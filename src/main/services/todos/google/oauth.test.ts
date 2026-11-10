import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import {
  buildAuthUrl,
  createPkce,
  createState,
  formBody,
  parseCallback,
  parseClientFile,
  parseStoredClient,
  parseTokenResponse,
  serializeClient,
  TASKS_SCOPE,
  tokenErrorKind
} from './oauth'

const CLIENT_ID = '123-abc.apps.googleusercontent.com'
const fixedBytes = (size: number): Buffer => Buffer.alloc(size, 7)

describe('PKCE', () => {
  it('makes a 43-character verifier and its S256 challenge', () => {
    const { verifier, challenge } = createPkce(fixedBytes)
    expect(verifier).toHaveLength(43)
    expect(verifier).toMatch(/^[\w-]+$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })

  it('uses fresh randomness each time by default', () => {
    expect(createPkce().verifier).not.toBe(createPkce().verifier)
    expect(createState()).not.toBe(createState())
  })
})

describe('buildAuthUrl', () => {
  it('asks Google for the Tasks scope only, with PKCE and offline access', () => {
    const url = new URL(
      buildAuthUrl({
        scopes: [TASKS_SCOPE],
        clientId: CLIENT_ID,
        redirectUri: 'http://127.0.0.1:5555',
        challenge: 'chal',
        state: 'st'
      })
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: 'http://127.0.0.1:5555',
      response_type: 'code',
      scope: TASKS_SCOPE,
      code_challenge: 'chal',
      code_challenge_method: 'S256',
      state: 'st',
      access_type: 'offline',
      prompt: 'select_account consent'
    })
  })
})

describe('parseCallback', () => {
  const params = (query: string): URLSearchParams => new URLSearchParams(query)

  it('returns the code when the state matches', () => {
    expect(parseCallback(params('state=abc&code=4%2F0xyz&scope=x'), 'abc')).toEqual({
      kind: 'code',
      code: '4/0xyz'
    })
  })

  it('returns Google’s error, such as a declined consent screen', () => {
    expect(parseCallback(params('state=abc&error=access_denied'), 'abc')).toEqual({
      kind: 'error',
      error: 'access_denied'
    })
  })

  it('ignores requests without our state or without a code', () => {
    expect(parseCallback(params('code=x'), 'abc')).toBeNull()
    expect(parseCallback(params('state=abd&code=x'), 'abc')).toBeNull()
    expect(parseCallback(params('state=ab&code=x'), 'abc')).toBeNull()
    expect(parseCallback(params('state=abc'), 'abc')).toBeNull()
    expect(parseCallback(params(`state=abc&code=${'x'.repeat(3000)}`), 'abc')).toBeNull()
  })
})

describe('formBody', () => {
  it('encodes fields and leaves out missing ones', () => {
    expect(formBody({ a: '1 2', b: null, c: 'x/y' })).toBe('a=1+2&c=x%2Fy')
  })
})

describe('parseTokenResponse', () => {
  it('reads the tokens and granted scopes', () => {
    expect(
      parseTokenResponse({
        access_token: 'ya29.a',
        expires_in: 3599,
        refresh_token: '1//r',
        scope: `${TASKS_SCOPE} openid`,
        token_type: 'Bearer'
      })
    ).toEqual({
      accessToken: 'ya29.a',
      expiresInSec: 3599,
      refreshToken: '1//r',
      scopes: [TASKS_SCOPE, 'openid']
    })
  })

  it('tolerates a missing refresh token and expiry', () => {
    expect(parseTokenResponse({ access_token: 'a' })).toEqual({
      accessToken: 'a',
      expiresInSec: 300,
      refreshToken: null,
      scopes: []
    })
  })

  it('rejects a response without an access token', () => {
    expect(parseTokenResponse({ error: 'invalid_grant' })).toBeNull()
    expect(parseTokenResponse(null)).toBeNull()
  })
})

describe('tokenErrorKind', () => {
  it('tells a dead sign-in from a bad client and an outage', () => {
    expect(tokenErrorKind(400, { error: 'invalid_grant' })).toBe('invalidGrant')
    expect(tokenErrorKind(401, { error: 'invalid_client' })).toBe('badClient')
    expect(tokenErrorKind(401, { error: 'deleted_client' })).toBe('badClient')
    expect(tokenErrorKind(503, null)).toBe('unavailable')
    expect(tokenErrorKind(429, null)).toBe('unavailable')
    expect(tokenErrorKind(400, { error: 'invalid_request' })).toBe('other')
  })
})

describe('parseClientFile', () => {
  const desktop = {
    installed: {
      client_id: CLIENT_ID,
      project_id: 'focus-screen',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      client_secret: 'GOCSPX-test',
      redirect_uris: ['http://localhost']
    }
  }

  it('reads a desktop client', () => {
    expect(parseClientFile(JSON.stringify(desktop))).toEqual({
      ok: true,
      client: { clientId: CLIENT_ID, clientSecret: 'GOCSPX-test' }
    })
  })

  it('explains that a web client won’t do', () => {
    const result = parseClientFile(JSON.stringify({ web: desktop.installed }))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('Desktop app')
  })

  it('rejects files that aren’t client files', () => {
    expect(parseClientFile('not json').ok).toBe(false)
    expect(parseClientFile('[]').ok).toBe(false)
    expect(parseClientFile(JSON.stringify({ installed: { client_id: 'nope' } })).ok).toBe(false)
  })
})

describe('stored client', () => {
  it('round-trips and rejects junk', () => {
    const client = { clientId: CLIENT_ID, clientSecret: 's' }
    expect(parseStoredClient(serializeClient(client))).toEqual(client)
    expect(parseStoredClient(null)).toBeNull()
    expect(parseStoredClient('{"clientId":"x"}')).toBeNull()
  })
})
