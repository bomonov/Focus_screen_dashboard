import { createHash, randomBytes, timingSafeEqual } from 'crypto'

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
export const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
/** Read and check off tasks: Google Tasks' only scope. No Drive, Gmail or profile, ever. */
export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'
/**
 * Next class from Google Calendar: the list of calendars, to pick the class ones, and their
 * events, read-only. Nothing can be changed or added with these.
 */
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly'
] as const

/** The user's own OAuth client, from the JSON file Google Cloud Console downloads. */
export interface GoogleClient {
  clientId: string
  /** Google calls it a secret, but a desktop app can't keep one; it still goes in safeStorage. */
  clientSecret: string | null
}

export interface Pkce {
  verifier: string
  challenge: string
}

type RandomBytes = (size: number) => Buffer

/** RFC 7636 S256: 32 random bytes make a 43-character verifier, Google's minimum. */
export function createPkce(random: RandomBytes = randomBytes): Pkce {
  const verifier = random(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function createState(random: RandomBytes = randomBytes): string {
  return random(24).toString('base64url')
}

export function buildAuthUrl(options: {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  scopes: readonly string[]
}): string {
  const url = new URL(AUTH_ENDPOINT)
  url.searchParams.set('client_id', options.clientId)
  url.searchParams.set('redirect_uri', options.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', options.scopes.join(' '))
  url.searchParams.set('code_challenge', options.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', options.state)
  // A refresh token, so the list keeps updating after the first hour…
  url.searchParams.set('access_type', 'offline')
  // …and every time, even when this Google account already said yes once. The account chooser
  // too: with a school and a personal account signed in, Google would otherwise just pick one.
  url.searchParams.set('prompt', 'select_account consent')
  return url.toString()
}

export type CallbackResult = { kind: 'code'; code: string } | { kind: 'error'; error: string }

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * What a request to the loopback server says. Null unless it carries our state, so a page
 * that guesses the port can't hand us a code from someone else's account.
 */
export function parseCallback(
  params: URLSearchParams,
  expectedState: string
): CallbackResult | null {
  const state = params.get('state')
  if (!state || !sameText(state, expectedState)) return null
  const error = params.get('error')
  if (error) return { kind: 'error', error: error.slice(0, 100) }
  const code = params.get('code')
  return code && code.length <= 2048 ? { kind: 'code', code } : null
}

export function formBody(params: Record<string, string | null>): string {
  const body = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) if (value !== null) body.set(name, value)
  return body.toString()
}

export const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' }

export interface TokenResponse {
  accessToken: string
  expiresInSec: number
  /** Only on the first exchange (and when Google rotates it). */
  refreshToken: string | null
  scopes: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== ''

export function parseTokenResponse(body: unknown): TokenResponse | null {
  if (!isRecord(body) || !nonEmpty(body.access_token)) return null
  const expires = body.expires_in
  return {
    accessToken: body.access_token,
    // Google says 3599; a missing value gets a cautious five minutes.
    expiresInSec:
      typeof expires === 'number' && Number.isFinite(expires) && expires > 0 ? expires : 300,
    refreshToken: nonEmpty(body.refresh_token) ? body.refresh_token : null,
    scopes: typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : []
  }
}

export type TokenErrorKind =
  /** The refresh token (or code) is expired, revoked or already used. */
  | 'invalidGrant'
  /** The OAuth client is wrong, deleted, or not a desktop client. */
  | 'badClient'
  | 'unavailable'
  | 'other'

export function tokenErrorKind(status: number, body: unknown): TokenErrorKind {
  const error = isRecord(body) && typeof body.error === 'string' ? body.error : ''
  if (error === 'invalid_grant') return 'invalidGrant'
  if (['invalid_client', 'unauthorized_client', 'deleted_client'].includes(error)) {
    return 'badClient'
  }
  if (status === 429 || status >= 500) return 'unavailable'
  return 'other'
}

const CLIENT_ID = /^[\w.-]+\.apps\.googleusercontent\.com$/
const NOT_A_CLIENT_FILE =
  'That file isn’t a Google OAuth client file. In Google Cloud Console, open your “Desktop app” client and click Download JSON.'

export type ClientFileResult = { ok: true; client: GoogleClient } | { ok: false; message: string }

/** Reads the client JSON Google Cloud Console downloads (`{"installed": {...}}`). */
export function parseClientFile(text: string): ClientFileResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: NOT_A_CLIENT_FILE }
  }
  if (!isRecord(raw)) return { ok: false, message: NOT_A_CLIENT_FILE }
  if (isRecord(raw.web) && !isRecord(raw.installed)) {
    return {
      ok: false,
      message:
        'That’s a “Web application” client. Focus Screen needs one of type “Desktop app”: create it in Google Cloud Console and download its JSON.'
    }
  }
  const installed = raw.installed
  if (!isRecord(installed)) return { ok: false, message: NOT_A_CLIENT_FILE }
  const { client_id: clientId, client_secret: clientSecret } = installed
  if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId)) {
    return { ok: false, message: NOT_A_CLIENT_FILE }
  }
  return {
    ok: true,
    client: { clientId, clientSecret: nonEmpty(clientSecret) ? clientSecret : null }
  }
}

/** The client as kept in the secret store. */
export function serializeClient(client: GoogleClient): string {
  return JSON.stringify(client)
}

export function parseStoredClient(text: string | null): GoogleClient | null {
  if (!text) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw) || typeof raw.clientId !== 'string' || !CLIENT_ID.test(raw.clientId)) {
    return null
  }
  return {
    clientId: raw.clientId,
    clientSecret: nonEmpty(raw.clientSecret) ? raw.clientSecret : null
  }
}
