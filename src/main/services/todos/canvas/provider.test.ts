import { describe, expect, it } from 'vitest'
import type { JsonRequest, JsonResponse } from '../../http'
import type { SecretKey, SecretStore } from '../../secrets/store'
import { TodoSourceError } from '../provider'
import type { FeedMarks } from './feedMarks'
import { createCanvasProvider, type FetchText } from './provider'

const ORIGIN = 'https://canvas.school.edu'
const TOKEN = `1234~${'a'.repeat(64)}`
const FEED_URL = `${ORIGIN}/feeds/calendars/user_AbC123.ics`
// Wednesday, October 14, 2026, 3:00 PM local time.
const NOW = new Date(2026, 9, 14, 15, 0).getTime() / 1000
const DUE_TONIGHT = new Date(2026, 9, 14, 23, 59).toISOString()

function memorySecrets(initial: Partial<Record<SecretKey, string>> = {}): SecretStore & {
  values: Map<SecretKey, string>
} {
  const values = new Map<SecretKey, string>(Object.entries(initial) as [SecretKey, string][])
  return {
    values,
    get: (key) => values.get(key) ?? null,
    set: (key, value) => void values.set(key, value),
    delete: (key) => void values.delete(key)
  }
}

function memoryMarks(): FeedMarks & { values: Map<string, number> } {
  const values = new Map<string, number>()
  return {
    values,
    get: (uid) => values.get(uid),
    set: (uid, at) => void (at === null ? values.delete(uid) : values.set(uid, at)),
    keepOnly: (uids) => {
      for (const uid of values.keys()) if (!uids.has(uid)) values.delete(uid)
    },
    clear: () => values.clear()
  }
}

const reply = (status: number, body: unknown = null, next?: string): JsonResponse => ({
  status,
  body,
  retryAfterSec: null,
  ...(next ? { next } : {})
})

interface Sent {
  url: URL
  request: JsonRequest
}

function fakeCanvas(route: (url: URL, request: JsonRequest) => JsonResponse | undefined): {
  sent: Sent[]
  request: (url: string, request: JsonRequest) => Promise<JsonResponse>
} {
  const sent: Sent[] = []
  return {
    sent,
    request: async (raw, request) => {
      const url = new URL(raw)
      sent.push({ url, request })
      const answer = route(url, request)
      if (!answer) throw new Error(`unexpected ${request.method} ${raw}`)
      return answer
    }
  }
}

const noFeed: FetchText = async () => {
  throw new Error('no feed in this test')
}

function assignment(id: number, changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    course_id: 101,
    plannable_id: id,
    plannable_type: 'assignment',
    planner_override: null,
    submissions: { submitted: false },
    plannable_date: DUE_TONIGHT,
    plannable: { id, title: `Assignment ${id}`, course_id: 101 },
    context_name: 'General Biology I',
    ...changes
  }
}

function connected(): ReturnType<typeof memorySecrets> {
  return memorySecrets({ 'canvas.site': ORIGIN, 'canvas.token': TOKEN })
}

describe('Canvas provider, connecting', () => {
  it('checks the token with Canvas before keeping it', async () => {
    const secrets = memorySecrets()
    const canvas = fakeCanvas((url) =>
      url.pathname === '/api/v1/users/self' ? reply(200, { id: 1, name: 'Student' }) : undefined
    )
    const provider = createCanvasProvider({
      secrets,
      request: canvas.request,
      fetchFeed: noFeed,
      marks: memoryMarks(),
      now: () => NOW
    })
    let changes = 0
    provider.start(() => changes++)
    expect(provider.connection()).toBe('disconnected')

    expect(await provider.connectToken('canvas.school.edu/courses', `  ${TOKEN}\n`)).toEqual({
      ok: true
    })
    expect(canvas.sent[0]?.request.headers?.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(secrets.values.get('canvas.site')).toBe(ORIGIN)
    expect(secrets.values.get('canvas.token')).toBe(TOKEN)
    expect(provider.connection()).toBe('connected')
    expect(provider.address()).toBe('canvas.school.edu')
    expect(provider.localCheckOffs?.()).toBe(false)
    expect(changes).toBe(1)
  })

  it('says which field is wrong, and keeps nothing', async () => {
    const secrets = memorySecrets()
    let status = 401
    let body: unknown = { errors: [{ message: 'Invalid access token.' }] }
    const provider = createCanvasProvider({
      secrets,
      request: async () => reply(status, body),
      fetchFeed: noFeed,
      marks: memoryMarks()
    })
    expect(await provider.connectToken('canvas', TOKEN)).toMatchObject({ field: 'address' })
    expect(await provider.connectToken('canvas.school.edu', 'oops')).toMatchObject({
      field: 'token'
    })
    expect(await provider.connectToken('canvas.school.edu', TOKEN)).toEqual({
      ok: false,
      message: 'Canvas didn’t accept that token. Copy it again, or make a new one.',
      field: 'token'
    })
    status = 200
    body = '<html>not canvas</html>'
    expect(await provider.connectToken('example.com', TOKEN)).toEqual({
      ok: false,
      message: 'example.com doesn’t look like a Canvas site. Check the address.',
      field: 'address'
    })
    expect(secrets.values.size).toBe(0)
  })

  it('says when Canvas can’t be reached', async () => {
    const provider = createCanvasProvider({
      secrets: memorySecrets(),
      request: async () => {
        throw new Error('offline')
      },
      fetchFeed: noFeed,
      marks: memoryMarks()
    })
    expect(await provider.connectToken('canvas.school.edu', TOKEN)).toEqual({
      ok: false,
      message: 'Couldn’t reach canvas.school.edu. Check the address and your connection.',
      field: 'address'
    })
  })

  it('forgets the token on disconnect but remembers the address', () => {
    const secrets = connected()
    const provider = createCanvasProvider({
      secrets,
      request: async () => reply(200, []),
      fetchFeed: noFeed,
      marks: memoryMarks()
    })
    let changes = 0
    provider.start(() => changes++)
    provider.disconnect()
    expect(provider.connection()).toBe('disconnected')
    expect(secrets.values.has('canvas.token')).toBe(false)
    expect(provider.address()).toBe('canvas.school.edu')
    expect(changes).toBe(1)
  })
})

describe('Canvas provider, listing', () => {
  it('lists planner items with short course codes, following pages', async () => {
    const canvas = fakeCanvas((url) => {
      if (url.pathname === '/api/v1/planner/items') {
        return url.searchParams.get('page') === '2'
          ? reply(200, [assignment(2)])
          : reply(200, [assignment(1)], `${ORIGIN}/api/v1/planner/items?page=2&per_page=100`)
      }
      if (url.pathname === '/api/v1/courses') {
        return reply(200, [{ id: 101, name: 'General Biology I', course_code: 'BIO 181' }])
      }
      return undefined
    })
    const provider = createCanvasProvider({
      secrets: connected(),
      request: canvas.request,
      fetchFeed: noFeed,
      marks: memoryMarks(),
      now: () => NOW
    })
    const todos = await provider.list()
    expect(todos.map((todo) => [todo.id, todo.context])).toEqual([
      ['assignment:1', 'Canvas · BIO 181'],
      ['assignment:2', 'Canvas · BIO 181']
    ])
    expect(todos[0]?.due).toEqual({ kind: 'time', at: Date.parse(DUE_TONIGHT) / 1000 })
    for (const { url, request } of canvas.sent) {
      expect(url.origin).toBe(ORIGIN)
      expect(request.headers?.Authorization).toBe(`Bearer ${TOKEN}`)
    }
  })

  it('never sends the token to another site, even if a page link says so', async () => {
    const canvas = fakeCanvas((url) => {
      if (url.pathname === '/api/v1/planner/items') {
        return reply(200, [assignment(1)], 'https://evil.example/api/v1/planner/items?page=2')
      }
      if (url.pathname === '/api/v1/courses') return reply(200, [])
      return undefined
    })
    const provider = createCanvasProvider({
      secrets: connected(),
      request: canvas.request,
      fetchFeed: noFeed,
      marks: memoryMarks(),
      now: () => NOW
    })
    await expect(provider.list()).rejects.toMatchObject({ kind: 'offline' })
    expect(canvas.sent.every(({ url }) => url.origin === ORIGIN)).toBe(true)
  })

  it('falls back to the course name when the course list is off limits', async () => {
    const canvas = fakeCanvas((url) => {
      if (url.pathname === '/api/v1/planner/items') {
        return reply(200, [assignment(1, { context_name: 'CHM 113: General Chemistry' })])
      }
      if (url.pathname === '/api/v1/courses') return reply(403, { errors: [] })
      return undefined
    })
    const provider = createCanvasProvider({
      secrets: connected(),
      request: canvas.request,
      fetchFeed: noFeed,
      marks: memoryMarks(),
      now: () => NOW
    })
    expect((await provider.list())[0]?.context).toBe('Canvas · CHM 113')
  })

  it('keeps work done today and drops older done work', async () => {
    const overrideAt = (iso: string): Record<string, unknown> => ({
      id: 9,
      marked_complete: true,
      updated_at: iso
    })
    const canvas = fakeCanvas((url) => {
      if (url.pathname === '/api/v1/planner/items') {
        return reply(200, [
          assignment(1, {
            plannable_date: '2026-10-20T06:59:00Z',
            planner_override: overrideAt(new Date(NOW * 1000 - 60_000).toISOString())
          }),
          assignment(2, {
            plannable_date: '2026-10-20T06:59:00Z',
            planner_override: overrideAt('2026-10-10T12:00:00Z')
          })
        ])
      }
      if (url.pathname === '/api/v1/courses') return reply(200, [])
      return undefined
    })
    const provider = createCanvasProvider({
      secrets: connected(),
      request: canvas.request,
      fetchFeed: noFeed,
      marks: memoryMarks(),
      now: () => NOW
    })
    const todos = await provider.list()
    expect(todos.map((todo) => [todo.id, todo.done])).toEqual([['assignment:1', true]])
  })

  it('signs out when Canvas stops accepting the token', async () => {
    const secrets = connected()
    const provider = createCanvasProvider({
      secrets,
      request: async () => reply(401, { errors: [{ message: 'Invalid access token.' }] }),
      fetchFeed: noFeed,
      marks: memoryMarks(),
      now: () => NOW
    })
    let changes = 0
    provider.start(() => changes++)
    const error: unknown = await provider.list().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(TodoSourceError)
    expect(error).toMatchObject({ kind: 'reconnect' })
    expect(provider.connection()).toBe('disconnected')
    expect(secrets.values.get('canvas.site')).toBe(ORIGIN)
    expect(changes).toBe(1)
  })
})

describe('Canvas provider, check-offs', () => {
  it('creates a planner override, then updates that one', async () => {
    const canvas = fakeCanvas((url, request) => {
      if (url.pathname === '/api/v1/planner/items') {
        return reply(200, [
          assignment(1),
          assignment(44, {
            plannable_type: 'quiz',
            plannable: { id: 44, title: 'Quiz 3', assignment_id: 5050, course_id: 101 }
          })
        ])
      }
      if (url.pathname === '/api/v1/courses') return reply(200, [])
      if (url.pathname === '/api/v1/planner/overrides' && request.method === 'POST') {
        return reply(200, { id: 900, marked_complete: true, updated_at: '2026-10-14T22:00:00Z' })
      }
      if (url.pathname === '/api/v1/planner/overrides/900' && request.method === 'PUT') {
        return reply(200, { id: 900, marked_complete: false })
      }
      return undefined
    })
    const provider = createCanvasProvider({
      secrets: connected(),
      request: canvas.request,
      fetchFeed: noFeed,
      marks: memoryMarks(),
      now: () => NOW
    })
    await provider.list()
    canvas.sent.length = 0

    await provider.setDone('quiz:44', true)
    await provider.setDone('quiz:44', false)
    expect(canvas.sent.map(({ url, request }) => [request.method, url.pathname])).toEqual([
      ['POST', '/api/v1/planner/overrides'],
      ['PUT', '/api/v1/planner/overrides/900']
    ])
    expect(JSON.parse(canvas.sent[0]?.request.body ?? '')).toEqual({
      plannable_type: 'assignment',
      plannable_id: '5050',
      marked_complete: true
    })
    expect(JSON.parse(canvas.sent[1]?.request.body ?? '')).toEqual({ marked_complete: false })
  })

  it('refuses items it no longer lists', async () => {
    const provider = createCanvasProvider({
      secrets: connected(),
      request: async () => reply(200, []),
      fetchFeed: noFeed,
      marks: memoryMarks()
    })
    await expect(provider.setDone('assignment:1', true)).rejects.toMatchObject({
      kind: 'offline',
      message: 'It’s no longer in Canvas.'
    })
  })
})

describe('Canvas provider, calendar feed', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:event-assignment-5001',
    `DTSTART:${new Date(NOW * 1000 + 3600_000).toISOString().replace(/[-:]|\.\d+/g, '')}`,
    'SUMMARY:Essay 2 [ENG 102]',
    'END:VEVENT',
    // Due two days ago: the feed can't say whether it was turned in, so it isn't shown.
    'BEGIN:VEVENT',
    'UID:event-assignment-4000',
    `DTSTART:${new Date(NOW * 1000 - 2 * 86_400_000).toISOString().replace(/[-:]|\.\d+/g, '')}`,
    'SUMMARY:Essay 1 [ENG 102]',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')

  it('connects with the feed link and keeps check-offs on this computer', async () => {
    const secrets = memorySecrets({ 'canvas.site': ORIGIN, 'canvas.token': 'old' })
    const marks = memoryMarks()
    const fetched: string[] = []
    const provider = createCanvasProvider({
      secrets,
      request: async () => {
        throw new Error('the feed never uses the API')
      },
      fetchFeed: async (url) => {
        fetched.push(url)
        return { status: 200, text: ics }
      },
      marks,
      now: () => NOW
    })
    expect(await provider.connectFeed(FEED_URL.replace('https:', 'webcal:'))).toEqual({ ok: true })
    expect(secrets.values.get('canvas.feedUrl')).toBe(FEED_URL)
    // One way in at a time: the old token is gone.
    expect(secrets.values.has('canvas.token')).toBe(false)
    expect(provider.connection()).toBe('connected')
    expect(provider.localCheckOffs?.()).toBe(true)

    const todos = await provider.list()
    expect(todos).toMatchObject([
      { id: 'event-assignment-5001', title: 'Essay 2', context: 'Canvas · ENG 102', done: false }
    ])
    await provider.setDone('event-assignment-5001', true)
    expect(marks.values.get('event-assignment-5001')).toBe(Math.floor(NOW))
    expect((await provider.list())[0]).toMatchObject({ done: true, completedAt: Math.floor(NOW) })
    expect(fetched.every((url) => url === FEED_URL)).toBe(true)
  })

  it('turns down links that aren’t a calendar', async () => {
    const provider = createCanvasProvider({
      secrets: memorySecrets(),
      request: async () => reply(500),
      fetchFeed: async () => ({ status: 200, text: '<html>Log in</html>' }),
      marks: memoryMarks()
    })
    expect(await provider.connectFeed(FEED_URL)).toMatchObject({ ok: false, field: 'url' })
    expect(await provider.connectFeed('https://canvas.school.edu/calendar')).toMatchObject({
      ok: false,
      field: 'url'
    })
  })

  it('asks for the link again once Canvas forgets it', async () => {
    const secrets = memorySecrets({ 'canvas.site': ORIGIN, 'canvas.feedUrl': FEED_URL })
    const marks = memoryMarks()
    marks.values.set('event-assignment-5001', 1)
    const provider = createCanvasProvider({
      secrets,
      request: async () => reply(500),
      fetchFeed: async () => ({ status: 404, text: null }),
      marks
    })
    await expect(provider.list()).rejects.toMatchObject({ kind: 'reconnect' })
    expect(provider.connection()).toBe('disconnected')
    expect(marks.values.size).toBe(0)
  })
})
