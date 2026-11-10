import type { JsonRequest, JsonResponse } from '../../http'
import type { SecretStore } from '../../secrets/store'
import { TodoSourceError, type ProviderTodo, type TodoProvider } from '../provider'
import { TODO_SOURCE_NAMES, type CanvasFormResult, type TodoConnection } from '../types'
import {
  apiError,
  coursesUrl,
  isShown,
  itemLabel,
  localDayStart,
  newOverrideBody,
  overrideBody,
  overridesUrl,
  overrideUrl,
  parseCoursesPage,
  parseOverride,
  parsePlannerPage,
  plannerItemsUrl,
  selfUrl,
  toProviderTodo,
  trackCompletions,
  type OverrideTarget,
  type PlannerItem,
  type Seen
} from './api'
import type { FeedMarks } from './feedMarks'
import { feedTodos, parseIcs } from './ics'
import { cleanToken, displayAddress, parseCanvasAddress, parseFeedUrl } from './site'

/** A page of 100 planner items with long titles stays well under this. */
export const CANVAS_MAX_BYTES = 4 * 1024 * 1024
/** A full feed (1,000 entries with descriptions) can run to a few megabytes. */
export const CANVAS_FEED_MAX_BYTES = 8 * 1024 * 1024
export const CANVAS_TIMEOUT_MS = 20_000
/** Overdue work from the last two weeks (token only; the feed starts today), and four weeks ahead. */
const PAST_DAYS = 14
const AHEAD_DAYS = 28
/** 100 per page: far more than any student's month. */
const MAX_PLANNER_PAGES = 10
const MAX_COURSE_PAGES = 5

export type RequestJson = (url: string, request: JsonRequest) => Promise<JsonResponse>
export type FetchText = (url: string) => Promise<{ status: number; text: string | null }>

export interface CanvasProvider extends TodoProvider {
  /** The Canvas address used last time ("canvas.school.edu"), or "", to fill in the form. */
  address(): string
  /** Checks the token with Canvas, then keeps it. */
  connectToken(address: string, token: string): Promise<CanvasFormResult>
  /** Checks the feed link, then keeps it. Check-offs stay on this computer. */
  connectFeed(url: string): Promise<CanvasFormResult>
  /** Forgets the token or feed link (the address stays, to fill in the form next time). */
  disconnect(): void
}

export interface CanvasOptions {
  secrets: SecretStore
  request: RequestJson
  fetchFeed: FetchText
  marks: FeedMarks
  now?: () => number
}

interface Credentials {
  origin: string
  token: string
}

interface ItemRef {
  target: OverrideTarget
  overrideId: string | null
}

const epochSeconds = (): number => Date.now() / 1000
const UNEXPECTED = 'Canvas sent something unexpected.'
const FEED_GONE =
  'Canvas no longer knows this calendar feed link. Copy it again from Calendar → Calendar Feed.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const failed = (message: string, field: 'address' | 'token' | 'url' | null): CanvasFormResult => ({
  ok: false,
  message,
  field
})

export function createCanvasProvider({
  secrets,
  request,
  fetchFeed,
  marks,
  now = epochSeconds
}: CanvasOptions): CanvasProvider {
  let onChange = (): void => {}
  /** Override targets for the items in the last list, by to-do id. */
  let refs = new Map<string, ItemRef>()
  /** What each item looked like in the last list, to date check-offs Canvas doesn't date. */
  let seen = new Map<string, Seen>()
  /** Feed entries in the last list. */
  let feedIds = new Set<string>()

  function credentials(): Credentials | null {
    const origin = secrets.get('canvas.site')
    const token = secrets.get('canvas.token')
    return origin && token ? { origin, token } : null
  }

  const connection = (): TodoConnection =>
    credentials() || secrets.get('canvas.feedUrl') ? 'connected' : 'disconnected'
  let reported = connection()

  function notifyIfChanged(): void {
    const current = connection()
    if (current === reported) return
    reported = current
    onChange()
  }

  function forget(): void {
    secrets.delete('canvas.token')
    secrets.delete('canvas.feedUrl')
    marks.clear()
    refs = new Map()
    seen = new Map()
    feedIds = new Set()
  }

  /** One Canvas API call with the token. Only ever goes to the connected Canvas site. */
  async function call(
    url: string,
    init: JsonRequest,
    during: 'read' | 'write'
  ): Promise<JsonResponse> {
    const current = credentials()
    if (!current) throw new TodoSourceError('reconnect', 'Connect Canvas again.')
    // Page links come from the response; the token must not follow one anywhere else.
    if (new URL(url).origin !== current.origin) throw new TodoSourceError('offline', UNEXPECTED)
    let response: JsonResponse
    try {
      response = await request(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${current.token}` }
      })
    } catch {
      throw new TodoSourceError('offline', 'Couldn’t reach Canvas.')
    }
    if (response.status >= 200 && response.status < 300) return response
    const error = apiError(response.status, response.body, during)
    // A dead token only gets fixed by a new one; showing "connected" would be a lie.
    if (error.kind === 'reconnect' && secrets.get('canvas.token') === current.token) {
      secrets.delete('canvas.token')
      notifyIfChanged()
    }
    throw error
  }

  async function allPages<T>(
    firstUrl: string,
    parse: (body: unknown) => T[] | null,
    maxPages: number
  ): Promise<T[]> {
    const items: T[] = []
    let url: string | null = firstUrl
    for (let page = 0; page < maxPages && url; page++) {
      const response = await call(url, { method: 'GET' }, 'read')
      const parsed = parse(response.body)
      if (!parsed) throw new TodoSourceError('offline', UNEXPECTED)
      items.push(...parsed)
      try {
        url = response.next ? new URL(response.next, url).toString() : null
      } catch {
        url = null
      }
    }
    return items
  }

  async function listPlanner(origin: string): Promise<ProviderTodo[]> {
    const at = now()
    const [items, courses] = await Promise.all([
      allPages(
        plannerItemsUrl(origin, localDayStart(at, -PAST_DAYS), localDayStart(at, AHEAD_DAYS + 1)),
        parsePlannerPage,
        MAX_PLANNER_PAGES
      ),
      // Only for the short course codes; the course's name stands in without it.
      allPages(coursesUrl(origin), parseCoursesPage, MAX_COURSE_PAGES).catch(() => [])
    ])
    const labels = new Map(courses.map((course) => [course.id, course.label]))
    const unique = [
      ...new Map(items.map((item): [string, PlannerItem] => [item.key, item])).values()
    ]
    seen = trackCompletions(unique, seen, at)
    const today = { start: localDayStart(at, 0), end: localDayStart(at, 1) }
    const todos: ProviderTodo[] = []
    const nextRefs = new Map<string, ItemRef>()
    for (const item of unique) {
      const completedAt = seen.get(item.key)?.at ?? null
      if (!isShown(item, completedAt, today)) continue
      todos.push(toProviderTodo(item, itemLabel(item, labels), completedAt))
      nextRefs.set(item.key, { target: item.target, overrideId: item.override?.id ?? null })
    }
    refs = nextRefs
    return todos
  }

  async function listFeed(feedUrl: string): Promise<ProviderTodo[]> {
    let response: { status: number; text: string | null }
    try {
      response = await fetchFeed(feedUrl)
    } catch {
      throw new TodoSourceError('offline', 'Couldn’t reach Canvas.')
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      if (secrets.get('canvas.feedUrl') === feedUrl) {
        forget()
        notifyIfChanged()
      }
      throw new TodoSourceError('reconnect', FEED_GONE)
    }
    if (response.status < 200 || response.status >= 300) {
      throw apiError(response.status, {}, 'read')
    }
    const events = response.text ? parseIcs(response.text) : null
    if (!events) throw new TodoSourceError('offline', UNEXPECTED)
    // Check-offs live as long as their entry is in the feed (30 days back, a year ahead).
    marks.keepOnly(new Set(events.map((event) => event.uid)))
    const at = now()
    const today = { start: localDayStart(at, 0), end: localDayStart(at, 1) }
    // The feed can't tell submitted work from missed work, so past days would read as a wall
    // of false "Overdue"s. Today onward only (the user's choice).
    const window = { start: today.start, end: localDayStart(at, AHEAD_DAYS + 1) }
    const todos = feedTodos(events, window, (uid) => marks.get(uid)).filter((todo) =>
      isShown(
        { done: todo.done, dueAt: todo.due?.kind === 'time' ? todo.due.at : null },
        todo.completedAt,
        today
      )
    )
    feedIds = new Set(todos.map((todo) => todo.id))
    return todos
  }

  async function connectToken(address: string, tokenInput: string): Promise<CanvasFormResult> {
    const site = parseCanvasAddress(address)
    if (!site.ok) return failed(site.message, 'address')
    const token = cleanToken(tokenInput)
    if (!token) return failed('Paste the whole access token from Canvas.', 'token')
    const host = displayAddress(site.origin)

    let response: JsonResponse
    try {
      response = await request(selfUrl(site.origin), {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch {
      return failed(`Couldn’t reach ${host}. Check the address and your connection.`, 'address')
    }
    if (response.status === 401) {
      return failed('Canvas didn’t accept that token. Copy it again, or make a new one.', 'token')
    }
    const isUser = isRecord(response.body) && response.body.id !== undefined
    if (response.status === 404 || (response.status >= 200 && response.status < 300 && !isUser)) {
      return failed(`${host} doesn’t look like a Canvas site. Check the address.`, 'address')
    }
    if (response.status < 200 || response.status >= 300) {
      return failed(apiError(response.status, response.body, 'read').message, null)
    }

    forget()
    secrets.set('canvas.site', site.origin)
    secrets.set('canvas.token', token)
    notifyIfChanged()
    return { ok: true }
  }

  async function connectFeed(input: string): Promise<CanvasFormResult> {
    const feed = parseFeedUrl(input)
    if (!feed.ok) return failed(feed.message, 'url')
    let response: { status: number; text: string | null }
    try {
      response = await fetchFeed(feed.url)
    } catch {
      return failed(
        `Couldn’t reach ${displayAddress(feed.origin)}. Check the link and your connection.`,
        'url'
      )
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return failed(
        'Canvas doesn’t know that feed link. Copy it again from Calendar → Calendar Feed.',
        'url'
      )
    }
    if (response.status < 200 || response.status >= 300) {
      return failed(apiError(response.status, {}, 'read').message, null)
    }
    if (!response.text || !parseIcs(response.text)) {
      return failed('That link didn’t return a calendar. Copy the Calendar Feed link again.', 'url')
    }

    forget()
    secrets.set('canvas.site', feed.origin)
    secrets.set('canvas.feedUrl', feed.url)
    notifyIfChanged()
    return { ok: true }
  }

  return {
    source: 'canvas',
    name: TODO_SOURCE_NAMES.canvas,
    start(listener) {
      onChange = listener
    },
    connection,

    async list() {
      const current = credentials()
      if (current) return listPlanner(current.origin)
      const feedUrl = secrets.get('canvas.feedUrl')
      if (feedUrl) return listFeed(feedUrl)
      throw new TodoSourceError('reconnect', 'Connect Canvas again.')
    },

    async setDone(id, done) {
      if (!credentials() && secrets.get('canvas.feedUrl')) {
        if (!feedIds.has(id)) throw new TodoSourceError('offline', 'It’s no longer in Canvas.')
        marks.set(id, done ? Math.floor(now()) : null)
        return
      }
      const ref = refs.get(id)
      const current = credentials()
      if (!ref || !current) throw new TodoSourceError('offline', 'It’s no longer in Canvas.')
      const init = (body: string, method: 'POST' | 'PUT'): JsonRequest => ({
        method,
        headers: { 'Content-Type': 'application/json' },
        body
      })
      if (ref.overrideId) {
        await call(
          overrideUrl(current.origin, ref.overrideId),
          init(overrideBody(done), 'PUT'),
          'write'
        )
        return
      }
      const response = await call(
        overridesUrl(current.origin),
        init(newOverrideBody(ref.target, done), 'POST'),
        'write'
      )
      // The next check-off of this item updates the override instead of making a second one.
      const created = parseOverride(response.body)
      if (created) ref.overrideId = created.id
    },

    localCheckOffs: () => !credentials() && secrets.get('canvas.feedUrl') !== null,

    address() {
      const origin = secrets.get('canvas.site')
      return origin ? displayAddress(origin) : ''
    },
    connectToken,
    connectFeed,

    disconnect() {
      forget()
      notifyIfChanged()
    },

    dispose() {
      // Nothing runs between lists: no timers, sockets or helpers to stop.
    }
  }
}
