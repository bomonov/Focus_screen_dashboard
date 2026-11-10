// What the kept trip's countdown says at a moment: "Leave in 6 min · [Orbit Venus] · home
// 4:41 PM", gold at "Leave now", "Missed it · next: leave in 9 min" once its bus has gone.
// Pure, so the words can be tested; the phases are main's own rule (kept.ts), so the countdown
// turns when main's kept trip does.
import type { Place, TripPlan, TripRide, TripState } from '../../../main/ipc'
import { firstRide, keptPhase } from '../../../main/services/trips/kept'
import { isTyping, type KeyPress } from '../../hooks/useSpacePlayPause'
import { contrast, onAccentColor } from '../../theme/color'
import { timeFormat } from '../clockFormat'

type Kept = NonNullable<TripState['kept']>

/** How a unix second is written: its time of day, and its day when that isn't today. */
export interface ClockWords {
  /** "4:41 PM", or "16:41": the top bar clock's own format. */
  time(unix: number): string
  /** "Thu" */
  day(unix: number): string
}

const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

/** The top bar clock's own format, so 12- or 24-hour follows the user's region. */
export const clockWords: ClockWords = {
  time: (unix) => timeFormat.format(unix * 1000),
  day: (unix) => weekdayFormat.format(unix * 1000)
}

/** The floor for words (presets.ts holds the same): a chip's name is read from the desk. */
const MIN_TEXT_CONTRAST = 4.5

/** Past this the count is long and the time to leave says it better: "Leave at 8:32 AM". */
export const COUNT_HOURS_MAX = 3

/** A ride's chip: its name on the route's own colour, as CSS colours. */
export interface RouteChip {
  text: string
  color: string
  textColor: string
}

export interface CountdownParts {
  /** "Leave in 6 min", "Leave now", "Missed it". */
  lead: string
  /** The first ride's route, on its colour; null for a trip that's a walk, or none to offer. */
  chip: RouteChip | null
  /** "home 4:41 PM", "Trader Joe’s 4:52 PM", "next: leave in 9 min"; '' for nothing. */
  tail: string
  /** Time to go: the border turns the accent (gold). */
  due: boolean
}

export function sameDay(a: number, b: number): boolean {
  const one = new Date(a * 1000)
  const other = new Date(b * 1000)
  return (
    one.getFullYear() === other.getFullYear() &&
    one.getMonth() === other.getMonth() &&
    one.getDate() === other.getDate()
  )
}

/** "4:41 PM" today; "Thu 9:10 AM" any other day (a class planned for tomorrow). */
export function timeWords(unix: number, now: number, clock: ClockWords): string {
  return sameDay(unix, now) ? clock.time(unix) : `${clock.day(unix)} ${clock.time(unix)}`
}

/**
 * "Leave in 6 min" (whole minutes, so "6 min" holds until the minute is up), "Leave in 1 h 20
 * min", "Leave at 8:32 AM" once it's three hours off ("Leave at Thu 8:32 AM" another day), and
 * "Leave now" for the last minute and on until the first ride goes. `now` is unix seconds.
 *
 * Only for the kept trip's plan: main swaps that for the next way once its first ride goes, so
 * the "Leave now" this still says past the departure lasts a moment. A plan that may have gone
 * stale (one of several on an open card) has to check its first ride's departure itself.
 */
export function keptLeaveWords(
  plan: TripPlan,
  now: number,
  clock: ClockWords = clockWords
): string {
  const phase = keptPhase(plan, now)
  if (phase.kind !== 'leaveIn') return 'Leave now'
  const { minutes } = phase
  if (minutes < 60) return `Leave in ${minutes} min`
  if (minutes >= COUNT_HOURS_MAX * 60) return `Leave at ${timeWords(plan.leave, now, clock)}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `Leave in ${hours} h ${rest} min` : `Leave in ${hours} h`
}

/** "home": Home in lower case, as the words run on; any other place by its own name. */
export const placeWords = (to: Place): string => (to.kind === 'home' ? 'home' : to.name)

/** "72" for a numbered route (Next bus's "Route 72"), else its name: "Orbit Venus". */
export function chipText(ride: TripRide): string {
  return /^\d/.test(ride.short) ? ride.short : ride.routeName || ride.short
}

const HEX = /^[0-9a-f]{6}$/i

/**
 * A route's chip colours from the schedule's (no "#"): its own, with "#". No colour, or junk,
 * takes the theme's raised surface (its border colour, a step up from the card: the stronger
 * border put white words at 4.2:1 on Maroon) and text. Words that are missing or don't read on
 * the route's colour turn black or white, whichever reads better (at least 4.58:1 on any
 * colour), so the route keeps its colour.
 */
export function chipColors(color: string, textColor: string): { bg: string; fg: string } {
  if (!HEX.test(color)) return { bg: 'var(--border)', fg: 'var(--text)' }
  const bg = `#${color.toUpperCase()}`
  const given = HEX.test(textColor) ? `#${textColor.toUpperCase()}` : null
  const fg = given && contrast(bg, given) >= MIN_TEXT_CONTRAST ? given : onAccentColor(bg)
  return { bg, fg }
}

/** A ride's chip as drawn: its name on the route's colour; null for no ride. */
export function routeChip(ride: TripRide | undefined): RouteChip | null {
  if (!ride) return null
  const { bg, fg } = chipColors(ride.color, ride.textColor)
  return { text: chipText(ride), color: bg, textColor: fg }
}

/** Lower-cases the first letter, so "Leave in 9 min" runs on after "next:". */
const runOn = (words: string): string => words.charAt(0).toLowerCase() + words.slice(1)

const MISSED_ALONE: CountdownParts = { lead: 'Missed it', chip: null, tail: '', due: false }

/**
 * The countdown's words at `now` (unix seconds); null when nothing is kept or its trip has
 * arrived (the bubble shrinks back). A missed trip offers the next way once main has found one
 * (`nextWay`); until then, or when nothing else gets there, it says only "Missed it": the plan
 * in hand is the gone (or canceled) bus's, with nothing to count down to.
 */
export function countdownParts(
  kept: TripState['kept'],
  now: number,
  clock: ClockWords = clockWords
): CountdownParts | null {
  if (!kept) return null
  const { plan } = kept
  const phase = keptPhase(plan, now)
  if (phase.kind === 'over') return null
  if (phase.kind === 'missed' || (kept.missed && !kept.nextWay)) return MISSED_ALONE
  const chip = routeChip(firstRide(plan))
  const due = phase.kind === 'leaveNow'
  const leave = keptLeaveWords(plan, now, clock)
  if (kept.missed) return { lead: 'Missed it', chip, tail: `next: ${runOn(leave)}`, due }
  return {
    lead: leave,
    chip,
    tail: `${placeWords(kept.to)} ${timeWords(plan.arrive, now, clock)}`,
    due
  }
}

/**
 * The countdown's words in the order it shows them, for its accessible name and hover, the
 * parts dropped for room included. A missed trip's says where it was going, since its own
 * words no longer do: "Missed it, next: leave in 3 min, A Line, to home".
 */
export function countdownWords(kept: Kept, parts: CountdownParts): string[] {
  const { lead, chip, tail } = parts
  const words = kept.missed
    ? [lead, tail, chip?.text, `to ${placeWords(kept.to)}`]
    : [lead, chip?.text, tail]
  return words.filter((word): word is string => Boolean(word))
}

/**
 * The moments the countdown's words change at (unix seconds), for `useCountdownNow`: each whole
 * minute to leaving, the first ride going (missed) and the arrival (over).
 */
export function countdownMoments(kept: TripState['kept']): number[] {
  if (!kept) return []
  const { plan } = kept
  const ride = firstRide(plan)
  return ride ? [plan.leave, ride.depart, plan.arrive] : [plan.leave, plan.arrive]
}

/** What the ⌘F check needs to know about a key press. */
export interface FindKeyPress extends KeyPress {
  shiftKey: boolean
  /** The key's place on the keyboard: "KeyF" whatever letter the layout puts there. */
  code: string
}

const LATIN_LETTER = /^[a-z]$/i

/**
 * ⌘F opens the trip card, as Find would (Ctrl+F on Windows, which has no ⌘). Not with another
 * modifier (other shortcuts), not held down, and never while typing in a field, whose keys are
 * its own. On a layout without Latin letters (Cyrillic, Greek) it's the key where F is; a Latin
 * layout's other letter there (Dvorak's U) is that letter's shortcut.
 */
export function isFindKey(press: FindKeyPress): boolean {
  const key = press.key.toLowerCase()
  const isF = key === 'f' || (!LATIN_LETTER.test(key) && press.code === 'KeyF')
  if (!isF || press.repeat) return false
  if (press.altKey || press.shiftKey || press.metaKey === press.ctrlKey) return false
  return !isTyping(press.target)
}
