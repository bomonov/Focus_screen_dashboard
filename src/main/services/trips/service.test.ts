// The trip service with fake sources: when it asks where the Mac is, when it plans and what it
// sends the search, the kept trip's ends, and what the card is told when there's nothing to go on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, type Settings } from '../settings/schema'
import type { FeedTrip } from '../transit/gtfsRealtime'
import { distanceM, type LatLon } from '../transit/routeLine'
import type { StopList } from '../transit/stopList'
import type { TransitState } from '../transit/types'
import type { LocateResult, LocationSource } from '../weather/location'
import type { LocationAccess } from '../weather/types'
import type { ApplePlaces } from './applePlaces'
import type { TripPlanner } from './client'
import type { PlanReply } from './messages'
import { demoTrips } from './mock'
import type { PlacesStore } from './places'
import {
  createTripService,
  FRESH_FIX_SEC,
  KEPT_FIX_SEC,
  type TripService,
  type TripServiceOptions
} from './service'
import type { ClassPlace, Place, PlanQuery, TripFrom, TripPlan, TripRide } from './types'

/** Tue 3 Nov 2026, 2 PM in Tempe. */
const START_MS = Date.UTC(2026, 10, 3, 21, 0)
const NOW = START_MS / 1000

/** The Sun Devil Fitness Complex. */
const HERE = { lat: 33.4206, lon: -111.9312 }
const ACCURACY_M = 50

/** `north` metres north of HERE. */
function north(metres: number): { lat: number; lon: number } {
  const perMetre = 1 / distanceM([HERE.lat, HERE.lon], [HERE.lat + 1, HERE.lon])
  return { lat: HERE.lat + metres * perMetre, lon: HERE.lon }
}

const place = (id: string, kind: Place['kind'], name: string, at: LatLon): Place => ({
  id,
  kind,
  name,
  detail: '',
  lat: at[0],
  lon: at[1]
})

const HOME = place('home', 'home', 'Home', [33.416, -111.9075])
const SHOP = place('apple:shop', 'apple', 'Trader Joe’s', [33.414, -111.91])
const RECENT = place('apple:old', 'recent', 'Tempe Marketplace', [33.43, -111.9])
const GYM = place('building:sdfc', 'building', 'Sun Devil Fitness Complex', [33.42065, -111.93125])
const CLASS: ClassPlace = {
  ...place('class:byeng', 'class', 'Brickyard Engineering', [33.4236, -111.9393]),
  detail: 'BYENG 210',
  title: 'CSE 240',
  start: NOW + 3 * 3600
}

const LIST: StopList = {
  downloadedAt: NOW - 86400,
  revision: 4,
  version: 'test',
  routes: { VENU: { short: 'VENU', long: 'Orbit Venus' } },
  stops: [
    {
      id: '1',
      code: '1',
      name: 'Rural Rd & Terrace Rd',
      detail: '',
      station: '',
      serves: [['VENU', 0, 'Venus Forward']],
      position: [33.4207, -111.9302]
    }
  ]
}

const FEED: FeedTrip[] = [
  { tripId: 't1', routeId: 'VENU', directionId: 0, canceled: false, vehicleId: '', stops: [] }
]

/** One trip a route and timetable time, as the schedule has it. */
const tripIdOf = (route: string, scheduledDepart: number): string => `${route}@${scheduledDepart}`

function ride(
  depart: number,
  arrive: number,
  route = 'Orbit Venus',
  delayMin: number | null = null
): TripRide {
  return {
    kind: 'ride',
    routeName: route,
    short: 'VENU',
    color: '591769',
    textColor: 'FFFFFF',
    rail: false,
    headsign: 'Venus Forward',
    tripId: tripIdOf(route, depart - (delayMin ?? 0) * 60),
    fromName: 'Rural Rd & Terrace Rd',
    fromStopId: 'RT',
    toName: 'Apache Blvd & McClintock Dr',
    toStopId: 'AM',
    depart,
    arrive,
    stops: 6,
    live: delayMin !== null,
    delayMin
  }
}

/** Leave at `leave`, a ride from leave + 300 to leave + 1200, there at leave + 1400. */
function tripPlan(leave: number, route = 'Orbit Venus', delayMin: number | null = null): TripPlan {
  return {
    leave,
    arrive: leave + 1400,
    steps: [
      { kind: 'walk', start: leave, end: leave + 300, minutes: 5, toName: 'Rural Rd & Terrace Rd' },
      ride(leave + 300, leave + 1200, route, delayMin),
      { kind: 'walk', start: leave + 1200, end: leave + 1400, minutes: 4, toName: null }
    ],
    rides: 1,
    walkM: 600
  }
}

/** What the card sends with `keep`: which plan it showed, so a replan since can't swap it. */
function identity(plan: TripPlan): { leave: number; tripId: string | null } {
  const ride = plan.steps.find((step): step is TripRide => step.kind === 'ride')
  return { leave: plan.leave, tripId: ride ? ride.tripId : null }
}

/** Walking all the way: `minutes` from `leave`. */
function walkPlan(leave: number, minutes: number): TripPlan {
  const arrive = leave + minutes * 60
  return {
    leave,
    arrive,
    steps: [{ kind: 'walk', start: leave, end: arrive, minutes, toName: null }],
    rides: 0,
    walkM: minutes * 60
  }
}

function settingsStore(initial: { trips?: boolean; nextClass?: boolean; early?: number } = {}): {
  get(): Settings
  subscribe(listener: (settings: Settings) => void): () => void
  set(change: (current: Settings) => Settings): void
} {
  const base = defaultSettings()
  let current: Settings = {
    ...base,
    widgets: {
      ...base.widgets,
      trips: initial.trips ?? true,
      nextClass: initial.nextClass ?? true
    },
    trips: { arriveEarlyMin: initial.early ?? 5 }
  }
  const listeners = new Set<(settings: Settings) => void>()
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(change) {
      current = change(current)
      for (const listener of listeners) listener(current)
    }
  }
}

interface FakeLocation {
  access: LocationAccess | null
  starts: number
  stopped: number
  locates: number
  requested: number
  next: LocateResult
  /** While true, a locate waits until `answer()` is called. */
  holding: boolean
  /** While true, a locate rejects, as a helper that's gone would. */
  rejecting: boolean
  answer(): void
  setAccess(access: LocationAccess): void
  start(): LocationSource
}

function fakeLocation(): FakeLocation {
  const listeners = new Set<(access: LocationAccess) => void>()
  const waiting: (() => void)[] = []
  const fake: FakeLocation = {
    access: 'granted',
    starts: 0,
    stopped: 0,
    locates: 0,
    requested: 0,
    next: { ok: true, position: HERE, accuracyM: ACCURACY_M },
    holding: false,
    rejecting: false,
    answer() {
      for (const resolve of waiting.splice(0)) resolve()
    },
    setAccess(access) {
      fake.access = access
      for (const listener of [...listeners]) listener(access)
    },
    start() {
      fake.starts++
      let stopped = false
      return {
        access: () => fake.access,
        onAccess(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        requestAccess() {
          fake.requested++
        },
        locate() {
          fake.locates++
          if (fake.rejecting) return Promise.reject(new Error('The helper is gone.'))
          if (!fake.holding) return Promise.resolve(fake.next)
          return new Promise((resolve) => waiting.push(() => resolve(fake.next)))
        },
        placeName: () => Promise.resolve(null),
        stop() {
          if (stopped) return
          stopped = true
          fake.stopped++
          listeners.clear()
        }
      }
    }
  }
  return fake
}

interface Asked {
  query: PlanQuery
  feed: FeedTrip[]
  now: number | undefined
}

interface FakePlanner {
  made: string[]
  disposed: number
  asked: Asked[]
  answer(query: PlanQuery): PlanReply | null
  /** While true, answers wait in `held` (in the order asked) until sent. */
  holding: boolean
  held: { query: PlanQuery; send(): void }[]
  make(path: string): TripPlanner
}

/** By default one trip, leaving a minute after the time asked (or arriving 60 s before it). */
function fakePlanner(): FakePlanner {
  const fake: FakePlanner = {
    made: [],
    disposed: 0,
    asked: [],
    answer: (query) => ({
      kind: 'planned',
      id: 1,
      plans: [tripPlan(query.mode === 'depart' ? query.time + 60 : query.time - 1460)],
      noTrip: null
    }),
    holding: false,
    held: [],
    make(path) {
      fake.made.push(path)
      return {
        plan(query, feed, now) {
          fake.asked.push({ query, feed, now })
          const reply = fake.answer(query)
          if (!fake.holding) return Promise.resolve(reply)
          return new Promise((resolve) => fake.held.push({ query, send: () => resolve(reply) }))
        },
        dispose() {
          fake.disposed++
        }
      }
    }
  }
  return fake
}

type TransitPick = TripServiceOptions['transit']

interface FakeTransit {
  wants: boolean[]
  tripsOn: boolean[]
  downloads: number
  path: string | null
  downloadedAt: number
  downloading: boolean
  /** The trips the last good read of the live feed had. */
  feed: FeedTrip[]
  /** When that read was (unix seconds); null before any. */
  updatedAt: number | null
  /** A good read of the live feed, as Next bus's service tells its listeners: fresh as of now. */
  live(): void
  /** A read that failed: the listeners hear of it, and the last good read gets no younger. */
  failedRead(): void
  /** The transit state changed (a download started or finished). */
  changed(): void
  finishDownload(): void
  transit: TransitPick
}

function fakeTransit(path: string | null = '/userData/transit-timetable.bin'): FakeTransit {
  const liveListeners = new Set<() => void>()
  const listeners = new Set<(state: TransitState) => void>()
  let finish: () => void = () => {}
  const state = (): TransitState => ({
    schedule: fake.path ? { stops: 1, downloadedAt: fake.downloadedAt } : null,
    downloading: fake.downloading,
    scheduleProblem: null,
    stops: [],
    routes: [],
    arrivals: [],
    shuttles: [],
    updatedAt: null,
    liveProblem: null,
    horizonMinutes: 30,
    demo: false
  })
  const fake: FakeTransit = {
    wants: [],
    tripsOn: [],
    downloads: 0,
    path,
    downloadedAt: NOW - 86400,
    downloading: false,
    feed: FEED,
    updatedAt: NOW,
    live() {
      fake.updatedAt = Math.floor(Date.now() / 1000)
      for (const listener of [...liveListeners]) listener()
    },
    failedRead() {
      for (const listener of [...liveListeners]) listener()
    },
    changed() {
      for (const listener of [...listeners]) listener(state())
    },
    finishDownload() {
      fake.path = '/userData/transit-timetable.bin'
      fake.downloadedAt = NOW
      fake.downloading = false
      fake.changed()
      finish()
    },
    transit: {
      get: state,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      timetablePath: () => fake.path,
      stopList: () => LIST,
      wantLive(on) {
        fake.wants.push(on)
      },
      liveTrips: () => ({ trips: fake.feed, updatedAt: fake.updatedAt }),
      onLive(listener) {
        liveListeners.add(listener)
        return () => liveListeners.delete(listener)
      },
      download() {
        fake.downloads++
        fake.downloading = true
        fake.changed()
        return new Promise<void>((resolve) => {
          finish = resolve
        })
      },
      setTripsOn(on) {
        fake.tripsOn.push(on)
      }
    }
  }
  return fake
}

interface FakePlaces {
  home: Place | null
  recentsAdded: string[]
  store: PlacesStore
}

function fakePlaces(home: Place | null = HOME): FakePlaces {
  let saved: Place[] = []
  let recents: Place[] = [RECENT]
  const fake: FakePlaces = {
    home,
    recentsAdded: [],
    store: {
      read: () => ({ home: fake.home, saved, recents }),
      setHome([lat, lon]) {
        fake.home = { ...HOME, lat, lon }
      },
      clearHome() {
        fake.home = null
      },
      save(found, name) {
        const kept: Place = { ...found, id: `saved:${saved.length}`, kind: 'saved', name }
        saved = [...saved, kept]
        return kept
      },
      rename(id, name) {
        saved = saved.map((one) => (one.id === id ? { ...one, name } : one))
      },
      remove(id) {
        saved = saved.filter((one) => one.id !== id)
        recents = recents.filter((one) => one.id !== id)
      },
      addRecent(picked) {
        fake.recentsAdded.push(picked.id)
      },
      clearRecents() {
        recents = []
      }
    }
  }
  return fake
}

interface Rig {
  service: TripService
  store: ReturnType<typeof settingsStore>
  location: FakeLocation
  planner: FakePlanner
  transit: FakeTransit
  places: FakePlaces
  appleSearches: string[]
  appleStarts: () => number
  appleStops: () => number
  emits: () => number
}

function rig(
  options: {
    trips?: boolean
    nextClass?: boolean
    early?: number
    visible?: boolean
    hasLocation?: boolean
    home?: Place | null
    timetable?: string | null
    buildings?: Place[]
    demo?: boolean
  } = {}
): Rig {
  const store = settingsStore(options)
  const location = fakeLocation()
  const planner = fakePlanner()
  const transit = fakeTransit(options.timetable === undefined ? undefined : options.timetable)
  // No Home unless a test sets one: with Home, opening the card plans it in the background too.
  const places = fakePlaces(options.home ?? null)
  const appleSearches: string[] = []
  let appleStops = 0
  let appleStarts = 0
  const apple = (): ApplePlaces => {
    appleStarts++
    return {
      search(text) {
        appleSearches.push(text)
        return Promise.resolve([SHOP])
      },
      stop() {
        appleStops++
      }
    }
  }
  const service = createTripService({
    settings: store,
    transit: transit.transit,
    planner: (path) => planner.make(path),
    location: options.hasLocation === false ? null : () => location.start(),
    places: places.store,
    apple,
    classes: { next: () => Promise.resolve(CLASS) },
    buildings: () => Promise.resolve(options.buildings ?? [GYM]),
    demo: options.demo ? demoTrips(Date.now) : null
  })
  let emits = 0
  service.subscribe(() => {
    emits++
  })
  service.setVisible(options.visible ?? true)
  return {
    service,
    store,
    location,
    planner,
    transit,
    places,
    appleSearches,
    appleStarts: () => appleStarts,
    appleStops: () => appleStops,
    emits: () => emits
  }
}

/** Lets what's under way finish. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}
async function seconds(count: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(count * 1000)
}

const planHome = { kind: 'plan', to: HOME, from: { kind: 'here' }, when: { kind: 'now' } } as const

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START_MS)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createTripService: where the Mac is', () => {
  it('asks once for a fix as the card opens and reads live times; closing stops both', async () => {
    const { service, location, transit } = rig()
    expect(service.get().here).toBeNull()
    expect(location.starts).toBe(0)
    service.command({ kind: 'open' })
    await settle()
    expect(location.locates).toBe(1)
    expect(transit.wants.at(-1)).toBe(true)
    expect(service.get().here).toEqual({ status: 'found', name: 'Sun Devil Fitness Complex' })
    service.command({ kind: 'open' })
    await settle()
    expect(location.locates).toBe(1)

    service.command({ kind: 'close' })
    expect(transit.wants.at(-1)).toBe(false)
    expect(location.stopped).toBe(1)
    expect(service.get().here).toBeNull()
    expect(service.get().from).toEqual({ kind: 'here' })
    service.dispose()
  })

  it('reads live times only while the screen can be seen', async () => {
    const { service, transit } = rig({ visible: false })
    service.command({ kind: 'open' })
    await settle()
    expect(transit.wants.at(-1)).toBe(false)
    service.setVisible(true)
    expect(transit.wants.at(-1)).toBe(true)
    service.setVisible(false)
    expect(transit.wants.at(-1)).toBe(false)
    service.dispose()
  })

  it('names the spot by a school building within 150 m, else a stop, else not at all', async () => {
    const nearStop = rig({ buildings: [] })
    nearStop.service.command({ kind: 'open' })
    await settle()
    expect(nearStop.service.get().here?.name).toBe('near Rural Rd & Terrace Rd')
    nearStop.service.dispose()

    const nowhere = rig({ buildings: [] })
    nowhere.location.next = { ok: true, position: north(1000), accuracyM: ACCURACY_M }
    nowhere.service.command({ kind: 'open' })
    await settle()
    expect(nowhere.service.get().here).toEqual({ status: 'found', name: null })
    nowhere.service.dispose()
  })

  it('says Location is turned off or not allowed, and leaves the start to be picked', async () => {
    const answers: [LocateResult, string][] = [
      [{ ok: false, reason: 'access' }, 'denied'],
      [{ ok: false, reason: 'servicesOff' }, 'servicesOff'],
      [{ ok: false, reason: 'failed' }, 'failed']
    ]
    for (const [answer, status] of answers) {
      const { service, location, planner } = rig()
      location.access = answer.ok === false && answer.reason === 'access' ? 'denied' : 'granted'
      location.next = answer
      service.command({ kind: 'open' })
      await settle()
      service.command(planHome)
      await settle()
      const state = service.get()
      expect(state.here).toEqual({ status, name: null })
      expect(state.plans).toBeNull()
      expect(state.planning).toBe(false)
      expect(state.from).toEqual({ kind: 'here' })
      expect(planner.asked).toHaveLength(0)
      service.dispose()
    }
  })

  it('finds where the Mac is as soon as Location is allowed while the card is open', async () => {
    const { service, location, planner } = rig()
    location.access = 'denied'
    location.next = { ok: false, reason: 'access' }
    service.command({ kind: 'open' })
    service.command(planHome)
    await settle()
    expect(service.get().here?.status).toBe('denied')
    location.next = { ok: true, position: HERE, accuracyM: ACCURACY_M }
    location.setAccess('granted')
    await settle()
    expect(service.get().here?.status).toBe('found')
    expect(planner.asked).toHaveLength(1)
    expect(service.get().plans).toHaveLength(1)
    service.dispose()
  })

  it('takes a fix that fails outright as failed, and asks again next time', async () => {
    const { service, location } = rig()
    location.rejecting = true
    service.command({ kind: 'open' })
    await settle()
    expect(service.get().here).toEqual({ status: 'failed', name: null })
    location.rejecting = false
    service.command(planHome)
    await settle()
    expect(location.locates).toBe(2)
    expect(service.get().here?.status).toBe('found')
    expect(service.get().plans).toHaveLength(1)
    service.dispose()
  })

  it('asks macOS from Customize with the card closed, and lets go once it’s answered', async () => {
    const { service, location } = rig()
    location.access = 'notDetermined'
    service.command({ kind: 'requestAccess' })
    expect(location.starts).toBe(1)
    expect(location.requested).toBe(1)
    expect(service.get().here).toBeNull()
    location.setAccess('granted')
    await settle()
    expect(location.stopped).toBe(1)
    // Allowed is all it asked: where the Mac is isn't read for it.
    expect(location.locates).toBe(0)
    expect(service.get().here).toBeNull()
    service.dispose()
  })

  it('keeps macOS’s last word on Location once it’s let go, for Customize to say', async () => {
    const { service, location } = rig()
    expect(service.get().locationAccess).toBeNull()
    location.access = 'notDetermined'
    service.command({ kind: 'requestAccess' })
    location.setAccess('denied')
    await settle()
    expect(location.stopped).toBe(1)
    expect(service.get().here).toBeNull()
    expect(service.get().locationAccess).toBe('denied')
    service.dispose()
  })

  it('learns Location Services is off from a fix, and keeps that over macOS’s “denied”', async () => {
    const { service, location } = rig()
    location.access = 'denied'
    location.next = { ok: false, reason: 'servicesOff' }
    service.command({ kind: 'open' })
    await settle()
    expect(service.get().locationAccess).toBe('off')
    // macOS reports Location Services off as "denied" too.
    location.setAccess('denied')
    service.command({ kind: 'close' })
    expect(service.get().here).toBeNull()
    expect(service.get().locationAccess).toBe('off')
    service.dispose()
  })

  it('has no word on Location where there’s none to have', () => {
    const { service } = rig({ hasLocation: false })
    service.command({ kind: 'requestAccess' })
    expect(service.get().locationAccess).toBeNull()
    service.dispose()
  })

  it('lets go of the location 10 s after asking macOS when no answer comes', async () => {
    const { service, location } = rig()
    location.access = 'notDetermined'
    service.command({ kind: 'requestAccess' })
    await seconds(9)
    expect(location.stopped).toBe(0)
    await seconds(1)
    expect(location.stopped).toBe(1)
    expect(location.locates).toBe(0)
    service.dispose()
  })

  it('gives up on a fix that hasn’t come in 45 s', async () => {
    const { service, location } = rig()
    location.holding = true
    service.command({ kind: 'open' })
    service.command(planHome)
    await seconds(44)
    expect(service.get().here?.status).toBe('locating')
    expect(service.get().planning).toBe(true)
    await seconds(1)
    expect(service.get().here?.status).toBe('failed')
    expect(service.get().planning).toBe(false)
    expect(service.get().plans).toBeNull()
    service.dispose()
  })

  it('asks macOS once when Location isn’t decided, and locates once it’s allowed', async () => {
    const { service, location } = rig()
    location.access = 'notDetermined'
    service.command({ kind: 'open' })
    await settle()
    expect(location.requested).toBe(1)
    expect(location.locates).toBe(0)
    expect(service.get().here?.status).toBe('locating')
    location.setAccess('granted')
    await settle()
    expect(location.locates).toBe(1)
    expect(service.get().here?.status).toBe('found')
    service.command({ kind: 'requestAccess' })
    expect(location.requested).toBe(2)
    service.dispose()
  })

  it('without a location source starts from Home, or leaves the start to be picked', async () => {
    const withHome = rig({ hasLocation: false, home: HOME })
    expect(withHome.service.get().supported.location).toBe(false)
    expect(withHome.service.get().from).toEqual({ kind: 'place', place: HOME })
    withHome.service.command({ kind: 'open' })
    await settle()
    withHome.service.command({ kind: 'close' })
    expect(withHome.service.get().from).toEqual({ kind: 'place', place: HOME })
    withHome.service.dispose()

    const noHome = rig({ hasLocation: false, home: null })
    expect(noHome.service.get().from).toEqual({ kind: 'here' })
    noHome.service.command({ kind: 'open' })
    await settle()
    expect(noHome.service.get().here).toEqual({ status: 'failed', name: null })
    noHome.service.dispose()
  })

  it('sets Home to where the Mac is, even from Customize with the card closed', async () => {
    const { service, location, places } = rig({ home: null })
    service.command({ kind: 'setHomeHere' })
    await settle()
    expect(location.locates).toBe(1)
    expect(places.home).toMatchObject({ lat: HERE.lat, lon: HERE.lon })
    expect(service.get().home).toMatchObject({ lat: HERE.lat, lon: HERE.lon })
    expect(location.stopped).toBe(1)
    expect(service.get().here).toBeNull()
    service.command({ kind: 'clearHome' })
    expect(service.get().home).toBeNull()
    service.dispose()
  })

  it('sets Home only from the fix it asked for, never a later one', async () => {
    const { service, location, places } = rig({ home: null })
    service.command({ kind: 'open' })
    await settle()
    service.command({ kind: 'plan', to: SHOP, from: { kind: 'here' }, when: { kind: 'now' } })
    await settle()
    service.command({ kind: 'keep', index: 0, ...identity(tripPlan(NOW + 60)) })
    expect(service.get().kept).not.toBeNull()
    await seconds(FRESH_FIX_SEC + 1)
    location.next = { ok: false, reason: 'failed' }
    service.command({ kind: 'setHomeHere' })
    await settle()
    expect(location.locates).toBe(2)
    expect(places.home).toBeNull()
    location.next = { ok: true, position: north(500), accuracyM: ACCURACY_M }
    await seconds(KEPT_FIX_SEC)
    expect(location.locates).toBe(3)
    expect(places.home).toBeNull()
    service.dispose()
  })

  it('sets Home after an earlier fix was given up on', async () => {
    const { service, location, places } = rig({ home: null })
    location.holding = true
    service.command({ kind: 'open' })
    await seconds(45)
    expect(service.get().here?.status).toBe('failed')
    location.next = { ok: false, reason: 'failed' }
    location.answer()
    await settle()
    location.holding = false
    location.next = { ok: true, position: HERE, accuracyM: ACCURACY_M }
    service.command({ kind: 'setHomeHere' })
    await settle()
    expect(places.home).toMatchObject({ lat: HERE.lat, lon: HERE.lon })
    service.dispose()
  })

  it('waits at most 45 s on a refresh for Home, even with an older fix in hand', async () => {
    const { service, location, places } = rig({ home: null })
    service.command({ kind: 'open' })
    await settle()
    await seconds(FRESH_FIX_SEC + 1)
    location.holding = true
    location.next = { ok: true, position: north(500), accuracyM: ACCURACY_M }
    service.command({ kind: 'setHomeHere' })
    await seconds(45)
    expect(service.get().here?.status).toBe('found')
    location.answer()
    await settle()
    expect(places.home).toBeNull()
    service.dispose()
  })

  it('gives up waiting for Home’s fix with the rest, and takes no late one for it', async () => {
    const { service, location, places } = rig({ home: null })
    location.holding = true
    service.command({ kind: 'setHomeHere' })
    await seconds(45)
    expect(service.get().here?.status ?? 'released').toBe('released')
    location.answer()
    await settle()
    expect(places.home).toBeNull()
    service.dispose()
  })
})

describe('createTripService: Home’s row', () => {
  /** Home's trips walk all the way; any other place's take the Orbit, so the two can be told apart. */
  const homeWalks = (planner: FakePlanner): void => {
    planner.answer = (query) => ({
      kind: 'planned',
      id: 1,
      plans:
        query.to[0] === HOME.lat && query.to[1] === HOME.lon
          ? [walkPlan(query.time, 12)]
          : [tripPlan(query.time + 60)],
      noTrip: null
    })
  }
  const toHome = (asked: Asked): boolean =>
    asked.query.to[0] === HOME.lat && asked.query.to[1] === HOME.lon

  it('plans Home in the background as the card opens with a fix, leaving the card’s trips alone', async () => {
    const { service, planner } = rig({ home: HOME })
    service.command({ kind: 'open' })
    await settle()
    expect(planner.asked.map((asked) => asked.query)).toEqual([
      { from: [HERE.lat, HERE.lon], to: [HOME.lat, HOME.lon], time: NOW, mode: 'depart' }
    ])
    expect(service.get().homePreview).toEqual({
      leave: NOW + 60,
      arrive: NOW + 1460,
      first: 'Orbit Venus'
    })
    expect(service.get().plans).toBeNull()
    expect(service.get().to).toBeNull()
    expect(service.get().planning).toBe(false)
    service.dispose()
  })

  it('makes none without Home, without a schedule, or with no start to go from', async () => {
    const noHome = rig()
    noHome.service.command({ kind: 'open' })
    await settle()
    expect(noHome.planner.asked).toHaveLength(0)
    expect(noHome.service.get().homePreview).toBeNull()
    noHome.service.dispose()

    const noSchedule = rig({ home: HOME, timetable: null })
    noSchedule.service.command({ kind: 'open' })
    await settle()
    expect(noSchedule.planner.asked).toHaveLength(0)
    expect(noSchedule.service.get().homePreview).toBeNull()
    noSchedule.service.dispose()

    const refused = rig({ home: HOME })
    refused.location.access = 'denied'
    refused.location.next = { ok: false, reason: 'access' }
    refused.service.command({ kind: 'open' })
    await settle()
    expect(refused.planner.asked).toHaveLength(0)
    expect(refused.service.get().homePreview).toBeNull()
    refused.service.dispose()
  })

  it('never takes the card’s trips’ place, nor they its, whichever answer lands first', async () => {
    const { service, planner } = rig({ home: HOME })
    homeWalks(planner)
    planner.holding = true
    service.command({ kind: 'open' })
    await settle()
    service.command({ kind: 'plan', to: SHOP, from: { kind: 'here' }, when: { kind: 'now' } })
    await settle()
    expect(planner.held.map((held) => toHome({ query: held.query, feed: [], now: 0 }))).toEqual([
      true,
      false
    ])
    planner.held[1]?.send()
    await settle()
    planner.held[0]?.send()
    await settle()
    expect(service.get().plans).toEqual([tripPlan(NOW + 60)])
    expect(service.get().homePreview).toEqual({ leave: NOW, arrive: NOW + 720, first: 'walk' })
    service.dispose()
  })

  it('plans Home again from a picked start, and once Home is moved', async () => {
    const { service, planner } = rig({ home: HOME })
    service.command({ kind: 'open' })
    await settle()
    service.command({
      kind: 'plan',
      to: SHOP,
      from: { kind: 'place', place: GYM },
      when: { kind: 'now' }
    })
    await settle()
    expect(planner.asked.filter(toHome).map((asked) => asked.query.from)).toEqual([
      [HERE.lat, HERE.lon],
      [GYM.lat, GYM.lon]
    ])
    planner.asked.length = 0
    // Home is set to where the Mac is now: from the picked start to the new Home.
    service.command({ kind: 'setHomeHere' })
    await settle()
    expect(planner.asked.map((asked) => [asked.query.from, asked.query.to])).toEqual([
      [
        [GYM.lat, GYM.lon],
        [HERE.lat, HERE.lon]
      ]
    ])
    service.dispose()
  })

  it('reads again with the live feed while the card is open', async () => {
    const { service, planner, transit } = rig({ home: HOME })
    service.command({ kind: 'open' })
    await settle()
    await seconds(60)
    transit.live()
    await settle()
    expect(planner.asked.filter(toHome).map((asked) => asked.query.time)).toEqual([NOW, NOW + 60])
    service.dispose()
  })

  it('lets it go when Location is turned off with the card open', async () => {
    const { service, location } = rig({ home: HOME })
    service.command({ kind: 'open' })
    await settle()
    expect(service.get().homePreview).not.toBeNull()
    location.next = { ok: false, reason: 'access' }
    location.setAccess('denied')
    await settle()
    expect(service.get().here?.status).toBe('denied')
    expect(service.get().homePreview).toBeNull()
    service.dispose()
  })

  it('has none from Home itself', async () => {
    const { service, planner } = rig({ home: HOME })
    service.command({ kind: 'open' })
    await settle()
    service.command({
      kind: 'plan',
      to: SHOP,
      from: { kind: 'place', place: HOME },
      when: { kind: 'now' }
    })
    await settle()
    expect(service.get().homePreview).toBeNull()
    expect(planner.asked.filter(toHome)).toHaveLength(1)
    service.dispose()
  })

  it('is let go as the card closes, and an answer landing after that changes nothing', async () => {
    const { service, planner } = rig({ home: HOME })
    service.command({ kind: 'open' })
    await settle()
    expect(service.get().homePreview).not.toBeNull()
    service.command({ kind: 'close' })
    expect(service.get().homePreview).toBeNull()
    planner.holding = true
    service.command({ kind: 'open' })
    await settle()
    service.command({ kind: 'close' })
    planner.held[0]?.send()
    await settle()
    expect(service.get().homePreview).toBeNull()
    service.dispose()
  })
})

describe('createTripService: planning', () => {
  it('plans from where the Mac is with the live trips and the service’s clock', async () => {
    const { service, planner, transit, places } = rig()
    service.command({ kind: 'open' })
    await settle()
    service.command({ kind: 'plan', to: SHOP, from: { kind: 'here' }, when: { kind: 'now' } })
    expect(service.get().planning).toBe(true)
    expect(service.get().plans).toBeNull()
    await settle()
    expect(planner.made).toEqual([transit.path])
    expect(planner.asked).toEqual([
      {
        query: { from: [HERE.lat, HERE.lon], to: [SHOP.lat, SHOP.lon], time: NOW, mode: 'depart' },
        feed: FEED,
        now: NOW
      }
    ])
    const state = service.get()
    expect(state.to).toEqual(SHOP)
    expect(state.plans).toEqual([tripPlan(NOW + 60)])
    expect(state.planning).toBe(false)
    expect(state.problem).toBeNull()
    expect(places.recentsAdded).toEqual([SHOP.id])
    service.dispose()
  })

  it('plans on the timetable alone once the live feed is over 5 minutes old', async () => {
    const { service, planner, transit } = rig()
    service.command({ kind: 'open' })
    await settle()
    transit.updatedAt = NOW - 6 * 60
    service.command({ kind: 'plan', to: SHOP, from: { kind: 'here' }, when: { kind: 'now' } })
    await settle()
    expect(planner.asked.at(-1)?.feed).toEqual([])
    // Never read: nothing live either.
    transit.updatedAt = null
    service.command({ kind: 'plan', to: HOME, from: { kind: 'here' }, when: { kind: 'now' } })
    await settle()
    expect(planner.asked.at(-1)?.feed).toEqual([])
    // A minute old is fresh.
    transit.updatedAt = NOW - 60
    service.command({ kind: 'plan', to: SHOP, from: { kind: 'here' }, when: { kind: 'now' } })
    await settle()
    expect(planner.asked.at(-1)?.feed).toEqual(FEED)
    service.dispose()
  })

  it('plans from a place picked, and at a time picked', async () => {
    const { service, planner } = rig()
    service.command({ kind: 'open' })
    await settle()
    service.command({
      kind: 'plan',
      to: SHOP,
      from: { kind: 'place', place: HOME },
      when: { kind: 'depart', time: NOW + 7200 }
    })
    await settle()
    expect(planner.asked[0]?.query).toEqual({
      from: [HOME.lat, HOME.lon],
      to: [SHOP.lat, SHOP.lon],
      time: NOW + 7200,
      mode: 'depart'
    })
    service.dispose()
  })

  it('moves a recent place picked again to the front, and never adds the next class', async () => {
    const { service, places } = rig()
    service.command({ kind: 'open' })
    await settle()
    service.command({ kind: 'plan', to: RECENT, from: { kind: 'here' }, when: { kind: 'now' } })
    await settle()
    expect(places.recentsAdded).toEqual([RECENT.id])
    service.command({ kind: 'plan', to: CLASS, from: { kind: 'here' }, when: { kind: 'now' } })
    await settle()
    expect(places.recentsAdded).toEqual([RECENT.id])
    service.dispose()
  })

  it('plans the next class to arrive a few minutes early, unless told to leave now', async () => {
    const { service, planner, store } = rig()
    service.command({ kind: 'open' })
    await settle()
    expect(service.get().nextClass).toEqual(CLASS)
    service.command({ kind: 'plan', to: CLASS, from: { kind: 'here' }, when: { kind: 'now' } })
    await settle()
    expect(planner.asked[0]?.query).toMatchObject({ time: CLASS.start - 300, mode: 'arrive' })
    expect(service.get().when).toEqual({ kind: 'arrive', time: CLASS.start - 300 })
    // The switch turned to "Leave now" for the same class.
    service.command({ kind: 'plan', to: CLASS, from: { kind: 'here' }, when: { kind: 'now' } })
    await settle()
    expect(planner.asked[1]?.query).toMatchObject({ time: NOW, mode: 'depart' })

    store.set((current) => ({ ...current, trips: { arriveEarlyMin: 10 } }))
    service.command({ kind: 'plan', to: HOME, from: { kind: 'here' }, when: { kind: 'now' } })
    service.command({ kind: 'plan', to: CLASS, from: { kind: 'here' }, when: { kind: 'now' } })
    await settle()
    expect(planner.asked.at(-1)?.query).toMatchObject({ time: CLASS.start - 600, mode: 'arrive' })
    service.dispose()
  })

  it('offers the next class only while Next class is on', async () => {
    const { service, store } = rig({ nextClass: false })
    service.command({ kind: 'open' })
    await settle()
    expect(service.get().nextClass).toBeNull()
    store.set((current) => ({ ...current, widgets: { ...current.widgets, nextClass: true } }))
    await settle()
    expect(service.get().nextClass).toEqual(CLASS)
    service.dispose()
  })

  it('replans on a live read while the card is open, not once it’s closed', async () => {
    const { service, planner, transit } = rig()
    service.command({ kind: 'open' })
    await settle()
    service.command(planHome)
    await settle()
    expect(planner.asked).toHaveLength(1)
    await seconds(60)
    transit.live()
    expect(service.get().planning).toBe(false)
    await settle()
    expect(planner.asked).toHaveLength(2)
    expect(planner.asked[1]?.query.time).toBe(NOW + 60)
    service.command({ kind: 'close' })
    transit.live()
    await settle()
    expect(planner.asked).toHaveLength(2)
    service.dispose()
  })

  it('keeps the later question’s trips when the earlier one’s answer lands after them', async () => {
    const { service, planner } = rig()
    planner.answer = (query) => ({
      kind: 'planned',
      id: 1,
      plans: [tripPlan(query.time + (query.to[0] === SHOP.lat ? 600 : 60))],
      noTrip: null
    })
    service.command({ kind: 'open' })
    await settle()
    planner.holding = true
    service.command({ kind: 'plan', to: SHOP, from: { kind: 'here' }, when: { kind: 'now' } })
    service.command(planHome)
    planner.held[1]?.send()
    await settle()
    expect(service.get().plans).toEqual([tripPlan(NOW + 60)])
    planner.held[0]?.send()
    await settle()
    expect(service.get()).toMatchObject({ to: HOME, plans: [tripPlan(NOW + 60)], planning: false })
    service.dispose()
  })

  it('changes nothing when an answer lands after the card has closed', async () => {
    const { service, planner } = rig()
    service.command({ kind: 'open' })
    await settle()
    planner.holding = true
    service.command(planHome)
    service.command({ kind: 'close' })
    const closed = service.get()
    planner.held[0]?.send()
    await settle()
    expect(service.get()).toBe(closed)
    expect(service.get()).toMatchObject({ to: null, plans: null, planning: false })
    service.dispose()
  })

  it('says so when the search can’t answer', async () => {
    const { service, planner } = rig()
    planner.answer = () => null
    service.command({ kind: 'open' })
    await settle()
    service.command(planHome)
    await settle()
    expect(service.get()).toMatchObject({
      plans: [],
      noTrip: null,
      planning: false,
      problem: 'This trip couldn’t be planned just now.'
    })
    service.dispose()
  })

  it('passes on what no trip says', async () => {
    const { service, planner } = rig()
    const noTrip = { walkSec: null, serviceStarts: NOW + 50_000 }
    planner.answer = () => ({ kind: 'planned', id: 1, plans: [], noTrip })
    service.command({ kind: 'open' })
    await settle()
    service.command(planHome)
    await settle()
    expect(service.get()).toMatchObject({ plans: [], noTrip, problem: null })
    service.dispose()
  })

  it('with no schedule says it’s missing, downloads it when asked, then plans', async () => {
    const { service, planner, transit } = rig({ timetable: null })
    expect(service.get().schedule).toBe('missing')
    service.command({ kind: 'open' })
    await settle()
    service.command(planHome)
    await settle()
    expect(service.get().plans).toBeNull()
    expect(service.get().planning).toBe(false)
    expect(planner.made).toEqual([])
    service.command({ kind: 'downloadSchedule' })
    expect(transit.downloads).toBe(1)
    expect(service.get().schedule).toBe('downloading')
    transit.finishDownload()
    await settle()
    expect(service.get().schedule).toBe('ready')
    expect(planner.made).toEqual(['/userData/transit-timetable.bin'])
    expect(service.get().plans).toEqual([tripPlan(NOW + 60)])
    service.dispose()
  })

  it('starts a new search on a newly downloaded schedule, letting the old one go', async () => {
    const { service, planner, transit } = rig()
    service.command({ kind: 'open' })
    await settle()
    service.command(planHome)
    await settle()
    expect(planner.made).toHaveLength(1)
    transit.downloadedAt = NOW
    transit.changed()
    await settle()
    expect(planner.disposed).toBe(1)
    expect(planner.made).toHaveLength(2)
    expect(planner.asked).toHaveLength(2)
    service.dispose()
  })

  it('lets the old search go as a new schedule lands, with nothing to plan', async () => {
    const { service, planner, transit } = rig()
    service.command({ kind: 'open' })
    await settle()
    service.command(planHome)
    await settle()
    service.command({ kind: 'close' })
    transit.downloadedAt = NOW
    transit.changed()
    expect(planner.disposed).toBe(1)
    expect(planner.made).toHaveLength(1)
    service.dispose()
  })
})

describe('createTripService: a kept trip', () => {
  /** A trip home kept: planned from where the Mac is, or from the shop where there's no location. */
  async function keptRig(
    options: Parameters<typeof rig>[0] & { plan?: TripPlan } = {}
  ): Promise<Rig> {
    const made = rig(options)
    const { plan } = options
    if (plan) made.planner.answer = () => ({ kind: 'planned', id: 1, plans: [plan], noTrip: null })
    made.service.command({ kind: 'open' })
    await settle()
    const from: TripFrom =
      options.hasLocation === false ? { kind: 'place', place: SHOP } : { kind: 'here' }
    made.service.command({ ...planHome, from })
    await settle()
    const shown = made.service.get().plans?.[0]
    if (shown) made.service.command({ kind: 'keep', index: 0, ...identity(shown) })
    return made
  }

  it('keeps the trip picked on screen with the card closed, live times still read', async () => {
    const { service, transit, location } = await keptRig()
    expect(service.get().kept).toEqual({
      to: HOME,
      plan: tripPlan(NOW + 60),
      missed: false,
      nextWay: false
    })
    service.command({ kind: 'close' })
    expect(service.get().kept).not.toBeNull()
    expect(transit.wants.at(-1)).toBe(true)
    expect(location.stopped).toBe(0)
    service.command({ kind: 'unkeep' })
    expect(service.get().kept).toBeNull()
    expect(transit.wants.at(-1)).toBe(false)
    expect(location.stopped).toBe(1)
    service.dispose()
  })

  it('keeps only the plan the card showed: a replan since leaves the press doing nothing', async () => {
    const { service, planner } = rig()
    service.command({ kind: 'open' })
    await settle()
    service.command(planHome)
    await settle()
    const shown = tripPlan(NOW + 60)
    expect(service.get().plans).toEqual([shown])
    // The live read's replan lands first: the plan at index 0 is now another.
    planner.answer = () => ({ kind: 'planned', id: 1, plans: [tripPlan(NOW + 960)], noTrip: null })
    service.command(planHome)
    await settle()
    service.command({ kind: 'keep', index: 0, ...identity(shown) })
    expect(service.get().kept).toBeNull()
    // Another plan's bus at the same time to leave isn't it either.
    service.command({ kind: 'keep', index: 0, leave: NOW + 960, tripId: 'another' })
    expect(service.get().kept).toBeNull()
    service.command({ kind: 'keep', index: 0, ...identity(tripPlan(NOW + 960)) })
    expect(service.get().kept?.plan).toEqual(tripPlan(NOW + 960))
    service.dispose()
  })

  it('checks where the Mac is every 3 minutes, and lets the trip go once it’s 400 m away', async () => {
    const { service, location } = await keptRig({ plan: tripPlan(NOW + 3600) })
    service.command({ kind: 'close' })
    expect(location.locates).toBe(1)
    location.next = { ok: true, position: north(200), accuracyM: ACCURACY_M }
    await seconds(KEPT_FIX_SEC)
    expect(location.locates).toBe(2)
    expect(service.get().kept).not.toBeNull()
    location.next = { ok: true, position: north(400), accuracyM: ACCURACY_M }
    await seconds(KEPT_FIX_SEC)
    expect(location.locates).toBe(3)
    expect(service.get().kept).toBeNull()
    expect(location.stopped).toBe(1)
    service.dispose()
  })

  it('checks only while the screen can be seen, and again on waking', async () => {
    const { service, location } = await keptRig({ plan: tripPlan(NOW + 3600) })
    service.setVisible(false)
    await seconds(10 * 60)
    expect(location.locates).toBe(1)
    service.refresh()
    await settle()
    expect(location.locates).toBe(1)
    service.setVisible(true)
    await settle()
    expect(location.locates).toBe(2)
    await seconds(60)
    service.refresh()
    await settle()
    expect(location.locates).toBe(3)
    service.dispose()
  })

  it('asks for a fresh fix when the card opens on a fix over a minute old', async () => {
    const { service, location } = await keptRig()
    service.command({ kind: 'close' })
    await seconds(30)
    service.command({ kind: 'open' })
    await settle()
    expect(location.locates).toBe(1)
    service.command({ kind: 'close' })
    await seconds(40)
    service.command({ kind: 'open' })
    await settle()
    expect(location.locates).toBe(2)
    service.dispose()
  })

  it('lets the trip go once its arrival has passed', async () => {
    const walking = walkPlan(NOW, 25)
    const { service } = await keptRig({ hasLocation: false, plan: walking })
    const { arrive } = walking
    await vi.advanceTimersByTimeAsync((arrive - NOW) * 1000 - 1)
    expect(service.get().kept).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(service.get().kept).toBeNull()
    service.dispose()
  })

  it('with the first ride gone, keeps the next best from where the Mac is, as missed', async () => {
    const { service, planner, location } = await keptRig()
    const { steps } = tripPlan(NOW + 60)
    const departs = (steps[1] as TripRide).depart
    location.next = { ok: true, position: north(100), accuracyM: ACCURACY_M }
    await seconds(KEPT_FIX_SEC)
    await vi.advanceTimersByTimeAsync((departs - NOW - KEPT_FIX_SEC) * 1000)
    expect(planner.asked.at(-1)?.query).toEqual({
      from: [north(100).lat, north(100).lon],
      to: [HOME.lat, HOME.lon],
      time: departs,
      mode: 'depart'
    })
    expect(service.get().kept).toEqual({
      to: HOME,
      plan: tripPlan(departs + 60),
      missed: true,
      nextWay: true
    })
    service.dispose()
  })

  it('keeps the missed trip, as missed, when nothing else gets there, until it would have', async () => {
    const { service, planner } = await keptRig({ hasLocation: false })
    planner.answer = () => ({ kind: 'planned', id: 1, plans: [], noTrip: null })
    const plan = tripPlan(NOW + 60)
    const departs = (plan.steps[1] as TripRide).depart
    await vi.advanceTimersByTimeAsync((departs - NOW) * 1000)
    expect(service.get().kept).toEqual({ to: HOME, plan, missed: true, nextWay: false })
    const asked = planner.asked.length
    await vi.advanceTimersByTimeAsync((plan.arrive - departs) * 1000)
    expect(service.get().kept).toBeNull()
    expect(planner.asked).toHaveLength(asked)
    service.dispose()
  })

  it('swaps in the same rides’ live times, never another way or a later bus', async () => {
    const { service, planner, transit } = await keptRig()
    service.command({ kind: 'close' })
    const late = tripPlan(NOW + 120, 'Orbit Venus', 1)
    planner.answer = () => ({ kind: 'planned', id: 1, plans: [late], noTrip: null })
    transit.live()
    await settle()
    // From the kept plan's own time to leave, so its bus comes back however late it runs.
    expect(planner.asked.at(-1)?.query).toMatchObject({ time: NOW + 60, mode: 'depart' })
    expect(service.get().kept?.plan).toEqual(late)

    planner.answer = () => ({
      kind: 'planned',
      id: 1,
      plans: [tripPlan(NOW + 60, 'Route 72'), tripPlan(NOW + 960)],
      noTrip: null
    })
    transit.live()
    await settle()
    expect(service.get().kept?.plan).toEqual(late)
    service.dispose()
  })

  /** The kept trip's first ride as the live feed tells of it. */
  function feedTrip(change: Partial<FeedTrip> = {}): FeedTrip {
    return {
      tripId: tripIdOf('Orbit Venus', NOW + 360),
      routeId: 'VENU',
      directionId: 0,
      canceled: false,
      vehicleId: '',
      stops: [],
      ...change
    }
  }

  const skipped = (stopId: string): FeedTrip['stops'][number] => ({
    stopSequence: 4,
    stopId,
    arrival: null,
    departure: null,
    relationship: 'skipped'
  })

  it('is missed at once when the feed cancels its bus, before the bus was due', async () => {
    const { service, planner, transit } = await keptRig()
    service.command({ kind: 'close' })
    await seconds(60)
    transit.feed = [feedTrip({ canceled: true })]
    transit.live()
    await settle()
    expect(planner.asked.at(-1)?.query).toEqual({
      from: [HERE.lat, HERE.lon],
      to: [HOME.lat, HOME.lon],
      time: NOW + 60,
      mode: 'depart'
    })
    expect(service.get().kept).toEqual({
      to: HOME,
      plan: tripPlan(NOW + 120),
      missed: true,
      nextWay: true
    })
    service.dispose()
  })

  it('takes no cancellation from a feed over 5 minutes old, and plans its rides as scheduled', async () => {
    const { service, planner, transit } = await keptRig({ plan: tripPlan(NOW + 3600) })
    service.command({ kind: 'close' })
    const canceled = [feedTrip({ tripId: tripIdOf('Orbit Venus', NOW + 3900), canceled: true })]
    transit.feed = canceled
    transit.updatedAt = NOW - 6 * 60
    transit.failedRead()
    await settle()
    expect(service.get().kept).toMatchObject({ missed: false, plan: tripPlan(NOW + 3600) })
    expect(planner.asked.at(-1)?.feed).toEqual([])
    // Read again, the same news is fresh: it's missed at once.
    transit.live()
    await settle()
    expect(service.get().kept?.missed).toBe(true)
    service.dispose()
  })

  it('has no next way to offer when its bus is canceled and nothing else gets there', async () => {
    const { service, planner, transit } = await keptRig()
    service.command({ kind: 'close' })
    planner.answer = () => ({ kind: 'planned', id: 1, plans: [], noTrip: null })
    transit.feed = [feedTrip({ canceled: true })]
    transit.live()
    await settle()
    // Still the canceled bus's plan: nothing to count down to.
    expect(service.get().kept).toEqual({
      to: HOME,
      plan: tripPlan(NOW + 60),
      missed: true,
      nextWay: false
    })
    service.dispose()
  })

  it('offers the next way only once it’s found, not while it’s being looked for', async () => {
    const { service, planner, transit } = await keptRig()
    service.command({ kind: 'close' })
    await seconds(60)
    planner.holding = true
    transit.feed = [feedTrip({ canceled: true })]
    transit.live()
    await settle()
    expect(service.get().kept).toMatchObject({ missed: true, nextWay: false })
    expect(service.get().kept?.plan).toEqual(tripPlan(NOW + 60))
    planner.held.at(-1)?.send()
    await settle()
    expect(service.get().kept).toMatchObject({ missed: true, nextWay: true })
    expect(service.get().kept?.plan).toEqual(tripPlan(NOW + 120))
    service.dispose()
  })

  it('is missed at once when its bus skips the stop it’s boarded or left at', async () => {
    for (const stop of ['RT', 'AM']) {
      const { service, transit } = await keptRig()
      transit.feed = [feedTrip({ stops: [skipped(stop)] })]
      transit.live()
      await settle()
      expect(service.get().kept?.missed).toBe(true)
      service.dispose()
    }
  })

  it('isn’t missed for a stop skipped elsewhere, or another trip canceled', async () => {
    const { service, planner, transit } = await keptRig()
    planner.answer = () => ({ kind: 'planned', id: 1, plans: [], noTrip: null })
    transit.feed = [
      feedTrip({ stops: [skipped('ELSEWHERE')] }),
      feedTrip({ tripId: tripIdOf('Orbit Venus', NOW + 1260), canceled: true })
    ]
    transit.live()
    await settle()
    expect(service.get().kept).toEqual({
      to: HOME,
      plan: tripPlan(NOW + 60),
      missed: false,
      nextWay: false
    })
    service.dispose()
  })

  it('swaps in a bus that’s running late, rather than calling it missed', async () => {
    const { service, planner, transit } = await keptRig()
    const late = tripPlan(NOW + 240, 'Orbit Venus', 3)
    planner.answer = () => ({ kind: 'planned', id: 1, plans: [late], noTrip: null })
    transit.feed = [
      feedTrip({
        stops: [
          {
            stopSequence: 1,
            stopId: 'RT',
            arrival: null,
            departure: { time: NOW + 540, delay: 180 },
            relationship: 'scheduled'
          }
        ]
      })
    ]
    transit.live()
    await settle()
    expect(service.get().kept).toEqual({ to: HOME, plan: late, missed: false, nextWay: false })
    // Past its timetable time, it isn't missed: it's late.
    await seconds(400)
    expect(service.get().kept?.missed).toBe(false)
    service.dispose()
  })

  it('changes nothing when a replan lands after the trip was let go', async () => {
    const live = await keptRig()
    live.service.command({ kind: 'close' })
    live.planner.holding = true
    live.transit.live()
    expect(live.planner.held).toHaveLength(1)
    live.service.command({ kind: 'unkeep' })
    live.planner.held[0]?.send()
    await settle()
    expect(live.service.get().kept).toBeNull()
    live.service.dispose()

    const missed = await keptRig()
    missed.service.command({ kind: 'close' })
    missed.planner.holding = true
    await seconds(360)
    expect(missed.planner.held).toHaveLength(1)
    missed.service.command({ kind: 'unkeep' })
    missed.planner.held[0]?.send()
    await settle()
    expect(missed.service.get().kept).toBeNull()
    missed.service.dispose()
  })

  it('doesn’t lose a missed trip’s replan to a live read made meanwhile', async () => {
    const { service, planner, transit } = await keptRig()
    service.command({ kind: 'close' })
    planner.holding = true
    await seconds(360)
    transit.live()
    // The missed trip's own plan has nothing to count down to: the live read asks nothing for it.
    expect(planner.held).toHaveLength(1)
    planner.held[0]?.send()
    await settle()
    expect(service.get().kept).toEqual({
      to: HOME,
      plan: tripPlan(NOW + 420),
      missed: true,
      nextWay: true
    })
    service.dispose()
  })

  /** `plan` with its first ride on the trip_id `tripId`, as every day's run of it is named. */
  function onTrip(plan: TripPlan, tripId: string): TripPlan {
    return {
      ...plan,
      steps: plan.steps.map((step) => (step.kind === 'ride' ? { ...step, tripId } : step))
    }
  }

  it('leaves a trip kept for tomorrow alone when today’s run of its trip is canceled', async () => {
    const tomorrow = NOW + 18 * 3600
    const { service, planner, transit } = await keptRig({ plan: onTrip(tripPlan(tomorrow), 'v7') })
    service.command({ kind: 'close' })
    const asked = planner.asked.length
    transit.feed = [feedTrip({ tripId: 'v7', canceled: true })]
    transit.live()
    await settle()
    expect(service.get().kept).toMatchObject({ missed: false })
    // No replan for a missed trip: the live read only re-asks the trip's own question.
    expect(planner.asked.slice(asked).map((one) => one.query.time)).toEqual([tomorrow])
    service.dispose()
  })

  it('replans a canceled “Leave at” trip from the time it was asked for, not now', async () => {
    const { service, planner, transit } = rig()
    service.command({ kind: 'open' })
    await settle()
    const sixPm = NOW + 4 * 3600
    service.command({ ...planHome, when: { kind: 'depart', time: sixPm } })
    await settle()
    service.command({ kind: 'keep', index: 0, ...identity(tripPlan(sixPm + 60)) })
    service.command({ kind: 'close' })
    transit.feed = [feedTrip({ tripId: tripIdOf('Orbit Venus', sixPm + 360), canceled: true })]
    transit.live()
    await settle()
    expect(planner.asked.at(-1)?.query).toMatchObject({ time: sixPm, mode: 'depart' })
    expect(service.get().kept).toMatchObject({ missed: true, nextWay: true })
    expect(service.get().kept?.plan).toEqual(tripPlan(sixPm + 60))
    service.dispose()
  })

  it('replans an arrive-by class trip arrive-by when its bus is canceled', async () => {
    const { service, planner, transit } = rig()
    service.command({ kind: 'open' })
    await settle()
    const by = CLASS.start - 5 * 60
    service.command({ kind: 'plan', to: CLASS, from: { kind: 'here' }, when: { kind: 'now' } })
    await settle()
    const kept = tripPlan(by - 1460)
    service.command({ kind: 'keep', index: 0, ...identity(kept) })
    service.command({ kind: 'close' })
    const departs = (kept.steps[1] as TripRide).depart
    transit.feed = [feedTrip({ tripId: tripIdOf('Orbit Venus', departs), canceled: true })]
    transit.live()
    await settle()
    expect(planner.asked.at(-1)?.query).toMatchObject({ time: by, mode: 'arrive' })
    expect(service.get().kept).toMatchObject({ missed: true, nextWay: true })
    service.dispose()
  })

  it('replans arrive-by as leaving now once nothing gets there by the time any more', async () => {
    const { service, planner, transit } = rig()
    service.command({ kind: 'open' })
    await settle()
    const by = CLASS.start - 5 * 60
    service.command({ kind: 'plan', to: CLASS, from: { kind: 'here' }, when: { kind: 'now' } })
    await settle()
    const kept = tripPlan(by - 1460)
    service.command({ kind: 'keep', index: 0, ...identity(kept) })
    service.command({ kind: 'close' })
    // Only ways that have gone already get there by the time.
    planner.answer = (query) => ({
      kind: 'planned',
      id: 1,
      plans: [query.mode === 'arrive' ? tripPlan(NOW - 3600) : tripPlan(query.time + 60)],
      noTrip: null
    })
    const departs = (kept.steps[1] as TripRide).depart
    transit.feed = [feedTrip({ tripId: tripIdOf('Orbit Venus', departs), canceled: true })]
    transit.live()
    await settle()
    expect(planner.asked.slice(-2).map((one) => one.query)).toMatchObject([
      { time: by, mode: 'arrive' },
      { time: NOW, mode: 'depart' }
    ])
    expect(service.get().kept).toMatchObject({ missed: true, nextWay: true })
    expect(service.get().kept?.plan).toEqual(tripPlan(NOW + 60))
    service.dispose()
  })

  it('ends on its second miss: the user has let it go', async () => {
    const { service, planner } = await keptRig({ hasLocation: false })
    const first = (tripPlan(NOW + 60).steps[1] as TripRide).depart
    await vi.advanceTimersByTimeAsync((first - NOW) * 1000)
    expect(service.get().kept).toMatchObject({ missed: true, nextWay: true })
    const next = (service.get().kept?.plan.steps[1] as TripRide).depart
    const asked = planner.asked.length
    await vi.advanceTimersByTimeAsync((next - first) * 1000 - 1)
    expect(service.get().kept).not.toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(service.get().kept).toBeNull()
    expect(planner.asked).toHaveLength(asked)
    service.dispose()
  })

  it('once missed with no next way, ends by the time it would first have arrived', async () => {
    const plan = tripPlan(NOW + 60)
    const { service, planner } = await keptRig({ hasLocation: false, plan })
    planner.answer = () => ({ kind: 'planned', id: 1, plans: [], noTrip: null })
    const departs = (plan.steps[1] as TripRide).depart
    await vi.advanceTimersByTimeAsync((departs - NOW) * 1000)
    expect(service.get().kept).toMatchObject({ missed: true, nextWay: false })
    // Nothing else gets there: the missed trip is let go no later than 30 min past its arrival.
    await vi.advanceTimersByTimeAsync((plan.arrive + 30 * 60 - departs) * 1000)
    expect(service.get().kept).toBeNull()
    service.dispose()
  })

  it('once missed with a next way coming, keeps it past that cutoff, to the next way’s arrival', async () => {
    const plan = tripPlan(NOW + 60)
    const { service, planner } = await keptRig({ hasLocation: false, plan })
    // The next way leaves after the old arrival + 30 min.
    const next = tripPlan(NOW + 3000)
    planner.answer = () => ({ kind: 'planned', id: 1, plans: [next], noTrip: null })
    const departs = (plan.steps[1] as TripRide).depart
    await vi.advanceTimersByTimeAsync((departs - NOW) * 1000)
    expect(service.get().kept).toMatchObject({ missed: true, nextWay: true })
    const giveUp = plan.arrive + 30 * 60
    expect(next.arrive).toBeGreaterThan(giveUp)
    await vi.advanceTimersByTimeAsync((giveUp - departs) * 1000 + 1000)
    expect(service.get().kept).not.toBeNull()
    await vi.advanceTimersByTimeAsync((next.arrive - giveUp) * 1000 + 1000)
    expect(service.get().kept).toBeNull()
    service.dispose()
  })

  it('isn’t let go while its bus is still to come, however late it runs', async () => {
    const plan = tripPlan(NOW + 60)
    const { service, planner, transit } = await keptRig({ hasLocation: false, plan })
    const late = tripPlan(NOW + 60 + 50 * 60, 'Orbit Venus', 50)
    planner.answer = () => ({ kind: 'planned', id: 1, plans: [late], noTrip: null })
    transit.live()
    await settle()
    expect(service.get().kept?.plan).toEqual(late)
    // Past half an hour after it would first have arrived, its bus hasn't come yet.
    await vi.advanceTimersByTimeAsync((plan.arrive + 30 * 60 + 60 - NOW) * 1000)
    expect(service.get().kept).toMatchObject({ missed: false, plan: late })
    service.dispose()
  })

  it('ends with trips turned off', async () => {
    const { service, store, transit } = await keptRig()
    expect(transit.tripsOn).toEqual([true])
    store.set((current) => ({ ...current, widgets: { ...current.widgets, trips: false } }))
    expect(transit.tripsOn).toEqual([true, false])
    expect(service.get().kept).toBeNull()
    expect(transit.wants.at(-1)).toBe(false)
    service.dispose()
  })
})

describe('createTripService: searching', () => {
  it('searches the Mac’s own places at once', async () => {
    const { service } = rig({ home: HOME })
    expect(await service.searchLocal('home')).toEqual([HOME])
    expect((await service.searchLocal('terrace')).map((found) => found.name)).toEqual([
      'Rural Rd & Terrace Rd'
    ])
    expect((await service.searchLocal('fitness')).map((found) => found.id)).toEqual([GYM.id])
    service.dispose()
  })

  it('sends Apple nothing under two characters, and stops its helper as the card closes', async () => {
    const { service, appleSearches, appleStops } = rig()
    service.command({ kind: 'open' })
    expect(await service.searchApple('t')).toEqual([])
    expect(await service.searchApple(' t ')).toEqual([])
    expect(appleSearches).toEqual([])
    expect(await service.searchApple('tr')).toEqual([SHOP])
    expect(appleSearches).toEqual(['tr'])
    service.command({ kind: 'close' })
    expect(appleStops()).toBe(1)
    service.dispose()
  })

  it('asks Apple nothing while trips are off', async () => {
    const { service, appleStarts, appleSearches } = rig({ trips: false })
    expect(await service.searchApple('trader')).toEqual([])
    expect(appleStarts()).toBe(0)
    expect(appleSearches).toEqual([])
    service.dispose()
  })

  it('stops Apple’s helper after a minute without a search', async () => {
    const { service, appleStarts, appleStops } = rig()
    service.command({ kind: 'open' })
    await service.searchApple('tr')
    await seconds(30)
    await service.searchApple('tra')
    expect(appleStarts()).toBe(1)
    await seconds(59)
    expect(appleStops()).toBe(0)
    await seconds(1)
    expect(appleStops()).toBe(1)
    await service.searchApple('trad')
    expect(appleStarts()).toBe(2)
    service.dispose()
  })

  it('saves, renames and removes places', () => {
    const { service } = rig()
    service.command({ kind: 'save', place: SHOP, name: 'Groceries' })
    expect(service.get().saved.map((one) => one.name)).toEqual(['Groceries'])
    const id = service.get().saved[0]?.id ?? ''
    service.command({ kind: 'rename', id, name: 'TJ’s' })
    expect(service.get().saved.map((one) => one.name)).toEqual(['TJ’s'])
    service.command({ kind: 'remove', id })
    expect(service.get().saved).toEqual([])
    service.command({ kind: 'clearRecents' })
    expect(service.get().recents).toEqual([])
    service.dispose()
  })
})

describe('createTripService: news and the demo', () => {
  it('tells listeners only what’s new', async () => {
    const { service, store, emits } = rig()
    const before = emits()
    store.set((current) => ({ ...current, theme: { ...current.theme, accent: '#8C1D40' } }))
    service.setVisible(true)
    expect(emits()).toBe(before)
    service.command({ kind: 'open' })
    await settle()
    expect(emits()).toBeGreaterThan(before)
    service.dispose()
  })

  it('plans a made-up Tempe trip with no helper, no schedule and no live reads', async () => {
    const { service, planner, location, transit, appleSearches } = rig({
      demo: true,
      timetable: null
    })
    expect(service.hasDemo).toBe(true)
    service.setDemoEnabled(true)
    expect(service.isDemoEnabled()).toBe(true)
    const state = service.get()
    expect(state).toMatchObject({
      demo: true,
      schedule: 'ready',
      supported: { location: true, appleSearch: true }
    })
    const home = state.home
    expect(home?.kind).toBe('home')
    service.command({ kind: 'open' })
    await settle()
    expect(service.get().here?.status).toBe('found')
    expect(service.get().nextClass?.title).toBeTruthy()
    expect(transit.wants.every((on) => !on)).toBe(true)
    expect((await service.searchApple('trader')).map((found) => found.name)).toEqual([
      'Trader Joe’s'
    ])
    if (!home) throw new Error('The demo has a Home')
    service.command({ kind: 'plan', to: home, from: { kind: 'here' }, when: { kind: 'now' } })
    await vi.advanceTimersByTimeAsync(100)
    const plans = service.get().plans ?? []
    expect(plans.length).toBeGreaterThan(0)
    expect(plans.some((plan) => plan.rides > 0)).toBe(true)
    // None of the real sources were touched.
    expect(location.starts).toBe(0)
    expect(planner.made).toEqual([])
    expect(appleSearches).toEqual([])
    service.setDemoEnabled(false)
    expect(service.get().demo).toBe(false)
    expect(service.get().schedule).toBe('missing')
    service.dispose()
  })
})
