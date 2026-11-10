import type { CalendarState, ClassEvent } from '../../../main/ipc'

/** Within this many minutes of starting, the next class lights up in the accent. */
export const SOON_MINUTES = 10

/** The first class of a day after today, for the end-of-day pill's swipe. */
export interface LaterClass {
  event: ClassEvent
  /** "Tomorrow", "Wed", or "Next Mon" a week on. */
  day: string
}

export type NextClassView =
  /** In class right now. */
  | { kind: 'now'; event: ClassEvent }
  /** Later today. */
  | { kind: 'next'; event: ClassEvent; minutes: number }
  /**
   * Today's classes are over, or there are none today: the pill stays, blank, and a swipe shows
   * `later` (null when the week ahead has no classes).
   */
  | { kind: 'done'; later: LaterClass | null }
  /** Turned on, but there's something to set up first (Customize says what). */
  | { kind: 'setup'; text: string }

const DAY_MS = 24 * 3600 * 1000

export function localDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "Tomorrow", the weekday within the week ("Wed"), or "Next Mon" for today's weekday a week on. */
export function dayLabel(day: Date, now: Date): string {
  // Rounded: a day a clock change makes 23 or 25 h long is still one day.
  const days = Math.round((localDay(day) - localDay(now)) / DAY_MS)
  if (days === 1) return 'Tomorrow'
  const weekday = day.toLocaleDateString(undefined, { weekday: 'short' })
  return days >= 7 ? `Next ${weekday}` : weekday
}

/**
 * What the top bar says at `now`: the class going on, else the next one today, else that the
 * day's done (with the next day's first class). `picked` are the class calendars chosen in
 * Customize. null when there's nothing to say yet (still starting up).
 */
export function nextClassView(
  state: CalendarState | null,
  picked: readonly string[],
  now: Date
): NextClassView | null {
  if (!state?.supported) return null
  if (!state.demo) {
    if (state.access === 'denied' || state.access === 'restricted') {
      return { kind: 'setup', text: 'Next class needs Calendar access · see Customize' }
    }
    if (state.access !== 'granted') return null
    if (picked.length === 0) {
      return { kind: 'setup', text: 'Pick your class calendars in Customize' }
    }
  }
  const nowSec = now.getTime() / 1000
  // Events come sorted by start, so the last one under way is the class that began latest.
  const current = state.events.filter((event) => event.start <= nowSec && nowSec < event.end)
  const latest = current[current.length - 1]
  if (latest) return { kind: 'now', event: latest }
  const next = state.events.find((event) => event.start > nowSec)
  if (!next) return { kind: 'done', later: null }
  const start = new Date(next.start * 1000)
  if (localDay(start) === localDay(now)) {
    return { kind: 'next', event: next, minutes: Math.ceil((next.start - nowSec) / 60) }
  }
  return { kind: 'done', later: { event: next, day: dayLabel(start, now) } }
}

/** "in 25 min", "in 1 h 20 min"; null once it's far enough off that the time says enough. */
export function startsIn(minutes: number): string | null {
  if (minutes < 60) return `in ${Math.max(1, minutes)} min`
  if (minutes >= 180) return null
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `in ${hours} h ${rest} min` : `in ${hours} h`
}

/** The calendar's color for an event's dot, or null to use the accent. */
export function calendarColor(state: CalendarState, event: ClassEvent): string | null {
  return state.calendars.find((calendar) => calendar.id === event.calendar)?.color || null
}
