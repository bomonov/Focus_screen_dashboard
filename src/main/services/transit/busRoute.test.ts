import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  busSpot,
  createBusRouteService,
  frameRoute,
  otherBuses,
  routeSpots,
  VEHICLE_POLL_SEC,
  WATCH_MAX_SEC,
  type BusTiming,
  type RouteFrame
} from './busRoute'
import type { FeedVehicle } from './gtfsRealtime'
import { lineDistances, projector, type LatLon } from './routeLine'
import type { RouteMapRequest } from './routePicture'
import type { RouteSource } from './service'
import type { BusArrival, BusRouteLive, TransitState } from './types'
import type { VehicleRead } from './valleyMetro'

/** North up Mill Ave for ~2.2 km, then east along a street for ~1.9 km. */
const LINE: LatLon[] = [
  [33.41, -111.94],
  [33.43, -111.94],
  [33.43, -111.92]
]
/** A stop beside the first stretch, ~1.1 km along. */
const STOP: LatLon = [33.42, -111.9399]
/** On the path ~2.9 km along, well past the stop. */
const PAST_STOP: LatLon = [33.43, -111.93]
const DUE_NOW: BusTiming = { dueInSec: 0, onAnotherTrip: false }
/** Up Mill Ave, round a block, and back down Mill past a stop on its other side. */
const TWICE: LatLon[] = [
  [33.41, -111.94],
  [33.43, -111.94],
  [33.43, -111.935],
  [33.431, -111.935],
  [33.431, -111.94],
  [33.4, -111.94]
]
/** The stop on the way back down, across Mill from one on the way up. */
const SOUTHBOUND: LatLon = [33.42, -111.9401]

describe('frameRoute', () => {
  it('frames a short route whole, with the stop on it', () => {
    const frame = frameRoute(LINE, STOP, null, 520 / 300)
    if (!frame) throw new Error('no frame')
    expect(frame.stopAlong).toBeCloseTo(1106, -1)
    expect(frame.box.south).toBeLessThan(33.41)
    expect(frame.box.north).toBeGreaterThan(33.43)
    expect(frame.box.east).toBeGreaterThan(-111.92)
  })

  it('leaves the pin room at the top, for a stop at the top of its path', () => {
    // Tempe TC, where the Orbits start: the northernmost point of the path.
    const top = frameRoute(LINE, [33.43, -111.93], null, 520 / 300)
    if (!top) throw new Error('no frame')
    const [x, y] = projector(top.box, [0, 0], [1, 1])(top.stopAt)
    expect(y).toBeGreaterThanOrEqual(0.17 - 1e-9)
    expect(x).toBeGreaterThanOrEqual(0.13 - 1e-9)
    expect(x).toBeLessThanOrEqual(0.87 + 1e-9)
    // The whole path is still on the map.
    const place = projector(top.box, [0, 0], [1, 1])
    for (const point of LINE) {
      expect(place(point).every((share) => share >= 0 && share <= 1)).toBe(true)
    }
  })

  it('puts the stop where the stop list placed it, on a street the route runs down twice', () => {
    // Nearest, the way up comes first; the stop list knows the way down serves it.
    expect(frameRoute(TWICE, SOUTHBOUND, null)?.stopAlong).toBeCloseTo(1106, -1)
    const down = frameRoute(TWICE, SOUTHBOUND, 4467)
    if (!down) throw new Error('no frame')
    expect(down.stopAlong).toBe(4467)
    const { behind } = routeSpots(TWICE, down, projector(down.box, [0, 0], [1, 1]))
    // The way up and round the block is all behind the stop.
    expect(behind).toHaveLength(6)
    const total = lineDistances(TWICE).at(-1) ?? 0
    expect(frameRoute(TWICE, SOUTHBOUND, total + 50)?.stopAlong).toBe(total)
  })
})

describe('busSpot on a street the route runs down twice', () => {
  const place = projector(
    { north: 33.44, south: 33.39, east: -111.93, west: -111.95 },
    [0, 0],
    [1, 1]
  )
  /** On Mill, 220 m south of the stops. */
  const belowStops: LatLon = [33.418, -111.94]
  const coming = (frame: RouteFrame | null, nextAlong: number | null): boolean => {
    if (!frame) throw new Error('no frame')
    return busSpot(TWICE, frame, place, belowStops, nextAlong, DUE_NOW).coming
  }

  it('knows a bus heading on down Mill has been to the stop on the way down', () => {
    const down = frameRoute(TWICE, SOUTHBOUND, 4467)
    // Its next stop is further down Mill, 6.1 km along.
    expect(coming(down, 6126)).toBe(false)
    // Heading for the stop on the way up: the whole block still to go.
    expect(coming(down, 1106)).toBe(true)
    // Not said: the earliest pass, coming, as before.
    expect(coming(down, null)).toBe(true)
  })

  it('knows a bus heading on down Mill has been to the stop on the way up, and come back', () => {
    const up = frameRoute(TWICE, [33.42, -111.9399], 1106)
    expect(coming(up, 1106)).toBe(true)
    expect(coming(up, 6126)).toBe(false)
  })
})

describe('routeSpots and busSpot', () => {
  const frame = frameRoute(LINE, STOP, null, 520 / 300)
  if (!frame) throw new Error('no frame')
  const place = projector(frame.box, [0, 0], [1, 1])

  it('splits the path at the stop: where the bus comes from, and where it goes on to', () => {
    const { behind, ahead, stop } = routeSpots(LINE, frame, place)
    expect(behind.at(-1)).toEqual(stop)
    expect(ahead[0]).toEqual(stop)
    // Up the map toward the stop, then on north and east.
    expect(behind[0]?.[1]).toBeGreaterThan(stop[1])
    expect(ahead.at(-1)?.[0]).toBeGreaterThan(stop[0])
    expect(stop.every((share) => share > 0 && share < 1)).toBe(true)
  })

  it('puts a bus near its path on it, and says whether it’s still coming', () => {
    const coming = busSpot(LINE, frame, place, [33.415, -111.9401], null, DUE_NOW)
    expect(coming.coming).toBe(true)
    const onPath = place([33.415, -111.94])
    expect(coming.at[0]).toBeCloseTo(onPath[0], 3)
    expect(busSpot(LINE, frame, place, PAST_STOP, null, DUE_NOW).coming).toBe(false)
  })

  it('shows a bus off its path where it is', () => {
    const detour = busSpot(LINE, frame, place, [33.415, -111.93], null, DUE_NOW)
    expect(detour.at[0]).toBeCloseTo(place([33.415, -111.93])[0], 3)
  })

  it('says when the bus is at the stop', () => {
    // ~20 m short of it, waiting; ~550 m short, on its way.
    expect(busSpot(LINE, frame, place, [33.4198, -111.94], null, DUE_NOW).atStop).toBe(true)
    expect(busSpot(LINE, frame, place, [33.415, -111.94], null, DUE_NOW).atStop).toBe(false)
  })

  it('knows a loop’s bus back at its first stop is at it, though it’s at the path’s end', () => {
    const LOOP: LatLon[] = [
      [33.41, -111.94],
      [33.42, -111.94],
      [33.42, -111.93],
      [33.41, -111.93],
      [33.4101, -111.9399]
    ]
    const first = frameRoute(LOOP, [33.41, -111.9401], 0, 520 / 300)
    if (!first) throw new Error('no frame')
    const loopPlace = projector(first.box, [0, 0], [1, 1])
    const back = busSpot(LOOP, first, loopPlace, [33.4101, -111.9399], null, {
      dueInSec: 6 * 60,
      onAnotherTrip: false
    })
    expect(back).toMatchObject({ atStop: true, coming: true })
  })
})

describe('otherBuses', () => {
  const frame = frameRoute(LINE, STOP, null, 520 / 300)
  if (!frame) throw new Error('no frame')
  const place = projector(frame.box, [0, 0], [1, 1])
  const NOW = 1_800_000_000
  const bus = (id: string, more: Partial<FeedVehicle> = {}): FeedVehicle => ({
    vehicleId: id,
    tripId: `trip-${id}`,
    routeId: 'VENU',
    directionId: 0,
    stopId: '',
    lat: 33.415,
    lon: -111.9401,
    bearing: null,
    timestamp: NOW - 10,
    ...more
  })
  const of = {
    routeId: 'VENU',
    directionId: 0,
    except: null,
    line: LINE,
    stopsAlong: new Map<string, number>()
  }

  it('shows the route’s other buses going the same way, on the path', () => {
    const vehicles = [
      bus('b2', { lat: 33.43, lon: -111.93 }),
      bus('b1'),
      bus('other-way', { directionId: 1 }),
      bus('other-route', { routeId: 'MARS' }),
      bus('stale', { timestamp: NOW - 10 * 60 }),
      bus('off-path', { lat: 33.415, lon: -111.93 })
    ]
    const others = otherBuses(vehicles, of, place, NOW)
    expect(others.map((other) => other.id)).toEqual(['b1', 'b2'])
    // Snapped onto the path, like the card's own bus.
    expect(others[0]?.at[0]).toBeCloseTo(place([33.415, -111.94])[0], 3)
  })

  it('leaves out the card’s own bus, and takes either way when the feed doesn’t say', () => {
    const mine = bus('mine')
    const unsaid = bus('unsaid', { directionId: null })
    const others = otherBuses([mine, unsaid], { ...of, except: mine }, place, NOW)
    expect(others.map((other) => other.id)).toEqual(['unsaid'])
  })

  it('leaves out buses beyond the map', () => {
    // On a long route's path, far down it: off the card.
    const far = bus('far', { lat: 33.43, lon: -111.8 })
    const long: LatLon[] = [...LINE, [33.43, -111.8]]
    expect(otherBuses([far], { ...of, line: long }, place, NOW)).toEqual([])
  })
})

describe('busSpot: still coming, or already past the stop', () => {
  const frame = frameRoute(LINE, STOP, null, 520 / 300)
  if (!frame) throw new Error('no frame')
  const place = projector(frame.box, [0, 0], [1, 1])
  const comingAt = (
    line: LatLon[],
    lineFrame: RouteFrame,
    at: LatLon,
    timing: BusTiming
  ): boolean => busSpot(line, lineFrame, place, at, null, timing).coming

  it('takes the feed’s word over the path while the bus is due later', () => {
    // Past the stop on the path, 13 min out: it's finishing the trip before this one.
    expect(comingAt(LINE, frame, PAST_STOP, { dueInSec: 13 * 60, onAnotherTrip: false })).toBe(true)
    // Nearly due and past it: it has been.
    expect(comingAt(LINE, frame, PAST_STOP, { dueInSec: 60, onAnotherTrip: false })).toBe(false)
    expect(comingAt(LINE, frame, PAST_STOP, { dueInSec: -30, onAnotherTrip: false })).toBe(false)
  })

  it('counts a bus still on the trip before as coming, until it’s due', () => {
    expect(comingAt(LINE, frame, PAST_STOP, { dueInSec: 30, onAnotherTrip: true })).toBe(true)
    // On another trip once its time has gone by: it ended this one and went on.
    expect(comingAt(LINE, frame, PAST_STOP, { dueInSec: -30, onAnotherTrip: true })).toBe(false)
  })

  it('keeps a bus at the stop, or a little past it, coming', () => {
    expect(comingAt(LINE, frame, [33.4202, -111.94], DUE_NOW)).toBe(true)
  })

  describe('on a loop', () => {
    /** An Orbit-like square, ~4.1 km round, starting and ending at Mill Ave. */
    const LOOP: LatLon[] = [
      [33.41, -111.94],
      [33.42, -111.94],
      [33.42, -111.93],
      [33.41, -111.93],
      [33.41, -111.94]
    ]
    /** The loop's second stop, ~110 m along. */
    const loopFrame = frameRoute(LOOP, [33.411, -111.9401], null, 520 / 300)
    if (!loopFrame) throw new Error('no frame')

    it('counts a bus coming round as coming, though it’s past the stop on the path', () => {
      // Halfway round, 13 min out: the demo's Orbit Venus on 2026-10-20.
      const halfway: LatLon = [33.42, -111.935]
      expect(comingAt(LOOP, loopFrame, halfway, { dueInSec: 13 * 60, onAnotherTrip: false })).toBe(
        true
      )
      // On its last stretch, about 600 m short of coming round to the stop.
      expect(comingAt(LOOP, loopFrame, [33.41, -111.935], DUE_NOW)).toBe(true)
    })

    it('still says a bus that has been is past', () => {
      expect(comingAt(LOOP, loopFrame, [33.4125, -111.94], DUE_NOW)).toBe(false)
      expect(comingAt(LOOP, loopFrame, [33.42, -111.935], DUE_NOW)).toBe(false)
    })
  })
})

const ARRIVAL: BusArrival = {
  id: 'trip1:S:3',
  routeId: 'VENU',
  route: 'Orbit Venus',
  headsign: 'Venus Forward',
  stopId: 'S',
  at: 1_800_000_240,
  hasRoute: true
}

const SOURCE: RouteSource = {
  arrival: ARRIVAL,
  stopName: 'Mill Ave & University Dr',
  stopPosition: STOP,
  stopAlong: null,
  stopsAlong: new Map(),
  lineId: 'VENU0022',
  line: LINE,
  tripId: 'trip1',
  vehicleId: 'bus7',
  directionId: 0
}

function state(arrivals: BusArrival[]): TransitState {
  return {
    schedule: { stops: 1, downloadedAt: 0 },
    downloading: false,
    scheduleProblem: null,
    stops: [],
    routes: [],
    arrivals,
    shuttles: [],
    updatedAt: null,
    liveProblem: null,
    horizonMinutes: 30,
    demo: false
  }
}

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bus-route-'))
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000 * 1000)
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

/** Bus 7 on its way up Mill Ave, on trip 1. */
const ON_THE_WAY: FeedVehicle = {
  vehicleId: 'bus7',
  tripId: 'trip1',
  routeId: 'VENU',
  directionId: 0,
  stopId: 'S',
  lat: 33.415,
  lon: -111.9401,
  bearing: 0,
  timestamp: 1_799_999_990
}

function setup(
  vehicleReads: VehicleRead[] = [],
  vehicle: FeedVehicle = ON_THE_WAY,
  source: RouteSource = SOURCE
): {
  service: ReturnType<typeof createBusRouteService>
  pictures: RouteMapRequest[]
  reads: () => number
  push: (next: TransitState) => void
} {
  const pictures: RouteMapRequest[] = []
  let readCount = 0
  let listener: ((next: TransitState) => void) | null = null
  let current = state([ARRIVAL])
  const service = createBusRouteService({
    directory: dir,
    transit: {
      routeSource: (id) => (id === ARRIVAL.id ? source : null),
      subscribe: (next) => {
        listener = next
        return () => undefined
      },
      get: () => current,
      isDemoEnabled: () => false
    },
    makePicture: async (request) => {
      pictures.push(request)
      return { image: 'aGVsbG8=', northWest: [0, 0], southEast: [1, 1] }
    },
    dark: () => true,
    vehicles: {
      read: async () => {
        readCount += 1
        return (
          vehicleReads.shift() ?? {
            ok: true,
            feed: { timestamp: 1_800_000_000, vehicles: [vehicle] }
          }
        )
      }
    },
    demoVehicles: null
  })
  return {
    service,
    pictures,
    reads: () => readCount,
    push: (next) => {
      current = next
      listener?.(next)
    }
  }
}

describe('createBusRouteService', () => {
  it('makes the card’s map once, keeps it, and sends only the box to the helper', async () => {
    const { service, pictures } = setup()
    const card = await service.route(ARRIVAL.id)
    expect(card).toMatchObject({
      arrivalId: ARRIVAL.id,
      route: 'Orbit Venus',
      headsign: 'Venus Forward',
      stopName: 'Mill Ave & University Dr',
      picture: 'data:image/jpeg;base64,aGVsbG8=',
      live: true
    })
    expect(card?.behind.length).toBeGreaterThan(1)
    expect(card?.ahead.length).toBeGreaterThan(1)
    expect(pictures).toHaveLength(1)
    expect(Object.keys(pictures[0] ?? {}).sort()).toEqual(
      ['dark', 'east', 'height', 'north', 'south', 'west', 'width'].sort()
    )
    await service.route(ARRIVAL.id)
    expect(pictures).toHaveLength(1)
    expect(readdirSync(join(dir, 'transit-maps'))).toEqual(['VENU0022-S-dark.json'])
    service.dispose()
  })

  it('has no card for a bus without a path', async () => {
    const { service } = setup()
    expect(await service.route('other')).toBeNull()
    service.dispose()
  })

  it('makes the next buses’ maps ahead of time', async () => {
    const { service, pictures, push } = setup()
    push(state([ARRIVAL, { ...ARRIVAL, id: 'trip2:S:3' }]))
    await vi.advanceTimersByTimeAsync(0)
    // The second bus has no source here; the first is made once.
    expect(pictures).toHaveLength(1)
    service.dispose()
  })

  it('reads where the bus is only while its card is open', async () => {
    const { service, reads } = setup()
    const seen: (BusRouteLive | null)[] = []
    service.subscribe((bus) => seen.push(bus))
    await service.route(ARRIVAL.id)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads()).toBe(0)

    service.watch(ARRIVAL.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(reads()).toBe(1)
    expect(seen.at(-1)).toMatchObject({ arrivalId: ARRIVAL.id, bus: { coming: true } })
    await vi.advanceTimersByTimeAsync(VEHICLE_POLL_SEC * 1000)
    expect(reads()).toBe(2)

    service.watch(null)
    expect(seen.at(-1)).toBeNull()
    await vi.advanceTimersByTimeAsync(VEHICLE_POLL_SEC * 4000)
    expect(reads()).toBe(2)
    service.dispose()
  })

  it('stops reading a card left open too long', async () => {
    const { service, reads } = setup()
    await service.route(ARRIVAL.id)
    service.watch(ARRIVAL.id)
    await vi.advanceTimersByTimeAsync((WATCH_MAX_SEC + 60) * 1000)
    const after = reads()
    await vi.advanceTimersByTimeAsync(VEHICLE_POLL_SEC * 4000)
    expect(reads()).toBe(after)
    service.dispose()
  })

  it('keeps a card’s 15 minutes when it’s swiped to another route', async () => {
    const { service, reads } = setup()
    await service.route(ARRIVAL.id)
    service.watch(ARRIVAL.id)
    await vi.advanceTimersByTimeAsync((WATCH_MAX_SEC - 60) * 1000)
    // Swiped: the card lets go of one bus and takes the next straight away.
    service.watch(null)
    service.watch('another')
    await vi.advanceTimersByTimeAsync(120 * 1000)
    const after = reads()
    await vi.advanceTimersByTimeAsync(VEHICLE_POLL_SEC * 4000)
    expect(reads()).toBe(after)
    // Closed, then opened again later: a fresh 15 minutes.
    service.watch(null)
    await vi.advanceTimersByTimeAsync(10 * 1000)
    service.watch(ARRIVAL.id)
    await vi.advanceTimersByTimeAsync(VEHICLE_POLL_SEC * 2000)
    expect(reads()).toBeGreaterThan(after)
    service.dispose()
  })

  it('says a bus past the stop on its path is coming while the feed has it due later', async () => {
    // Bus 7 on trip 1, well past the stop: four minutes out, it's coming round to it again.
    const { service, push } = setup([], {
      ...ON_THE_WAY,
      lat: PAST_STOP[0],
      lon: PAST_STOP[1],
      timestamp: null
    })
    const seen: (BusRouteLive | null)[] = []
    service.subscribe((bus) => seen.push(bus))
    await service.route(ARRIVAL.id)
    service.watch(ARRIVAL.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.at(-1)).toMatchObject({ bus: { coming: true } })

    // The feed has it due in a minute: past the stop now means it has been.
    push(state([{ ...ARRIVAL, at: 1_800_000_000 + 60 }]))
    await vi.advanceTimersByTimeAsync(VEHICLE_POLL_SEC * 1000)
    expect(seen.at(-1)).toMatchObject({ bus: { coming: false } })

    // Gone from the feed: the last time it gave still counts.
    push(state([]))
    await vi.advanceTimersByTimeAsync(VEHICLE_POLL_SEC * 1000)
    expect(seen.at(-1)).toMatchObject({ bus: { coming: false } })
    service.dispose()
  })

  it('says a bus still on the trip before is coming, until it’s due', async () => {
    // Found by its id; Vehicle Locations has it finishing trip 0, past the stop on the path.
    const { service, push } = setup([], {
      ...ON_THE_WAY,
      tripId: 'trip0',
      lat: PAST_STOP[0],
      lon: PAST_STOP[1],
      timestamp: null
    })
    push(state([{ ...ARRIVAL, at: 1_800_000_000 + 30 }]))
    const seen: (BusRouteLive | null)[] = []
    service.subscribe((bus) => seen.push(bus))
    await service.route(ARRIVAL.id)
    service.watch(ARRIVAL.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.at(-1)).toMatchObject({ bus: { coming: true } })

    await vi.advanceTimersByTimeAsync(VEHICLE_POLL_SEC * 3000)
    expect(seen.at(-1)).toMatchObject({ bus: { coming: false } })
    service.dispose()
  })

  it('places a bus by the stop it’s heading to, on a street the path runs down twice', async () => {
    const twice: RouteSource = {
      ...SOURCE,
      stopPosition: SOUTHBOUND,
      stopAlong: 4467,
      line: TWICE,
      stopsAlong: new Map([
        ['up', 1106],
        ['S', 4467],
        ['south', 6126]
      ])
    }
    // Back down Mill, 220 m past the stop and heading for the next: it has been, due or not.
    const below = { ...ON_THE_WAY, lat: 33.418, lon: -111.94, timestamp: null }
    const { service, push } = setup([], { ...below, stopId: 'south' }, twice)
    push(state([{ ...ARRIVAL, at: 1_800_000_000 + 30 }]))
    const seen: (BusRouteLive | null)[] = []
    service.subscribe((bus) => seen.push(bus))
    await service.route(ARRIVAL.id)
    service.watch(ARRIVAL.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.at(-1)).toMatchObject({ bus: { coming: false } })
    service.dispose()

    // The same spot heading for the stop on the way up: the block and the stop are still ahead.
    const up = setup([], { ...below, stopId: 'up' }, twice)
    up.push(state([{ ...ARRIVAL, at: 1_800_000_000 + 30 }]))
    const upSeen: (BusRouteLive | null)[] = []
    up.service.subscribe((bus) => upSeen.push(bus))
    await up.service.route(ARRIVAL.id)
    up.service.watch(ARRIVAL.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(upSeen.at(-1)).toMatchObject({ bus: { coming: true } })
    up.service.dispose()
  })

  it('sends the route’s other buses with the card’s own', async () => {
    const second = { ...ON_THE_WAY, vehicleId: 'bus9', tripId: 'trip2', lat: 33.43, lon: -111.93 }
    const { service } = setup([
      { ok: true, feed: { timestamp: 1_800_000_000, vehicles: [ON_THE_WAY, second] } }
    ])
    const seen: (BusRouteLive | null)[] = []
    service.subscribe((live) => seen.push(live))
    await service.route(ARRIVAL.id)
    service.watch(ARRIVAL.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.at(-1)).toMatchObject({
      arrivalId: ARRIVAL.id,
      bus: { coming: true, atStop: false },
      others: [{ id: 'bus9' }]
    })
    service.dispose()
  })

  it('shows no bus when the feed can’t say where it is', async () => {
    const { service } = setup([
      { ok: false, problem: 'down' },
      { ok: true, feed: { timestamp: 1, vehicles: [] } }
    ])
    const seen: (BusRouteLive | null)[] = []
    service.subscribe((bus) => seen.push(bus))
    await service.route(ARRIVAL.id)
    service.watch(ARRIVAL.id)
    await vi.advanceTimersByTimeAsync(VEHICLE_POLL_SEC * 1000)
    expect(seen.every((live) => live === null || live.bus === null)).toBe(true)
    service.dispose()
  })
})
