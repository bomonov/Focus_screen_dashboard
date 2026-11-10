// ASU's shuttle stops (asuShuttle.ts, bundled) as Next bus's picker and filter show them: found
// by the same search as Valley Metro's stops, with no download.
import { SHUTTLE_ROUTES, SHUTTLE_STOPS, type ShuttleStop } from './asuShuttle'
import { words } from './stopList'
import type { TransitRoute, TransitStop } from './types'

/** Shuttle routes go in the same route filter as Valley Metro's, apart by this prefix. */
export const SHUTTLE_ROUTE_PREFIX = 'asu:'

export const shuttleRouteId = (id: string): string => `${SHUTTLE_ROUTE_PREFIX}${id}`

export const isShuttleStop = (id: string): boolean => SHUTTLE_STOPS.some((stop) => stop.id === id)

function routesAt(stopId: string): (typeof SHUTTLE_ROUTES)[number][] {
  return SHUTTLE_ROUTES.filter((route) =>
    Object.values(route.timetables).some((table) => table.stops.some(([id]) => id === stopId))
  )
}

export function shuttleTransitStop(stop: ShuttleStop): TransitStop {
  return {
    id: stop.id,
    name: stop.name,
    detail: `ASU Shuttle · ${stop.campus} campus`,
    code: '',
    source: 'asuShuttle',
    serves: routesAt(stop.id).map((route) => ({
      route: route.name,
      headsign: route.campuses.filter((campus) => campus !== stop.campus).join(', ')
    }))
  }
}

/** The shuttle routes at these stops, for the route filter. */
export function shuttleRoutesAt(stopIds: readonly string[]): TransitRoute[] {
  return SHUTTLE_ROUTES.filter((route) => stopIds.some((id) => routesAt(id).includes(route))).map(
    (route) => ({
      id: shuttleRouteId(route.id),
      name: route.name,
      detail: `ASU Shuttle · ${route.long}`
    })
  )
}

/** Shuttle stops with every typed word: in the name, the campus, or "ASU shuttle" itself. */
export function searchShuttleStops(query: string): ShuttleStop[] {
  const typed = words(query)
  if (typed.length === 0) return []
  return SHUTTLE_STOPS.filter((stop) => {
    const all = [
      ...words(stop.name),
      ...words(stop.campus),
      'asu',
      'shuttle',
      ...routesAt(stop.id).flatMap((route) => words(route.name))
    ]
    return typed.every((word) => all.some((candidate) => candidate.startsWith(word)))
  })
}
