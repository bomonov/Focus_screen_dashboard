import { describe, expect, it } from 'vitest'
import type { JsonRequest, JsonResponse } from '../../http'
import type { SecretKey, SecretStore } from '../../secrets/store'
import { TodoSourceError } from '../provider'
import { createGoogleAuth, SignInError } from './auth'
import {
  CALENDAR_SCOPES,
  REVOKE_ENDPOINT,
  serializeClient,
  TASKS_SCOPE,
  TOKEN_ENDPOINT
} from './oauth'

const T0 = 1_800_000_000
const CLIENT = { clientId: '1-a.apps.googleusercontent.com', clientSecret: 'shh' }

function memorySecrets(initial: Partial<Record<SecretKey, string>> = {}): SecretStore {
  const values = new Map<SecretKey, string>(Object.entries(initial) as [SecretKey, string][])
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => void values.set(key, value),
    delete: (key) => void values.delete(key)
  }
}

interface Sent {
  url: string
  request: JsonRequest
  form: Record<string, string>
}

function fakeGoogle(replies: (JsonResponse | Error)[]): {
  sent: Sent[]
  request: (url: string, request: JsonRequest) => Promise<JsonResponse>
} {
  const sent: Sent[] = []
  return {
    sent,
    request: async (url, request) => {
      sent.push({ url, request, form: Object.fromEntries(new URLSearchParams(request.body)) })
      const reply = replies.shift()
      if (!reply) throw new Error('unexpected request')
      if (reply instanceof Error) throw reply
      return reply
    }
  }
}

const ok = (body: unknown): JsonResponse => ({ status: 200, body, retryAfterSec: null })
const fail = (status: number, error: string): JsonResponse => ({
  status,
  body: { error },
  retryAfterSec: null
})

function signedIn(): SecretStore {
  return memorySecrets({
    'google.oauthClient': serializeClient(CLIENT),
    'google.refreshToken': 'refresh-1'
  })
}

describe('google auth', () => {
  it('keeps the client and knows when it’s signed in', () => {
    const secrets = memorySecrets()
    const auth = createGoogleAuth({ secrets, request: fakeGoogle([]).request })
    expect(auth.client()).toBeNull()
    auth.setClient(CLIENT)
    expect(auth.client()).toEqual(CLIENT)
    expect(auth.isSignedIn()).toBe(false)
    secrets.set('google.refreshToken', 'r')
    expect(auth.isSignedIn()).toBe(true)
    // A different client can't use the old sign-in.
    auth.setClient({ ...CLIENT, clientId: '2-b.apps.googleusercontent.com' })
    expect(auth.isSignedIn()).toBe(false)
  })

  it('trades the code for tokens with PKCE and keeps only the refresh token', async () => {
    const secrets = memorySecrets({ 'google.oauthClient': serializeClient(CLIENT) })
    const google = fakeGoogle([
      ok({
        access_token: 'access-1',
        expires_in: 3599,
        refresh_token: 'refresh-1',
        scope: TASKS_SCOPE
      })
    ])
    const auth = createGoogleAuth({ secrets, request: google.request, now: () => T0 })
    await auth.completeSignIn('code-1', 'verifier-1', 'http://127.0.0.1:5000')
    expect(google.sent[0]?.url).toBe(TOKEN_ENDPOINT)
    expect(google.sent[0]?.form).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      code_verifier: 'verifier-1',
      redirect_uri: 'http://127.0.0.1:5000',
      client_id: CLIENT.clientId,
      client_secret: 'shh'
    })
    expect(secrets.get('google.refreshToken')).toBe('refresh-1')
    await expect(auth.accessToken()).resolves.toBe('access-1')
    expect(google.sent).toHaveLength(1)
  })

  it('refuses a sign-in without the Tasks scope and revokes it', async () => {
    const secrets = memorySecrets({ 'google.oauthClient': serializeClient(CLIENT) })
    const google = fakeGoogle([
      ok({ access_token: 'a', refresh_token: 'r', scope: 'openid' }),
      ok({})
    ])
    const auth = createGoogleAuth({ secrets, request: google.request })
    await expect(auth.completeSignIn('c', 'v', 'u')).rejects.toThrow(/Google Tasks box/)
    expect(google.sent[1]?.url).toBe(REVOKE_ENDPOINT)
    expect(secrets.get('google.refreshToken')).toBeNull()
  })

  it('says when Google rejects the client', async () => {
    const secrets = memorySecrets({ 'google.oauthClient': serializeClient(CLIENT) })
    const auth = createGoogleAuth({
      secrets,
      request: fakeGoogle([fail(401, 'invalid_client')]).request
    })
    const error = await auth.completeSignIn('c', 'v', 'u').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SignInError)
    expect(error).toMatchObject({ kind: 'badClient' })
  })

  it('refreshes the access token before it expires, once for concurrent callers', async () => {
    let clock = T0
    const google = fakeGoogle([
      ok({ access_token: 'a1', expires_in: 3600 }),
      ok({ access_token: 'a2', expires_in: 3600, refresh_token: 'refresh-2' })
    ])
    const secrets = signedIn()
    const auth = createGoogleAuth({ secrets, request: google.request, now: () => clock })
    const [first, second] = await Promise.all([auth.accessToken(), auth.accessToken()])
    expect([first, second]).toEqual(['a1', 'a1'])
    expect(google.sent[0]?.form).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1'
    })
    clock = T0 + 3550
    await expect(auth.accessToken()).resolves.toBe('a2')
    expect(secrets.get('google.refreshToken')).toBe('refresh-2')
  })

  it('gets a new token when Google refuses the cached one', async () => {
    const google = fakeGoogle([
      ok({ access_token: 'a1', expires_in: 3600 }),
      ok({ access_token: 'a2', expires_in: 3600 })
    ])
    const auth = createGoogleAuth({ secrets: signedIn(), request: google.request, now: () => T0 })
    expect(await auth.accessToken()).toBe('a1')
    expect(await auth.accessToken('a1')).toBe('a2')
  })

  it('signs out when the refresh token is dead', async () => {
    const secrets = signedIn()
    const auth = createGoogleAuth({
      secrets,
      request: fakeGoogle([fail(400, 'invalid_grant')]).request
    })
    const error = await auth.accessToken().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TodoSourceError)
    expect(error).toMatchObject({ kind: 'reconnect' })
    expect(auth.isSignedIn()).toBe(false)
    expect(auth.client()).toEqual(CLIENT)
  })

  it('forgets a client Google deleted', async () => {
    const secrets = signedIn()
    const auth = createGoogleAuth({
      secrets,
      request: fakeGoogle([fail(401, 'deleted_client')]).request
    })
    await expect(auth.accessToken()).rejects.toMatchObject({ kind: 'setup' })
    expect(auth.client()).toBeNull()
  })

  it('stays signed in when Google can’t be reached', async () => {
    const auth = createGoogleAuth({
      secrets: signedIn(),
      request: fakeGoogle([new Error('net::ERR_INTERNET_DISCONNECTED'), fail(503, '')]).request
    })
    await expect(auth.accessToken()).rejects.toMatchObject({ kind: 'offline' })
    await expect(auth.accessToken()).rejects.toMatchObject({ kind: 'offline' })
    expect(auth.isSignedIn()).toBe(true)
  })

  it('revokes the refresh token on sign-out, even offline', async () => {
    const secrets = signedIn()
    const google = fakeGoogle([new Error('offline')])
    const auth = createGoogleAuth({ secrets, request: google.request })
    await auth.signOut()
    expect(google.sent[0]).toMatchObject({ url: REVOKE_ENDPOINT, form: { token: 'refresh-1' } })
    expect(auth.isSignedIn()).toBe(false)
  })
})

describe('a sign-in of its own (Google Calendar)', () => {
  const options = {
    scopes: CALENDAR_SCOPES,
    tokenKey: 'google.calendarRefreshToken' as const,
    clientIdKey: 'google.calendarClientId' as const,
    product: 'Google Calendar',
    needs: 'to see your calendars'
  }

  it('needs every box ticked, and keeps its token apart from Tasks’', async () => {
    const secrets = memorySecrets({ 'google.oauthClient': serializeClient(CLIENT) })
    const halfway = fakeGoogle([
      ok({
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 3600,
        scope: CALENDAR_SCOPES[0]
      }),
      ok({})
    ])
    const auth = createGoogleAuth({ secrets, request: halfway.request, ...options })
    await expect(auth.completeSignIn('code', 'verifier', 'http://127.0.0.1:1/')).rejects.toThrow(
      'Focus Screen needs to see your calendars. Connect again and leave the Google Calendar boxes checked.'
    )
    const full = fakeGoogle([
      ok({
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 3600,
        scope: CALENDAR_SCOPES.join(' ')
      })
    ])
    const signedInAuth = createGoogleAuth({ secrets, request: full.request, ...options })
    await signedInAuth.completeSignIn('code', 'verifier', 'http://127.0.0.1:1/')
    expect(secrets.get('google.calendarRefreshToken')).toBe('r')
    expect(secrets.get('google.calendarClientId')).toBe(CLIENT.clientId)
    expect(secrets.get('google.refreshToken')).toBeNull()
    expect(signedInAuth.isSignedIn()).toBe(true)
  })
})
