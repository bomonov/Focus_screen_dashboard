// Next bus types shared with the renderer (the top bar's pills and Customize).
// Keep this file free of runtime imports: the renderer compiles it too. (asuShuttle.ts has none.)
import type { ShuttleService } from './asuShuttle'

export type { ShuttleService }

/** How many stops can be picked: enough for home, campus and work, both ways. */
export const MAX_BUS_STOPS = 10

/**
 * Live times older than this say too little about where the buses are now: the Bus pill stops
 * showing them, and the trip planner plans on the timetable instead (its rides read "scheduled").
 */
export const LIVE_STALE_SEC = 5 * 60

/** A route, as Valley Metro's schedule names it. */
export interface TransitRoute {
  id: string
  /** "Orbit Venus", "Route 72": what the pill says. */
  name: string
  /** "Scottsdale Rd/Rural Rd" for a numbered route; "" when `name` already says it all. */
  detail: string
}

/** A bus stop from the schedule, for the picker and the picked list. */
export interface TransitStop {
  id: string
  /** "Mill Ave & University Dr" */
  name: string
  /** "NB Mill Av & NS University Dr": which corner, which way. "" when the schedule has none. */
  detail: string
  /** The number on the stop's sign; "" when it has none. */
  code: string
  /** Valley Metro's (live times) or ASU's shuttles (their published timetable). */
  source: 'valleyMetro' | 'asuShuttle'
  /** What stops there and where it's headed: "Orbit Venus → Rural/Apache". */
  serves: { route: string; headsign: string }[]
}

/** A bus on its way to one of the picked stops, from Valley Metro's live feed. */
export interface BusArrival {
  /** Unique per trip and stop. */
  id: string
  routeId: string
  /** "Orbit Venus" */
  route: string
  /** "Rural/Apache"; "" when the schedule doesn't say. */
  headsign: string
  stopId: string
  /** Unix epoch seconds, as predicted. */
  at: number
  /** The stop list has this route's path past the stop: holding the pill shows it. */
  hasRoute: boolean
}

/** [x, y] on the route card's map, as shares of its width and height (0–1, y down). */
export type MapSpot = [number, number]

/** What the route card shows for a coming bus: its path, which way it goes, and the stop. */
export interface BusRouteInfo {
  arrivalId: string
  /** "Orbit Venus" */
  route: string
  /** "Venus Forward"; "" when the schedule doesn't say. */
  headsign: string
  /** "Mill Ave & University Dr" */
  stopName: string
  /** The map (a JPEG data URL); null when it can't be made: the path shows on the card alone. */
  picture: string | null
  /** The map's width over its height. */
  aspect: number
  /** The path from where the bus starts to the stop, and from the stop on: it may run off the map. */
  behind: MapSpot[]
  ahead: MapSpot[]
  stop: MapSpot
  /** The bus's own position comes from Valley Metro's Vehicle Locations while the card is open. */
  live: boolean
}

/** Where the card's bus is now. */
export interface BusRouteBus {
  at: MapSpot
  /** Still on its way to the stop (it may be on its last trip around a loop). */
  coming: boolean
  /** At the stop now (waiting out its layover, or stopped for riders): drawn beside its pin. */
  atStop: boolean
  /** When the feed placed it (Unix seconds). */
  seenAt: number
}

/** Another bus on the card's route, going the same way: drawn smaller and dimmer. */
export interface BusRouteOther {
  /** The feed's id for the bus, so each glides from its last spot. */
  id: string
  at: MapSpot
}

/** The card's buses, pushed while the card is open; null when Vehicle Locations can't be read. */
export interface BusRouteLive {
  arrivalId: string
  /** The bus the card is about; null when the feed doesn't place it. */
  bus: BusRouteBus | null
  others: BusRouteOther[]
}

export interface TransitState {
  /** The stop list on this Mac (from Valley Metro's schedule); null until it's downloaded. */
  schedule: { stops: number; downloadedAt: number } | null
  downloading: boolean
  /** Why the stop list couldn't be downloaded, in words. */
  scheduleProblem: string | null
  /** The picked stops, as the stop list names them, in the order picked. */
  stops: TransitStop[]
  /** Every route that stops at a picked stop, for the route filter (shuttles' ids: "asu:gold"). */
  routes: TransitRoute[]
  /** Buses due at the picked stops (and routes), soonest first. */
  arrivals: BusArrival[]
  /**
   * The ASU shuttles at the picked shuttle stops (and routes), from ASU's timetable as of the
   * last push: main pushes again whenever one starts or stops running, and at midnight.
   */
  shuttles: ShuttleService[]
  /** When the live feed last answered (Unix seconds); null before it has. */
  updatedAt: number | null
  /** Why the live feed couldn't be read just now; null when it could. */
  liveProblem: string | null
  /** How far ahead the live feed predicts, in minutes: "none in the next 30 min". */
  horizonMinutes: number
  /** Dev builds only: made-up stops and buses. */
  demo: boolean
}

export type TransitCommand =
  /** Downloads Valley Metro's stop list (asked first in Customize), or downloads it again. */
  | { kind: 'download' }
  | { kind: 'remove' }
  /** Reads the live feed again now (the Bus pill clicked while it has no live times). */
  | { kind: 'retry' }
