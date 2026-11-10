// Next bus: the stop list (downloaded when the user says so), the picked stops, and the live
// feed, read once a minute only while the pill can be seen. The renderer counts down between
// reads. ASU's shuttles come from their bundled timetable: pushed again only when one starts or
// stops running (and at midnight), also only while the pill can be seen. The same download
// saves the trip planner's timetable, and the same reads serve its card while it's open.
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { writeFileAtomic } from '../jsonFile'
import type { SettingsStore } from '../settings/store'
import { encodeTimetable } from '../trips/timetableFile'
import { arrivalId, busArrivals, type ArrivalNames } from './arrivals'
import { SHUTTLE_STOPS, shuttleServices, type ShuttleService } from './asuShuttle'
import type { FeedTrip } from './gtfsRealtime'
import { DEMO_STOP } from './mock'
import type { LatLon } from './routeLine'
import {
  parseStopList,
  routeName,
  searchStops,
  STOP_LIST_REVISION,
  stopLine,
  stopsAlong,
  toTransitStop,
  type StopList,
  type StopListStop
} from './stopList'
import {
  searchShuttleStops,
  shuttleRouteId,
  shuttleRoutesAt,
  shuttleTransitStop
} from './shuttleStops'
import type { BusArrival, TransitRoute, TransitState, TransitStop } from './types'
import {
  ScheduleError,
  type ArrivalFeed,
  type DownloadedSchedule,
  type FeedRead
} from './valleyMetro'

/** The live feed changes every few seconds, but a minute is plenty for "4 min". */
export const POLL_SEC = 60
/**
 * After the feed fails: try again after these waits, then every 4 minutes, so the pill is back
 * within 4 minutes of the feed (a longer wait kept "No live bus times" up long after it was).
 */
export const BACKOFF_SEC = [60, 120, 240]
/** A retry asked for by clicking the pill: at most this often, however often it's clicked. */
export const RETRY_GAP_SEC = 10
/** Valley Metro's feed predicts about half an hour ahead (measured 2026-10-19). */
export const LIVE_HORIZON_MINUTES = 30
/** A feed older than this (by its own clock) says nothing true about now. */
const FEED_TOO_OLD_SEC = 10 * 60
/** Schedules change a few times a year; a monthly download keeps up. */
export const STOP_LIST_MAX_AGE_SEC = 30 * 24 * 3600
/** A monthly refresh that failed waits a day before trying again on its own. */
const AUTO_RETRY_SEC = 24 * 3600
/** Arizona keeps UTC−7 all year: the shuttles' day turns over at its midnight. */
const ARIZONA_OFFSET_SEC = 7 * 3600
/** The shuttle check runs at least this often, in case the computer's clock jumps. */
const SHUTTLE_CHECK_MAX_SEC = 3600
/**
 * The stop list's revision that began saving the timetable beside it. Fixed, not
 * STOP_LIST_REVISION: a later revision mustn't make a good timetable look too old.
 */
const TIMETABLE_SINCE_REVISION = 4

/** When the shuttles' words next change: one starts or stops running, or a new day begins. */
export function nextShuttleChange(services: readonly ShuttleService[], now: number): number {
  const local = now - ARIZONA_OFFSET_SEC
  const midnight = (Math.floor(local / 86400) + 1) * 86400 + ARIZONA_OFFSET_SEC
  const moments = services.flatMap((service) => [
    // Running through `until` itself; ended the second after.
    service.state === 'running' && service.until !== null ? service.until + 1 : Infinity,
    service.state === 'later' && service.next !== null ? service.next : Infinity
  ])
  return Math.min(midnight, now + SHUTTLE_CHECK_MAX_SEC, ...moments.filter((at) => at > now))
}

/** What the route card needs about a coming bus. */
export interface RouteSource {
  arrival: BusArrival
  stopName: string
  stopPosition: LatLon
  /** Metres along the path to the stop, as the stop list placed it; null when it couldn't. */
  stopAlong: number | null
  /** The path's stops (by id) and how far along it each is, for placing the bus by its next. */
  stopsAlong: ReadonlyMap<string, number>
  /** The path's id in the stop list (its shape id): pictures are kept by it. */
  lineId: string
  line: LatLon[]
  /** The trip and bus the live feed names, for finding it in Vehicle Locations ("" unknown). */
  tripId: string
  vehicleId: string
  /** Which way the trip goes (0 or 1), for the route's other buses going the same way. */
  directionId: number | null
}

export interface TransitService {
  get(): TransitState
  /** A coming bus's path, stop and trip; null when it's gone or has no path to show. */
  routeSource(arrivalId: string): RouteSource | null
  subscribe(listener: (state: TransitState) => void): () => void
  /** ASU shuttle stops and stops in the stop list matching what was typed. */
  search(query: string): TransitStop[]
  /** Downloads the schedule (the user said yes in Customize), or downloads it again. */
  download(): Promise<void>
  /** Deletes the stop list and the trip timetable from this computer. */
  remove(): void
  /**
   * The trip timetable's file, for the search's process to read; null when there's none, or
   * the stop list beside it was saved before the timetable was (its download is due again).
   */
  timetablePath(): string | null
  /**
   * The stop list, for the trip planner's places (stops as starts and destinations, and naming
   * where the Mac is): the saved one, or the demo's while it's on; null when there's none.
   */
  stopList(): StopList | null
  /** The trip planner wants live times (its card is open, or a trip is kept). */
  wantLive(on: boolean): void
  /** The last good read's trips, and when it was (Unix seconds; null before any). */
  liveTrips(): { trips: FeedTrip[]; updatedAt: number | null }
  /** After every read of the feed, good or not. */
  onLive(listener: () => void): () => void
  /** The trip planner is on: the stop list is kept up to date for it too. */
  setTripsOn(on: boolean): void
  /** The pill can be seen: the Focus Screen is up and not dimmed. */
  setVisible(visible: boolean): void
  /** Reads the feed now if the pill is showing, and the shuttles again (after waking up). */
  refresh(): void
  /** Reads the live feed now: the pill clicked while it has no live times. */
  retry(): void
  /** Dev builds: made-up stops and buses. */
  readonly hasDemo: boolean
  isDemoEnabled(): boolean
  setDemoEnabled(on: boolean): void
  dispose(): void
}

export interface TransitServiceOptions {
  settings: Pick<SettingsStore, 'get' | 'subscribe'>
  /** userData: the stop list goes in its transit-stops.json, the timetable in transit-timetable.bin. */
  directory: string
  feed: ArrivalFeed
  /** Throws ScheduleError, in words for Customize. */
  downloadSchedule(): Promise<DownloadedSchedule>
  /** Dev builds only. */
  demo: { feed: ArrivalFeed; stopList: StopList } | null
  /** Milliseconds, like Date.now. */
  now?: () => number
}

const stopMaps = new WeakMap<StopList, Map<string, StopListStop>>()

function stopMap(list: StopList): Map<string, StopListStop> {
  let map = stopMaps.get(list)
  if (!map) {
    map = new Map(list.stops.map((stop) => [stop.id, stop]))
    stopMaps.set(list, map)
  }
  return map
}

function readSavedList(path: string): StopList | null {
  try {
    return parseStopList(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    // Not downloaded yet, or unreadable: either way, there's none.
    return null
  }
}

function namesFor(list: StopList): ArrivalNames {
  return {
    route: (routeId) => (list.routes[routeId] ? routeName(routeId, list.routes[routeId]) : null),
    headsign: (stopId, routeId, directionId) => {
      const serves = stopMap(list).get(stopId)?.serves ?? []
      const match =
        serves.find(([route, direction]) => route === routeId && direction === directionId) ??
        serves.find(([route]) => route === routeId)
      return match?.[2] ?? ''
    },
    hasLine: (stopId, routeId, directionId) => {
      const stop = stopMap(list).get(stopId)
      return (
        stop?.position !== undefined && stopLine(list, stop, routeId, directionId, null) !== null
      )
    }
  }
}

export function createTransitService(options: TransitServiceOptions): TransitService {
  const { settings, demo } = options
  const now = options.now ?? Date.now
  const nowSec = (): number => Math.floor(now() / 1000)
  const path = join(options.directory, 'transit-stops.json')
  const timetableFile = join(options.directory, 'transit-timetable.bin')
  const listeners = new Set<(state: TransitState) => void>()
  const liveListeners = new Set<() => void>()

  let saved = readSavedList(path)
  let demoOn = false
  let visible = false
  let trips: FeedTrip[] = []
  let updatedAt: number | null = null
  let liveProblem: string | null = null
  let failures = 0
  /** When the feed was last asked (ms); null to ask as soon as the pill shows. */
  let lastAttempt: number | null = null
  let reading = false
  let disposed = false
  /** Bumped when the source changes (demo on or off), so a read under way is dropped. */
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let shuttleTimer: ReturnType<typeof setTimeout> | undefined
  let downloading = false
  let scheduleProblem: string | null = null
  let autoTriedAt: number | null = null
  let tripsOn = false
  let liveWanted = false

  const list = (): StopList | null => (demoOn && demo ? demo.stopList : saved)
  const feed = (): ArrivalFeed => (demoOn && demo ? demo.feed : options.feed)
  const enabled = (): boolean => settings.get().widgets.nextBus

  function pickedStops(current: StopList | null): StopListStop[] {
    if (!current) return []
    const stops = stopMap(current)
    const picked = settings
      .get()
      .nextBus.stops.flatMap((id) => (stops.has(id) ? [stops.get(id) as StopListStop] : []))
    if (picked.length === 0 && demoOn) return current.stops.filter((stop) => stop.id === DEMO_STOP)
    return picked
  }

  /** The picked ASU shuttle stops: bundled, so they need no download. */
  const pickedShuttleStops = (): string[] =>
    settings.get().nextBus.stops.filter((id) => SHUTTLE_STOPS.some((stop) => stop.id === id))

  function routesAt(current: StopList, stops: StopListStop[]): TransitRoute[] {
    const ids = [...new Set(stops.flatMap((stop) => stop.serves.map(([route]) => route)))]
    return ids
      .map((id) => routeName(id, current.routes[id]))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  }

  function compute(): TransitState {
    const current = list()
    const stops = pickedStops(current)
    const shuttleStops = pickedShuttleStops()
    const routes = [...(current ? routesAt(current, stops) : []), ...shuttleRoutesAt(shuttleStops)]
    // A filter left over from a stop since removed would hide every bus: then it's all routes.
    // One filter for both: picking only Gold hides Valley Metro's buses too.
    const filter = new Set(
      settings.get().nextBus.routes.filter((id) => routes.some((route) => route.id === id))
    )
    const order = settings.get().nextBus.stops
    const shown = [
      ...(current ? stops.map((stop) => toTransitStop(current, stop)) : []),
      ...shuttleStops
        .flatMap((id) => SHUTTLE_STOPS.filter((stop) => stop.id === id))
        .map(shuttleTransitStop)
    ].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    return {
      schedule: current
        ? { stops: current.stops.length, downloadedAt: current.downloadedAt }
        : null,
      downloading,
      scheduleProblem,
      stops: shown,
      routes,
      arrivals: current
        ? busArrivals(trips, {
            stops: new Set(stops.map((stop) => stop.id)),
            routes: filter,
            now: nowSec(),
            names: namesFor(current)
          })
        : [],
      shuttles: shuttleServices(shuttleStops, nowSec()).filter(
        (service) => filter.size === 0 || filter.has(shuttleRouteId(service.routeId))
      ),
      updatedAt,
      liveProblem,
      horizonMinutes: LIVE_HORIZON_MINUTES,
      demo: demoOn
    }
  }

  let state = compute()

  function emit(): void {
    const next = compute()
    // Every settings change lands here (a Customize slider sends many): only real news goes out.
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    for (const listener of listeners) listener(state)
  }

  /** While the shuttle pill can be seen, its words are pushed again whenever they'd change. */
  function scheduleShuttles(): void {
    clearTimeout(shuttleTimer)
    shuttleTimer = undefined
    if (disposed || !enabled() || !visible || pickedShuttleStops().length === 0) return
    const at = nextShuttleChange(state.shuttles, nowSec())
    shuttleTimer = setTimeout(
      () => {
        emit()
        scheduleShuttles()
      },
      Math.max(1, at - nowSec()) * 1000
    )
  }

  const active = (): boolean => enabled() && visible && pickedStops(list()).length > 0
  /** The pill's reason to read the feed, or the trip planner's: one read serves both. */
  const live = (): boolean => active() || (liveWanted && visible)

  function schedule(): void {
    clearTimeout(timer)
    timer = undefined
    if (disposed || !live() || reading) return
    const waitSec =
      failures === 0
        ? POLL_SEC
        : (BACKOFF_SEC[Math.min(failures, BACKOFF_SEC.length) - 1] ?? POLL_SEC)
    const delay = lastAttempt === null ? 0 : Math.max(0, lastAttempt + waitSec * 1000 - now())
    timer = setTimeout(() => void read(), delay)
  }

  async function read(): Promise<void> {
    if (reading) return
    reading = true
    lastAttempt = now()
    const asked = generation
    const result = await feed()
      .read()
      .catch((): FeedRead => ({ ok: false, problem: 'Valley Metro’s live feed couldn’t be read.' }))
    reading = false
    if (asked !== generation) {
      schedule()
      return
    }
    const stale =
      result.ok && result.feed.timestamp !== null
        ? nowSec() - result.feed.timestamp > FEED_TOO_OLD_SEC
        : false
    if (result.ok && !stale) {
      trips = result.feed.trips
      updatedAt = nowSec()
      liveProblem = null
      failures = 0
    } else {
      liveProblem = result.ok ? 'Valley Metro’s live feed is out of date.' : result.problem
      failures += 1
    }
    emit()
    schedule()
    // A failed read is news too: the trip planner's live times are a minute older. After
    // schedule(), so a listener that throws can't stop the pill's reads.
    for (const listener of [...liveListeners]) listener()
  }

  /**
   * Once a month, while Next bus or the trip planner is on, the stop list (and the timetable with
   * it) is downloaded again: the user said yes.
   */
  function refreshOldList(): void {
    if (!saved || downloading || !(enabled() || tripsOn)) return
    const age = nowSec() - saved.downloadedAt
    // A list saved before it kept what the route card or the trip planner needs is downloaded
    // again, once.
    if (age < STOP_LIST_MAX_AGE_SEC && (saved.revision ?? 0) >= STOP_LIST_REVISION) return
    if (autoTriedAt !== null && nowSec() - autoTriedAt < AUTO_RETRY_SEC) return
    autoTriedAt = nowSec()
    void service.download()
  }

  const unsubscribe = settings.subscribe(() => {
    // Picked stops and routes change what's shown, from the trips already read.
    emit()
    schedule()
    scheduleShuttles()
    refreshOldList()
  })

  const service: TransitService = {
    get: () => state,
    routeSource(wanted) {
      const current = list()
      const arrival = state.arrivals.find((candidate) => candidate.id === wanted)
      const stop = arrival && current ? stopMap(current).get(arrival.stopId) : undefined
      if (!current || !arrival?.hasRoute || !stop?.position) return null
      const isWanted = (tripId: string, update: FeedTrip['stops'][number]): boolean => {
        const at = update.arrival?.time ?? update.departure?.time ?? null
        return at !== null && arrivalId(tripId, update.stopId, update.stopSequence ?? at) === wanted
      }
      const trip = trips.find((candidate) =>
        candidate.stops.some((update) => isWanted(candidate.tripId, update))
      )
      // Which visit, at a stop the trip makes twice (an Orbit's first and last).
      const sequence =
        trip?.stops.find((update) => isWanted(trip.tripId, update))?.stopSequence ?? null
      const path = stopLine(current, stop, arrival.routeId, trip?.directionId ?? null, sequence)
      if (!path) return null
      return {
        arrival,
        stopName: stop.name,
        stopPosition: stop.position,
        stopAlong: path.along,
        stopsAlong: stopsAlong(current, path.id),
        lineId: path.id,
        line: path.line,
        tripId: trip?.tripId ?? '',
        vehicleId: trip?.vehicleId ?? '',
        directionId: trip?.directionId ?? null
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    search(query) {
      const current = list()
      // The few shuttle stops first: Valley Metro's list has thousands.
      return [
        ...searchShuttleStops(query).map(shuttleTransitStop),
        ...(current ? searchStops(current, query).map((stop) => toTransitStop(current, stop)) : [])
      ]
    },
    async download() {
      if (downloading) return
      downloading = true
      scheduleProblem = null
      emit()
      try {
        const fresh = await options.downloadSchedule()
        // A schedule that made no trips to plan with leaves a good timetable as it was.
        if (fresh.timetable.patterns.length > 0) {
          try {
            writeFileAtomic(
              timetableFile,
              encodeTimetable(fresh.timetable, fresh.stopList.downloadedAt)
            )
          } catch (error) {
            // Next bus still works; the trip planner offers the download again.
            console.warn('[transit] Could not save the trip timetable.', error)
          }
        }
        saved = fresh.stopList
        try {
          // ~1 MB on one line: nobody edits it by hand, and it's read back on every start.
          writeFileAtomic(path, JSON.stringify(fresh.stopList))
        } catch (error) {
          // It still works until the app quits; the next run downloads it again.
          console.warn('[transit] Could not save the stop list.', error)
        }
      } catch (error) {
        if (!(error instanceof ScheduleError)) {
          console.warn('[transit] Could not make the stop list.', error)
        }
        scheduleProblem =
          error instanceof ScheduleError ? error.message : 'The stop list couldn’t be made.'
      } finally {
        downloading = false
        emit()
        schedule()
      }
    },
    remove() {
      saved = null
      const forget = (file: string, what: string): void => {
        try {
          rmSync(file, { force: true })
        } catch (error) {
          console.warn(`[transit] Could not delete the ${what}.`, error)
        }
      }
      forget(path, 'stop list')
      forget(timetableFile, 'trip timetable')
      emit()
      schedule()
    },
    timetablePath() {
      if (!saved || (saved.revision ?? 0) < TIMETABLE_SINCE_REVISION) return null
      return existsSync(timetableFile) ? timetableFile : null
    },
    stopList: list,
    wantLive(on) {
      if (on === liveWanted) return
      liveWanted = on
      schedule()
    },
    liveTrips: () => ({ trips, updatedAt }),
    onLive(listener) {
      liveListeners.add(listener)
      return () => {
        liveListeners.delete(listener)
      }
    },
    setTripsOn(on) {
      if (on === tripsOn) return
      tripsOn = on
      refreshOldList()
    },
    setVisible(next) {
      if (next === visible) return
      visible = next
      // The shuttles' words may have changed while nobody looked.
      if (visible) emit()
      schedule()
      scheduleShuttles()
    },
    retry() {
      if (reading || !live()) return
      if (lastAttempt !== null && now() - lastAttempt < RETRY_GAP_SEC * 1000) return
      lastAttempt = null
      schedule()
    },
    refresh() {
      lastAttempt = null
      // A timer that slept through a shuttle starting or stopping fires late: push it now.
      emit()
      schedule()
      scheduleShuttles()
    },
    hasDemo: demo !== null,
    isDemoEnabled: () => demoOn,
    setDemoEnabled(on) {
      if (!demo || on === demoOn) return
      demoOn = on
      generation += 1
      trips = []
      updatedAt = null
      liveProblem = null
      failures = 0
      lastAttempt = null
      emit()
      schedule()
    },
    dispose() {
      disposed = true
      generation += 1
      clearTimeout(timer)
      clearTimeout(shuttleTimer)
      unsubscribe()
      listeners.clear()
      liveListeners.clear()
    }
  }
  refreshOldList()
  return service
}
