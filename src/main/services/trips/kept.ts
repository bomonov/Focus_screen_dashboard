// The rules for a trip the user keeps on screen: what its countdown says as time passes, and
// whether the Mac has moved far enough from where the trip began that it's no longer theirs.
// Pure: the service that keeps the trip supplies the clock and the fixes.
import type { FeedTrip, StopTimeEvent } from '../transit/gtfsRealtime'
import { distanceM, type LatLon } from '../transit/routeLine'
import type { TripPlan, TripRide, TripStep } from './types'

/**
 * How far the Mac may be from where the trip began, beyond what the two fixes' accuracies could
 * explain, before the trip is dropped: a walk round the block is still the same trip.
 */
export const MOVED_AWAY_M = 150

export type KeptPhase =
  /** At least a whole minute to go before leaving. */
  | { kind: 'leaveIn'; minutes: number }
  /** Under a minute to leaving, or past it with the first ride still to come: the gold "Leave now". */
  | { kind: 'leaveNow' }
  /** The first ride has gone. */
  | { kind: 'missed' }
  /** The trip's arrival time has come. */
  | { kind: 'over' }

/**
 * `now` is unix seconds. The countdown to leaving shows whole minutes (so "6 min" holds until the
 * minute is up, not rounded up early) and turns to "Leave now" for the last one. After the first
 * ride has departed it's missed rather than "now", though the trip itself runs on to its arrival
 * (the user may be on a later bus). A walk-only trip has no ride to miss: it's "now" until
 * it ends.
 */
export function keptPhase(plan: TripPlan, now: number): KeptPhase {
  if (now >= plan.arrive) return { kind: 'over' }
  const minutes = Math.floor((plan.leave - now) / 60)
  if (minutes >= 1) return { kind: 'leaveIn', minutes }
  const ride = firstRide(plan)
  const departs = ride ? ride.depart : plan.arrive
  return now < departs ? { kind: 'leaveNow' } : { kind: 'missed' }
}

/** A fix of where the Mac is, and how far out it may be (metres). */
export interface Fix {
  at: LatLon
  accuracyM: number
}

/** Both fixes are estimates, so the gap has to clear both of their errors as well as the margin. */
export function movedAway(from: Fix, to: Fix): boolean {
  return distanceM(from.at, to.at) > MOVED_AWAY_M + from.accuracyM + to.accuracyM
}

/**
 * How far apart two readings of one bus's timetable time may be (each its live time less its
 * whole minutes late, so each within half a minute) and still be the same bus: the same route's
 * next one is minutes later.
 */
export const SAME_RUN_SEC = 120

export const firstRide = (plan: TripPlan): TripRide | undefined =>
  plan.steps.find((step): step is TripRide => step.kind === 'ride')

/** Which plan this is, as `keep` names it: its time to leave and its first ride's trip_id. */
export function planIdentity(plan: TripPlan): { leave: number; tripId: string | null } {
  return { leave: plan.leave, tripId: firstRide(plan)?.tripId ?? null }
}

/**
 * The rides as the rider knows them: which route, which way, on where and off where, by the
 * stops' ids (two stops can share a name). Not which bus: a later ride's may change and it's still
 * the trip kept, only arriving later.
 */
function rideSignature(plan: TripPlan): string {
  const rides = plan.steps.filter((step): step is TripRide => step.kind === 'ride')
  return JSON.stringify(
    rides.map((ride) => [ride.routeName, ride.short, ride.headsign, ride.fromStopId, ride.toStopId])
  )
}

/** The first ride's timetable time, near enough: its live time less its whole minutes late. */
function scheduledDepart(plan: TripPlan): number | null {
  const ride = firstRide(plan)
  return ride ? ride.depart - (ride.delayMin ?? 0) * 60 : null
}

/**
 * Whether `candidate` is the kept trip with the feed's newer times: the same rides, the first on
 * the same bus (its trip_id, and its timetable time, since a trip_id runs once each service day).
 * The same rides a bus later aren't: that's a missed trip, which says so. A trip with nothing to
 * ride has no times to update.
 */
export function sameJourney(candidate: TripPlan, kept: TripPlan): boolean {
  if (rideSignature(candidate) !== rideSignature(kept)) return false
  if (firstRide(candidate)?.tripId !== firstRide(kept)?.tripId) return false
  const [a, b] = [scheduledDepart(candidate), scheduledDepart(kept)]
  return a !== null && b !== null && Math.abs(a - b) <= SAME_RUN_SEC
}

/** The first plan that can still be caught at `now`: its first ride not gone, and not over. */
export function catchable(plans: readonly TripPlan[], now: number): TripPlan | undefined {
  return plans.find((plan) => {
    const phase = keptPhase(plan, now).kind
    return phase !== 'missed' && phase !== 'over'
  })
}

/** Arizona keeps UTC−7 all year; the schedule's service days are its days. */
const ARIZONA_SEC = 7 * 3600
const DAY_SEC = 86_400
const arizonaDay = (unix: number): number => Math.floor((unix - ARIZONA_SEC) / DAY_SEC)

/**
 * A trip_id runs at most once a service day, so its runs are a day apart: an entry whose times
 * come within this of the ride's own time is about that run.
 */
export const SAME_RUN_WITHIN_SEC = 3 * 3600
/** An entry with no time on it (a cancellation, a skip) is about the run this near now, today. */
export const UNTIMED_RUN_WITHIN_SEC = 12 * 3600

function feedTimes(trip: FeedTrip): number[] {
  const times: number[] = []
  for (const stop of trip.stops) {
    for (const event of [stop.arrival, stop.departure]) {
      if (event?.time != null && Number.isFinite(event.time)) times.push(event.time)
    }
  }
  return times
}

/**
 * The feed's entry for the ride's own run of its trip, if it has one. The feed names a trip by
 * its trip_id, which runs every service day it's scheduled, so a cancellation of today's run
 * mustn't touch a trip kept for tomorrow. An entry with times is the run they're within a few
 * hours of; one without (a cancellation, a skip, a delay alone) is taken as the run on now's day,
 * so only a ride that leaves that same day, within 12 hours of now.
 */
function runEntry(ride: TripRide, feed: readonly FeedTrip[], now: number): FeedTrip | undefined {
  return feed.find((trip) => {
    if (trip.tripId !== ride.tripId) return false
    const times = feedTimes(trip)
    if (times.length > 0) {
      return times.some((time) => Math.abs(time - ride.depart) <= SAME_RUN_WITHIN_SEC)
    }
    return (
      Math.abs(ride.depart - now) <= UNTIMED_RUN_WITHIN_SEC &&
      arizonaDay(ride.depart) === arizonaDay(now)
    )
  })
}

/**
 * Whether the live feed says the first ride won't come: its run of its trip canceled, or skipping
 * the stop it's boarded or left at (matched by stop_id; a loop's stop made twice can't be told
 * apart here, so a skip at either visit counts). `now` is unix seconds. Later rides are left to
 * the live replan, which finds the same first bus with a later connection, or doesn't. A trip the
 * feed doesn't mention runs.
 */
export function firstRideGone(plan: TripPlan, feed: readonly FeedTrip[], now: number): boolean {
  const ride = firstRide(plan)
  const trip = ride && runEntry(ride, feed, now)
  if (!ride || !trip) return false
  if (trip.canceled) return true
  return trip.stops.some(
    (update) =>
      update.relationship === 'skipped' &&
      (update.stopId === ride.fromStopId || update.stopId === ride.toStopId)
  )
}

/** What an event says of its stop: its time, or the timetable time moved by its delay. */
function eventTime(event: StopTimeEvent | null, scheduled: number): number | null {
  if (!event) return null
  if (event.time !== null && Number.isFinite(event.time)) return event.time
  return event.delay !== null && Number.isFinite(event.delay) ? scheduled + event.delay : null
}

/**
 * When the feed has the trip at `stopId`, leaving (or arriving), nearest its timetable time: a
 * loop makes a stop twice. Null where it says nothing usable of that stop.
 */
function feedTimeAt(
  trip: FeedTrip,
  stopId: string,
  leaving: boolean,
  scheduled: number
): number | null {
  let best: number | null = null
  for (const stop of trip.stops) {
    if (
      stop.stopId !== stopId ||
      stop.relationship === 'skipped' ||
      stop.relationship === 'noData'
    ) {
      continue
    }
    const [own, other] = leaving ? [stop.departure, stop.arrival] : [stop.arrival, stop.departure]
    const time = eventTime(own, scheduled) ?? eventTime(other, scheduled)
    if (
      time !== null &&
      (best === null || Math.abs(time - scheduled) < Math.abs(best - scheduled))
    ) {
      best = time
    }
  }
  return best
}

const moved = (step: TripStep | TripRide, by: number): TripStep | TripRide =>
  step.kind === 'walk'
    ? { ...step, start: step.start + by, end: step.end + by }
    : { ...step, depart: step.depart + by, arrive: step.arrive + by }

/**
 * The plan with its first ride at the times the feed gives for its run where it's boarded (and,
 * if it says, where it's left; otherwise as late there): the time to leave and the walk to the
 * stop move with it, so the countdown follows the bus when the search no longer finds the same
 * journey (running late past an arrive-by time, or early before the plan's time to leave). With
 * one ride the rest of the trip moves too; with more, the later rides keep their times and the
 * next live read finds the connection, or doesn't. Null when the feed says nothing new of it.
 */
export function followFeed(
  plan: TripPlan,
  feed: readonly FeedTrip[],
  now: number
): TripPlan | null {
  const at = plan.steps.findIndex((step) => step.kind === 'ride')
  const ride = plan.steps[at]
  if (!ride || ride.kind !== 'ride') return null
  const trip = runEntry(ride, feed, now)
  if (!trip || trip.canceled) return null
  // Its timetable times, near enough: the live times less the whole minutes it was late.
  const late = (ride.delayMin ?? 0) * 60
  const scheduled = ride.depart - late
  const depart = feedTimeAt(trip, ride.fromStopId, true, scheduled)
  if (depart === null) return null
  const shift = depart - ride.depart
  const arrive = Math.max(
    depart,
    feedTimeAt(trip, ride.toStopId, false, ride.arrive - late) ?? ride.arrive + shift
  )
  const after = arrive - ride.arrive
  if (shift === 0 && after === 0) return null
  const onlyRide = plan.rides === 1
  const steps = plan.steps.map((step, index) => {
    if (index < at) return moved(step, shift)
    if (index > at) return onlyRide ? moved(step, after) : step
    const delayMin = Math.round((depart - scheduled) / 60) || null
    return { ...ride, depart, arrive, live: true, delayMin }
  })
  return {
    ...plan,
    leave: plan.leave + shift,
    arrive: onlyRide ? plan.arrive + after : plan.arrive,
    steps
  }
}
