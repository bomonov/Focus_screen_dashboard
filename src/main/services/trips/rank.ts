// Which journeys the Trips card shows. The search (raptor.ts) returns every journey no other
// beats on leaving later, arriving earlier and fewer rides; this picks the three worth showing,
// adds walking the whole way as a trip, and works out what "no trip" has to say.
import { distanceM } from '../transit/routeLine'
import { planTrips } from './raptor'
import { serviceDayStart } from './timetable'
import {
  ACCESS_MAX_M,
  WINDOW_SEC,
  type Journey,
  type LiveTimes,
  type PlanQuery,
  type RideLeg,
  type Timetable
} from './types'
import { stopsNear, walkOnly } from './walk'

/** What the card shows. */
export const MAX_RESULTS = 3
/**
 * How much later (or, arriving by a time, earlier) a trip may get there and still beat the
 * quickest: a couple of minutes isn't worth an extra bus or a longer walk.
 */
export const BEAT_WITHIN_SEC = 120
/**
 * The longest wait between two rides: from getting off one (and walking to the next stop) to the
 * next leaving. Past this a journey is a wait on a platform, not a trip; at 01:30 on Valley
 * Metro's schedule the only journeys were 94 minutes and 3 hours from one.
 */
export const MAX_CHANGE_WAIT_SEC = 45 * 60
/** Past this a walk isn't offered as a trip; people take a bus, or give up. */
export const WALK_ONLY_MAX_SEC = 45 * 60
/** How far past the window "Service starts at" looks. */
const SERVICE_LOOKAHEAD_SEC = 24 * 3600

/** A journey with what the ranking compares. */
interface Scored {
  journey: Journey
  /** Smaller is better: when it gets there (leaving at a time), or minus when it leaves (arriving by one). */
  when: number
  /** The other end, smaller is better: minus when it leaves (leaving at a time), or when it arrives. */
  other: number
  rides: number
  /** Metres walked in all, to the metre: what two sums of floats can differ by isn't less walking. */
  walked: number
  /** The rides without their trips, so the same rides a bus later are the same. */
  signature: string
}

/**
 * A ride as the rider knows it: the route, where it's boarded and where it's left, by their ids.
 * Not the pattern or the positions in it: a route's trips split over patterns that differ only
 * in a stop this ride doesn't use (the A Line's first stop has two platforms), and those are one
 * ride to take.
 */
function rideKey(tt: Timetable, leg: RideLeg): string {
  const pattern = tt.patterns[leg.pattern]
  const route = pattern && tt.routes[pattern.route]
  const board = pattern && tt.stops.ids[pattern.stops[leg.board] as number]
  const alight = pattern && tt.stops.ids[pattern.stops[leg.alight] as number]
  // A leg of no pattern of this timetable can't be told from another by name; it keeps its
  // indexes, which only ever match its own kind. The search never makes one.
  if (route === undefined || board === undefined || alight === undefined) {
    return JSON.stringify([leg.pattern, leg.board, leg.alight])
  }
  return JSON.stringify([route.id, board, alight])
}

function scoreOf(tt: Timetable, journey: Journey, mode: PlanQuery['mode']): Scored {
  let walked = 0
  const rides: string[] = []
  for (const leg of journey.legs) {
    if (leg.kind === 'walk') walked += leg.metres
    else rides.push(rideKey(tt, leg))
  }
  return {
    journey,
    when: mode === 'depart' ? journey.arrive : -journey.depart,
    other: mode === 'depart' ? -journey.depart : journey.arrive,
    rides: rides.length,
    walked: Math.round(walked),
    // Walking all the way has no rides; its own signature keeps it to one.
    signature: rides.length === 0 ? 'walk' : rides.join('>')
  }
}

/** The order the others are shown in: the quickest, then the fewest rides, then the least walking. */
function byQuickest(a: Scored, b: Scored): number {
  return a.when - b.when || a.rides - b.rides || a.walked - b.walked || a.other - b.other
}

/** Among those that beat the quickest, the simplest wins, not the quickest. */
function bySimplest(a: Scored, b: Scored): number {
  return a.rides - b.rides || a.walked - b.walked || a.when - b.when || a.other - b.other
}

/** Gets there at most BEAT_WITHIN_SEC after the quickest does, with fewer rides or less walking. */
function beats(x: Scored, quickest: Scored): boolean {
  return (
    x.when - quickest.when <= BEAT_WITHIN_SEC &&
    (x.rides < quickest.rides || x.walked < quickest.walked)
  )
}

/**
 * Up to MAX_RESULTS of the candidates, best first. The best is the quickest (earliest arrival
 * leaving at a time, latest departure arriving by one), unless some candidate beats it
 * (BEAT_WITHIN_SEC); then the simplest of those that do. The others follow in order of speed,
 * each with rides the ones before it hasn't (the same route, boarded and left at the same stops,
 * whatever the pattern): the same rides a bus later add nothing.
 */
export function rankTrips(
  tt: Timetable,
  candidates: readonly Journey[],
  mode: PlanQuery['mode']
): Journey[] {
  const ordered = candidates.map((journey) => scoreOf(tt, journey, mode)).sort(byQuickest)
  const quickest = ordered[0]
  if (!quickest) return []
  // The beating is applied once: a candidate that beat the quickest isn't then beaten by what
  // the quickest would have beaten, or a chain of small gains would walk a long way from it.
  const best = ordered.filter((x) => beats(x, quickest)).sort(bySimplest)[0] ?? quickest
  const shown = [best]
  const signatures = new Set([best.signature])
  for (const x of ordered) {
    if (shown.length === MAX_RESULTS) break
    if (signatures.has(x.signature)) continue
    signatures.add(x.signature)
    shown.push(x)
  }
  return shown.map((x) => x.journey)
}

/**
 * Whether the journey waits more than MAX_CHANGE_WAIT_SEC between two rides. The wait runs from
 * the end of the previous leg, a ride's arrival or the walk after it, to the next ride's
 * departure; waiting before the first ride or after the last isn't a change.
 */
function waitsTooLong(journey: Journey): boolean {
  let readyAt: number | null = null
  for (const leg of journey.legs) {
    if (leg.kind === 'walk') {
      if (readyAt !== null) readyAt = leg.end
      continue
    }
    if (readyAt !== null && leg.depart - readyAt > MAX_CHANGE_WAIT_SEC) return true
    readyAt = leg.arrive
  }
  return false
}

/**
 * What the card shows for `query`: the search's journeys, less those that wait too long
 * between two rides, and the walk all the way (when it's no more than WALK_ONLY_MAX_SEC),
 * ranked. `plan` is injectable so the ranking can be tested without the search.
 */
export function planAll(
  tt: Timetable,
  query: PlanQuery,
  live: LiveTimes,
  plan: typeof planTrips = planTrips
): Journey[] {
  const walk = walkOnly(query.from, query.to, query)
  // Nothing to ride to: the two ends are the same place.
  if (distanceM(query.from, query.to) < 1) return [walk]
  const found = plan(tt, query, live).filter((journey) => !waitsTooLong(journey))
  const candidates = walk.arrive - walk.depart <= WALK_ONLY_MAX_SEC ? [...found, walk] : found
  return rankTrips(tt, candidates, query.mode)
}

/** The days a service runs, as the unix second each one starts, ascending; made when first asked. */
function dayStartsOf(tt: Timetable): (service: number) => Float64Array {
  const made = new Map<number, Float64Array>()
  return (service) => {
    let starts = made.get(service)
    if (!starts) {
      const dates = tt.services[service] ?? new Int32Array(0)
      made.set(service, (starts = Float64Array.from(dates, (date) => serviceDayStart(date))))
    }
    return starts
  }
}

/** The first index of `values` (ascending) at or above `limit`, or its length. */
function firstFrom(values: Float64Array, limit: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >> 1
    if ((values[middle] as number) >= limit) high = middle
    else low = middle + 1
  }
  return low
}

/**
 * The first departure after the window (after `time` itself when arriving by one) from a stop
 * within walking distance of the start, no more than a day on; null when there's none, and null
 * when something leaves one of those stops inside the window: then buses run, they just don't
 * get there, and "Service starts at 1 PM" at noon would be wrong. A trip's last stop is no
 * departure. Runs only when there was nothing to show, so it may read every trip of the patterns
 * that stop near the start.
 */
function serviceStarts(tt: Timetable, query: PlanQuery): number | null {
  // The window ends at `after`: leaving in [time, time + WINDOW_SEC], or arriving in
  // [time - WINDOW_SEC, time].
  const after = query.mode === 'depart' ? query.time + WINDOW_SEC : query.time
  const opens = after - WINDOW_SEC
  const until = after + SERVICE_LOOKAHEAD_SEC
  const nearby = new Set(stopsNear(tt, query.from, ACCESS_MAX_M).map(({ stop }) => stop))
  if (nearby.size === 0) return null
  const dayStarts = dayStartsOf(tt)
  let first: number | null = null
  for (const pattern of tt.patterns) {
    const width = pattern.stops.length
    const positions: number[] = []
    for (let p = 0; p < width - 1; p++) {
      if (nearby.has(pattern.stops[p] as number)) positions.push(p)
    }
    if (positions.length === 0) continue
    for (let t = 0; t < pattern.trips.length; t++) {
      const starts = dayStarts(pattern.service[t] as number)
      for (const p of positions) {
        const departs = pattern.times[(t * width + p) * 2 + 1] as number
        // The trip's first run leaving here once the window opens: inside it, or the earliest
        // after it.
        const day = firstFrom(starts, opens - departs)
        if (day === starts.length) continue
        const when = (starts[day] as number) + departs
        if (when <= after) return null
        if (when <= until && (first === null || when < first)) first = when
      }
    }
  }
  return first
}

/**
 * Why there's nothing to show: how long walking all the way would take when that's no more than
 * WALK_ONLY_MAX_SEC (else null), and when service next starts near the start (unix seconds; null
 * when something leaves near the start inside the window, or nothing does in the next day).
 */
export function noTrip(
  tt: Timetable,
  query: PlanQuery
): { walkSec: number | null; serviceStarts: number | null } {
  const walk = walkOnly(query.from, query.to, query)
  const seconds = walk.arrive - walk.depart
  return {
    walkSec: seconds <= WALK_ONLY_MAX_SEC ? seconds : null,
    serviceStarts: serviceStarts(tt, query)
  }
}
