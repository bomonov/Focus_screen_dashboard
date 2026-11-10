// What the search's process answers: each journey it found told the way the screen shows it
// (route names, colours, stop names, minutes) rather than by the timetable's indexes, which mean
// nothing outside the process that read the timetable.
import { routeName } from '../transit/stopList'
import { liveTimes } from './live'
import type { PlanReply, PlanRequest } from './messages'
import { noTrip, planAll } from './rank'
import type { planTrips } from './raptor'
import type { Journey, Leg, Timetable, TripPlan, TripRide, TripStep } from './types'

export type { TripPlan, TripRide, TripStep } from './types'

/** GTFS route_type: light rail, streetcar or tram (0), subway (1), rail (2). */
const RAIL_TYPES = new Set([0, 1, 2])

const stopName = (tt: Timetable, stop: number): string => tt.stops.names[stop] ?? ''

function walkStep(tt: Timetable, leg: Extract<Leg, { kind: 'walk' }>): TripStep {
  return {
    kind: 'walk',
    start: leg.start,
    end: leg.end,
    // "1 min" for a few steps: a walk the card lists is never "0 min".
    minutes: Math.max(1, Math.ceil((leg.end - leg.start) / 60)),
    toName: leg.to.kind === 'stop' ? stopName(tt, leg.to.stop) : null
  }
}

function rideStep(tt: Timetable, leg: Extract<Leg, { kind: 'ride' }>): TripRide {
  const pattern = tt.patterns[leg.pattern]
  const route = pattern && tt.routes[pattern.route]
  const at = (position: number): string => {
    const stop = pattern?.stops[position]
    return stop === undefined ? '' : stopName(tt, stop)
  }
  const idAt = (position: number): string => {
    const stop = pattern?.stops[position]
    return stop === undefined ? '' : (tt.stops.ids[stop] ?? '')
  }
  // The lateness where it's boarded is what the rider waits on; `|| null` folds -0 into on time.
  const delay = leg.live ? Math.round((leg.depart - leg.scheduledDepart) / 60) || null : null
  return {
    kind: 'ride',
    routeName: routeName(route?.id ?? '', route).name,
    short: route?.short ?? '',
    color: route?.color ?? '',
    textColor: route?.textColor ?? '',
    rail: route !== undefined && RAIL_TYPES.has(route.type),
    headsign: pattern?.headsign ?? '',
    tripId: leg.tripId,
    fromName: at(leg.board),
    fromStopId: idAt(leg.board),
    toName: at(leg.alight),
    toStopId: idAt(leg.alight),
    depart: leg.depart,
    arrive: leg.arrive,
    stops: leg.alight - leg.board,
    live: leg.live,
    delayMin: delay
  }
}

/** A journey as the screen shows it. */
export function describeJourney(tt: Timetable, j: Journey): TripPlan {
  let walked = 0
  let rides = 0
  const steps = j.legs.map((leg) => {
    if (leg.kind === 'walk') {
      walked += leg.metres
      return walkStep(tt, leg)
    }
    rides++
    return rideStep(tt, leg)
  })
  return { leave: j.depart, arrive: j.arrive, steps, rides, walkM: Math.round(walked) }
}

/**
 * The answer to one request: the feed read as of the request's `now`, the trips ranked, each
 * described, and why there are none when there are none. `tt` is null when the process couldn't
 * read the timetable; that, and a search that throws, answer `failed` rather than ending the
 * process. `plan` is injectable so this can be tested without the search.
 */
export function answerPlan(
  tt: Timetable | null,
  request: PlanRequest,
  plan?: typeof planTrips
): PlanReply {
  const failed: PlanReply = { kind: 'failed', id: request.id }
  if (!tt) return failed
  try {
    const live = liveTimes(tt, request.feed, request.now)
    const journeys = planAll(tt, request.query, live, plan)
    return {
      kind: 'planned',
      id: request.id,
      plans: journeys.map((journey) => describeJourney(tt, journey)),
      noTrip: journeys.length === 0 ? noTrip(tt, request.query) : null
    }
  } catch (error) {
    // The error only: the request holds where the trip starts and ends.
    console.warn('[trips] Could not plan the trip.', error)
    return failed
  }
}
