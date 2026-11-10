import type { JsonRequest, JsonResponse } from '../../http'
import type { SecretKey, SecretStore } from '../../secrets/store'
import { TodoSourceError } from '../provider'
import {
  FORM_HEADERS,
  formBody,
  parseStoredClient,
  parseTokenResponse,
  REVOKE_ENDPOINT,
  serializeClient,
  TASKS_SCOPE,
  TOKEN_ENDPOINT,
  tokenErrorKind,
  type GoogleClient
} from './oauth'

/** Sends one request; rejects only when the network fails. Injected so tests never reach Google. */
export type RequestJson = (url: string, request: JsonRequest) => Promise<JsonResponse>

/** Get a new access token this long before Google says the old one expires. */
const EXPIRY_MARGIN_SEC = 60

/** Why finishing a sign-in failed; the message is shown to the user as is. */
export class SignInError extends Error {
  constructor(
    readonly kind: 'badClient' | 'offline' | 'other',
    message: string
  ) {
    super(message)
    this.name = 'SignInError'
  }
}

export interface GoogleAuth {
  client(): GoogleClient | null
  setClient(client: GoogleClient): void
  forgetClient(): void
  isSignedIn(): boolean
  /** Trades the code from the browser for tokens and keeps the refresh token. Throws SignInError. */
  completeSignIn(code: string, verifier: string, redirectUri: string): Promise<void>
  /**
   * A working access token. Pass the one Google just refused to force a new one.
   * Throws TodoSourceError; a dead sign-in also signs out.
   */
  accessToken(refused?: string): Promise<string>
  /** Forgets the sign-in here without telling Google (it's already dead there). */
  forgetSignIn(): void
  /** Forgets the sign-in and asks Google to revoke it. */
  signOut(): Promise<void>
}

export interface GoogleAuthOptions {
  secrets: SecretStore
  request: RequestJson
  /** Unix epoch seconds; injectable for tests. */
  now?: () => number
  /** What this sign-in may do; Google Tasks unless said. */
  scopes?: readonly string[]
  /** Where its refresh token is kept: each product signs in on its own. */
  tokenKey?: SecretKey
  /**
   * Where the id of the client it signed in with is kept, for a sign-in that shares the client
   * with another: when the client changes, its token is no good, and it says so up front.
   */
  clientIdKey?: SecretKey | null
  /** "Google Tasks", for its messages. */
  product?: string
  /** "access to your tasks", for the message when a box was left unticked. */
  needs?: string
}

const epochSeconds = (): number => Date.now() / 1000

/**
 * Google sign-in state. The refresh token lives only in the secret store (safeStorage);
 * access tokens last an hour and stay in memory. Neither is ever logged.
 */
export function createGoogleAuth({
  secrets,
  request,
  now = epochSeconds,
  scopes = [TASKS_SCOPE],
  tokenKey = 'google.refreshToken',
  clientIdKey = null,
  product = 'Google Tasks',
  needs = 'access to your tasks'
}: GoogleAuthOptions): GoogleAuth {
  let cached: { token: string; expiresAt: number } | null = null
  let refreshing: Promise<string> | null = null
  /** Bumped on sign-out, so a refresh that was already running can't sign back in. */
  let generation = 0

  const client = (): GoogleClient | null => parseStoredClient(secrets.get('google.oauthClient'))
  /** Signed in with the client there is now (or not keeping track: only one sign-in uses it). */
  const sameClient = (): boolean =>
    clientIdKey === null || secrets.get(clientIdKey) === client()?.clientId

  function forgetSignIn(): void {
    generation += 1
    cached = null
    secrets.delete(tokenKey)
    if (clientIdKey) secrets.delete(clientIdKey)
  }

  function post(body: string): Promise<JsonResponse> {
    return request(TOKEN_ENDPOINT, { method: 'POST', headers: FORM_HEADERS, body })
  }

  async function refresh(): Promise<string> {
    const refreshToken = secrets.get(tokenKey)
    const current = client()
    if (refreshToken && current && !sameClient()) forgetSignIn()
    if (!refreshToken || !current || !sameClient()) {
      throw new TodoSourceError('reconnect', `Connect ${product} again.`)
    }
    const startedIn = generation
    let response: JsonResponse
    try {
      response = await post(
        formBody({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: current.clientId,
          client_secret: current.clientSecret
        })
      )
    } catch {
      throw new TodoSourceError('offline', 'Couldn’t reach Google.')
    }
    if (startedIn !== generation) throw new TodoSourceError('reconnect', 'Signed out.')

    const tokens = response.status === 200 ? parseTokenResponse(response.body) : null
    if (tokens) {
      cached = { token: tokens.accessToken, expiresAt: now() + tokens.expiresInSec }
      // Google can rotate the refresh token; keep the new one.
      if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
        secrets.set(tokenKey, tokens.refreshToken)
      }
      return tokens.accessToken
    }

    switch (tokenErrorKind(response.status, response.body)) {
      case 'invalidGrant':
        forgetSignIn()
        throw new TodoSourceError(
          'reconnect',
          'Your Google sign-in expired or was revoked. Connect again.'
        )
      case 'badClient':
        forgetSignIn()
        secrets.delete('google.oauthClient')
        throw new TodoSourceError(
          'setup',
          'Google no longer accepts your OAuth client. Connect again and choose a current client file.'
        )
      case 'unavailable':
        throw new TodoSourceError('offline', 'Google sign-in is having trouble. Trying again soon.')
      default:
        throw new TodoSourceError('offline', `Google sign-in said no (error ${response.status}).`)
    }
  }

  return {
    client,
    setClient(next) {
      if (client()?.clientId !== next.clientId) forgetSignIn()
      secrets.set('google.oauthClient', serializeClient(next))
    },
    forgetClient() {
      forgetSignIn()
      secrets.delete('google.oauthClient')
    },
    isSignedIn: () => secrets.get(tokenKey) !== null && client() !== null && sameClient(),

    async completeSignIn(code, verifier, redirectUri) {
      const current = client()
      if (!current) throw new SignInError('badClient', 'Choose your OAuth client file first.')
      let response: JsonResponse
      try {
        response = await post(
          formBody({
            grant_type: 'authorization_code',
            code,
            code_verifier: verifier,
            redirect_uri: redirectUri,
            client_id: current.clientId,
            client_secret: current.clientSecret
          })
        )
      } catch {
        throw new SignInError('offline', 'Couldn’t reach Google to finish signing in. Try again.')
      }

      const tokens = response.status === 200 ? parseTokenResponse(response.body) : null
      if (!tokens) {
        if (tokenErrorKind(response.status, response.body) === 'badClient') {
          throw new SignInError(
            'badClient',
            'Google didn’t accept your OAuth client. Make sure it’s a “Desktop app” client, then connect again and choose its file.'
          )
        }
        throw new SignInError('other', 'Google didn’t finish the sign-in. Try connecting again.')
      }
      // With granular consent the user can untick a box and still click Continue.
      if (!scopes.every((scope) => tokens.scopes.includes(scope))) {
        void request(REVOKE_ENDPOINT, {
          method: 'POST',
          headers: FORM_HEADERS,
          body: formBody({ token: tokens.refreshToken ?? tokens.accessToken })
        }).catch(() => {})
        throw new SignInError(
          'other',
          `Focus Screen needs ${needs}. Connect again and leave the ${product} boxes checked.`
        )
      }
      if (!tokens.refreshToken) {
        throw new SignInError(
          'other',
          'Google didn’t send a lasting sign-in. Try connecting again.'
        )
      }
      generation += 1
      secrets.set(tokenKey, tokens.refreshToken)
      if (clientIdKey) secrets.set(clientIdKey, current.clientId)
      cached = { token: tokens.accessToken, expiresAt: now() + tokens.expiresInSec }
    },

    accessToken(refused) {
      if (cached && cached.token !== refused && now() < cached.expiresAt - EXPIRY_MARGIN_SEC) {
        return Promise.resolve(cached.token)
      }
      if (cached?.token === refused) cached = null
      refreshing ??= refresh().finally(() => {
        refreshing = null
      })
      return refreshing
    },

    forgetSignIn,

    async signOut() {
      const refreshToken = secrets.get(tokenKey)
      forgetSignIn()
      if (!refreshToken) return
      try {
        await request(REVOKE_ENDPOINT, {
          method: 'POST',
          headers: FORM_HEADERS,
          body: formBody({ token: refreshToken })
        })
      } catch {
        // Offline: the token is gone from this computer either way, and the user can remove
        // access at myaccount.google.com.
      }
    }
  }
}
