// The trip card's "when": Leave now, Leave at…, or Arrive by…, a day from today to six days on
// and a time of day. Days are this Mac's own (local midnight to midnight), as the clock shows.
import type { TripWhen } from '../../../main/ipc'
import { clockWords, sameDay, type ClockWords } from './tripView'

/** Today and the six days after it: as far as the schedule's week is worth planning. */
export const DAYS_OFFERED = 7
/** A new pick starts at least this far ahead, on a quarter hour. */
const LEAD_MIN = 10
const STEP_MIN = 15
/** A time this little gone is still this minute. */
const GRACE_SEC = 60

export interface DayChoice {
  /** "2026-11-03", what the picker keeps. */
  day: string
  /** "Today", "Tomorrow", "Wed". */
  label: string
}

export interface WhenPick {
  kind: 'depart' | 'arrive'
  /** "2026-11-03" */
  day: string
  /** "08:55", a time input's value. */
  time: string
}

const two = (n: number): string => String(n).padStart(2, '0')

/** "2026-11-03" for the day `date` falls on here. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/** "08:55" */
const timeKey = (date: Date): string => `${two(date.getHours())}:${two(date.getMinutes())}`

/** The day `offset` days after `date`'s (a calendar day, whatever the clock does in between). */
function daysAfter(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset, 12)
}

export function dayChoices(now: Date, clock: ClockWords = clockWords): DayChoice[] {
  return Array.from({ length: DAYS_OFFERED }, (_, offset) => {
    const date = daysAfter(now, offset)
    const label =
      offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : clock.day(date.getTime() / 1000)
    return { day: dayKey(date), label }
  })
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME = /^(\d{2}):(\d{2})$/

/** The moment (unix seconds) a day and a time of day name; null for anything that isn't one. */
export function atDayTime(day: string, time: string): number | null {
  const d = DAY.exec(day)
  const t = TIME.exec(time)
  if (!d || !t) return null
  const [year, month, date, hour, minute] = [d[1], d[2], d[3], t[1], t[2]].map(Number) as [
    number,
    number,
    number,
    number,
    number
  ]
  if (hour > 23 || minute > 59) return null
  const moment = new Date(year, month - 1, date, hour, minute)
  // February 30th rolls over into March: not a day the picker offers.
  if (moment.getDate() !== date || moment.getMonth() !== month - 1) return null
  return moment.getTime() / 1000
}

/**
 * Where the picker starts when Leave at… or Arrive by… is chosen: the day and time already
 * asked for, or the next quarter hour at least ten minutes off (so it's never already gone).
 */
export function pickFor(when: TripWhen, kind: WhenPick['kind'], now: Date): WhenPick {
  if (when.kind !== 'now') {
    const asked = new Date(when.time * 1000)
    return { kind, day: dayKey(asked), time: timeKey(asked) }
  }
  const step = STEP_MIN * 60_000
  const soon = new Date(Math.ceil((now.getTime() + LEAD_MIN * 60_000) / step) * step)
  return { kind, day: dayKey(soon), time: timeKey(soon) }
}

/**
 * The trip's when for a pick; null when the time isn't one, has gone by, or falls past the days
 * offered (main would plan it, but the picker can't show it).
 */
export function whenOf(pick: WhenPick, nowSec: number): TripWhen | null {
  const time = atDayTime(pick.day, pick.time)
  if (time === null || time < nowSec - GRACE_SEC) return null
  const now = new Date(nowSec * 1000)
  const lastDay = atDayTime(dayKey(daysAfter(now, DAYS_OFFERED)), '00:00')
  if (lastDay !== null && time >= lastDay) return null
  return { kind: pick.kind, time }
}

/** The day `unix` is on, said from today: null for today, "tomorrow", "Thu". */
export function dayWord(
  unix: number,
  nowSec: number,
  clock: ClockWords = clockWords
): string | null {
  if (sameDay(unix, nowSec)) return null
  if (sameDay(unix, daysAfter(new Date(nowSec * 1000), 1).getTime() / 1000)) return 'tomorrow'
  return clock.day(unix)
}

/** "4:30 PM" today, "tomorrow 9:00 AM", "Thu 9:00 AM". */
export function dayTimeWords(unix: number, nowSec: number, clock: ClockWords = clockWords): string {
  const day = dayWord(unix, nowSec, clock)
  return day === null ? clock.time(unix) : `${day} ${clock.time(unix)}`
}

/** What the "when" button says: "Leave now", "Leave at 5:30 PM", "Arrive by tomorrow 8:55 AM". */
export function whenLabel(when: TripWhen, nowSec: number, clock: ClockWords = clockWords): string {
  if (when.kind === 'now') return 'Leave now'
  const words = dayTimeWords(when.time, nowSec, clock)
  return when.kind === 'depart' ? `Leave at ${words}` : `Arrive by ${words}`
}
