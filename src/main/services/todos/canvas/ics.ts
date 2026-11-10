import type { ProviderTodo } from '../provider'
import type { TodoDue } from '../types'
import { canvasContext, courseLabel } from './api'

/** Canvas caps a feed at 1,000 entries; this is only a backstop against a runaway file. */
const MAX_EVENTS = 5000
const MAX_UID_CHARS = 200
const MAX_SUMMARY_CHARS = 500
/**
 * Canvas names feed entries after what they are (`event-assignment-12`,
 * `event-calendar-event-34`, `event-assignment-override-56` for a section's own due date).
 * Only assignments, quizzes and graded discussions are things to do.
 */
const ASSIGNMENT_UID = /^event-(?:sub-)?assignment(?:-override)?-\d+$/
/** Canvas ends each summary with the course code: "Lab report [CHM 113]". */
const COURSE_SUFFIX = /^(.*\S)\s+\[([^[\]]+)\]$/

export interface IcsEvent {
  uid: string
  summary: string
  start: TodoDue | null
}

interface Property {
  name: string
  params: Map<string, string>
  value: string
}

/** RFC 5545 text escapes: \, \; \\ and \n. */
function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_match, char: string) =>
    char === 'n' || char === 'N' ? ' ' : char
  )
}

/** `NAME;PARAM=value;PARAM="x:y":value` */
function parseLine(line: string): Property | null {
  let quoted = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') quoted = !quoted
    else if (char === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon <= 0) return null
  const [name = '', ...rawParams] = line.slice(0, colon).split(';')
  const params = new Map<string, string>()
  for (const raw of rawParams) {
    const equals = raw.indexOf('=')
    if (equals > 0) {
      params.set(raw.slice(0, equals).toUpperCase(), raw.slice(equals + 1).replace(/^"|"$/g, ''))
    }
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) }
}

function parseStart(property: Property): TodoDue | null {
  const value = property.value.trim()
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  if (date) return { kind: 'day', day: `${date[1]}-${date[2]}-${date[3]}` }
  const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value)
  if (!time) return null
  const [year, month, day, hours, minutes, seconds] = time.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number
  ]
  const zone = property.params.get('TZID')?.toUpperCase()
  const utc = time[7] === 'Z' || zone === 'UTC' || zone === 'ETC/UTC' || zone === 'GMT'
  // Canvas always writes UTC. Any other zone is read as this computer's, where the student is.
  const ms = utc
    ? Date.UTC(year, month - 1, day, hours, minutes, seconds)
    : new Date(year, month - 1, day, hours, minutes, seconds).getTime()
  return Number.isFinite(ms) ? { kind: 'time', at: Math.floor(ms / 1000) } : null
}

/** The events in an iCalendar file; null when it isn't one. */
export function parseIcs(text: string): IcsEvent[] | null {
  // Long lines are folded: a line break followed by a space or tab continues the line.
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  if (!lines.some((line) => line.trim().toUpperCase() === 'BEGIN:VCALENDAR')) return null

  const events: IcsEvent[] = []
  let current: Partial<IcsEvent> | null = null
  /** Components inside the event (alarms), whose properties aren't the event's. */
  let nested = 0
  for (const line of lines) {
    const property = parseLine(line)
    if (!property) continue
    const value = property.value.trim().toUpperCase()
    if (property.name === 'BEGIN') {
      if (current) nested++
      else if (value === 'VEVENT') current = {}
      continue
    }
    if (property.name === 'END') {
      if (!current) continue
      if (nested > 0) {
        nested--
        continue
      }
      if (current.uid && current.summary) {
        events.push({ uid: current.uid, summary: current.summary, start: current.start ?? null })
        if (events.length >= MAX_EVENTS) break
      }
      current = null
      continue
    }
    if (!current || nested > 0) continue
    switch (property.name) {
      case 'UID': {
        const uid = property.value.trim()
        if (uid && uid.length <= MAX_UID_CHARS) current.uid = uid
        break
      }
      case 'SUMMARY': {
        const summary = unescapeText(property.value).trim().slice(0, MAX_SUMMARY_CHARS)
        if (summary) current.summary = summary
        break
      }
      case 'DTSTART':
        current.start = parseStart(property)
        break
    }
  }
  return events
}

/** "Lab report [CHM 113]" → the title and "CHM 113". */
export function splitSummary(summary: string): { title: string; course: string | null } {
  const match = COURSE_SUFFIX.exec(summary)
  return match?.[1] && match[2]
    ? { title: match[1], course: match[2].trim() }
    : { title: summary, course: null }
}

/** Epoch seconds a due date falls at; a plain day counts from its local midnight. */
function dueMoment(due: TodoDue): number {
  if (due.kind === 'time') return due.at
  const [year, month, day] = due.day.split('-').map(Number) as [number, number, number]
  return Math.floor(new Date(year, month - 1, day).getTime() / 1000)
}

/**
 * The feed's assignments due inside the window (epoch seconds), as to-dos. The feed can't
 * say what's finished, so done means checked off on this computer (`doneAt`).
 */
export function feedTodos(
  events: readonly IcsEvent[],
  window: { start: number; end: number },
  doneAt: (uid: string) => number | undefined
): ProviderTodo[] {
  const todos: ProviderTodo[] = []
  const seen = new Set<string>()
  for (const event of events) {
    if (!ASSIGNMENT_UID.test(event.uid) || !event.start || seen.has(event.uid)) continue
    const at = dueMoment(event.start)
    if (at < window.start || at >= window.end) continue
    seen.add(event.uid)
    const { title, course } = splitSummary(event.summary)
    const completedAt = doneAt(event.uid) ?? null
    todos.push({
      id: event.uid,
      title,
      context: canvasContext(course ? courseLabel(course) : null),
      due: event.start,
      done: completedAt !== null,
      completedAt
    })
  }
  return todos.sort((a, b) => (a.due && b.due ? dueMoment(a.due) - dueMoment(b.due) : 0))
}
