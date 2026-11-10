// Live times for the trip planner: what Valley Metro's Trip Updates say about each trip, laid out
// the way the search reads them (a prediction per position of the trip's pattern, in unix
// seconds), not the way the feed gives them (a few stops, some with only a delay).
import type {
  FeedTrip,
  StopRelationship,
  StopTimeEvent,
  StopTimeUpdate
} from '../transit/gtfsRealtime'
import { serviceDayStart } from './timetable'
import type { LiveTimes, LiveTrip, Pattern, Timetable } from './types'

const DAY_SEC = 86_400
/**
 * An absolute time further than this from now isn't believed: a feed from another schedule, or a
 * stale entry. It would put a ride a day away in the window, and carry its lateness on.
 */
const PLAUSIBLE_SEC = 12 * 3600

interface TripSlot {
  pattern: number
  trip: number
}

const indexes = new WeakMap<Timetable, Map<string, TripSlot>>()

/** Where each trip_id is in the timetable: its pattern and its place among that pattern's trips. */
export function tripIndex(tt: Timetable): Map<string, TripSlot> {
  const cached = indexes.get(tt)
  if (cached) return cached
  const index = new Map<string, TripSlot>()
  tt.patterns.forEach((pattern, p) => {
    pattern.trips.forEach((id, t) => index.set(id, { pattern: p, trip: t }))
  })
  indexes.set(tt, index)
  return index
}

/** Seconds after the service day's midnight that trip t arrives at (0) or leaves (1) position p. */
function offsetOf(pattern: Pattern, t: number, p: number, leaving: 0 | 1): number {
  return pattern.times[(t * pattern.stops.length + p) * 2 + leaving] as number
}

/**
 * The service day, as the unix second it starts, whose run of this trip is on or nearest `now`
 * among yesterday, today and tomorrow (Arizona days; the search rides the same ones). Yesterday,
 * because a trip that leaves at 23:50 is under way at 00:10 on the day before's run; tomorrow,
 * because a trip that leaves at 00:10 may be in the feed at 23:30. NaN when the trip runs on none
 * of them, so a delay isn't put on a clock it can't be on.
 */
function runStart(tt: Timetable, pattern: Pattern, t: number, now: number): number {
  const first = offsetOf(pattern, t, 0, 0)
  const last = offsetOf(pattern, t, pattern.stops.length - 1, 1)
  let best = NaN
  let bestGap = Infinity
  for (const date of tt.services[pattern.service[t] as number] ?? []) {
    const start = serviceDayStart(date)
    // Midnight Arizona is never after now on the day of now, and tomorrow's is within a day of it.
    if (start > now + DAY_SEC || start <= now - 2 * DAY_SEC) continue
    const gap = Math.max(start + first - now, now - (start + last), 0)
    // Dates run in order, so on a tie the later day wins.
    if (gap <= bestGap) {
      best = start
      bestGap = gap
    }
  }
  return best
}

/** What an event says, the parts we can use: NaN where it says none, or none we believe. */
interface Reading {
  /** Unix seconds. */
  time: number
  /** Seconds late (negative: early). */
  delay: number
}

interface ReadUpdate {
  stopId: string
  relationship: StopRelationship
  arrival: Reading | null
  departure: Reading | null
}

/** Null when the event says nothing: no time within PLAUSIBLE_SEC of now, and no delay. */
function reading(event: StopTimeEvent | null, now: number): Reading | null {
  if (!event) return null
  const time = event.time !== null && Math.abs(event.time - now) <= PLAUSIBLE_SEC ? event.time : NaN
  const delay = event.delay !== null && Number.isFinite(event.delay) ? event.delay : NaN
  return Number.isNaN(time) && Number.isNaN(delay) ? null : { time, delay }
}

/** Unix seconds an event puts a stop at: its time, else `scheduled` (NaN without a run) moved by its delay. */
function timeOf(read: Reading | null, scheduled: number): number {
  if (!read) return NaN
  return Number.isNaN(read.time) ? scheduled + read.delay : read.time
}

/**
 * How far a visit is from what an event says, to tell a loop's visits apart: an absolute time is
 * compared with the visit's scheduled time, a delay's prediction (scheduled + delay) with now,
 * since a bus that's due is about to come. NaN when that can't be worked out.
 */
function gapOf(read: Reading | null, scheduled: number, now: number): number {
  if (!read) return NaN
  return Number.isNaN(read.time)
    ? Math.abs(scheduled + read.delay - now)
    : Math.abs(scheduled - read.time)
}

/** The updates in the order of the trip: by stopSequence, or as given when any lacks one. */
function inTripOrder(updates: readonly StopTimeUpdate[]): readonly StopTimeUpdate[] {
  if (updates.some((update) => update.stopSequence === null)) return updates
  return [...updates].sort((a, b) => (a.stopSequence as number) - (b.stopSequence as number))
}

/**
 * Each update at its position in the pattern. The timetable keeps no stop_sequence (its
 * positions are only the stops riders can use), so an update goes to a position after the last
 * one matched that has its stop. A stop the trip makes more than once is the hard case, a loop's
 * or a layover's: the feed may list every visit, or only the later ones (it drops stops the bus has
 * passed). Each later update for the same stop needs a visit of its own after this one, which
 * leaves the first visit for the first of them when the feed lists them all; of the visits
 * that remain, the one whose scheduled time on the chosen run is nearest what the update says
 * (see gapOf), or the first when there's no clock to tell by. An update for a stop the trip
 * doesn't make is left out without moving the place.
 */
function placeUpdates(
  tt: Timetable,
  pattern: Pattern,
  t: number,
  updates: readonly ReadUpdate[],
  now: number,
  start: number
): (ReadUpdate | undefined)[] {
  const n = pattern.stops.length
  const placed = new Array<ReadUpdate | undefined>(n)
  let from = 0
  updates.forEach((update, i) => {
    const visits: number[] = []
    for (let p = from; p < n; p++) {
      if (tt.stops.ids[pattern.stops[p] as number] === update.stopId) visits.push(p)
    }
    const first = visits[0]
    if (first === undefined) return
    let reach = 1
    if (visits.length > 1) {
      const later = updates.slice(i + 1).filter((other) => other.stopId === update.stopId).length
      reach = Math.max(1, visits.length - later)
    }
    let best = first
    let bestGap = Infinity
    for (const p of visits.slice(0, reach)) {
      const gap = gapOf(update.departure, start + offsetOf(pattern, t, p, 1), now)
      const nearest = Number.isNaN(gap)
        ? gapOf(update.arrival, start + offsetOf(pattern, t, p, 0), now)
        : gap
      if (nearest < bestGap) {
        best = p
        bestGap = nearest
      }
    }
    placed[best] = update
    from = best + 1
  })
  return placed
}

/**
 * What an update says for its own stop, and the shift the stops after it carry: what to add to a
 * timetable time (seconds after midnight) to get the prediction. For a delay that's the run's
 * start plus the delay, for an absolute time what it says of that stop, run or not. Null when it
 * says no time at all. Of an arrival and a departure the feed gives only one, the other is the
 * same moment; leaving is never before arriving.
 */
function ownTimes(
  update: ReadUpdate,
  start: number,
  offsetArrival: number,
  offsetDeparture: number
): { arrival: number; departure: number; shift: number } | null {
  let arrival = timeOf(update.arrival, start + offsetArrival)
  let departure = timeOf(update.departure, start + offsetDeparture)
  if (Number.isNaN(arrival) && Number.isNaN(departure)) return null
  // What GTFS-realtime carries on is the last stop's departure delay, its arrival's if that's all there is.
  const shift = Number.isNaN(departure) ? arrival - offsetArrival : departure - offsetDeparture
  if (Number.isNaN(arrival)) arrival = departure
  else if (Number.isNaN(departure) || departure < arrival) departure = arrival
  return { arrival, departure, shift }
}

function liveTrip(
  tt: Timetable,
  pattern: Pattern,
  t: number,
  feed: FeedTrip,
  now: number
): LiveTrip {
  const n = pattern.stops.length
  const arrival = new Float64Array(n).fill(NaN)
  const departure = new Float64Array(n).fill(NaN)
  const skipped = new Uint8Array(n)
  if (feed.canceled) return { canceled: true, arrival, departure, skipped }

  const updates = inTripOrder(feed.stops).map((update) => ({
    stopId: update.stopId,
    relationship: update.relationship,
    arrival: reading(update.arrival, now),
    departure: reading(update.departure, now)
  }))
  const start = runStart(tt, pattern, t, now)
  const placed = placeUpdates(tt, pattern, t, updates, now, start)
  let shift = NaN
  for (let p = 0; p < n; p++) {
    const update = placed[p]
    if (update?.relationship === 'skipped') skipped[p] = 1
    const offsetArrival = offsetOf(pattern, t, p, 0)
    const offsetDeparture = offsetOf(pattern, t, p, 1)
    // A skipped stop's time is no use and a stop with no data says nothing; both go on like one without an update.
    const counts = update && update.relationship !== 'skipped' && update.relationship !== 'noData'
    const own = counts ? ownTimes(update, start, offsetArrival, offsetDeparture) : null
    if (own) {
      arrival[p] = own.arrival
      departure[p] = own.departure
      shift = own.shift
    } else {
      // NaN until the first update, and after delays only when the trip has no run on a clock.
      arrival[p] = shift + offsetArrival
      departure[p] = shift + offsetDeparture
    }
  }
  return { canceled: false, arrival, departure, skipped }
}

/**
 * The feed's trips as the planner reads them, by trip_id. `now` (unix seconds) puts a delay on a
 * clock: it's added to the run of the trip that's on now (see runStart); an absolute time needs no
 * run, but is ignored when it's more than 12 hours from now. Trips the timetable doesn't have are
 * left out, and so are frequency trips (stored as `id@seconds`, which the feed's plain id doesn't
 * name). A trip listed twice keeps its last entry.
 */
export function liveTimes(tt: Timetable, trips: readonly FeedTrip[], now: number): LiveTimes {
  const index = tripIndex(tt)
  const live = new Map<string, LiveTrip>()
  for (const feed of trips) {
    const slot = index.get(feed.tripId)
    const pattern = slot && tt.patterns[slot.pattern]
    if (!slot || !pattern) continue
    live.set(feed.tripId, liveTrip(tt, pattern, slot.trip, feed, now))
  }
  return live
}
