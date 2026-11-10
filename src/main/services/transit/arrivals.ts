// From the live feed's trips to "which bus comes next to my stop": pure, so it's tested alone.
import type { FeedTrip } from './gtfsRealtime'
import type { BusArrival, TransitRoute } from './types'

/** A bus that came a moment ago may still be at the stop; one gone longer than this is gone. */
export const PAST_GRACE_SEC = 60
/**
 * A loop (an Orbit) ends its trip where the next one starts: the same bus shows up twice, as
 * the end of one trip and the start of the next. Within this many seconds it's one visit.
 */
const SAME_VISIT_SEC = 5 * 60
/** More than the pill ever shows; enough for "then 19 min" on every picked route. */
const MAX_ARRIVALS = 20

export interface ArrivalNames {
  route(routeId: string): TransitRoute | null
  /** Where a route's buses in this direction are headed from this stop; "" when unknown. */
  headsign(stopId: string, routeId: string, directionId: number | null): string
  /** The stop list has the path this route takes past this stop. */
  hasLine?(stopId: string, routeId: string, directionId: number | null): boolean
}

/** An arrival's id: unique per trip and stop (a loop's trip can pass one stop twice). */
export const arrivalId = (tripId: string, stopId: string, sequence: number): string =>
  `${tripId}:${stopId}:${sequence}`

export interface ArrivalOptions {
  stops: ReadonlySet<string>
  /** Only these routes; empty means every route. */
  routes: ReadonlySet<string>
  /** Unix seconds. */
  now: number
  names: ArrivalNames
}

/** The picked stops' coming buses, soonest first. */
export function busArrivals(trips: readonly FeedTrip[], options: ArrivalOptions): BusArrival[] {
  const { stops, routes, now, names } = options
  const found: (BusArrival & { vehicleId: string })[] = []
  for (const trip of trips) {
    if (trip.canceled || !trip.routeId) continue
    if (routes.size > 0 && !routes.has(trip.routeId)) continue
    for (const update of trip.stops) {
      if (!stops.has(update.stopId)) continue
      if (update.relationship === 'skipped' || update.relationship === 'noData') continue
      // The bus shows up at its arrival; the first stop of a trip may give only a departure.
      const at = update.arrival?.time ?? update.departure?.time ?? null
      if (at === null || at < now - PAST_GRACE_SEC) continue
      const route = names.route(trip.routeId)
      found.push({
        id: arrivalId(trip.tripId, update.stopId, update.stopSequence ?? at),
        routeId: trip.routeId,
        route: route?.name ?? trip.routeId,
        headsign: names.headsign(update.stopId, trip.routeId, trip.directionId),
        stopId: update.stopId,
        at,
        hasRoute: names.hasLine?.(update.stopId, trip.routeId, trip.directionId) ?? false,
        vehicleId: trip.vehicleId
      })
    }
  }
  found.sort((a, b) => a.at - b.at)
  const kept: (BusArrival | null)[] = []
  const lastVisit = new Map<string, { at: number; index: number }>()
  for (const { vehicleId, ...arrival } of found) {
    if (vehicleId) {
      const key = `${vehicleId}\n${arrival.stopId}`
      const previous = lastVisit.get(key)
      // The later one is when it leaves again, which is what someone waiting needs.
      if (previous && arrival.at - previous.at <= SAME_VISIT_SEC) kept[previous.index] = null
      lastVisit.set(key, { at: arrival.at, index: kept.length })
    }
    kept.push(arrival)
  }
  return kept.filter((arrival) => arrival !== null).slice(0, MAX_ARRIVALS)
}
