import { describe, expect, it } from 'vitest'
import type { JsonRequest, JsonResponse } from '../http'
import type { SecretKey, SecretStore } from '../secrets/store'
import { serializeClient } from '../todos/google/oauth'
import {
  calendarApiError,
  createGoogleCalendar,
  eventsUrl,
  parseGoogleCalendar,
  parseGoogleEvent
} from './google'

const CLIENT = { clientId: '1-a.apps.googleusercontent.com', clientSecret: 'shh' }
const ok = (body: unknown): JsonResponse => ({ status: 200, body, retryAfterSec: null })
const TOKEN = ok({
  access_token: 'access-1',
  expires_in: 3600,
  token_type: 'Bearer',
  scope:
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly'
})

function memorySecrets(initial: Partial<Record<SecretKey, string>> = {}): SecretStore {
  const values = new Map<SecretKey, string>(Object.entries(initial) as [SecretKey, string][])
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => void values.set(key, value),
    delete: (key) => void values.delete(key)
  }
}

function fakeGoogle(replies: JsonResponse[]): {
  urls: string[]
  request: (url: string, request: JsonRequest) => Promise<JsonResponse>
} {
  const urls: string[] = []
  return {
    urls,
    request: async (url) => {
      urls.push(url)
      const reply = replies.shift()
      if (!reply) throw new Error('unexpected request')
      return reply
    }
  }
}

function calendarFor(
  replies: JsonResponse[],
  clientId = CLIENT.clientId
): {
  calendar: ReturnType<typeof createGoogleCalendar>
  urls: string[]
} {
  const google = fakeGoogle(replies)
  const secrets = memorySecrets({
    'google.oauthClient': serializeClient(CLIENT),
    'google.calendarRefreshToken': 'refresh-1',
    'google.calendarClientId': clientId
  })
  const calendar = createGoogleCalendar({
    secrets,
    request: google.request,
    listen: async () => {
      throw new Error('no sign-in in tests')
    },
    openBrowser: async () => {}
  })
  return { calendar, urls: google.urls }
}

describe('reading Google Calendar', () => {
  it('lists calendars under their own ids, leaving out hidden and deleted ones', () => {
    expect(
      parseGoogleCalendar({
        id: 'abc@group.calendar.google.com',
        summary: 'Classes',
        backgroundColor: '#9fe1e7'
      })
    ).toEqual({
      id: 'google:abc@group.calendar.google.com',
      title: 'Classes',
      source: 'Google Calendar',
      color: '#9FE1E7'
    })
    expect(
      parseGoogleCalendar({ id: 'x', summary: 'Mine', summaryOverride: 'Renamed' })?.title
    ).toBe('Renamed')
    expect(parseGoogleCalendar({ id: 'x', hidden: true })).toBeNull()
    expect(parseGoogleCalendar({ id: 'x', deleted: true })).toBeNull()
    expect(parseGoogleCalendar({ summary: 'no id' })).toBeNull()
  })

  it('keeps timed events, not all-day or cancelled ones', () => {
    const event = {
      id: 'e1',
      summary: 'BIO 181',
      location: 'Tempe - LSE104',
      start: { dateTime: '2026-10-15T10:30:00-07:00' },
      end: { dateTime: '2026-10-15T11:45:00-07:00' }
    }
    expect(parseGoogleEvent(event, 'cal')).toEqual({
      id: 'google:cal:e1',
      calendar: 'google:cal',
      title: 'BIO 181',
      location: 'Tempe - LSE104',
      start: Date.parse('2026-10-15T10:30:00-07:00') / 1000,
      end: Date.parse('2026-10-15T11:45:00-07:00') / 1000
    })
    expect(parseGoogleEvent({ ...event, start: { date: '2026-10-15' } }, 'cal')).toBeNull()
    expect(parseGoogleEvent({ ...event, status: 'cancelled' }, 'cal')).toBeNull()
    expect(parseGoogleEvent({ ...event, end: { dateTime: 'soon' } }, 'cal')).toBeNull()
  })

  it('asks for each class as its own event, in order, within the window', () => {
    const url = new URL(eventsUrl('a b@group.calendar.google.com', { from: 0, to: 86_400 }, null))
    expect(url.pathname).toBe('/calendar/v3/calendars/a%20b%40group.calendar.google.com/events')
    expect(url.searchParams.get('singleEvents')).toBe('true')
    expect(url.searchParams.get('orderBy')).toBe('startTime')
    expect(url.searchParams.get('timeMin')).toBe('1970-01-01T00:00:00.000Z')
    expect(url.searchParams.get('timeMax')).toBe('1970-01-02T00:00:00.000Z')
  })

  it('says what to do about Google’s errors', () => {
    const disabled = { error: { errors: [{ reason: 'accessNotConfigured' }] } }
    expect(calendarApiError(403, disabled).kind).toBe('setup')
    expect(calendarApiError(403, disabled).message).toMatch(/Calendar API is turned off/)
    expect(calendarApiError(401, {}).kind).toBe('reconnect')
    expect(calendarApiError(503, {}).kind).toBe('offline')
  })

  it('reads the calendars and the picked ones’ events with a fresh token', async () => {
    const { calendar, urls } = calendarFor([
      TOKEN,
      ok({ items: [{ id: 'cal', summary: 'Classes' }] }),
      ok({
        items: [
          {
            id: 'e1',
            summary: 'BIO 181',
            start: { dateTime: '2026-10-15T10:30:00Z' },
            end: { dateTime: '2026-10-15T11:45:00Z' }
          }
        ]
      })
    ])
    expect(calendar.state()).toBe('connected')
    expect(await calendar.calendars()).toMatchObject([{ id: 'google:cal', title: 'Classes' }])
    const events = await calendar.events(['cal'], { from: 0, to: 2_000_000_000 })
    expect(events.map((event) => event.title)).toEqual(['BIO 181'])
    expect(urls[1]).toContain('/users/me/calendarList')
    expect(urls[2]).toContain('/calendars/cal/events')
  })

  it('says to turn the API on when the project has it off, and stays signed in', async () => {
    const { calendar } = calendarFor([
      TOKEN,
      {
        status: 403,
        body: { error: { errors: [{ reason: 'accessNotConfigured' }] } },
        retryAfterSec: null
      }
    ])
    await expect(calendar.calendars()).rejects.toMatchObject({ kind: 'setup' })
    expect(calendar.state()).toBe('connected')
  })

  it('isn’t signed in when the OAuth client changed since', () => {
    const { calendar } = calendarFor([], 'another-client.apps.googleusercontent.com')
    expect(calendar.state()).toBe('disconnected')
  })
})
