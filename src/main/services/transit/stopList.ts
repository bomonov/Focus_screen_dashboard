// The stop list: what Next bus keeps of Valley Metro's schedule (stop names and places, route
// names, which routes stop where, heading where, and each route's path for the route card).
// Made from the schedule's zip once, when the user downloads it in Customize, and saved in
// userData/transit-stops.json.
import {
  decodeLine,
  encodeLine,
  isPosition,
  placeInOrder,
  simplifyLine,
  type LatLon
} from './routeLine'
import {
  feedVersion,
  MAX_ID_CHARS,
  MAX_TEXT_CHARS,
  MAX_TRIP_STOPS,
  openSchedule,
  type ScheduleZip
} from './scheduleZip'
import { ZipError } from './zip'
import type { TransitRoute, TransitStop } from './types'

export interface StopListRoute {
  /** route_short_name: "72", "VENU" */
  short: string
  /** route_long_name: "Scottsdale Rd/Rural Rd", "Orbit Venus" */
  long: string
}

/**
 * A route stopping somewhere: [route id, direction (0, 1; -1 unknown), headsign, the id of its
 * path in `lines` when the schedule has one, how many metres along that path the stop is, when
 * its place could be told, and for a stop its trips make twice (a loop's first and last, a short
 * loop off the route), each visit's stop_sequence and place: [sequence, metres, sequence, metres]].
 */
export type Serves =
  | [string, number, string]
  | [string, number, string, string]
  | [string, number, string, string, number]
  | [string, number, string, string, number, number[]]

export interface StopListStop {
  id: string
  code: string
  name: string
  detail: string
  /** The station a bay or platform is part of ("Tempe Transportation Center"), for search. */
  station: string
  serves: Serves[]
  /** [latitude, longitude]; missing when the schedule doesn't say. */
  position?: [number, number]
}

/**
 * What the stop list keeps, by when it began keeping it: 1 paths (`lines`), 2 each stop's place
 * along its paths, 3 each visit's place for a stop made twice, 4 the trip planner's timetable
 * (saved beside it from the same download). A list saved by an older one is downloaded again,
 * once.
 */
export const STOP_LIST_REVISION = 4

export interface StopList {
  /** Unix seconds. */
  downloadedAt: number
  /** Missing from lists saved before revisions. */
  revision?: number
  /** The schedule's feed_version, "" when it has none. */
  version: string
  routes: Record<string, StopListRoute>
  stops: StopListStop[]
  /**
   * The paths buses take, simplified (lat, lon, lat, lon…), by the schedule's shape id. Missing
   * from stop lists saved before the route card: those are downloaded again once.
   */
  lines?: Record<string, number[]>
}

/** Bends smaller than this don't show on the card's map; ~0.2 MB keeps all of Valley Metro's. */
const LINE_TOLERANCE_M = 8
/** Valley Metro needs ~300 (a path per route, direction and headsign); far more isn't buses. */
const MAX_LINES = 3000

/** "Route 72" for a numbered route, else its name: "Orbit Venus", "Downtown DASH". */
export function routeName(id: string, route: StopListRoute | undefined): TransitRoute {
  const short = route?.short ?? ''
  const long = route?.long ?? ''
  // "72", and its variants "7s", "68CM"
  if (/^\d/.test(short)) return { id, name: `Route ${short}`, detail: long }
  return { id, name: long || short || id, detail: '' }
}

/** Reads the schedule's zip into a stop list. Throws ZipError when it isn't a GTFS schedule. */
export async function buildStopList(zip: Uint8Array, downloadedAt: number): Promise<StopList> {
  const schedule = openSchedule(zip)
  const rows = schedule.rows

  const routes: Record<string, StopListRoute> = {}
  await rows('routes.txt', ['route_id', 'route_short_name', 'route_long_name'], ([id, s, l]) => {
    if (id) routes[id] = { short: s.slice(0, MAX_TEXT_CHARS), long: l.slice(0, MAX_TEXT_CHARS) }
  })

  const trips = new Map<
    string,
    { route: string; direction: number; headsign: string; shape: string }
  >()
  await rows(
    'trips.txt',
    ['trip_id', 'route_id', 'direction_id', 'trip_headsign', 'shape_id'],
    ([id, route, direction, headsign, shape]) => {
      if (!id || !route) return
      trips.set(id, {
        route,
        direction: direction === '0' || direction === '1' ? Number(direction) : -1,
        headsign: headsign.slice(0, MAX_TEXT_CHARS),
        shape: shape.length <= MAX_ID_CHARS ? shape : ''
      })
    }
  )

  const stops = new Map<string, StopListStop>()
  const stations = new Map<string, string>()
  const parents = new Map<string, string>()
  await rows(
    'stops.txt',
    [
      'stop_id',
      'stop_code',
      'stop_name',
      'stop_desc',
      'location_type',
      'parent_station',
      'stop_lat',
      'stop_lon'
    ],
    ([id, code, name, detail, type, parent, lat, lon]) => {
      if (!id || !name || id.length > MAX_ID_CHARS) return
      if (type === '1') stations.set(id, name.slice(0, MAX_TEXT_CHARS))
      // Stations and entrances (1–4) group stops; buses only stop at plain stops.
      if (type !== '' && type !== '0') return
      if (parent) parents.set(id, parent)
      const position = [Number(lat), Number(lon)]
      stops.set(id, {
        id,
        code: code.slice(0, MAX_ID_CHARS),
        name: name.slice(0, MAX_TEXT_CHARS),
        detail: detail.slice(0, MAX_TEXT_CHARS),
        station: '',
        serves: [],
        ...(lat && lon && isPosition(position) ? { position } : {})
      })
    }
  )
  for (const [id, parent] of parents) {
    const stop = stops.get(id)
    if (stop) stop.station = stations.get(parent) ?? ''
  }

  // Each path's first trip, for the order its stops come in along the path: every trip on a
  // path makes the same stops (all of Valley Metro's do, 2026-09-14), and one's are few to keep.
  const orderTrips = new Map<string, string>()
  const shapesSeen = new Set<string>()
  for (const [id, trip] of trips) {
    if (!trip.shape || shapesSeen.has(trip.shape)) continue
    shapesSeen.add(trip.shape)
    orderTrips.set(id, trip.shape)
  }
  /** By path: [stop_sequence, stop id] of its first trip. */
  const orders = new Map<string, [number, string][]>()

  // Per stop, per route and direction: how many trips go to each headsign, and on which path.
  const headsigns = new Map<string, Map<string, Map<string, HeadsignCount>>>()
  await rows(
    'stop_times.txt',
    ['trip_id', 'stop_id', 'stop_sequence'],
    ([tripId, stopId, sequence]) => {
      const trip = trips.get(tripId)
      if (!trip || !stops.has(stopId)) return
      const shape = orderTrips.get(tripId)
      if (shape !== undefined && sequence !== '' && Number.isFinite(Number(sequence))) {
        let order = orders.get(shape)
        if (!order) orders.set(shape, (order = []))
        if (order.length < MAX_TRIP_STOPS) order.push([Number(sequence), stopId])
      }
      let atStop = headsigns.get(stopId)
      if (!atStop) headsigns.set(stopId, (atStop = new Map()))
      const key = `${trip.route}\n${trip.direction}`
      let counts = atStop.get(key)
      if (!counts) atStop.set(key, (counts = new Map()))
      let count = counts.get(trip.headsign)
      if (!count) counts.set(trip.headsign, (count = { trips: 0, shapes: new Map() }))
      count.trips += 1
      if (trip.shape) count.shapes.set(trip.shape, (count.shapes.get(trip.shape) ?? 0) + 1)
    }
  )

  const version = await feedVersion(schedule)

  const served: StopListStop[] = []
  const wanted = new Set<string>()
  for (const stop of stops.values()) {
    const atStop = headsigns.get(stop.id)
    // A stop nothing stops at (yet) is no use to pick.
    if (!atStop) continue
    for (const [key, counts] of atStop) {
      const [route = '', direction] = key.split('\n')
      // The headsign most of its trips here show; short turns are the exception.
      const [headsign = '', count] = [...counts].sort((a, b) => b[1].trips - a[1].trips)[0] ?? []
      // And the path most of those trips take: a detour now and then isn't the route.
      const [shape] = [...(count?.shapes ?? [])].sort((a, b) => b[1] - a[1])[0] ?? []
      if (shape) wanted.add(shape)
      stop.serves.push(
        shape ? [route, Number(direction), headsign, shape] : [route, Number(direction), headsign]
      )
    }
    stop.serves.sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }) || a[1] - b[1])
    served.push(stop)
  }
  if (served.length === 0) throw new ZipError('The schedule has no stops.')
  const lines = await readLines(schedule, wanted)
  const places = placeStops(lines, orders, stops)
  for (const stop of served) {
    stop.serves = stop.serves.map((serves) => {
      if (serves.length !== 4) return serves
      const visits = places.get(serves[3])?.get(stop.id)
      const [, first] = visits?.[0] ?? []
      if (!visits || first === undefined) return serves
      return visits.length === 1 ? [...serves, first] : [...serves, first, visits.flat()]
    })
  }
  return { downloadedAt, revision: STOP_LIST_REVISION, version, routes, stops: served, lines }
}

interface HeadsignCount {
  trips: number
  shapes: Map<string, number>
}

/**
 * By path, then stop: [stop_sequence, metres along the path] of each visit its first trip makes
 * to the stop, worked out from the order it makes its stops; most stops have one.
 */
function placeStops(
  lines: Record<string, number[]>,
  orders: Map<string, [number, string][]>,
  stops: Map<string, StopListStop>
): Map<string, Map<string, [number, number][]>> {
  const places = new Map<string, Map<string, [number, number][]>>()
  for (const [shape, order] of orders) {
    const line = decodeLine(lines[shape])
    if (!line) continue
    order.sort((a, b) => a[0] - b[0])
    const placed = order.flatMap(([sequence, id]) => {
      const position = stops.get(id)?.position
      return position ? [{ id, sequence, position }] : []
    })
    const alongs = placeInOrder(
      line,
      placed.map(({ position }) => position)
    )
    const byStop = new Map<string, [number, number][]>()
    placed.forEach(({ id, sequence }, i) => {
      const along = alongs[i]
      if (along === null || along === undefined) return
      const visits = byStop.get(id)
      if (visits) visits.push([sequence, Math.round(along)])
      else byStop.set(id, [[sequence, Math.round(along)]])
    })
    places.set(shape, byStop)
  }
  return places
}

/** The paths the stop list's routes take, from shapes.txt; none when the schedule has none. */
async function readLines(
  schedule: ScheduleZip,
  wanted: ReadonlySet<string>
): Promise<Record<string, number[]>> {
  if (!schedule.has('shapes.txt') || wanted.size === 0) return {}
  const points = new Map<string, [number, LatLon][]>()
  await schedule.rows(
    'shapes.txt',
    ['shape_id', 'shape_pt_sequence', 'shape_pt_lat', 'shape_pt_lon'],
    ([id, sequence, lat, lon]) => {
      if (!wanted.has(id)) return
      const position = [Number(lat), Number(lon)]
      const order = Number(sequence)
      if (!lat || !lon || !isPosition(position) || !Number.isFinite(order)) return
      let line = points.get(id)
      if (!line) points.set(id, (line = []))
      line.push([order, position])
    }
  )
  const lines: Record<string, number[]> = {}
  for (const [id, line] of points) {
    if (Object.keys(lines).length >= MAX_LINES) break
    line.sort((a, b) => a[0] - b[0])
    const simple = simplifyLine(
      line.map(([, position]) => position),
      LINE_TOLERANCE_M
    )
    if (simple.length >= 2) lines[id] = encodeLine(simple)
  }
  return lines
}

/**
 * The path buses on this route take past this stop, heading this way, and how far along it the
 * stop is (null when the stop list couldn't tell); null when there's no path. For a stop its
 * trips make twice, the trip's `sequence` there (stop_sequence) says which visit.
 */
export function stopLine(
  list: StopList,
  stop: StopListStop,
  routeId: string,
  directionId: number | null,
  sequence: number | null
): { id: string; line: LatLon[]; along: number | null } | null {
  const serves =
    stop.serves.find(([route, direction]) => route === routeId && direction === directionId) ??
    stop.serves.find(([route]) => route === routeId)
  const id = serves?.[3]
  const line = id ? decodeLine(list.lines?.[id]) : null
  return id && line ? { id, line, along: visitPlace(serves, sequence) } : null
}

/** The place of the visit whose stop_sequence is nearest the trip's, else the first visit's. */
function visitPlace(serves: Serves | undefined, sequence: number | null): number | null {
  const visits = serves?.[5]
  let place = serves?.[4] ?? null
  if (!visits || sequence === null) return place
  let nearest = Infinity
  for (let i = 0; i + 1 < visits.length; i += 2) {
    const gap = Math.abs((visits[i] ?? Infinity) - sequence)
    if (gap < nearest) {
      nearest = gap
      place = visits[i + 1] ?? place
    }
  }
  return place
}

/** Each list's paths' stops and how far along their path they are, worked out once. */
const pathStops = new WeakMap<StopList, Map<string, Map<string, number>>>()

/** The stops the stop list placed along this path, by id, in metres along it. */
export function stopsAlong(list: StopList, lineId: string): ReadonlyMap<string, number> {
  let byPath = pathStops.get(list)
  if (!byPath) {
    byPath = new Map()
    for (const stop of list.stops) {
      for (const serves of stop.serves) {
        // A stop made twice goes in at its first visit, as a stop the bus is heading to.
        const [, , , path, along] = serves
        if (path === undefined || along === undefined) continue
        let onPath = byPath.get(path)
        if (!onPath) byPath.set(path, (onPath = new Map()))
        onPath.set(stop.id, along)
      }
    }
    pathStops.set(list, byPath)
  }
  return byPath.get(lineId) ?? new Map()
}

const isString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max

const isAlong = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Visits are [sequence, metres] pairs: a few for a stop made twice, never many. */
const isVisits = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length >= 4 &&
  value.length <= 16 &&
  value.length % 2 === 0 &&
  value.every(isAlong)

/** A saved stop list, read back with the same care as anything from outside. */
export function parseStopList(raw: unknown): StopList | null {
  if (typeof raw !== 'object' || raw === null) return null
  const saved = raw as Record<string, unknown>
  if (typeof saved.downloadedAt !== 'number' || !Number.isFinite(saved.downloadedAt)) return null
  if (typeof saved.routes !== 'object' || saved.routes === null || !Array.isArray(saved.stops)) {
    return null
  }
  const routes: Record<string, StopListRoute> = {}
  for (const [id, value] of Object.entries(saved.routes)) {
    const route = (typeof value === 'object' && value !== null ? value : {}) as Record<
      string,
      unknown
    >
    if (isString(id, MAX_ID_CHARS) && isString(route.short, MAX_TEXT_CHARS)) {
      routes[id] = {
        short: route.short,
        long: isString(route.long, MAX_TEXT_CHARS) ? route.long : ''
      }
    }
  }
  const stops: StopListStop[] = []
  for (const value of saved.stops) {
    if (typeof value !== 'object' || value === null) continue
    const stop = value as Record<string, unknown>
    if (!isString(stop.id, MAX_ID_CHARS) || !stop.id || !isString(stop.name, MAX_TEXT_CHARS)) {
      continue
    }
    const serves = Array.isArray(stop.serves)
      ? stop.serves.filter(
          (row: unknown): row is Serves =>
            Array.isArray(row) &&
            (row.length === 3 ||
              ((row.length === 4 ||
                (row.length === 5 && isAlong(row[4])) ||
                (row.length === 6 && isAlong(row[4]) && isVisits(row[5]))) &&
                isString(row[3], MAX_ID_CHARS))) &&
            isString(row[0], MAX_ID_CHARS) &&
            typeof row[1] === 'number' &&
            isString(row[2], MAX_TEXT_CHARS)
        )
      : []
    stops.push({
      id: stop.id,
      code: isString(stop.code, MAX_ID_CHARS) ? stop.code : '',
      name: stop.name,
      detail: isString(stop.detail, MAX_TEXT_CHARS) ? stop.detail : '',
      station: isString(stop.station, MAX_TEXT_CHARS) ? stop.station : '',
      serves,
      ...(isPosition(stop.position) ? { position: stop.position } : {})
    })
  }
  if (stops.length === 0) return null
  return {
    downloadedAt: saved.downloadedAt,
    ...(Number.isInteger(saved.revision) ? { revision: saved.revision as number } : {}),
    version: isString(saved.version, MAX_TEXT_CHARS) ? saved.version : '',
    routes,
    stops,
    ...(typeof saved.lines === 'object' && saved.lines !== null
      ? { lines: parseLines(saved.lines) }
      : {})
  }
}

function parseLines(raw: object): Record<string, number[]> {
  const lines: Record<string, number[]> = {}
  for (const [id, value] of Object.entries(raw).slice(0, MAX_LINES)) {
    // Kept as saved once it's known to be a line: decoded again when a card needs it.
    if (isString(id, MAX_ID_CHARS) && decodeLine(value)) lines[id] = value as number[]
  }
  return lines
}

/** A stop as the renderer sees it: names instead of ids. */
export function toTransitStop(list: StopList, stop: StopListStop): TransitStop {
  const serves = new Map<string, TransitStop['serves'][number]>()
  for (const [route, , headsign] of stop.serves) {
    const name = routeName(route, list.routes[route]).name
    // A loop can head the same way in both its directions.
    serves.set(`${name}\n${headsign}`, { route: name, headsign })
  }
  return {
    id: stop.id,
    name: stop.name,
    detail: stop.detail,
    code: stop.code,
    source: 'valleyMetro',
    serves: [...serves.values()]
  }
}

/** Lowercase words with street-name spellings made alike: "Ave" and "Av", "&" and "and". */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => (word === 'ave' || word === 'avenue' ? 'av' : word))
    .map((word) => (word === 'street' ? 'st' : word === 'road' ? 'rd' : word))
}

const MAX_RESULTS = 25

interface SearchEntry {
  stop: StopListStop
  nameWords: string[]
  allWords: string[]
}

/** Each list's words, worked out on its first search rather than on every key typed. */
const searchIndexes = new WeakMap<StopList, SearchEntry[]>()

function searchIndex(list: StopList): SearchEntry[] {
  let index = searchIndexes.get(list)
  if (!index) {
    index = list.stops.map((stop) => {
      const nameWords = words(stop.name)
      const allWords = [...nameWords, ...words(stop.detail), ...words(stop.station), stop.code]
      return { stop, nameWords, allWords }
    })
    searchIndexes.set(list, index)
  }
  return index
}

/**
 * Stops whose name (or sign number, or corner) has every typed word, a word's start enough:
 * "mill univ" finds "Mill Ave & University Dr". Exact names and sign numbers come first.
 */
export function searchStops(list: StopList, query: string): StopListStop[] {
  const typed = words(query)
  if (typed.length === 0) return []
  const scored: { stop: StopListStop; score: number }[] = []
  for (const { stop, nameWords, allWords } of searchIndex(list)) {
    if (!typed.every((word) => allWords.some((candidate) => candidate.startsWith(word)))) continue
    const inName = typed.filter((word) => nameWords.some((w) => w.startsWith(word))).length
    const score = (stop.code === query.trim() ? 100 : 0) + inName * 10 - nameWords.length
    scored.push({ stop, score })
  }
  scored.sort((a, b) => b.score - a.score || a.stop.name.localeCompare(b.stop.name))
  return scored.slice(0, MAX_RESULTS).map(({ stop }) => stop)
}
