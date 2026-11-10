// What the trip card says (results mockup B): when to leave a fresh plan, where it gets to, its
// steps down a line, the other ways in a line each, the rows' second lines, the start, and what
// to say when nothing gets there. Pure, so the words can be tested; times are unix seconds.
import type {
  ClassPlace,
  HomePreview,
  Place,
  TripCommand,
  TripFrom,
  TripPlan,
  TripRide,
  TripState,
  TripWhen
} from '../../../main/ipc'
import { planIdentity } from '../../../main/services/trips/kept'
import { contrast, fitContrast } from '../../theme/color'
import { dayTimeWords, dayWord } from './whenPick'
import {
  chipText,
  clockWords,
  COUNT_HOURS_MAX,
  placeWords,
  sameDay,
  timeWords,
  type ClockWords
} from './tripView'

export interface LeaveView {
  /** "Leave in 6 min", "Leave now", "Leave at 4:18 PM". */
  words: string
  /** Time to go: in the accent. */
  due: boolean
  /** The time to leave has gone by: quieter, until main's next plan replaces it. */
  stale: boolean
}

/** Whole minutes and hours: "6 min", "1 h 20 min", "2 h". */
function countWords(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/**
 * When to leave a plan on the open card, from the clock: "Leave in 6 min" (whole minutes, so 6
 * holds until the minute's up), "Leave now" in its last minute, "Leave at 8:32 AM" three hours
 * off. Not the kept trip's words: a plan here can go stale between main's re-plans, and one whose
 * time to leave has gone isn't "Leave now" (its bus may be gone too), just its time.
 */
export function planLeave(plan: TripPlan, now: number, clock: ClockWords = clockWords): LeaveView {
  return leaveAt(plan.leave, now, clock)
}

/** planLeave's words for a time to leave (unix seconds). */
function leaveAt(leave: number, now: number, clock: ClockWords): LeaveView {
  const left = leave - now
  if (left < 0)
    return { words: `Leave at ${timeWords(leave, now, clock)}`, due: false, stale: true }
  if (left < 60) return { words: 'Leave now', due: true, stale: false }
  const minutes = Math.floor(left / 60)
  const words =
    minutes >= COUNT_HOURS_MAX * 60
      ? `Leave at ${timeWords(leave, now, clock)}`
      : `Leave in ${countWords(minutes)}`
  return { words, due: false, stale: false }
}

/**
 * Home's row before anything's typed: "Leave in 6 min · Orbit Venus", "Walk 12 min" (a walk can
 * start any time); nothing once its time to leave has gone (main's next read brings the next),
 * or before main has planned it.
 */
export function homeLine(
  preview: HomePreview | null,
  now: number,
  clock: ClockWords = clockWords
): string {
  if (!preview) return ''
  if (preview.first === 'walk') {
    return `Walk ${Math.max(1, Math.round((preview.arrive - preview.leave) / 60))} min`
  }
  const leave = leaveAt(preview.leave, now, clock)
  return leave.stale ? '' : `${leave.words} · ${preview.first}`
}

/**
 * The when a re-plan of the place picked asks (a new start, say): main's while that place's trip
 * shows, since main may have made it arrive-by (the next class); otherwise the user's own.
 */
export function askedWhen(
  state: Pick<TripState, 'to' | 'when'>,
  picked: Place | null,
  tripShown: boolean,
  own: TripWhen
): TripWhen {
  return picked && tripShown && state.to?.id === picked.id ? state.when : own
}

/**
 * A walk-only trip leaves the moment it was planned, so a minute on it would read as gone. There
 * is no bus to miss: once that moment's past, it starts now and gets there that much later. A trip
 * with a ride is left as it is (its bus doesn't wait).
 */
export function walkFromNow(plan: TripPlan, now: number, asked?: TripWhen): TripPlan {
  const late = now - plan.leave
  // Asked to arrive by a time, the walk is timed to it: moved, it would get there late.
  if (asked?.kind === 'arrive') return plan
  if (plan.rides > 0 || late <= 0 || plan.steps.some((step) => step.kind === 'ride')) return plan
  return {
    ...plan,
    leave: now,
    arrive: plan.arrive + late,
    steps: plan.steps.map((step) =>
      step.kind === 'walk' ? { ...step, start: step.start + late, end: step.end + late } : step
    )
  }
}

/**
 * When it gets there: "4:41 PM", or with its day where that isn't today and isn't the day it
 * leaves either ("Leave at Thu 8:06 AM" beside it already says Thu).
 */
function arriveTime(plan: TripPlan, now: number, clock: ClockWords): string {
  return sameDay(plan.arrive, plan.leave)
    ? clock.time(plan.arrive)
    : timeWords(plan.arrive, now, clock)
}

/** The trip's length, from leaving to getting there: "23 min", "1 h 5 min". */
const lengthWords = (plan: TripPlan): string =>
  countWords(Math.max(1, Math.round((plan.arrive - plan.leave) / 60)))

/** Beside the time to leave: "Home 4:41 PM · 23 min". */
export function arrivalWords(
  to: Place,
  plan: TripPlan,
  now: number,
  clock: ClockWords = clockWords
): string {
  const name = to.kind === 'home' ? 'Home' : to.name
  return `${name} ${arriveTime(plan, now, clock)} · ${lengthWords(plan)}`
}

/** An other way's time to leave, run on and short: "leave in 11", "leave now". */
function otherLeave(plan: TripPlan, now: number, clock: ClockWords): string {
  const leave = planLeave(plan, now, clock)
  const words = leave.words.charAt(0).toLowerCase() + leave.words.slice(1)
  return words.endsWith(' min') ? words.slice(0, -' min'.length) : words
}

/** An other way's right side: "leave in 11 · home 4:52 PM". */
export function otherWords(
  to: Place,
  plan: TripPlan,
  now: number,
  clock: ClockWords = clockWords
): string {
  return `${otherLeave(plan, now, clock)} · ${placeWords(to)} ${arriveTime(plan, now, clock)}`
}

/** An other way read out whole: "A Line, then Orbit Venus. Leave in 9 min, home 4:52 PM". */
export function otherLabel(
  to: Place,
  plan: TripPlan,
  now: number,
  clock: ClockWords = clockWords
): string {
  const { rides, walkMin } = otherLegs(plan)
  const how =
    rides.length > 0
      ? rides.map((ride) => ride.routeName || chipText(ride)).join(', then ')
      : `Walk ${walkMin ?? 1} min`
  const leave = planLeave(plan, now, clock).words
  return `${how}. ${leave}, ${placeWords(to)} ${arriveTime(plan, now, clock)}`
}

/** An other way's legs on its one line: the first walk's minutes, then the rides' chips. */
export function otherLegs(plan: TripPlan): { walkMin: number | null; rides: TripRide[] } {
  const [first] = plan.steps
  return {
    walkMin: first?.kind === 'walk' ? first.minutes : null,
    rides: plan.steps.filter((step): step is TripRide => step.kind === 'ride')
  }
}

/**
 * "live", "live, 1 min late", "live, 2 min early" or "scheduled": live only for a ride the feed
 * has (its times are the feed's), never for a timetable time.
 */
export function rideStatus(ride: TripRide): { words: string; live: boolean } {
  if (!ride.live) return { words: 'scheduled', live: false }
  const off = ride.delayMin ?? 0
  if (off > 0) return { words: `live, ${off} min late`, live: true }
  if (off < 0) return { words: `live, ${-off} min early`, live: true }
  return { words: 'live', live: true }
}

/**
 * Under a ride's chip: "toward Apache Blvd · 8 stops". `boardNamed`: a step before it named the
 * stop to get on at; when none did, this does ("at Rural Rd & Terrace Rd · …").
 */
export function rideDetail(ride: TripRide, boardNamed: boolean): string {
  const stops = `${ride.stops} ${ride.stops === 1 ? 'stop' : 'stops'}`
  const parts = [
    boardNamed ? '' : `at ${ride.fromName}`,
    ride.headsign ? `toward ${ride.headsign}` : '',
    stops
  ]
  return parts.filter(Boolean).join(' · ')
}

/** WCAG's floor for graphics: the line and dots a ride is drawn with. */
const MIN_LINE_CONTRAST = 3

/**
 * A ride's line and dots in its route's colour (no "#"), lifted (or deepened) in its own hue
 * until it shows 3:1 on the theme's card: Orbit Venus's dark purple all but vanished on the dark
 * glass. The chip keeps the colour as the schedule gives it. null for none, or junk: the theme's
 * grey is used.
 */
export function routeLineColor(color: string, ground: string): string | null {
  if (!/^[0-9a-f]{6}$/i.test(color)) return null
  const hex = `#${color.toUpperCase()}`
  return contrast(hex, ground) >= MIN_LINE_CONTRAST
    ? hex
    : fitContrast(hex, ground, MIN_LINE_CONTRAST)
}

/** How the line runs into or out of a step: a ride in its route's colour, a walk dotted. */
export type StepLine = 'route' | 'walk' | null

export interface StepRow {
  key: string
  kind: 'walk' | 'ride' | 'alight' | 'end'
  /** Its time, on the left. */
  at: number
  /** "Walk 5 min", the route's name (drawn as its chip), "Get off at …", the place. */
  title: string
  /** "to Rural Rd & Terrace Rd", "toward … · 8 stops", "walk 3 min"; '' for none. */
  detail: string
  /** The ride a ride or get-off step is part of, for its chip and line colour. */
  ride: TripRide | null
  above: StepLine
  below: StepLine
}

/**
 * The plan spelled out as steps down a line (mockup B): a walk to the stop, the ride (its chip,
 * where it's headed, how many stops), where to get off (with the last walk's minutes), any
 * change's walk, and the place itself. A walk-only trip is "Walk 12 min" and the place.
 */
export function stepRows(plan: TripPlan, destination: string): StepRow[] {
  const rows: Omit<StepRow, 'above' | 'below' | 'key'>[] = []
  const lines: StepLine[] = []
  plan.steps.forEach((step, index) => {
    const before = plan.steps[index - 1]
    const after = plan.steps[index + 1]
    if (step.kind === 'walk') {
      // The last walk is told on the get-off step: "walk 3 min".
      if (before?.kind === 'ride' && step.toName === null) return
      rows.push({
        kind: 'walk',
        at: step.start,
        title: `Walk ${step.minutes} min`,
        detail: step.toName ? `to ${step.toName}` : '',
        ride: null
      })
      lines.push('walk')
      return
    }
    const boardNamed =
      (before?.kind === 'walk' && before.toName === step.fromName) ||
      (before?.kind === 'ride' && before.toName === step.fromName)
    rows.push({
      kind: 'ride',
      at: step.depart,
      title: step.routeName || chipText(step),
      detail: rideDetail(step, boardNamed),
      ride: step
    })
    lines.push('route')
    const lastWalk = after?.kind === 'walk' && after.toName === null ? after : null
    rows.push({
      kind: 'alight',
      at: step.arrive,
      title: `Get off at ${step.toName}`,
      detail: lastWalk ? `walk ${lastWalk.minutes} min` : '',
      ride: step
    })
    lines.push('walk')
  })
  rows.push({ kind: 'end', at: plan.arrive, title: destination, detail: '', ride: null })
  lines.push(null)
  return rows.map((row, index) => ({
    ...row,
    key: `${index}:${row.kind}`,
    above: index === 0 ? null : (lines[index - 1] ?? null),
    below: lines[index] ?? null
  }))
}

/**
 * Which plan this is, by its rides (trip and stops), so a live re-plan that brings the same
 * buses back keeps the one the user swapped in; "walk" for a walk-only trip.
 */
export function planKey(plan: TripPlan): string {
  const rides = plan.steps.filter((step): step is TripRide => step.kind === 'ride')
  if (rides.length === 0) return 'walk'
  return rides.map((ride) => `${ride.tripId}@${ride.fromStopId}>${ride.toStopId}`).join('|')
}

/**
 * Keep on screen for main's plan at `index`, naming the plan as well (its time to leave and first
 * bus) so a replan landing first can't swap another in; null when there's no plan there.
 */
export function keepCommand(plans: readonly TripPlan[] | null, index: number): TripCommand | null {
  const plan = plans?.[index]
  return plan ? { kind: 'keep', index, ...planIdentity(plan) } : null
}

/** The plan to spell out: the one with `key`, else the best; -1 when there are none. */
export function shownIndex(plans: readonly TripPlan[], key: string | null): number {
  if (plans.length === 0) return -1
  if (key === null) return 0
  const found = plans.findIndex((plan) => planKey(plan) === key)
  return found === -1 ? 0 : found
}

/**
 * Nothing gets there in the hour asked about: "No bus or train gets there in the next hour",
 * and when the schedule's service starts again, if that's known. `walkSec` isn't used: a walk
 * short enough comes as a plan of its own.
 */
export function noTripWords(
  noTrip: TripState['noTrip'],
  when: TripWhen,
  now: number,
  clock: ClockWords = clockWords
): { lead: string; detail: string | null } {
  const lead =
    when.kind === 'arrive'
      ? `No bus or train gets there by ${dayTimeWords(when.time, now, clock)}`
      : when.kind === 'depart'
        ? `No bus or train gets there in the hour after ${dayTimeWords(when.time, now, clock)}`
        : 'No bus or train gets there in the next hour'
  const starts = noTrip?.serviceStarts ?? null
  if (starts === null) return { lead, detail: null }
  const time = clock.time(starts)
  const day = dayWord(starts, now, clock)
  return { lead, detail: day ? `Service starts ${day} at ${time}` : `Service starts at ${time}` }
}

export function isClassPlace(place: Place): place is ClassPlace {
  return (
    place.kind === 'class' &&
    typeof (place as Partial<ClassPlace>).title === 'string' &&
    typeof (place as Partial<ClassPlace>).start === 'number'
  )
}

/** The next class's row: "CSE 240 · 4:30 PM", "CSE 240 · tomorrow 9:00 AM". */
export function classTitle(
  lesson: ClassPlace,
  now: number,
  clock: ClockWords = clockWords
): string {
  return `${lesson.title || 'Class'} · ${dayTimeWords(lesson.start, now, clock)}`
}

/** "Brickyard Engineering · BYENG 210": the building, and the room the class is in. */
export function classDetail(lesson: Place): string {
  return [lesson.name, lesson.detail].filter(Boolean).join(' · ')
}

/** A row's second line: a street, "Saved", "Recent", a building's code, a stop's routes. */
export function placeLine(place: Place): string {
  switch (place.kind) {
    case 'home':
      return ''
    case 'saved':
      return place.detail ? `Saved · ${place.detail}` : 'Saved'
    case 'recent':
      return place.detail ? `Recent · ${place.detail}` : 'Recent'
    case 'class':
      return classDetail(place)
    case 'building':
      return place.detail || 'Building'
    case 'stop':
      return place.detail || 'Stop'
    case 'apple':
      return place.detail
  }
}

/** A place found (searched, Apple's, a building, a stop, a recent one) can be kept by a name. */
export function canSave(place: Place): boolean {
  return (
    place.kind === 'apple' ||
    place.kind === 'building' ||
    place.kind === 'stop' ||
    place.kind === 'recent'
  )
}

export interface StartView {
  /** "From where you are", "From Home", "Pick a start". */
  label: string
  /** Where the Mac is, by name; "Finding where you are…"; null for nothing to add. */
  detail: string | null
  /** Where the Mac is can't be had: the start has to be picked. */
  pick: boolean
  /** Location is refused or off for the whole Mac: say so, with a way to its settings. */
  locationOff: boolean
}

/** What the start line says: where the Mac is, a picked place, or that a start has to be picked. */
export function startView(
  from: TripFrom,
  here: TripState['here'],
  hasLocation: boolean
): StartView {
  if (from.kind === 'place') {
    const name = from.place.kind === 'home' ? 'Home' : from.place.name
    return { label: `From ${name}`, detail: null, pick: false, locationOff: false }
  }
  const pick = (detail: string | null, locationOff: boolean): StartView => ({
    label: 'Pick a start',
    detail,
    pick: true,
    locationOff
  })
  if (!hasLocation) return pick(null, false)
  switch (here?.status ?? 'locating') {
    case 'denied':
    case 'servicesOff':
      return pick(null, true)
    case 'failed':
      return pick('Couldn’t find where you are', false)
    case 'locating':
      return {
        label: 'From where you are',
        detail: 'Finding where you are…',
        pick: false,
        locationOff: false
      }
    case 'found':
      return {
        label: 'From where you are',
        detail: here?.name ?? null,
        pick: false,
        locationOff: false
      }
  }
}

export type HomeRow =
  { kind: 'home'; place: Place } | { kind: 'setHome'; disabled: boolean; detail: string }

/** Home's row: Home, or "Set Home to where you are now", greyed with why when it can't be. */
export function homeRow(state: Pick<TripState, 'home' | 'supported' | 'here'>): HomeRow {
  if (state.home) return { kind: 'home', place: state.home }
  if (!state.supported.location) {
    return {
      kind: 'setHome',
      disabled: true,
      detail: 'Needs Location, which this computer doesn’t have'
    }
  }
  const status = state.here?.status
  if (status === 'denied' || status === 'servicesOff') {
    return { kind: 'setHome', disabled: true, detail: 'Turn on Location first' }
  }
  return { kind: 'setHome', disabled: false, detail: 'Press this while you’re at home' }
}
