// Next class from Google Calendar, signed in on its own (read-only), apart from Google Tasks.
// Event titles never reach a log: they go from Google to the screen and nowhere else.
import type { JsonRequest, JsonResponse } from '../http'
import type { SecretStore } from '../secrets/store'
import { errorReasons } from '../todos/google/api'
import { createGoogleAuth, type RequestJson } from '../todos/google/auth'
import {
  createGoogleConnection,
  type ConnectResult,
  type GoogleConnectionState
} from '../todos/google/connection'
import type { ListenForRedirect } from '../todos/google/loopback'
import { CALENDAR_SCOPES, type GoogleClient } from '../todos/google/oauth'
import type { CalendarInfo, ClassEvent } from './types'

const API = 'https://www.googleapis.com/calendar/v3/'
/** Its calendars and events have this in front of their ids, so they never meet Apple's. */
export const GOOGLE_ID_PREFIX = 'google:'
/** A page of calendars, or of a week's events: far more than any real account has. */
const PAGE_SIZE = 250
const MAX_PAGES = 4
const MAX_TEXT = 300
const MAX_ID = 1024

/** What went wrong, in words for the Customize window. */
export class GoogleCalendarError extends Error {
  constructor(
    readonly kind: 'reconnect' | 'setup' | 'offline',
    message: string
  ) {
    super(message)
    this.name = 'GoogleCalendarError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

interface Page<T> {
  items: T[]
  nextPageToken: string | null
}

function page<T>(body: unknown, read: (entry: unknown) => T | null): Page<T> | null {
  if (!isRecord(body) || !Array.isArray(body.items)) return null
  const token = text(body.nextPageToken, MAX_ID)
  return {
    items: (body.items as unknown[]).map(read).filter((item): item is T => item !== null),
    nextPageToken: token || null
  }
}

/** One calendar from Google's list; null for anything off-shape, deleted or hidden. */
export function parseGoogleCalendar(entry: unknown): CalendarInfo | null {
  if (!isRecord(entry) || entry.deleted === true || entry.hidden === true) return null
  const id = text(entry.id, MAX_ID)
  if (!id) return null
  const color = text(entry.backgroundColor)
  return {
    id: `${GOOGLE_ID_PREFIX}${id}`,
    title: text(entry.summaryOverride) || text(entry.summary),
    source: 'Google Calendar',
    color: /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : ''
  }
}

function time(value: unknown): number | null {
  // All-day events only have a date: Next class is about timed ones, like Apple's.
  if (!isRecord(value) || typeof value.dateTime !== 'string') return null
  const ms = Date.parse(value.dateTime)
  return Number.isFinite(ms) ? ms / 1000 : null
}

/** One timed event; null for all-day, cancelled or off-shape ones. */
export function parseGoogleEvent(entry: unknown, calendarId: string): ClassEvent | null {
  if (!isRecord(entry) || entry.status === 'cancelled') return null
  const id = text(entry.id, MAX_ID)
  const start = time(entry.start)
  const end = time(entry.end)
  if (!id || start === null || end === null || end < start) return null
  return {
    id: `${GOOGLE_ID_PREFIX}${calendarId}:${id}`,
    calendar: `${GOOGLE_ID_PREFIX}${calendarId}`,
    title: text(entry.summary),
    location: text(entry.location),
    start,
    end
  }
}

export function calendarListUrl(pageToken: string | null): string {
  const url = new URL('users/me/calendarList', API)
  url.searchParams.set('maxResults', String(PAGE_SIZE))
  if (pageToken) url.searchParams.set('pageToken', pageToken)
  return url.toString()
}

export function eventsUrl(
  calendarId: string,
  window: { from: number; to: number },
  pageToken: string | null
): string {
  const url = new URL(`calendars/${encodeURIComponent(calendarId)}/events`, API)
  url.searchParams.set('timeMin', new Date(window.from * 1000).toISOString())
  url.searchParams.set('timeMax', new Date(window.to * 1000).toISOString())
  // Each week's class as its own event, in order.
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')
  url.searchParams.set('maxResults', String(PAGE_SIZE))
  if (pageToken) url.searchParams.set('pageToken', pageToken)
  return url.toString()
}

/** What Google's error means for the user, in words. */
export function calendarApiError(status: number, body: unknown): GoogleCalendarError {
  const reasons = errorReasons(body)
  const has = (...wanted: string[]): boolean => wanted.some((reason) => reasons.includes(reason))
  if (status === 401) {
    return new GoogleCalendarError('reconnect', 'Google signed Focus Screen out. Sign in again.')
  }
  if (status === 403 && has('accessNotConfigured', 'SERVICE_DISABLED')) {
    return new GoogleCalendarError(
      'setup',
      'The Google Calendar API is turned off in your Google Cloud project. Turn it on in Google Cloud Console, then try again.'
    )
  }
  if (status === 403 && has('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
    return new GoogleCalendarError(
      'reconnect',
      'Focus Screen can’t see your calendars. Sign in again and allow both Calendar boxes.'
    )
  }
  if (status === 429 || status === 403) {
    return new GoogleCalendarError(
      'offline',
      'Google Calendar asked to slow down. Trying again soon.'
    )
  }
  return new GoogleCalendarError(
    'offline',
    status >= 500
      ? 'Google Calendar is having trouble. Trying again soon.'
      : `Google Calendar said no (error ${status}).`
  )
}

export interface GoogleCalendar {
  state(): GoogleConnectionState
  hasClient(): boolean
  setClient(client: GoogleClient): void
  connect(): Promise<ConnectResult>
  cancelConnect(): void
  disconnect(): Promise<void>
  /** Told whenever the sign-in starts, ends or is lost. */
  onChange(listener: () => void): () => void
  /** Every calendar in the account. Throws GoogleCalendarError. */
  calendars(): Promise<CalendarInfo[]>
  /** The timed events in `calendarIds` (Google's own ids, unprefixed) within `window`. */
  events(
    calendarIds: readonly string[],
    window: { from: number; to: number }
  ): Promise<ClassEvent[]>
}

export interface GoogleCalendarOptions {
  secrets: SecretStore
  request: RequestJson
  listen: ListenForRedirect
  openBrowser: (url: string) => Promise<void>
  now?: () => number
}

export function createGoogleCalendar({
  secrets,
  request,
  listen,
  openBrowser,
  now
}: GoogleCalendarOptions): GoogleCalendar {
  const listeners = new Set<() => void>()
  const auth = createGoogleAuth({
    secrets,
    request,
    ...(now ? { now } : {}),
    scopes: CALENDAR_SCOPES,
    tokenKey: 'google.calendarRefreshToken',
    clientIdKey: 'google.calendarClientId',
    product: 'Google Calendar',
    needs: 'to see your calendars'
  })
  let reported: GoogleConnectionState | null = null
  const connection = createGoogleConnection({
    auth,
    scopes: CALENDAR_SCOPES,
    listen,
    openBrowser,
    changed: () => notifyIfChanged()
  })
  reported = connection.state()

  /** Tells listeners when the sign-in started, ended, or was lost on a call. */
  function notifyIfChanged(): void {
    const state = connection.state()
    if (state === reported) return
    reported = state
    for (const listener of listeners) listener()
  }

  async function send(url: string, token: string): Promise<JsonResponse> {
    const init: JsonRequest = { method: 'GET', headers: { Authorization: `Bearer ${token}` } }
    try {
      return await request(url, init)
    } catch {
      throw new GoogleCalendarError('offline', 'Couldn’t reach Google Calendar.')
    }
  }

  /** One API call with a fresh token, tried once more if Google refuses the token. */
  async function call(url: string): Promise<unknown> {
    let token: string
    try {
      token = await auth.accessToken()
    } catch (error) {
      throw new GoogleCalendarError(
        'reconnect',
        error instanceof Error ? error.message : 'Sign in to Google Calendar again.'
      )
    }
    let response = await send(url, token)
    if (response.status === 401) {
      try {
        token = await auth.accessToken(token)
      } catch (error) {
        throw new GoogleCalendarError(
          'reconnect',
          error instanceof Error ? error.message : 'Sign in to Google Calendar again.'
        )
      }
      response = await send(url, token)
    }
    if (response.status >= 200 && response.status < 300) return response.body
    const error = calendarApiError(response.status, response.body)
    // The only fix for a dead sign-in is a new one; showing it as connected would be a lie.
    if (error.kind === 'reconnect') auth.forgetSignIn()
    throw error
  }

  async function allPages<T>(
    pageUrl: (pageToken: string | null) => string,
    read: (entry: unknown) => T | null
  ): Promise<T[]> {
    const items: T[] = []
    let pageToken: string | null = null
    try {
      for (let index = 0; index < MAX_PAGES; index++) {
        const parsed: Page<T> | null = page(await call(pageUrl(pageToken)), read)
        if (!parsed)
          throw new GoogleCalendarError('offline', 'Google Calendar sent something unexpected.')
        items.push(...parsed.items)
        pageToken = parsed.nextPageToken
        if (!pageToken) break
      }
    } finally {
      notifyIfChanged()
    }
    return items
  }

  return {
    state: () => connection.state(),
    hasClient: () => connection.hasClient(),
    setClient: (client) => connection.setClient(client),
    connect: () => connection.connect(),
    cancelConnect: () => connection.cancel(),
    disconnect: () => connection.disconnect(),
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    calendars: () => allPages(calendarListUrl, parseGoogleCalendar),
    async events(calendarIds, window) {
      const events: ClassEvent[] = []
      // One calendar at a time: a few calendars only take a moment, and it's gentler on Google.
      for (const id of calendarIds) {
        events.push(
          ...(await allPages(
            (token) => eventsUrl(id, window, token),
            (entry) => parseGoogleEvent(entry, id)
          ))
        )
      }
      return events.sort((a, b) => a.start - b.start)
    }
  }
}
