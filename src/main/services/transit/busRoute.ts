// The Next bus route card, main-process side: a coming bus's path, cut at the stop and framed
// on an Apple Maps picture (made ahead, like the class maps, so holding never waits), and while
// the card is open, where the bus is, from Valley Metro's Vehicle Locations.
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { writeJsonFile } from '../jsonFile'
import type { FeedVehicle } from './gtfsRealtime'
import {
  distanceM,
  fitBox,
  frameStretch,
  isLoop,
  lineDistances,
  placeBefore,
  placeOnLine,
  pointAlong,
  projector,
  sliceLine,
  type LatLon,
  type MapBox
} from './routeLine'
import type { RouteMapReply, RouteMapRequest } from './routePicture'
import type { RouteSource, TransitService } from './service'
import type {
  BusRouteBus,
  BusRouteInfo,
  BusRouteLive,
  BusRouteOther,
  MapSpot,
  TransitState
} from './types'
import type { VehicleFeed, VehicleRead } from './valleyMetro'

/** The picture's size in points: the card's map, at the screen's scale. */
export const ROUTE_PICTURE = { width: 520, height: 300 }
const ASPECT = ROUTE_PICTURE.width / ROUTE_PICTURE.height
/** Room around the path, as a share of each side, so its ends aren't on the card's edge. */
const PADDING = 0.08
/**
 * Room around the stop, as shares of the map's height and width: its pin stands above it (2.1rem
 * of a ~16.5rem map), and a bus waiting there is drawn beside the pin. A stop at the top of its
 * path (Tempe TC, where the Orbits start) had its pin cut off by the map's edge, and the bus
 * waiting there on top of it.
 */
const STOP_ROOM = { above: 0.17, below: 0.08, aside: 0.13 }
/** Apple's map style changes now and then; a route's path changes with the schedule. */
const PICTURE_MAX_AGE_SEC = 90 * 24 * 3600
/** A card that opens before its picture is made waits this long for it, then shows without. */
const WAIT_FOR_PICTURE_MS = 6000
/**
 * Pictures made ahead, for the next buses with a path: every route the Bus pill (and its open
 * card) can be swiped to, near enough, so swiping never waits on a picture. Each is made once
 * per path, stop and theme, then kept.
 */
const PREPARE_AHEAD = 8
/** Buses report every 15–30 s; asking more often only repeats the same spot. */
export const VEHICLE_POLL_SEC = 15
/** A card left open (or a renderer that never said it closed) stops the reads after this. */
export const WATCH_MAX_SEC = 15 * 60
/**
 * A card swiped to another route stops watching one bus and starts on the next at once: within
 * this long, it's the same card, and its 15 minutes run on rather than start again.
 */
const SWITCH_SEC = 2
/** A bus this close to its path is on it; farther off (a detour, the garage) it shows as it is. */
const ON_LINE_M = 250
/** A position older than this says nothing true about now. */
const VEHICLE_TOO_OLD_SEC = 5 * 60
/** A bus this little past the stop is still at it. */
const AT_STOP_M = 40
/** A bus this close to the stop is at it: waiting out its layover, or stopped for riders. */
const AT_STOP_RADIUS_M = 75
/** Other buses this far off the map's edges are left out: nothing of them would show. */
const OFF_MAP = 0.05
/**
 * A bus the feed has due at the stop later than this is still coming, wherever it is on the
 * path. Measured on the live feeds (2026-10-20): buses that had really passed were all due
 * within 90 s, while one in thirty coming buses sat past the stop on the path, 2–29 min out
 * (finishing the trip before this one, or coming round a loop).
 */
const DUE_LATER_SEC = 90
/** A loop's bus this short of coming round to the stop is on its way there, even when due now. */
const COMING_ROUND_M = 1000

export interface RouteFrame {
  box: MapBox
  /** Metres along the path to the stop. */
  stopAlong: number
  /** The stop's place on the path, where its pin stands. */
  stopAt: LatLon
}

/**
 * The stretch of the path the card frames around the stop, and the box that fits it. The stop
 * is where the stop list placed it along the path (`stopAlong`), when it could: on a street the
 * route runs down twice, the nearest pass may not be the one that serves it.
 */
export function frameRoute(
  line: readonly LatLon[],
  stop: LatLon,
  stopAlong: number | null,
  aspect = ASPECT
): RouteFrame | null {
  const total = lineDistances(line).at(-1) ?? 0
  const along = stopAlong !== null ? Math.min(stopAlong, total) : placeOnLine(line, stop)?.along
  if (along === undefined) return null
  const [from, to] = frameStretch(total, along)
  const stopAt = pointAlong(line, along) ?? stop
  const box = fitBox([...sliceLine(line, from, to), stop], aspect, PADDING, {
    point: stopAt,
    ...STOP_ROOM
  })
  return box ? { box, stopAlong: along, stopAt } : null
}

type Place = (point: LatLon) => [number, number]

/** Four decimals is a tenth of a pixel on the card: plenty, and small to send. */
const round4 = (value: number): number => Math.round(value * 1e4) / 1e4

function spot(place: Place, point: LatLon): MapSpot {
  const [x, y] = place(point)
  return [round4(x), round4(y)]
}

/** The path on the card: up to the stop and on from it, meeting at the stop on the path. */
export function routeSpots(
  line: readonly LatLon[],
  frame: RouteFrame,
  place: Place
): Pick<BusRouteInfo, 'behind' | 'ahead' | 'stop'> {
  const total = lineDistances(line).at(-1) ?? 0
  return {
    behind: sliceLine(line, 0, frame.stopAlong).map((point) => spot(place, point)),
    ahead: sliceLine(line, frame.stopAlong, total).map((point) => spot(place, point)),
    stop: spot(place, frame.stopAt)
  }
}

/** What the live feeds say about the card's bus, besides where it is. */
export interface BusTiming {
  /** Seconds until the feed has it at the stop; negative once that time has gone by. */
  dueInSec: number
  /** Vehicle Locations has it on another trip: it hasn't started this one yet (or has ended it). */
  onAnotherTrip: boolean
}

/**
 * Past the stop on the path isn't always gone. A bus is matched by its id, so it may still be
 * finishing the trip before (on a loop, or the other way down the same streets), past the stop
 * on this trip's path while it's minutes away: the feed's time says which.
 */
function stillComing(
  line: readonly LatLon[],
  stopAlong: number,
  along: number,
  timing: BusTiming
): boolean {
  if (along <= stopAlong + AT_STOP_M) return true
  if (timing.dueInSec > DUE_LATER_SEC) return true
  if (timing.onAnotherTrip && timing.dueInSec > 0) return true
  // A loop's last stretch, from the far side of its end, comes round to the stop.
  const total = lineDistances(line).at(-1) ?? 0
  return isLoop(line) && total - along + stopAlong <= COMING_ROUND_M
}

/**
 * Where the bus is on the card: on its path when it's near it, whether it's still coming, and
 * whether it's at the stop. Where the path runs down a street twice, the stop it's at or heading
 * to (`nextAlong`, metres along the path) says which pass it's on.
 */
export function busSpot(
  line: readonly LatLon[],
  frame: RouteFrame,
  place: Place,
  position: LatLon,
  nextAlong: number | null,
  timing: BusTiming
): Pick<BusRouteBus, 'at' | 'coming' | 'atStop'> {
  // By its distance, not along the path: a loop's bus back at its first stop is at its end.
  const atStop = distanceM(position, frame.stopAt) <= AT_STOP_RADIUS_M
  const onLine = placeBefore(line, position, nextAlong)
  if (onLine && onLine.offset <= ON_LINE_M) {
    return {
      at: spot(place, pointAlong(line, onLine.along) ?? position),
      coming: stillComing(line, frame.stopAlong, onLine.along, timing),
      atStop
    }
  }
  return { at: spot(place, position), coming: true, atStop }
}

/** What picks out the route's other buses: its route, which way, and its path and stops. */
export interface OtherBusesOf {
  routeId: string
  /** null when the feed doesn't say: then either way counts. */
  directionId: number | null
  /** The card's own bus, drawn on its own. */
  except: FeedVehicle | null
  line: readonly LatLon[]
  stopsAlong: ReadonlyMap<string, number>
}

/**
 * The route's other buses going the same way, like a transit app shows them: fresh, on the
 * card's path (a bus off it, to or from the garage, isn't on its way), and on the map.
 */
export function otherBuses(
  vehicles: readonly FeedVehicle[],
  of: OtherBusesOf,
  place: Place,
  nowSec: number
): BusRouteOther[] {
  const others: BusRouteOther[] = []
  for (const vehicle of vehicles) {
    if (vehicle === of.except || vehicle.routeId !== of.routeId) continue
    const known = of.directionId !== null && vehicle.directionId !== null
    if (known && vehicle.directionId !== of.directionId) continue
    if (nowSec - (vehicle.timestamp ?? nowSec) > VEHICLE_TOO_OLD_SEC) continue
    const nextAlong = of.stopsAlong.get(vehicle.stopId) ?? null
    const onLine = placeBefore(of.line, [vehicle.lat, vehicle.lon], nextAlong)
    if (!onLine || onLine.offset > ON_LINE_M) continue
    const at = spot(place, pointAlong(of.line, onLine.along) ?? [vehicle.lat, vehicle.lon])
    if (at.some((share) => share < -OFF_MAP || share > 1 + OFF_MAP)) continue
    others.push({ id: vehicle.vehicleId || vehicle.tripId, at })
  }
  return others.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export interface BusRouteOptions {
  /** userData: the pictures are kept in its transit-maps folder. */
  directory: string
  transit: Pick<TransitService, 'routeSource' | 'subscribe' | 'get' | 'isDemoEnabled'>
  /** Makes one picture with the helper; null off macOS, or when it isn't built. */
  makePicture: ((request: RouteMapRequest) => Promise<RouteMapReply | null>) | null
  /** The map matches the theme: dark unless it's the day theme. */
  dark(): boolean
  vehicles: VehicleFeed
  /** Dev builds: the demo's buses, read while the demo is on. */
  demoVehicles: VehicleFeed | null
  /** Milliseconds, like Date.now. */
  now?: () => number
}

export interface BusRouteService {
  /** The card for a coming bus; null when it's gone or has no path. Waits a moment for its map. */
  route(arrivalId: string): Promise<BusRouteInfo | null>
  /** The card opened on this bus, or closed (null): Vehicle Locations is read only in between. */
  watch(arrivalId: string | null): void
  subscribe(listener: (live: BusRouteLive | null) => void): () => void
  /** Makes the pictures for the next buses ahead of time (after a theme change, say). */
  prepare(): void
  dispose(): void
}

interface SavedPicture extends RouteMapReply {
  madeAt: number
  box: MapBox
}

function asSavedPicture(raw: unknown): SavedPicture | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { madeAt, image, northWest, southEast, box } = raw as Record<string, unknown>
  if (typeof madeAt !== 'number' || typeof image !== 'string') return null
  if (!Array.isArray(northWest) || !Array.isArray(southEast)) return null
  if (typeof box !== 'object' || box === null) return null
  const { north, south, east, west } = box as Record<string, unknown>
  const corners = [...northWest, ...southEast] as unknown[]
  if (![north, south, east, west, ...corners].every((n) => typeof n === 'number')) return null
  return {
    madeAt,
    image,
    northWest: northWest as [number, number],
    southEast: southEast as [number, number],
    box: box as MapBox
  }
}

const sameBox = (a: MapBox, b: MapBox): boolean =>
  Math.abs(a.north - b.north) < 1e-6 &&
  Math.abs(a.south - b.south) < 1e-6 &&
  Math.abs(a.east - b.east) < 1e-6 &&
  Math.abs(a.west - b.west) < 1e-6

/** File names from the schedule's ids: letters, digits, dashes and underscores only. */
const safeName = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60)

export function createBusRouteService(options: BusRouteOptions): BusRouteService {
  const { transit, makePicture } = options
  const now = options.now ?? Date.now
  const nowSec = (): number => Math.floor(now() / 1000)
  const picturesDir = join(options.directory, 'transit-maps')
  const listeners = new Set<(live: BusRouteLive | null) => void>()

  /** Pictures being made, by file, so two asks share one run. */
  const making = new Map<string, Promise<SavedPicture | null>>()
  /** The last few read or made, so the minute's prepare doesn't reread them from disk. */
  const kept = new Map<string, SavedPicture>()
  /** One helper at a time: pictures queue up behind each other. */
  let queue: Promise<unknown> = Promise.resolve()

  /**
   * The card's path and how it's placed on the picture, for placing its bus the same way, and
   * when its bus is due, as the feed last said (it drops a bus once it has been).
   */
  let shown: {
    arrivalId: string
    source: RouteSource
    frame: RouteFrame
    place: Place
    dueAt: number
  } | null = null
  let watching: string | null = null
  let watchedAt = 0
  let stoppedAt = -Infinity
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let live: BusRouteLive | null = null

  function readSaved(file: string): SavedPicture | null {
    const memo = kept.get(file)
    if (memo) return memo
    try {
      return existsSync(file) ? asSavedPicture(JSON.parse(readFileSync(file, 'utf8'))) : null
    } catch {
      return null
    }
  }

  function keep(file: string, picture: SavedPicture): void {
    kept.delete(file)
    kept.set(file, picture)
    for (const old of kept.keys()) {
      if (kept.size <= PREPARE_AHEAD * 2) break
      kept.delete(old)
    }
  }

  function picture(
    source: RouteSource,
    frame: RouteFrame,
    dark: boolean
  ): Promise<SavedPicture | null> {
    const name = `${safeName(source.lineId)}-${safeName(source.arrival.stopId)}-${
      dark ? 'dark' : 'light'
    }.json`
    const file = join(picturesDir, name)
    const saved = readSaved(file)
    // A picture of another box (the schedule moved the route) can't carry this path.
    const fits = saved !== null && sameBox(saved.box, frame.box)
    if (fits && nowSec() - saved.madeAt < PICTURE_MAX_AGE_SEC) {
      keep(file, saved)
      return Promise.resolve(saved)
    }
    const fallback = fits ? saved : null
    if (!makePicture) return Promise.resolve(fallback)
    const running = making.get(file)
    if (running) return running
    const run = queue
      .then(() => makePicture({ ...frame.box, ...ROUTE_PICTURE, dark }))
      .then((reply) => {
        if (!reply) return fallback
        const made: SavedPicture = { ...reply, box: frame.box, madeAt: nowSec() }
        keep(file, made)
        try {
          writeJsonFile(file, made)
        } catch (error) {
          console.warn('[transit] Could not save a route map.', error)
        }
        return made
      })
      .catch(() => fallback)
      .finally(() => making.delete(file))
    making.set(file, run)
    queue = run
    return run
  }

  async function waitFor(made: Promise<SavedPicture | null>): Promise<SavedPicture | null> {
    let wait: ReturnType<typeof setTimeout> | undefined
    return Promise.race([
      made,
      new Promise<null>((resolve) => {
        wait = setTimeout(() => resolve(null), WAIT_FOR_PICTURE_MS)
      })
    ]).finally(() => clearTimeout(wait))
  }

  function prepare(state: TransitState = transit.get()): void {
    if (!makePicture) return
    const dark = options.dark()
    const done = new Set<string>()
    for (const arrival of state.arrivals) {
      if (done.size >= PREPARE_AHEAD) break
      const source = arrival.hasRoute ? transit.routeSource(arrival.id) : null
      const key = source && `${source.lineId}\n${arrival.stopId}`
      if (!source || !key || done.has(key)) continue
      done.add(key)
      const frame = frameRoute(source.line, source.stopPosition, source.stopAlong)
      if (frame) void picture(source, frame, dark)
    }
  }

  function emitBus(next: BusRouteLive | null): void {
    if (JSON.stringify(next) === JSON.stringify(live)) return
    live = next
    for (const listener of listeners) listener(live)
  }

  function liveFrom(read: VehicleRead): BusRouteLive | null {
    const card = shown && shown.arrivalId === watching ? shown : null
    if (!read.ok || !card) return null
    const { source } = card
    const vehicle =
      read.feed.vehicles.find(
        (candidate) =>
          (source.vehicleId !== '' && candidate.vehicleId === source.vehicleId) ||
          (source.tripId !== '' && candidate.tripId === source.tripId)
      ) ?? null
    const others = otherBuses(
      read.feed.vehicles,
      {
        routeId: source.arrival.routeId,
        directionId: source.directionId,
        except: vehicle,
        line: source.line,
        stopsAlong: source.stopsAlong
      },
      card.place,
      nowSec()
    )
    return { arrivalId: card.arrivalId, bus: vehicle && busFrom(card, vehicle), others }
  }

  function busFrom(card: NonNullable<typeof shown>, vehicle: FeedVehicle): BusRouteBus | null {
    const { source } = card
    const seenAt = vehicle.timestamp ?? nowSec()
    if (nowSec() - seenAt > VEHICLE_TOO_OLD_SEC) return null
    const latest = transit.get().arrivals.find((arrival) => arrival.id === card.arrivalId)
    if (latest) card.dueAt = latest.at
    const timing: BusTiming = {
      dueInSec: card.dueAt - nowSec(),
      onAnotherTrip:
        vehicle.tripId !== '' && source.tripId !== '' && vehicle.tripId !== source.tripId
    }
    // Its next stop is on this path only while it's running this trip.
    const onThisTrip = source.tripId !== '' && vehicle.tripId === source.tripId
    const nextAlong = onThisTrip ? (source.stopsAlong.get(vehicle.stopId) ?? null) : null
    return {
      ...busSpot(
        source.line,
        card.frame,
        card.place,
        [vehicle.lat, vehicle.lon],
        nextAlong,
        timing
      ),
      seenAt
    }
  }

  async function readVehicles(asked: number): Promise<void> {
    if (asked !== generation || watching === null) return
    if (nowSec() - watchedAt > WATCH_MAX_SEC) {
      watching = null
      emitBus(null)
      return
    }
    const feed =
      transit.isDemoEnabled() && options.demoVehicles ? options.demoVehicles : options.vehicles
    const read = await feed.read().catch((): VehicleRead => ({ ok: false, problem: '' }))
    if (asked !== generation) return
    emitBus(liveFrom(read))
    timer = setTimeout(() => void readVehicles(asked), VEHICLE_POLL_SEC * 1000)
  }

  const unsubscribe = transit.subscribe((state) => prepare(state))

  return {
    async route(arrivalId) {
      const source = transit.routeSource(arrivalId)
      const frame = source && frameRoute(source.line, source.stopPosition, source.stopAlong)
      if (!source || !frame) return null
      const made = await waitFor(picture(source, frame, options.dark()))
      const place = made
        ? projector(frame.box, made.northWest, made.southEast)
        : projector(frame.box, [0, 0], [1, 1])
      shown = { arrivalId, source, frame, place, dueAt: source.arrival.at }
      return {
        arrivalId,
        route: source.arrival.route,
        headsign: source.arrival.headsign,
        stopName: source.stopName,
        picture: made ? `data:image/jpeg;base64,${made.image}` : null,
        aspect: ASPECT,
        ...routeSpots(source.line, frame, place),
        live: source.vehicleId !== '' || source.tripId !== ''
      }
    },
    watch(arrivalId) {
      if (arrivalId === watching) return
      if (arrivalId === null) stoppedAt = nowSec()
      const switched = watching === null && nowSec() - stoppedAt <= SWITCH_SEC
      watching = arrivalId
      generation += 1
      clearTimeout(timer)
      emitBus(null)
      if (arrivalId === null) return
      if (!switched) watchedAt = nowSec()
      void readVehicles(generation)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    prepare: () => prepare(),
    dispose() {
      generation += 1
      watching = null
      clearTimeout(timer)
      unsubscribe()
      listeners.clear()
    }
  }
}
