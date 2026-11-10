import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, type Settings } from '../settings/schema'
import { near, testTimetable } from '../trips/testTimetable'
import { decodeTimetable, encodeTimetable } from '../trips/timetableFile'
import type { Timetable } from '../trips/types'
import type { FeedTrip } from './gtfsRealtime'
import { demoFeed, demoStopList } from './mock'
import { parseTransitCommand } from './parse'
import {
  createTransitService,
  nextShuttleChange,
  STOP_LIST_MAX_AGE_SEC,
  type TransitServiceOptions
} from './service'
import { STOP_LIST_REVISION, type StopList } from './stopList'
import { ScheduleError, type FeedRead } from './valleyMetro'

const START = Date.UTC(2026, 9, 19, 18, 0) // ms
const NOW_SEC = START / 1000

let dir: string
/** A one-route timetable, made before the fake clocks start (reading a zip awaits). */
let TIMETABLE: Timetable

beforeAll(async () => {
  TIMETABLE = await testTimetable({
    stops: { A: near(0, 0), B: near(0, 800) },
    routes: [
      {
        id: '72',
        trips: [
          {
            id: 't1',
            stops: [
              ['A', '08:00'],
              ['B', '08:04']
            ]
          }
        ]
      }
    ]
  })
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focus-screen-transit-'))
  vi.useFakeTimers({ now: START })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

function settingsStore(initial: Settings): {
  get(): Settings
  subscribe(listener: (settings: Settings) => void): () => void
  set(change: (current: Settings) => Settings): void
} {
  let current = initial
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

function withNextBus(on: boolean, stops: string[] = [], routes: string[] = []): Settings {
  const base = defaultSettings()
  return {
    ...base,
    widgets: { ...base.widgets, nextBus: on },
    nextBus: { stops, routes, order: [] }
  }
}

const LIST: StopList = {
  downloadedAt: NOW_SEC - 3600,
  revision: STOP_LIST_REVISION,
  version: 'test',
  routes: {
    '72': { short: '72', long: 'Scottsdale Rd/Rural Rd' },
    VENU: { short: 'VENU', long: 'Orbit Venus' }
  },
  stops: [
    {
      id: 'A',
      code: '1',
      name: 'Mill Av & University Dr',
      detail: 'NB',
      station: '',
      serves: [
        ['72', 1, 'Chandler'],
        ['VENU', 0, 'Venus Forward']
      ]
    },
    { id: 'B', code: '2', name: 'Rural Rd & Terrace Rd', detail: '', station: '', serves: [] }
  ],
  lines: {}
}

function trip(tripId: string, routeId: string, stopId: string, at: number): FeedTrip {
  return {
    tripId,
    routeId,
    directionId: routeId === '72' ? 1 : 0,
    canceled: false,
    vehicleId: '',
    stops: [
      {
        stopSequence: 1,
        stopId,
        arrival: { time: at, delay: null },
        departure: null,
        relationship: 'scheduled'
      }
    ]
  }
}

interface Setup {
  store: ReturnType<typeof settingsStore>
  reads: () => number
  answers: FeedRead[]
  service: ReturnType<typeof createTransitService>
}

function setup(
  settings: Settings,
  options: { list?: StopList | null; download?: TransitServiceOptions['downloadSchedule'] } = {}
): Setup {
  const list = options.list === undefined ? LIST : options.list
  if (list) writeFileSync(join(dir, 'transit-stops.json'), JSON.stringify(list))
  const store = settingsStore(settings)
  let count = 0
  const answers: FeedRead[] = []
  const service = createTransitService({
    settings: store,
    directory: dir,
    feed: {
      read: async () => {
        count += 1
        return (
          answers.shift() ?? {
            ok: true,
            feed: {
              timestamp: Math.floor(Date.now() / 1000),
              trips: [
                trip('t1', 'VENU', 'A', Math.floor(Date.now() / 1000) + 240),
                trip('t2', '72', 'A', Math.floor(Date.now() / 1000) + 540),
                trip('t3', '72', 'B', Math.floor(Date.now() / 1000) + 60)
              ]
            }
          }
        )
      }
    },
    downloadSchedule: options.download ?? (async () => ({ stopList: LIST, timetable: TIMETABLE })),
    demo: { feed: demoFeed(Date.now), stopList: demoStopList(NOW_SEC) }
  })
  return { store, reads: () => count, answers, service }
}

describe('createTransitService', () => {
  it('reads the feed only while on, seen, and with a stop picked', async () => {
    const { store, reads, service } = setup(withNextBus(false, ['A']))
    service.setVisible(true)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(reads()).toBe(0)

    store.set(() => withNextBus(true, []))
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(reads()).toBe(0)

    store.set(() => withNextBus(true, ['A']))
    await vi.advanceTimersByTimeAsync(0)
    expect(reads()).toBe(1)
    expect(service.get().arrivals.map((a) => [a.route, a.headsign])).toEqual([
      ['Orbit Venus', 'Venus Forward'],
      ['Route 72', 'Chandler']
    ])

    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads()).toBe(2)

    // Hidden (or dimmed): no more reads; seen again a while later: one right away.
    service.setVisible(false)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(reads()).toBe(2)
    service.setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(reads()).toBe(3)
    service.dispose()
  })

  it('waits longer after each failure, then goes back to once a minute', async () => {
    const { reads, answers, service } = setup(withNextBus(true, ['A']))
    for (let i = 0; i < 3; i++) answers.push({ ok: false, problem: 'down' })
    service.setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(reads()).toBe(1)
    expect(service.get().liveProblem).toBe('down')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads()).toBe(2)
    await vi.advanceTimersByTimeAsync(119_000)
    expect(reads()).toBe(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reads()).toBe(3)
    await vi.advanceTimersByTimeAsync(240_000)
    expect(reads()).toBe(4)
    expect(service.get().liveProblem).toBeNull()
    expect(service.get().updatedAt).toBe(Math.floor(Date.now() / 1000))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads()).toBe(5)
    service.dispose()
  })

  it('waits at most 4 minutes between tries while the feed is down', async () => {
    const { reads, answers, service } = setup(withNextBus(true, ['A']))
    for (let i = 0; i < 6; i++) answers.push({ ok: false, problem: 'down' })
    service.setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync((60 + 120 + 240) * 1000)
    expect(reads()).toBe(4)
    await vi.advanceTimersByTimeAsync(239_000)
    expect(reads()).toBe(4)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reads()).toBe(5)
    service.dispose()
  })

  it('reads again at once when asked, but not more than every 10 seconds', async () => {
    const { reads, answers, service } = setup(withNextBus(true, ['A']))
    for (let i = 0; i < 3; i++) answers.push({ ok: false, problem: 'down' })
    service.setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(reads()).toBe(1)
    // Clicked straight away: too soon after the read that just failed.
    service.retry()
    await vi.advanceTimersByTimeAsync(0)
    expect(reads()).toBe(1)
    await vi.advanceTimersByTimeAsync(10_000)
    service.retry()
    await vi.advanceTimersByTimeAsync(0)
    expect(reads()).toBe(2)
    service.dispose()
  })

  it('doesn’t trust a feed that stopped updating', async () => {
    const { answers, service } = setup(withNextBus(true, ['A']))
    answers.push({ ok: true, feed: { timestamp: NOW_SEC - 3600, trips: [] } })
    service.setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(service.get().updatedAt).toBeNull()
    expect(service.get().liveProblem).toBe('Valley Metro’s live feed is out of date.')
    service.dispose()
  })

  it('shows picked routes only, unless none of them stop at the picked stops', async () => {
    const { store, service } = setup(withNextBus(true, ['A'], ['72']))
    service.setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(service.get().arrivals.map((a) => a.routeId)).toEqual(['72'])
    expect(service.get().routes.map((route) => route.name)).toEqual(['Orbit Venus', 'Route 72'])
    // Stop B has no routes in the list, so a 72-only filter there would hide everything.
    store.set(() => withNextBus(true, ['B'], ['VENU']))
    expect(service.get().arrivals.map((a) => a.stopId)).toEqual(['B'])
    service.dispose()
  })

  it('names the picked stops and finds others', () => {
    const { service } = setup(withNextBus(true, ['B', 'gone', 'A']))
    expect(service.get().stops.map((stop) => stop.id)).toEqual(['B', 'A'])
    expect(service.get().schedule).toEqual({ stops: 2, downloadedAt: NOW_SEC - 3600 })
    // ASU's shuttle stop on Rural Rd comes first: there are only a few of those.
    expect(service.search('rural').map((stop) => stop.id)).toEqual(['asu:tempe-light-rail', 'B'])
    service.dispose()
  })

  it('downloads the schedule when asked, saves the stop list and timetable, and removes both', async () => {
    const { service } = setup(withNextBus(true), { list: null })
    expect(service.get().schedule).toBeNull()
    expect(service.timetablePath()).toBeNull()
    expect(service.search('mill')).toEqual([])
    const done = service.download()
    expect(service.get().downloading).toBe(true)
    await done
    expect(service.get().downloading).toBe(false)
    expect(service.get().schedule?.stops).toBe(2)
    const saved: unknown = JSON.parse(readFileSync(join(dir, 'transit-stops.json'), 'utf8'))
    expect(saved).toEqual(LIST)
    const timetable = join(dir, 'transit-timetable.bin')
    expect(service.timetablePath()).toBe(timetable)
    const read = decodeTimetable(readFileSync(timetable))
    expect(read?.downloadedAt).toBe(LIST.downloadedAt)
    expect(read?.timetable.patterns.map((pattern) => pattern.trips)).toEqual([['t1']])
    service.remove()
    expect(service.get().schedule).toBeNull()
    expect(service.timetablePath()).toBeNull()
    expect(existsSync(join(dir, 'transit-stops.json'))).toBe(false)
    expect(existsSync(timetable)).toBe(false)
    service.dispose()
  })

  it('never saves a timetable with nothing in it over a good one', async () => {
    const timetable = join(dir, 'transit-timetable.bin')
    const later = { ...LIST, downloadedAt: NOW_SEC }
    const empty = (): Timetable => ({ ...TIMETABLE, patterns: [] })
    let answer = { stopList: LIST, timetable: empty() }
    const { service } = setup(withNextBus(true), { list: null, download: async () => answer })
    // None before: the stop list still saves, for Next bus, but there's no timetable.
    await service.download()
    expect(service.get().schedule?.downloadedAt).toBe(LIST.downloadedAt)
    expect(service.timetablePath()).toBeNull()
    expect(existsSync(timetable)).toBe(false)

    answer = { stopList: LIST, timetable: TIMETABLE }
    await service.download()
    expect(service.timetablePath()).toBe(timetable)
    // A good one before: it stays, and the new stop list is saved.
    answer = { stopList: later, timetable: empty() }
    await service.download()
    expect(service.get().schedule?.downloadedAt).toBe(NOW_SEC)
    expect(service.timetablePath()).toBe(timetable)
    expect(decodeTimetable(readFileSync(timetable))?.downloadedAt).toBe(LIST.downloadedAt)
    service.dispose()
  })

  it('keeps the stop list when the timetable can’t be saved', async () => {
    // A folder where its temporary file would go: the write fails, as on a full disk.
    mkdirSync(join(dir, 'transit-timetable.bin.tmp'))
    const { service } = setup(withNextBus(true), { list: null })
    await service.download()
    expect(service.get().scheduleProblem).toBeNull()
    expect(service.get().schedule?.stops).toBe(2)
    expect(existsSync(join(dir, 'transit-stops.json'))).toBe(true)
    expect(service.timetablePath()).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(
      '[transit] Could not save the trip timetable.',
      expect.anything()
    )
    service.dispose()
  })

  it('has no timetable for a stop list saved before the timetable existed', () => {
    // A timetable file beside it can't be trusted to match it.
    writeFileSync(join(dir, 'transit-timetable.bin'), encodeTimetable(TIMETABLE, NOW_SEC))
    const { service } = setup(withNextBus(false), { list: { ...LIST, revision: 3 } })
    expect(service.get().schedule).not.toBeNull()
    expect(service.timetablePath()).toBeNull()
    service.dispose()
    rmSync(join(dir, 'transit-timetable.bin'))
    // A new enough list, but no timetable saved beside it.
    const fresh = setup(withNextBus(false))
    expect(fresh.service.timetablePath()).toBeNull()
    fresh.service.dispose()
  })

  it('says why a download failed', async () => {
    const { service } = setup(withNextBus(true), {
      list: null,
      download: () => Promise.reject(new ScheduleError('Try again later.'))
    })
    await service.download()
    expect(service.get().scheduleProblem).toBe('Try again later.')
    expect(service.get().schedule).toBeNull()
    service.dispose()
  })

  it('downloads a month-old stop list again on its own, only while Next bus is on', async () => {
    const old = { ...LIST, downloadedAt: NOW_SEC - STOP_LIST_MAX_AGE_SEC - 1 }
    let downloads = 0
    const download: TransitServiceOptions['downloadSchedule'] = async () => {
      downloads += 1
      return { stopList: LIST, timetable: TIMETABLE }
    }
    const off = setup(withNextBus(false), { list: old, download })
    await vi.advanceTimersByTimeAsync(0)
    expect(downloads).toBe(0)
    off.store.set(() => withNextBus(true))
    await vi.advanceTimersByTimeAsync(0)
    expect(downloads).toBe(1)
    expect(off.service.get().schedule?.downloadedAt).toBe(LIST.downloadedAt)
    off.service.dispose()
  })

  it('downloads a stop list saved before the route card again, once', async () => {
    const beforeLines: StopList = { ...LIST }
    delete beforeLines.lines
    delete beforeLines.revision
    // Saved before stops were placed along their paths: the route card needs that too.
    const beforePlaces: StopList = { ...LIST }
    delete beforePlaces.revision
    for (const old of [beforeLines, beforePlaces]) {
      let downloads = 0
      const download: TransitServiceOptions['downloadSchedule'] = async () => {
        downloads += 1
        return { stopList: LIST, timetable: TIMETABLE }
      }
      const { service, store } = setup(withNextBus(true), { list: old, download })
      await vi.advanceTimersByTimeAsync(0)
      expect(downloads).toBe(1)
      store.set(() => withNextBus(true, ['A']))
      await vi.advanceTimersByTimeAsync(0)
      expect(downloads).toBe(1)
      service.dispose()
    }
  })

  it('downloads an old stop list again, once, while Trips is on with Next bus off', async () => {
    let downloads = 0
    const download: TransitServiceOptions['downloadSchedule'] = async () => {
      downloads += 1
      return { stopList: LIST, timetable: TIMETABLE }
    }
    // Saved before the trip planner's timetable: Trips needs the download to make one.
    const old = { ...LIST, revision: 3 }
    const { service, store } = setup(withNextBus(false), { list: old, download })
    await vi.advanceTimersByTimeAsync(0)
    expect(downloads).toBe(0)
    service.setTripsOn(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(downloads).toBe(1)
    expect(service.timetablePath()).toBe(join(dir, 'transit-timetable.bin'))
    store.set(() => withNextBus(false, ['A']))
    service.setTripsOn(false)
    service.setTripsOn(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(downloads).toBe(1)
    service.dispose()
  })

  it('downloads a month-old stop list again while Trips is on, never while both are off', async () => {
    const old = { ...LIST, downloadedAt: NOW_SEC - STOP_LIST_MAX_AGE_SEC - 1 }
    let downloads = 0
    const download: TransitServiceOptions['downloadSchedule'] = async () => {
      downloads += 1
      return { stopList: LIST, timetable: TIMETABLE }
    }
    const { service } = setup(withNextBus(false), { list: old, download })
    service.setTripsOn(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(downloads).toBe(0)
    service.setTripsOn(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(downloads).toBe(1)
    service.dispose()
  })

  it('reads the feed for trips while wanted and seen, with no stop picked', async () => {
    const { reads, answers, service } = setup(withNextBus(false))
    let heard = 0
    service.onLive(() => (heard += 1))
    service.setVisible(true)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(reads()).toBe(0)
    expect(service.liveTrips()).toEqual({ trips: [], updatedAt: null })

    service.wantLive(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(reads()).toBe(1)
    expect(heard).toBe(1)
    const firstAt = Math.floor(Date.now() / 1000)
    expect(service.liveTrips().trips.map((t) => t.tripId)).toEqual(['t1', 't2', 't3'])
    expect(service.liveTrips().updatedAt).toBe(firstAt)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(reads()).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reads()).toBe(2)
    expect(heard).toBe(2)
    expect(service.liveTrips().updatedAt).toBe(firstAt + 60)

    // A failed read is news too (the live times are getting old), but keeps the last good ones.
    answers.push({ ok: false, problem: 'down' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads()).toBe(3)
    expect(heard).toBe(3)
    expect(service.liveTrips().trips).toHaveLength(3)
    expect(service.liveTrips().updatedAt).toBe(firstAt + 60)
    // The pill's backoff: the next try a minute after the failure, then back to once a minute.
    await vi.advanceTimersByTimeAsync(59_000)
    expect(reads()).toBe(3)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reads()).toBe(4)

    // Hidden: none, even while wanted; seen again a while later: one at once.
    service.setVisible(false)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(reads()).toBe(4)
    service.setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(reads()).toBe(5)

    service.wantLive(false)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(reads()).toBe(5)
    expect(heard).toBe(5)
    service.dispose()
  })

  it('stops telling a listener once it unsubscribes', async () => {
    const { reads, service } = setup(withNextBus(false))
    let heard = 0
    const stop = service.onLive(() => (heard += 1))
    service.setVisible(true)
    service.wantLive(true)
    await vi.advanceTimersByTimeAsync(0)
    stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads()).toBe(2)
    expect(heard).toBe(1)
    service.dispose()
  })

  it('shares the pill’s reads, and leaves the pill as it was', async () => {
    const plain = setup(withNextBus(true, ['A']))
    plain.service.setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    const arrivals = plain.service.get().arrivals
    expect(arrivals).toHaveLength(2)
    plain.service.dispose()

    const { reads, service } = setup(withNextBus(true, ['A']))
    service.setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    service.wantLive(true)
    await vi.advanceTimersByTimeAsync(0)
    // One read a minute serves both.
    expect(reads()).toBe(1)
    expect(service.get().arrivals).toEqual(arrivals)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads()).toBe(2)
    service.wantLive(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reads()).toBe(3)
    service.dispose()

    // No stop picked: the trips' reads show no buses on the pill.
    const none = setup(withNextBus(true))
    none.service.setVisible(true)
    none.service.wantLive(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(none.reads()).toBe(1)
    expect(none.service.get().stops).toEqual([])
    expect(none.service.get().arrivals).toEqual([])
    none.service.dispose()
  })

  it('reads the feed for wanting live times, not for Trips being on', async () => {
    const { reads, service } = setup(withNextBus(false))
    service.setVisible(true)
    service.setTripsOn(true)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(reads()).toBe(0)
    service.dispose()
  })

  it('gives the trip planner the stop list: the saved one, the demo’s while it’s on, or none', () => {
    const saved = setup(withNextBus(false))
    expect(saved.service.stopList()?.stops.map((stop) => stop.id)).toEqual(['A', 'B'])
    saved.service.setDemoEnabled(true)
    expect(saved.service.stopList()?.version).toBe('demo')
    saved.service.setDemoEnabled(false)
    expect(saved.service.stopList()?.version).toBe('test')
    saved.service.dispose()
    rmSync(join(dir, 'transit-stops.json'))
    const none = setup(withNextBus(false), { list: null })
    expect(none.service.stopList()).toBeNull()
    none.service.dispose()
  })

  it('shows made-up buses at a demo stop in dev builds', async () => {
    const { reads, service } = setup(withNextBus(true), { list: null })
    service.setVisible(true)
    service.setDemoEnabled(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(reads()).toBe(0)
    const state = service.get()
    expect(state.demo).toBe(true)
    expect(state.stops.map((stop) => stop.name)).toEqual(['Mill Ave & University Dr'])
    expect(state.arrivals.length).toBeGreaterThan(0)
    expect(state.arrivals.every((a) => a.at >= NOW_SEC - 60)).toBe(true)
    service.setDemoEnabled(false)
    expect(service.get().schedule).toBeNull()
    service.dispose()
  })
})

/** Unix seconds for an Arizona clock time, "2026-10-19T18:46" (Arizona is UTC−7 all year). */
const az = (local: string): number => Date.parse(`${local}:00Z`) / 1000 + 7 * 3600
const TEMPE_SHUTTLE = 'asu:tempe-forest-lemon'

describe('ASU shuttles in Next bus', () => {
  it('work without the stop list, and never read the live feed', async () => {
    const { reads, service } = setup(withNextBus(true, [TEMPE_SHUTTLE]), { list: null })
    service.setVisible(true)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(reads()).toBe(0)
    const state = service.get()
    expect(state.stops.map((stop) => [stop.id, stop.source])).toEqual([
      [TEMPE_SHUTTLE, 'asuShuttle']
    ])
    expect(state.routes.map((route) => route.id)).toEqual([
      'asu:maroon',
      'asu:gold',
      'asu:mercado',
      'asu:express'
    ])
    // 11 AM on a school Monday: all four run there.
    expect(state.shuttles.map((s) => [s.route, s.state])).toEqual([
      ['Maroon', 'running'],
      ['Gold', 'running'],
      ['Mercado', 'running'],
      ['Tempe–West Express', 'running']
    ])
    expect(service.search('forest').map((stop) => stop.id)).toEqual([TEMPE_SHUTTLE])
    service.dispose()
  })

  it('keeps picked stops in the order picked, buses and shuttles together', () => {
    const { service } = setup(withNextBus(true, ['B', TEMPE_SHUTTLE, 'A']))
    expect(service.get().stops.map((stop) => stop.id)).toEqual(['B', TEMPE_SHUTTLE, 'A'])
    service.dispose()
  })

  it('shares one route filter with the buses', async () => {
    const { service } = setup(withNextBus(true, ['A', TEMPE_SHUTTLE], ['asu:gold']))
    service.setVisible(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(service.get().shuttles.map((s) => s.route)).toEqual(['Gold'])
    // Only Gold picked: Valley Metro's buses step aside too.
    expect(service.get().arrivals).toEqual([])
    service.dispose()
  })

  it('pushes again when a shuttle stops running, while it can be seen', async () => {
    vi.setSystemTime((az('2026-10-19T22:29') + 30) * 1000)
    const { service } = setup(withNextBus(true, ['asu:west-university-way'], ['asu:maroon']))
    const pushed: string[] = []
    service.subscribe((state) => pushed.push(state.shuttles[0]?.state ?? 'none'))
    service.setVisible(true)
    expect(service.get().shuttles[0]?.state).toBe('running')
    await vi.advanceTimersByTimeAsync(29_000)
    expect(pushed).toEqual([])
    await vi.advanceTimersByTimeAsync(3_000)
    expect(pushed).toEqual(['ended'])
    service.dispose()
  })
})

describe('nextShuttleChange', () => {
  const base = {
    stopId: TEMPE_SHUTTLE,
    routeId: 'gold' as const,
    route: 'Gold',
    toward: 'Polytechnic',
    everyMinutes: 15
  }
  it('is the next start, stop, or Arizona midnight, whichever comes first', () => {
    const now = az('2026-10-19T22:00')
    expect(
      nextShuttleChange(
        [{ ...base, state: 'running', until: az('2026-10-19T22:30'), next: null }],
        now
      )
    ).toBe(az('2026-10-19T22:30') + 1)
    expect(
      nextShuttleChange([{ ...base, state: 'later', until: null, next: now + 600 }], now)
    ).toBe(now + 600)
    const late = az('2026-10-19T23:30')
    expect(nextShuttleChange([], late)).toBe(az('2026-10-20T00:00'))
    // At most an hour, in case the clock jumps.
    expect(nextShuttleChange([], now)).toBe(now + 3600)
  })
})

describe('parseTransitCommand', () => {
  it('passes only the known commands', () => {
    expect(parseTransitCommand({ kind: 'download' })).toEqual({ kind: 'download' })
    expect(parseTransitCommand({ kind: 'remove', path: '/' })).toEqual({ kind: 'remove' })
    expect(parseTransitCommand({ kind: 'retry', now: true })).toEqual({ kind: 'retry' })
    expect(parseTransitCommand({ kind: 'delete' })).toBeNull()
    expect(parseTransitCommand(null)).toBeNull()
  })
})
