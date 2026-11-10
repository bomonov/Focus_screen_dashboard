// What the trip planner shares between its pieces: the timetable it plans on, the question it's
// asked and the journeys it answers with. Only types and the planning rules' numbers; the one
// import is a type, so the renderer can compile this file too.
import type { LatLon } from '../transit/routeLine'
import type { LocationAccess } from '../weather/types'

/**
 * Walking is the straight line × WALK_DETOUR (streets aren't straight) at WALK_MPS (a calm
 * pace). They cancel out at today's values, so a straight metre costs a second; they stay
 * separate so either can be tuned alone.
 */
export const WALK_MPS = 1.3
export const WALK_DETOUR = 1.3
/** The first and last walk, straight-line: 20 minutes at our pace, past which a bus is rarely worth it. */
export const ACCESS_MAX_M = 1200
/** Walking between two stops to change, straight-line. */
export const TRANSFER_MAX_M = 400
/** Least time to change at one stop: a bus pulling in a little early mustn't be missed. */
export const MIN_CHANGE_SEC = 60
export const MAX_RIDES = 3
/** How far ahead (or back, arriving) a plan looks. */
export const WINDOW_SEC = 3600

export interface TimetableRoute {
  id: string
  short: string
  long: string
  /** "591769" without "#"; "" when the schedule gives none */
  color: string
  textColor: string
  /** GTFS route_type: 3 bus, 0 light rail/streetcar, 1/2 rail */
  type: number
}

/** Trips of one route that make the same stops in the same order and never overtake each other. */
export interface Pattern {
  route: number // index into routes
  direction: number // 0/1, -1 unknown
  headsign: string
  stops: Uint32Array // stop indexes in visiting order (a stop may repeat)
  trips: string[] // trip_ids, by first departure; none overtakes another anywhere
  service: Uint16Array // per trip: index into services
  /** [arrival, departure] per trip per position, seconds after the service day's midnight (may pass 86400): times[(t * stops.length + p) * 2] */
  times: Int32Array
}

export interface Timetable {
  version: string
  stops: { ids: string[]; names: string[]; lat: Float64Array; lon: Float64Array }
  routes: TimetableRoute[]
  patterns: Pattern[]
  /** per service: the yyyymmdd dates it runs, ascending */
  services: Int32Array[]
  /** stop i's walkable neighbours (≤ TRANSFER_MAX_M, not itself): to[start[i] .. start[i+1]) */
  transfers: { start: Uint32Array; to: Uint32Array; metres: Uint16Array }
}

export interface PlanQuery {
  from: LatLon
  to: LatLon
  /** Unix seconds: when to leave, or when to be there. */
  time: number
  mode: 'depart' | 'arrive'
}

/** What the live feed says about one trip; every array is indexed by pattern position. */
export interface LiveTrip {
  canceled: boolean
  /** Unix seconds; NaN = no prediction. */
  arrival: Float64Array
  /** Unix seconds; NaN = no prediction. */
  departure: Float64Array
  /** 1 where the trip no longer stops. */
  skipped: Uint8Array
}

/** Live trips by trip_id. */
export type LiveTimes = ReadonlyMap<string, LiveTrip>

export type LegEnd = { kind: 'origin' } | { kind: 'destination' } | { kind: 'stop'; stop: number }

export interface WalkLeg {
  kind: 'walk'
  from: LegEnd
  to: LegEnd
  /** Unix seconds. */
  start: number
  end: number
  /** Straight-line metres, which is what walking time is worked out from. */
  metres: number
}

export interface RideLeg {
  kind: 'ride'
  pattern: number
  trip: number
  tripId: string
  board: number
  alight: number // positions in the pattern
  depart: number
  arrive: number // unix s, live where known
  scheduledDepart: number
  scheduledArrive: number
  live: boolean
}

export type Leg = WalkLeg | RideLeg

export interface Journey {
  /** In order; walk legs under 1 m are left out — except a walk-only trip's single leg. */
  legs: Leg[]
  /** When to leave the start. */
  depart: number
  arrive: number
}

/**
 * The screen's journey (describe.ts): names and colours in place of the timetable's indexes, so
 * it can go to the renderer as it is. Times are unix seconds.
 */
export interface TripStep {
  kind: 'walk'
  start: number
  end: number
  /** Rounded up, at least 1. */
  minutes: number
  /** The stop it walks to; null when it walks to the destination. */
  toName: string | null
}

export interface TripRide {
  kind: 'ride'
  /** "Orbit Venus", "Route 72": what Next bus calls it. */
  routeName: string
  /** route_short_name: "VENU", "72"; "" when the schedule gives none. */
  short: string
  /** "591769" without "#" (the renderer adds it); "" when the schedule gives none. */
  color: string
  textColor: string
  /** Light rail, streetcar, subway or train (GTFS route_type 0, 1 or 2). */
  rail: boolean
  headsign: string
  /**
   * The schedule's trip_id and the stop_ids it's boarded and left at: what the live feed names,
   * so a kept trip can tell its own bus canceled, or skipping its stop, from any other.
   */
  tripId: string
  fromName: string
  fromStopId: string
  toName: string
  toStopId: string
  depart: number
  arrive: number
  /** How many stops it's ridden: the stops passed, and the one got off at. */
  stops: number
  live: boolean
  /** Whole minutes late where it's boarded (negative: early); null when on time or not live. */
  delayMin: number | null
}

export interface TripPlan {
  /** When to leave the start. */
  leave: number
  arrive: number
  steps: (TripStep | TripRide)[]
  rides: number
  /** Straight-line metres walked in all, rounded. */
  walkM: number
}

/**
 * A destination or start: Home, a saved or recent place, the next class's building, one of the
 * school's buildings, a Valley Metro stop, or one of Apple's place results. Personal (where the
 * user lives, their friends' places), so never logged. `detail` is the row's second line: a
 * street, a building's code, a stop's routes; '' for none.
 */
export type Place = {
  id: string
  kind: 'home' | 'saved' | 'recent' | 'class' | 'building' | 'stop' | 'apple'
  name: string
  detail: string
  lat: number
  lon: number
}

/**
 * The box Apple's place search is asked to stay inside: the Phoenix area, the same for everyone,
 * so it says nothing about where the user is.
 */
export const PHOENIX_AREA = { south: 33.1, west: -112.7, north: 33.9, east: -111.5 } as const

/** When the trip asked for leaves or arrives: now, or at a time picked (unix seconds). */
export type TripWhen = { kind: 'now' } | { kind: 'depart' | 'arrive'; time: number }

/** Where the trip starts: where the Mac is, or a place picked. */
export type TripFrom = { kind: 'here' } | { kind: 'place'; place: Place }

/**
 * When to leave for Home from the card's start, planned in the background while the card is
 * open (design call 9), for the Home row before anything's typed. Never the card's own plans.
 */
export interface HomePreview {
  /** Unix seconds. */
  leave: number
  arrive: number
  /** The first ride's route as its chip names it ("Orbit Venus", "72"), or "walk". */
  first: string
}

/** The next class as the trip card offers it: its building, the class's title and its start. */
export type ClassPlace = Place & { title: string; start: number }

/**
 * Everything the trip card and its countdown show, from the main process (ipc.ts carries it).
 * Where the Mac is never comes in it as a position, only as `here`'s status and name.
 */
export interface TripState {
  supported: { location: boolean; appleSearch: boolean }
  schedule: 'ready' | 'missing' | 'downloading'
  /** null while nobody needs where the Mac is */
  here: {
    status: 'locating' | 'found' | 'denied' | 'servicesOff' | 'failed'
    /** The school building it's at, or "near <stop>", worked out on this Mac; null for neither. */
    name: string | null
  } | null
  /**
   * macOS's last word on Location for Focus Screen ('off': Location Services off for the whole
   * Mac, learned from a fix), kept after the location's let go so Customize can say it's off after
   * a refused prompt. Only this: never a position. null before it's said, or with no location.
   */
  locationAccess: LocationAccess | null
  from: TripFrom
  to: Place | null
  when: TripWhen
  /** null: nothing asked yet, or planning a new destination */
  plans: TripPlan[] | null
  noTrip: { walkSec: number | null; serviceStarts: number | null } | null
  planning: boolean
  /** Plain words when the search couldn't answer; null once it has. */
  problem: string | null
  /**
   * The trip kept on screen. `missed`: its first ride went (or was canceled) before the user
   * did. `nextWay`: `plan` is the next way found since, to offer in its place; false while
   * that's being looked for and when nothing else gets there, when `plan` is still the missed
   * trip's and has nothing to count down to.
   */
  kept: { to: Place; plan: TripPlan; missed: boolean; nextWay: boolean } | null
  home: Place | null
  /** Home's row: when to leave for it now; null while the card's closed or there's no telling. */
  homePreview: HomePreview | null
  saved: Place[]
  recents: Place[]
  nextClass: ClassPlace | null
  arriveEarlyMin: number
  demo: boolean
}

export type TripCommand =
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'plan'; to: Place; from: TripFrom; when: TripWhen }
  /**
   * Keeps main's plan at `index`, only while it's still the one the card showed: the same time to
   * leave and first ride's trip_id (null for a walk). A replan landing first leaves it a no-op.
   */
  | { kind: 'keep'; index: number; leave: number; tripId: string | null }
  | { kind: 'unkeep' }
  | { kind: 'setHomeHere' }
  | { kind: 'clearHome' }
  | { kind: 'save'; place: Place; name: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'remove'; id: string }
  | { kind: 'clearRecents' }
  | { kind: 'downloadSchedule' }
  | { kind: 'requestAccess' }
  | { kind: 'openLocationSettings' }
