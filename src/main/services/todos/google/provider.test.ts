import { describe, expect, it } from 'vitest'
import type { JsonRequest, JsonResponse } from '../../http'
import type { SecretKey, SecretStore } from '../../secrets/store'
import type { ListenForRedirect, RedirectResult } from './loopback'
import { serializeClient, TASKS_SCOPE, TOKEN_ENDPOINT } from './oauth'
import { createGoogleTasksProvider } from './provider'

const T0 = new Date(2026, 9, 14, 15, 0).getTime() / 1000
const CLIENT = { clientId: '1-a.apps.googleusercontent.com', clientSecret: 'shh' }
const API = 'https://tasks.googleapis.com/tasks/v1/'

function memorySecrets(initial: Partial<Record<SecretKey, string>> = {}): SecretStore {
  const values = new Map<SecretKey, string>(Object.entries(initial) as [SecretKey, string][])
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => void values.set(key, value),
    delete: (key) => void values.delete(key)
  }
}

const ok = (body: unknown): JsonResponse => ({ status: 200, body, retryAfterSec: null })
const status = (code: number, body: unknown = null): JsonResponse => ({
  status: code,
  body,
  retryAfterSec: null
})

interface Sent {
  url: string
  request: JsonRequest
}

/** Answers by URL; `route` returns undefined for anything the test didn't expect. */
function fakeGoogle(route: (url: URL, request: JsonRequest) => JsonResponse | undefined): {
  sent: Sent[]
  request: (url: string, request: JsonRequest) => Promise<JsonResponse>
} {
  const sent: Sent[] = []
  return {
    sent,
    request: async (url, request) => {
      sent.push({ url, request })
      const reply = route(new URL(url), request)
      if (!reply) throw new Error(`unexpected ${request.method} ${url}`)
      return reply
    }
  }
}

function tokenRoute(url: URL): JsonResponse | undefined {
  if (url.toString() === TOKEN_ENDPOINT) {
    return ok({ access_token: 'access', expires_in: 3600, scope: TASKS_SCOPE })
  }
  return undefined
}

function signedIn(): SecretStore {
  return memorySecrets({
    'google.oauthClient': serializeClient(CLIENT),
    'google.refreshToken': 'refresh'
  })
}

function fakeListen(): {
  listen: ListenForRedirect
  answer(result: RedirectResult): void
} {
  let answer: (result: RedirectResult) => void = () => {}
  return {
    answer: (result) => answer(result),
    listen: async () => {
      const result = new Promise<RedirectResult>((resolve) => {
        answer = resolve
      })
      return {
        redirectUri: 'http://127.0.0.1:5000',
        result,
        close: () => answer({ kind: 'cancelled' })
      }
    }
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('google tasks provider', () => {
  it('signs in through the browser and reports each step', async () => {
    const secrets = memorySecrets({ 'google.oauthClient': serializeClient(CLIENT) })
    const google = fakeGoogle((url) =>
      url.toString() === TOKEN_ENDPOINT
        ? ok({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: TASKS_SCOPE })
        : undefined
    )
    const loopback = fakeListen()
    const opened: string[] = []
    const provider = createGoogleTasksProvider({
      secrets,
      request: google.request,
      listen: loopback.listen,
      openBrowser: async (url) => void opened.push(url)
    })
    const changes: string[] = []
    provider.start(() => changes.push(provider.connection()))
    expect(provider.connection()).toBe('disconnected')

    const done = provider.connect()
    expect(provider.connection()).toBe('connecting')
    await flush()
    const authUrl = new URL(opened[0] ?? '')
    expect(authUrl.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5000')
    expect(authUrl.searchParams.get('client_id')).toBe(CLIENT.clientId)

    loopback.answer({ kind: 'code', code: 'code-1' })
    await expect(done).resolves.toEqual({ kind: 'connected' })
    expect(changes).toEqual(['connecting', 'connected'])
    expect(secrets.get('google.refreshToken')).toBe('r')
  })

  it('needs a client before it can sign in', async () => {
    const provider = createGoogleTasksProvider({
      secrets: memorySecrets(),
      request: fakeGoogle(() => undefined).request,
      listen: fakeListen().listen,
      openBrowser: async () => {}
    })
    expect(provider.hasClient()).toBe(false)
    await expect(provider.connect()).resolves.toMatchObject({ kind: 'failed' })
  })

  it('can be cancelled, and says when access was declined', async () => {
    const loopback = fakeListen()
    const provider = createGoogleTasksProvider({
      secrets: memorySecrets({ 'google.oauthClient': serializeClient(CLIENT) }),
      request: fakeGoogle(() => undefined).request,
      listen: loopback.listen,
      openBrowser: async () => {}
    })
    const first = provider.connect()
    await flush()
    provider.cancelConnect()
    await expect(first).resolves.toEqual({ kind: 'cancelled' })
    expect(provider.connection()).toBe('disconnected')

    const second = provider.connect()
    await flush()
    loopback.answer({ kind: 'error', error: 'access_denied' })
    await expect(second).resolves.toEqual({
      kind: 'failed',
      message: 'Access was declined on Google’s sign-in page.'
    })
  })

  it('lists open tasks and today’s finished ones from every list, in Google’s order', async () => {
    const google = fakeGoogle((url) => {
      const token = tokenRoute(url)
      if (token) return token
      const path = url.toString().replace(API, '').split('?')[0]
      if (path === 'users/@me/lists') {
        return url.searchParams.get('pageToken')
          ? ok({ items: [{ id: 'L2', title: 'Groceries' }] })
          : ok({ items: [{ id: 'L1', title: 'My Tasks' }], nextPageToken: 'p2' })
      }
      const open = url.searchParams.get('showCompleted') === 'false'
      if (path === 'lists/L1/tasks') {
        expect(url.searchParams.get('completedMin') ?? '').toBe(
          open ? '' : new Date(2026, 9, 14).toISOString()
        )
        return open
          ? ok({
              items: [
                { id: 'b', title: 'Second', status: 'needsAction', position: '2' },
                {
                  id: 'a',
                  title: 'First',
                  status: 'needsAction',
                  position: '1',
                  due: '2026-10-15T00:00:00.000Z'
                }
              ]
            })
          : ok({
              items: [
                {
                  id: 'c',
                  title: 'Finished',
                  status: 'completed',
                  completed: '2026-10-14T16:00:00.000Z',
                  position: '0'
                }
              ]
            })
      }
      if (path === 'lists/L2/tasks') {
        return open ? ok({ items: [{ id: 'm', title: 'Milk', status: 'needsAction' }] }) : ok({})
      }
      return undefined
    })
    const provider = createGoogleTasksProvider({
      secrets: signedIn(),
      request: google.request,
      listen: fakeListen().listen,
      openBrowser: async () => {},
      now: () => T0
    })

    const todos = await provider.list()
    expect(todos.map((todo) => [todo.id, todo.context, todo.done])).toEqual([
      ['L1/c', 'Google · My Tasks', true],
      ['L1/a', 'Google · My Tasks', false],
      ['L1/b', 'Google · My Tasks', false],
      ['L2/m', 'Google · Groceries', false]
    ])
    expect(todos[1]?.due).toEqual({ kind: 'day', day: '2026-10-15' })
    const apiCalls = google.sent.filter((call) => call.url.startsWith(API))
    expect(apiCalls.every((call) => call.request.headers?.Authorization === 'Bearer access')).toBe(
      true
    )
  })

  it('checks a task off with a PATCH to its list', async () => {
    const google = fakeGoogle((url, request) => {
      const token = tokenRoute(url)
      if (token) return token
      const path = url.toString().replace(API, '').split('?')[0]
      if (path === 'users/@me/lists') return ok({ items: [{ id: 'L1', title: 'My Tasks' }] })
      if (path === 'lists/L1/tasks') {
        return ok({ items: [{ id: 'T1', title: 'Task', status: 'needsAction' }] })
      }
      if (path === 'lists/L1/tasks/T1' && request.method === 'PATCH') return ok({ id: 'T1' })
      return undefined
    })
    const provider = createGoogleTasksProvider({
      secrets: signedIn(),
      request: google.request,
      listen: fakeListen().listen,
      openBrowser: async () => {}
    })
    await provider.list()
    await provider.setDone('L1/T1', true)
    const patch = google.sent.at(-1)
    expect(patch?.request).toMatchObject({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access' }
    })
    expect(JSON.parse(patch?.request.body ?? '')).toEqual({ status: 'completed' })
    await expect(provider.setDone('L1/unknown', true)).rejects.toMatchObject({ kind: 'offline' })
  })

  it('retries once with a new token when Google refuses the old one', async () => {
    let tokens = 0
    let listCalls = 0
    const google = fakeGoogle((url) => {
      if (url.toString() === TOKEN_ENDPOINT) {
        tokens += 1
        return ok({ access_token: `access-${tokens}`, expires_in: 3600 })
      }
      listCalls += 1
      return listCalls === 1 ? status(401) : ok({ items: [] })
    })
    const provider = createGoogleTasksProvider({
      secrets: signedIn(),
      request: google.request,
      listen: fakeListen().listen,
      openBrowser: async () => {}
    })
    await expect(provider.list()).resolves.toEqual([])
    expect(tokens).toBe(2)
    expect(google.sent.at(-1)?.request.headers?.Authorization).toBe('Bearer access-2')
  })

  it('signs out when Google keeps refusing, and stays signed in when the API is off', async () => {
    let reply = status(401)
    const google = fakeGoogle((url) => tokenRoute(url) ?? reply)
    const provider = createGoogleTasksProvider({
      secrets: signedIn(),
      request: google.request,
      listen: fakeListen().listen,
      openBrowser: async () => {}
    })
    let changes = 0
    provider.start(() => (changes += 1))

    reply = status(403, {
      error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] }
    })
    await expect(provider.list()).rejects.toMatchObject({ kind: 'setup' })
    expect(provider.connection()).toBe('connected')

    reply = status(401)
    await expect(provider.list()).rejects.toMatchObject({ kind: 'reconnect' })
    expect(provider.connection()).toBe('disconnected')
    expect(changes).toBe(1)
  })

  it('reports offline when the network is down', async () => {
    const provider = createGoogleTasksProvider({
      secrets: signedIn(),
      request: async () => {
        throw new Error('net::ERR_INTERNET_DISCONNECTED')
      },
      listen: fakeListen().listen,
      openBrowser: async () => {}
    })
    await expect(provider.list()).rejects.toMatchObject({ kind: 'offline' })
    expect(provider.connection()).toBe('connected')
  })

  it('disconnects at once, revoking in the background', async () => {
    const secrets = signedIn()
    const google = fakeGoogle(() => ok({}))
    const provider = createGoogleTasksProvider({
      secrets,
      request: google.request,
      listen: fakeListen().listen,
      openBrowser: async () => {}
    })
    const changes: string[] = []
    provider.start(() => changes.push(provider.connection()))
    const disconnecting = provider.disconnect()
    expect(changes).toEqual(['disconnected'])
    await disconnecting
    expect(provider.hasClient()).toBe(true)
    expect(secrets.get('google.refreshToken')).toBeNull()
  })
})
