import { SignInError, type GoogleAuth } from './auth'
import type { ListenForRedirect, LoopbackRedirect } from './loopback'
import { buildAuthUrl, createPkce, createState, type GoogleClient } from './oauth'

/** Long enough to sign in and pick an account; the loopback port closes after. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000

export type ConnectResult =
  { kind: 'connected' } | { kind: 'cancelled' } | { kind: 'failed'; message: string }

export type GoogleConnectionState = 'connected' | 'connecting' | 'disconnected'

/** One Google sign-in (Tasks', or Calendar's) and the browser round trip that makes it. */
export interface GoogleConnection {
  state(): GoogleConnectionState
  hasClient(): boolean
  setClient(client: GoogleClient): void
  /** Signs in through the browser. Resolves when it's done, declined, timed out or cancelled. */
  connect(): Promise<ConnectResult>
  cancel(): void
  /** Forgets the sign-in here and revokes it at Google. Keeps the OAuth client. */
  disconnect(): Promise<void>
}

export interface GoogleConnectionOptions {
  auth: GoogleAuth
  /** What to ask Google for: the same scopes `auth` checks for. */
  scopes: readonly string[]
  listen: ListenForRedirect
  /** Opens the system browser (Google blocks sign-in inside app windows). */
  openBrowser: (url: string) => Promise<void>
  /** Told whenever the state may have changed. */
  changed: () => void
}

/**
 * Signs in with the user's own OAuth client: PKCE, a one-shot loopback redirect on 127.0.0.1,
 * and the system browser.
 */
export function createGoogleConnection({
  auth,
  scopes,
  listen,
  openBrowser,
  changed
}: GoogleConnectionOptions): GoogleConnection {
  let attempt: { cancel(): void; done: Promise<ConnectResult> } | null = null

  async function signIn(
    client: GoogleClient,
    isCancelled: () => boolean,
    keep: (redirect: LoopbackRedirect) => void
  ): Promise<ConnectResult> {
    const pkce = createPkce()
    const state = createState()
    let redirect: LoopbackRedirect
    try {
      redirect = await listen({ state, timeoutMs: SIGN_IN_TIMEOUT_MS })
    } catch {
      return { kind: 'failed', message: 'Couldn’t start the sign-in. Try again.' }
    }
    keep(redirect)
    if (isCancelled()) {
      redirect.close()
      return { kind: 'cancelled' }
    }
    try {
      await openBrowser(
        buildAuthUrl({
          clientId: client.clientId,
          redirectUri: redirect.redirectUri,
          challenge: pkce.challenge,
          state,
          scopes
        })
      )
    } catch {
      redirect.close()
      return { kind: 'failed', message: 'Couldn’t open your web browser to sign in.' }
    }

    const result = await redirect.result
    switch (result.kind) {
      case 'cancelled':
        return { kind: 'cancelled' }
      case 'timeout':
        return {
          kind: 'failed',
          message: 'The sign-in took longer than 5 minutes. Connect again when you’re ready.'
        }
      case 'error':
        return {
          kind: 'failed',
          message:
            result.error === 'access_denied'
              ? 'Access was declined on Google’s sign-in page.'
              : `Google stopped the sign-in (${result.error}).`
        }
      case 'code':
        try {
          await auth.completeSignIn(result.code, pkce.verifier, redirect.redirectUri)
          return { kind: 'connected' }
        } catch (error) {
          if (error instanceof SignInError) {
            // Ask for the file again next time instead of failing the same way forever.
            if (error.kind === 'badClient') auth.forgetClient()
            return { kind: 'failed', message: error.message }
          }
          return { kind: 'failed', message: 'Google didn’t finish the sign-in. Try again.' }
        }
    }
  }

  return {
    state: () => (attempt ? 'connecting' : auth.isSignedIn() ? 'connected' : 'disconnected'),
    hasClient: () => auth.client() !== null,
    setClient(client) {
      auth.setClient(client)
      changed()
    },

    connect() {
      if (auth.isSignedIn()) return Promise.resolve({ kind: 'connected' })
      if (attempt) return attempt.done
      const client = auth.client()
      if (!client) {
        return Promise.resolve({
          kind: 'failed',
          message: 'Choose your Google OAuth client file first.'
        })
      }
      let cancelled = false
      let redirect: LoopbackRedirect | null = null
      const done = signIn(
        client,
        () => cancelled,
        (open) => {
          redirect = open
        }
      ).finally(() => {
        attempt = null
        changed()
      })
      attempt = {
        cancel: () => {
          cancelled = true
          redirect?.close()
        },
        done
      }
      changed()
      return done
    },

    cancel() {
      attempt?.cancel()
    },

    async disconnect() {
      attempt?.cancel()
      const signOut = auth.signOut()
      // The token is already gone from this computer; Google hears about it in the background.
      changed()
      await signOut
    }
  }
}
