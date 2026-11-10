// What the helper answers in calendar mode (native/mac-reminders, `--calendar`). Parsed as
// untrusted: anything off-shape counts as no data.
import type { CalendarAccess, CalendarInfo, ClassEvent } from './types'

const ACCESS: readonly CalendarAccess[] = ['granted', 'denied', 'restricted', 'notDetermined']
/** The helper sends at most 200 calendars and 500 events; anything past that is not ours. */
const MAX_CALENDARS = 200
const MAX_EVENTS = 500
const MAX_ID_CHARS = 600
const MAX_TEXT_CHARS = 200
const HEX_COLOR = /^#[0-9A-F]{6}$/i
/** No class runs longer than a day; a longer timed event is something else. */
const MAX_EVENT_SECONDS = 24 * 3600

export type CalendarFailure = { ok: false; access: CalendarAccess | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseCalendarAccess(value: unknown): CalendarAccess | null {
  return ACCESS.find((status) => status === value) ?? null
}

function id(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_CHARS
    ? value
    : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT_CHARS) : ''
}

function epoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function failure(body: Record<string, unknown>): CalendarFailure | null {
  return body.ok === false ? { ok: false, access: parseCalendarAccess(body.status) } : null
}

function parseCalendar(raw: unknown): CalendarInfo | null {
  if (!isRecord(raw)) return null
  const calendarId = id(raw.id)
  if (!calendarId) return null
  const color = typeof raw.color === 'string' && HEX_COLOR.test(raw.color) ? raw.color : ''
  return { id: calendarId, title: text(raw.title), source: text(raw.source), color }
}

function parseEvent(raw: unknown): ClassEvent | null {
  if (!isRecord(raw)) return null
  const eventId = id(raw.id)
  const start = epoch(raw.start)
  const end = epoch(raw.end)
  if (!eventId || start === null || end === null) return null
  if (end <= start || end - start > MAX_EVENT_SECONDS) return null
  return {
    id: eventId,
    calendar: typeof raw.calendar === 'string' ? raw.calendar : '',
    title: text(raw.title),
    location: text(raw.location),
    start,
    end
  }
}

/** null: not a reply the app understands. Malformed entries are skipped one by one. */
export function parseCalendarsReply(
  body: Record<string, unknown>
): { ok: true; calendars: CalendarInfo[] } | CalendarFailure | null {
  const failed = failure(body)
  if (failed) return failed
  if (body.ok !== true || !Array.isArray(body.calendars)) return null
  const calendars = body.calendars
    .slice(0, MAX_CALENDARS)
    .map(parseCalendar)
    .filter((calendar) => calendar !== null)
  return { ok: true, calendars }
}

export function parseEventsReply(
  body: Record<string, unknown>
): { ok: true; events: ClassEvent[] } | CalendarFailure | null {
  const failed = failure(body)
  if (failed) return failed
  if (body.ok !== true || !Array.isArray(body.events)) return null
  const events = body.events
    .slice(0, MAX_EVENTS)
    .map(parseEvent)
    .filter((event) => event !== null)
    .sort((a, b) => a.start - b.start)
  return { ok: true, events }
}
