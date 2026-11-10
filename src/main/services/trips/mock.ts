// Dev builds: a made-up Tempe day for the trip card, with no helper, no schedule download and no
// network. A small timetable on real stop names by ASU's Tempe campus (Orbit Venus through Rural
// Rd & Terrace Rd, Route 72 down Rural Rd, the light rail from Veterans Way/College Ave), the
// Mac at the Sun Devil Fitness Complex, a Home off Apache Blvd & McClintock Dr, a class at
// BYENG and a few of "Apple's" places. Times run every day from 5 AM to past midnight, so it
// always has something to show; the positions are close to the real ones, not surveyed.
import { distanceM, type LatLon } from '../transit/routeLine'
import type { LocationSource } from '../weather/location'
import { MIN_APPLE_TEXT_CHARS, type ApplePlaces } from './applePlaces'
import type { TripPlanner } from './client'
import { answerPlan } from './describe'
import { placeWords, spelledWords, startsEvery } from './localSearch'
import type { PlacesStore } from './places'
import { serviceDayStart } from './timetable'
import {
  TRANSFER_MAX_M,
  type ClassPlace,
  type Pattern,
  type Place,
  type Timetable,
  type TimetableRoute
} from './types'

export interface TripsDemo {
  planner: TripPlanner
  location: () => LocationSource
  apple: () => ApplePlaces
  home: Place
  nextClass: ClassPlace
}

/** The Sun Devil Fitness Complex. */
export const DEMO_HERE: LatLon = [33.4206, -111.9312]
const DEMO_ACCURACY_M = 50

/** Arizona keeps UTC−7 all year. */
const ARIZONA_SEC = 7 * 3600
const DAY_SEC = 86_400

const STOPS: readonly { id: string; name: string; at: LatLon }[] = [
  { id: 'rural-university', name: 'Rural Rd & University Dr', at: [33.4219, -111.92645] },
  { id: 'rural-terrace', name: 'Rural Rd & Terrace Rd', at: [33.418279, -111.926478] },
  { id: 'rural-apache', name: 'Rural Rd & Apache Blvd', at: [33.4148, -111.9264] },
  { id: 'rural-broadway', name: 'Rural Rd & Broadway Rd', at: [33.4076, -111.9265] },
  { id: 'apache-dorsey', name: 'Apache Blvd & Dorsey Ln', at: [33.4146, -111.9176] },
  { id: 'apache-mcclintock', name: 'Apache Blvd & McClintock Dr', at: [33.4145, -111.9096] },
  { id: 'rail-veterans', name: 'Veterans Way/College Ave', at: [33.4163, -111.9348] },
  { id: 'rail-rural', name: 'University Dr/Rural Rd', at: [33.4216, -111.9259] },
  { id: 'rail-dorsey', name: 'Dorsey Ln/Apache Blvd', at: [33.4147, -111.917] },
  { id: 'rail-mcclintock', name: 'McClintock Dr/Apache Blvd', at: [33.4147, -111.909] }
]

interface Run {
  route: number
  direction: number
  headsign: string
  /** [stop id, minutes after the trip's first stop] */
  stops: readonly (readonly [string, number])[]
  /** Minutes between trips, and the first one's minutes after midnight. */
  every: number
  first: number
}

const ROUTES: readonly TimetableRoute[] = [
  { id: 'VENU', short: 'VENU', long: 'Orbit Venus', color: '591769', textColor: 'FFFFFF', type: 3 },
  { id: '72', short: '72', long: 'Scottsdale Rd/Rural Rd', color: '', textColor: '', type: 3 },
  { id: 'A', short: 'A', long: 'A Line', color: 'E37222', textColor: 'FFFFFF', type: 0 }
]

const VENUS_STOPS = [
  ['rural-terrace', 0],
  ['apache-dorsey', 4],
  ['apache-mcclintock', 8]
] as const
const RURAL_STOPS = [
  ['rural-university', 0],
  ['rural-terrace', 2],
  ['rural-apache', 4],
  ['rural-broadway', 9]
] as const
const RAIL_STOPS = [
  ['rail-veterans', 0],
  ['rail-rural', 3],
  ['rail-dorsey', 5],
  ['rail-mcclintock', 8]
] as const

/** The same stops the other way, each the same time from the last. */
function reversed(stops: readonly (readonly [string, number])[]): [string, number][] {
  const end = stops.at(-1)?.[1] ?? 0
  return [...stops].reverse().map(([stop, at]) => [stop, end - at])
}

const RUNS: readonly Run[] = [
  { route: 0, direction: 0, headsign: 'Venus Forward', stops: VENUS_STOPS, every: 15, first: 304 },
  {
    route: 0,
    direction: 1,
    headsign: 'Venus Reverse',
    stops: reversed(VENUS_STOPS),
    every: 15,
    first: 310
  },
  {
    route: 1,
    direction: 1,
    headsign: 'Chandler Fashion Ctr',
    stops: RURAL_STOPS,
    every: 20,
    first: 302
  },
  {
    route: 1,
    direction: 0,
    headsign: 'Scottsdale Airpark',
    stops: reversed(RURAL_STOPS),
    every: 20,
    first: 312
  },
  {
    route: 2,
    direction: 0,
    headsign: 'Gilbert Rd/Main St',
    stops: RAIL_STOPS,
    every: 12,
    first: 300
  },
  {
    route: 2,
    direction: 1,
    headsign: 'Downtown Phoenix',
    stops: reversed(RAIL_STOPS),
    every: 12,
    first: 306
  }
]

/** The last trips leave a little after midnight, counted on from the day before (GTFS's 24:30). */
const LAST_DEPARTURE_MIN = 24 * 60 + 30

/** yyyymmdd in Arizona for a unix second. */
function arizonaDate(unix: number): number {
  const day = new Date((unix - ARIZONA_SEC) * 1000)
  return day.getUTCFullYear() * 10000 + (day.getUTCMonth() + 1) * 100 + day.getUTCDate()
}

/** Each stop's neighbours within a walk to change, as the timetable keeps them. */
function transfersOf(lat: Float64Array, lon: Float64Array): Timetable['transfers'] {
  const start = new Uint32Array(lat.length + 1)
  const to: number[] = []
  const metres: number[] = []
  for (let i = 0; i < lat.length; i++) {
    start[i] = to.length
    for (let j = 0; j < lat.length; j++) {
      if (i === j) continue
      const apart = distanceM(
        [lat[i] as number, lon[i] as number],
        [lat[j] as number, lon[j] as number]
      )
      if (apart > TRANSFER_MAX_M) continue
      to.push(j)
      metres.push(Math.round(apart))
    }
  }
  start[lat.length] = to.length
  return { start, to: Uint32Array.from(to), metres: Uint16Array.from(metres) }
}

/** The demo's timetable, running from the day before `today` to a week after it. */
export function demoTimetable(today: number): Timetable {
  const index = new Map(STOPS.map((stop, i) => [stop.id, i]))
  const lat = Float64Array.from(STOPS, (stop) => stop.at[0])
  const lon = Float64Array.from(STOPS, (stop) => stop.at[1])
  // Noon each day, so the date is right whichever way a clock change would fall (none here).
  const noon = serviceDayStart(today) + DAY_SEC / 2
  const dates = Int32Array.from({ length: 9 }, (_, i) => arizonaDate(noon + (i - 1) * DAY_SEC))
  const patterns: Pattern[] = RUNS.map((run) => {
    const starts: number[] = []
    for (let minute = run.first; minute <= LAST_DEPARTURE_MIN; minute += run.every) {
      starts.push(minute * 60)
    }
    const width = run.stops.length
    const times = new Int32Array(starts.length * width * 2)
    starts.forEach((first, t) => {
      run.stops.forEach(([, after], p) => {
        const at = first + after * 60
        times[(t * width + p) * 2] = at
        times[(t * width + p) * 2 + 1] = at
      })
    })
    const route = ROUTES[run.route] as TimetableRoute
    return {
      route: run.route,
      direction: run.direction,
      headsign: run.headsign,
      stops: Uint32Array.from(run.stops, ([stop]) => index.get(stop) as number),
      trips: starts.map((first) => `demo:${route.id}:${run.direction}:${first}`),
      service: new Uint16Array(starts.length),
      times
    }
  })
  return {
    version: 'demo',
    stops: {
      ids: STOPS.map((stop) => `demo:${stop.id}`),
      names: STOPS.map((s) => s.name),
      lat,
      lon
    },
    routes: [...ROUTES],
    patterns,
    services: [dates],
    transfers: transfersOf(lat, lon)
  }
}

/** The search on the demo's timetable, in this process: it's small enough not to need its own. */
function demoPlanner(now: () => number): TripPlanner {
  let made: { day: number; timetable: Timetable } | null = null
  let nextId = 1
  return {
    plan(query, feed, at = Math.floor(now() / 1000)) {
      const day = arizonaDate(at)
      if (made?.day !== day) made = { day, timetable: demoTimetable(day) }
      const reply = answerPlan(made.timetable, { kind: 'plan', id: nextId++, query, feed, now: at })
      return Promise.resolve(reply.kind === 'planned' ? reply : null)
    },
    dispose() {
      made = null
    }
  }
}

function demoLocation(): LocationSource {
  const [lat, lon] = DEMO_HERE
  return {
    access: () => 'granted',
    onAccess: () => () => undefined,
    requestAccess: () => undefined,
    locate: () => Promise.resolve({ ok: true, position: { lat, lon }, accuracyM: DEMO_ACCURACY_M }),
    placeName: () => Promise.resolve('Tempe'),
    stop: () => undefined
  }
}

const applePlace = (name: string, detail: string, [lat, lon]: LatLon): Place => ({
  id: `apple:${lat.toFixed(5)},${lon.toFixed(5)}:${name}`,
  kind: 'apple',
  name,
  detail,
  lat,
  lon
})

const APPLE_RESULTS: readonly Place[] = [
  applePlace('Trader Joe’s', 'McClintock Dr & Apache Blvd, Tempe', [33.413, -111.9084]),
  applePlace('Target', 'Rural Rd & Broadway Rd, Tempe', [33.407, -111.9255]),
  applePlace('Chipotle Mexican Grill', 'University Dr & Rural Rd, Tempe', [33.4219, -111.9255])
]

function demoApple(): ApplePlaces {
  return {
    search(text) {
      if ([...text.trim()].length < MIN_APPLE_TEXT_CHARS) return Promise.resolve([])
      const typed = placeWords(text)
      return Promise.resolve(
        APPLE_RESULTS.filter((found) => startsEvery(typed, spelledWords(found.name)))
      )
    },
    stop: () => undefined
  }
}

const DEMO_HOME: Place = {
  id: 'home',
  kind: 'home',
  name: 'Home',
  detail: '',
  lat: 33.416,
  lon: -111.9078
}

/** Classes start on the hour or the half hour; the demo's is the first at least 45 minutes off. */
function demoClass(now: () => number): ClassPlace {
  const nowSec = Math.floor(now() / 1000)
  return {
    id: 'class:demo-byeng',
    kind: 'class',
    name: 'Brickyard Engineering',
    detail: 'BYENG 210',
    lat: 33.4236,
    lon: -111.9393,
    title: 'CSE 240',
    start: Math.ceil((nowSec + 45 * 60) / 1800) * 1800
  }
}

export function demoTrips(now: () => number): TripsDemo {
  const planner = demoPlanner(now)
  return {
    planner,
    location: demoLocation,
    apple: demoApple,
    home: DEMO_HOME,
    // Read anew each time, so the demo's class is always still to come.
    get nextClass() {
      return demoClass(now)
    }
  }
}

const MAX_RECENTS = 10

/**
 * Home, saved places and recents held in memory only: the demo's, so a made-up afternoon never
 * lands in the user's own trip-places.json.
 */
export function memoryPlaces(home: Place | null): PlacesStore {
  let current = { home, saved: [] as Place[], recents: [] as Place[] }
  let nextId = 1
  return {
    read: () => current,
    setHome([lat, lon]) {
      current = { ...current, home: { ...DEMO_HOME, lat, lon } }
    },
    clearHome() {
      current = { ...current, home: null }
    },
    save(place, name) {
      const saved: Place = {
        ...place,
        id: `saved:demo-${nextId++}`,
        kind: 'saved',
        name: name.trim() || place.name
      }
      current = { ...current, saved: [...current.saved, saved] }
      return saved
    },
    rename(id, name) {
      const cleaned = name.trim()
      if (!cleaned) return
      current = {
        ...current,
        saved: current.saved.map((place) => (place.id === id ? { ...place, name: cleaned } : place))
      }
    },
    remove(id) {
      current = {
        ...current,
        saved: current.saved.filter((place) => place.id !== id),
        recents: current.recents.filter((place) => place.id !== id)
      }
    },
    addRecent(place) {
      if (place.kind === 'home' || place.kind === 'saved') return
      const recent: Place = { ...place, kind: 'recent' }
      const others = current.recents.filter((old) => old.id !== place.id)
      current = { ...current, recents: [recent, ...others].slice(0, MAX_RECENTS) }
    },
    clearRecents() {
      current = { ...current, recents: [] }
    }
  }
}
