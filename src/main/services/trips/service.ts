// The trip card: where it starts, where to, when, the trips planned (on this Mac, from Valley
// Metro's schedule and live feed), the one kept on screen (keptTrip.ts), where the Mac is
// (here.ts), Home, saved and recent places, and the demo. Where the Mac is, Home, saved places,
// destinations and searches stay in this process and the places file: nothing here logs them,
// not even in an error.
import type { SettingsStore } from '../settings/store'
import type { LatLon } from '../transit/routeLine'
import type { TransitService } from '../transit/service'
import type { LocationSource } from '../weather/location'
import type { LocationAccess } from '../weather/types'
import { MIN_APPLE_TEXT_CHARS, type ApplePlaces } from './applePlaces'
import type { TripPlanner } from './client'
import { createHere, hereName } from './here'
import { homePreviewOf } from './homePreview'
import { planIdentity, type Fix } from './kept'
import { createKeptTrip, type PlannedFrom } from './keptTrip'
import { searchLocal, stopPlaces } from './localSearch'
import { memoryPlaces, type TripsDemo } from './mock'
import type { PlacesStore } from './places'
import { createTripSearch } from './search'
import type {
  ClassPlace,
  HomePreview,
  Place,
  PlanQuery,
  TripCommand,
  TripFrom,
  TripPlan,
  TripState,
  TripWhen
} from './types'

export { KEPT_FIX_SEC } from './keptTrip'

/** Opening the card asks for a new fix when the last is older than this. */
export const FRESH_FIX_SEC = 60
/** Apple's place search helper is stopped after this long without a search. */
export const APPLE_IDLE_SEC = 60
/** Asking macOS from Customize lets the location go once it answers, or after this long. */
export const ACCESS_ASK_SEC = 10

const NO_PLAN = 'This trip couldn’t be planned just now.'

/** What starts something: these wait for trips to be on. Customize's place buttons don't. */
const STARTING = new Set<TripCommand['kind']>([
  'open',
  'plan',
  'keep',
  'setHomeHere',
  'downloadSchedule',
  'requestAccess'
])

export interface TripService {
  get(): TripState
  subscribe(listener: (state: TripState) => void): () => void
  command(command: TripCommand): void
  /** The Mac's own places matching what's typed: nothing is sent anywhere for these. */
  searchLocal(text: string): Promise<Place[]>
  /** Apple's places for what's typed (two characters or more); none when there's no helper. */
  searchApple(text: string): Promise<Place[]>
  /** The Focus Screen can be seen: shown and not dimmed. */
  setVisible(visible: boolean): void
  /** After waking: a kept trip checks where the Mac is, and its countdown's ends, at once. */
  refresh(): void
  /** Dev builds: a made-up Tempe afternoon, with no helper, no schedule and no network. */
  readonly hasDemo: boolean
  isDemoEnabled(): boolean
  setDemoEnabled(on: boolean): void
  dispose(): void
}

export interface TripServiceOptions {
  settings: Pick<SettingsStore, 'get' | 'subscribe'>
  transit: Pick<
    TransitService,
    | 'timetablePath'
    | 'wantLive'
    | 'liveTrips'
    | 'onLive'
    | 'download'
    | 'get'
    | 'subscribe'
    | 'stopList'
    | 'setTripsOn'
  >
  /** The search on the timetable at that path (its own process). */
  planner: (timetablePath: string) => TripPlanner
  /** A handle on the shared location; null where there's none (not a Mac, or no helper). */
  location: (() => LocationSource) | null
  places: PlacesStore
  /** Apple's place search; null where there's none. */
  apple: (() => ApplePlaces) | null
  /** The next class still to start, at a building the class map knows; null for none. */
  classes: { next(): Promise<ClassPlace | null> }
  /** The school's buildings as places. */
  buildings(): Promise<Place[]>
  /** Dev builds only. */
  demo: TripsDemo | null
  /** Milliseconds, like Date.now. */
  now?: () => number
}

const pointOf = (place: Place): LatLon => [place.lat, place.lon]

export function createTripService(options: TripServiceOptions): TripService {
  const { settings, transit, demo } = options
  const now = options.now ?? Date.now
  const nowSec = (): number => Math.floor(now() / 1000)
  const listeners = new Set<(state: TripState) => void>()

  let demoOn = false
  let demoPlaces: PlacesStore | null = null
  let visible = false
  let disposed = false
  let open = false
  /** "Use where I am now" was pressed and waits on a fix. */
  let homePending = false
  /** macOS was asked for Location with nothing else holding the location: it's let go on the answer. */
  let askingAccess = false
  let accessTimer: ReturnType<typeof setTimeout> | undefined
  /** macOS's last word on Location, kept after the handle's let go (TripState.locationAccess). */
  let lastAccess: LocationAccess | null = null

  // The card's question and its answer.
  let to: Place | null = null
  let when: TripWhen = { kind: 'now' }
  let plans: TripPlan[] | null = null
  let noTrip: TripState['noTrip'] = null
  let planning = false
  let problem: string | null = null
  /** A plan from where the Mac is waits on a fix. */
  let waitingForFix = false
  /** What the plans shown were asked with: what keeping one keeps. */
  let planned: PlannedFrom | null = null
  /** Bumped by each question the card asks, so an older answer landing late is dropped. */
  let planSeq = 0
  /**
   * Home's row: when to leave for Home from the card's start, asked apart from the card's own
   * question (its own counter, its own answer), so neither ever lands in the other's place.
   */
  let homePreview: HomePreview | null = null
  let homeSeq = 0

  let nextClass: ClassPlace | null = null
  let classSeq = 0
  let nextClassOn = settings.get().widgets.nextClass
  /** The name worked out for a fix, kept with the fix it's for. */
  let named: { fix: Fix; name: string | null } | null = null
  let seenFix: Fix | null = null

  let apple: ApplePlaces | null = null
  let appleIdle: ReturnType<typeof setTimeout> | undefined
  let tripsOn: boolean | null = null

  const enabled = (): boolean => !disposed && settings.get().widgets.trips
  const places = (): PlacesStore => (demoOn && demoPlaces ? demoPlaces : options.places)
  const hasLocation = (): boolean => (demoOn && demo !== null) || options.location !== null
  const hasApple = (): boolean => (demoOn && demo !== null) || options.apple !== null

  const here = createHere({
    start: () => (demoOn && demo ? demo.location() : (options.location?.() ?? null)),
    now,
    changed: onHereChanged,
    wanted: () => needsHere(),
    accessChanged(access) {
      // macOS says "denied" for Location Services off too: a fix that found it off knows better.
      if (!(access === 'denied' && lastAccess === 'off')) lastAccess = access
      if (askingAccess && access !== 'notDetermined') stopAsking()
      emit()
    }
  })

  const search = createTripSearch({
    transit,
    planner: options.planner,
    demo: () => (demoOn && demo ? demo.planner : null),
    now
  })
  const ask = search.ask
  const schedule = search.schedule

  const kept = createKeptTrip({
    now,
    ask,
    feed: search.feed,
    startPoint,
    locate: () => here.locate(),
    canCheck: () => visible && here.held(),
    changed() {
      syncHere()
      syncLive()
      emit()
    }
  })

  /** Where a trip starts when nobody's picked: where the Mac is, or Home where that can't be known. */
  function defaultFrom(): TripFrom {
    const home = places().read().home
    return !hasLocation() && home ? { kind: 'place', place: home } : { kind: 'here' }
  }

  let from: TripFrom = defaultFrom()

  /** Who needs where the Mac is: the card, a trip kept from it, or "Use where I am now". */
  const needsHere = (): boolean => open || homePending || kept.fix() !== null

  function hereState(): TripState['here'] {
    if (!needsHere()) return null
    const fix = here.fix()
    const status = hasLocation() ? here.status() : 'failed'
    return { status, name: fix && named?.fix === fix ? named.name : null }
  }

  function compute(): TripState {
    const { home, saved, recents } = places().read()
    const current = settings.get()
    return {
      supported: { location: hasLocation(), appleSearch: hasApple() },
      schedule: schedule(),
      here: hereState(),
      locationAccess: hasLocation() ? lastAccess : null,
      from,
      to,
      when,
      plans,
      noTrip,
      planning,
      problem,
      kept: kept.shown(),
      home,
      homePreview: open ? homePreview : null,
      saved: [...saved],
      recents: [...recents],
      nextClass: current.widgets.nextClass ? nextClass : null,
      arriveEarlyMin: current.trips.arriveEarlyMin,
      demo: demoOn
    }
  }

  let state = compute()

  function emit(): void {
    const next = compute()
    // Settings land here on every change (a Customize slider sends many): only real news goes out.
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    for (const listener of listeners) listener(state)
  }

  /** The location handle is held exactly while something needs it, or macOS is being asked. */
  function syncHere(): void {
    const want = enabled() && (needsHere() || askingAccess)
    if (want && !here.held()) here.hold()
    if (!want && here.held()) {
      here.release()
      named = null
      seenFix = null
    }
    kept.syncChecks()
  }

  /** Live times only while the card or a kept trip can be seen; the demo reads none. */
  function syncLive(): void {
    transit.wantLive(enabled() && !demoOn && visible && (open || kept.shown() !== null))
  }

  function syncTripsOn(): void {
    const on = settings.get().widgets.trips
    if (on === tripsOn) return
    tripsOn = on
    transit.setTripsOn(on)
  }

  function stopApple(): void {
    clearTimeout(appleIdle)
    appleIdle = undefined
    apple?.stop()
    apple = null
  }

  function stopAsking(): void {
    clearTimeout(accessTimer)
    accessTimer = undefined
    askingAccess = false
    syncHere()
  }

  /**
   * macOS's Location prompt. With nothing holding the location (Customize's switch, the card
   * closed), a handle is taken just to ask, and let go once macOS answers, or 10 s on.
   */
  function requestAccess(): void {
    if (!hasLocation()) return
    if (!here.held()) {
      askingAccess = true
      syncHere()
      clearTimeout(accessTimer)
      accessTimer = setTimeout(stopAsking, ACCESS_ASK_SEC * 1000)
    }
    here.requestAccess()
  }

  function onHereChanged(): void {
    const status = here.held() ? here.status() : null
    if (status === 'found') lastAccess = 'granted'
    else if (status === 'denied') lastAccess = 'denied'
    else if (status === 'servicesOff') lastAccess = 'off'
    const fix = here.fix()
    if (fix && fix !== seenFix) {
      seenFix = fix
      onFix(fix)
    } else if (!here.busy()) {
      // The attempt's over with no new fix. With none at all, the card offers picking a start
      // rather than waiting; and Home is set only from the fix it asked for, never a later one.
      if (waitingForFix && !fix) {
        waitingForFix = false
        planning = false
      }
      if (homePending) {
        homePending = false
        syncHere()
      }
    }
    // Location refused or turned off with the card open: no start, so no Home row to offer.
    if (!fix && from.kind === 'here') dropHomePreview()
    emit()
  }

  function onFix(fix: Fix): void {
    void nameFix(fix)
    if (homePending) {
      homePending = false
      places().setHome(fix.at)
      syncHere()
    }
    kept.located(fix)
    if (to && from.kind === 'here' && (waitingForFix || plans === null)) runPlan(true)
    previewHome()
  }

  /** Home's row is let go: an answer on its way is dropped too. */
  function dropHomePreview(): void {
    homeSeq += 1
    homePreview = null
  }

  /**
   * Plans Home from the card's start, leaving now, while the card is open with a schedule, Home
   * and somewhere to start (a fix, or a picked start that isn't Home itself). Asked again when
   * the start, the fix or Home moves, and on each live read; never touches the card's own trips.
   */
  function previewHome(): void {
    const home = places().read().home
    const start = open && enabled() && home && schedule() === 'ready' ? startPoint(from) : null
    const fromHome = from.kind === 'place' && from.place.kind === 'home'
    if (!home || !start || fromHome) {
      dropHomePreview()
      return
    }
    const seq = ++homeSeq
    const query: PlanQuery = { from: start.at, to: pointOf(home), time: nowSec(), mode: 'depart' }
    void ask(query).then((reply) => {
      if (seq !== homeSeq || !open) return
      homePreview = homePreviewOf(reply ? reply.plans : null)
      emit()
    })
  }

  async function nameFix(fix: Fix): Promise<void> {
    const buildings = await options.buildings().catch((): Place[] => [])
    if (here.fix() !== fix) return
    named = { fix, name: hereName(fix.at, buildings, stopsNow()) }
    emit()
  }

  function stopsNow(): Place[] {
    const list = transit.stopList()
    return list ? stopPlaces(list) : []
  }

  /** Where a trip from `start` begins now; null while that's where the Mac is and there's no fix. */
  function startPoint(start: TripFrom): { at: LatLon; fix: Fix | null } | null {
    if (start.kind === 'place') return { at: pointOf(start.place), fix: null }
    const fix = here.fix()
    return fix ? { at: fix.at, fix: { at: fix.at, accuracyM: fix.accuracyM } } : null
  }

  function queryTime(asked: TripWhen): Pick<PlanQuery, 'time' | 'mode'> {
    return asked.kind === 'now'
      ? { time: nowSec(), mode: 'depart' }
      : { time: asked.time, mode: asked.kind }
  }

  /**
   * Asks the search the card's question. `announce` shows the card it's planning (a new
   * question); a live read's replan swaps the trips in quietly.
   */
  function runPlan(announce: boolean): void {
    const destination = to
    if (!destination) return
    const seq = ++planSeq
    if (schedule() !== 'ready') {
      // The card offers the download; it plans once the schedule's here.
      planning = false
      waitingForFix = false
      emit()
      return
    }
    const start = startPoint(from)
    if (!start) {
      if (from.kind === 'here' && here.held()) here.locate()
      waitingForFix = from.kind === 'here' && here.held() && here.status() === 'locating'
      planning = waitingForFix
      emit()
      return
    }
    waitingForFix = false
    if (announce) planning = true
    const startedFrom = from
    const query: PlanQuery = { from: start.at, to: pointOf(destination), ...queryTime(when) }
    emit()
    void ask(query).then((reply) => {
      if (seq !== planSeq) return
      planning = false
      plans = reply ? reply.plans : []
      noTrip = reply ? reply.noTrip : null
      problem = reply ? null : NO_PLAN
      planned = reply ? { query, start: startedFrom, fix: start.fix } : null
      emit()
    })
  }

  /**
   * A class picked as the destination plans to get there a few minutes before it starts; picking
   * "Leave now" for the same class afterwards is taken at its word.
   */
  function whenFor(destination: Place, asked: TripWhen, picked: boolean): TripWhen {
    const lesson = settings.get().widgets.nextClass ? nextClass : null
    if (!picked || asked.kind !== 'now' || destination.kind !== 'class') return asked
    if (!lesson || lesson.id !== destination.id) return asked
    const by = lesson.start - settings.get().trips.arriveEarlyMin * 60
    return by > nowSec() ? { kind: 'arrive', time: by } : asked
  }

  function plan(command: Extract<TripCommand, { kind: 'plan' }>): void {
    const picked = to?.id !== command.to.id
    const moved = JSON.stringify(from) !== JSON.stringify(command.from)
    to = command.to
    from = command.from
    when = whenFor(command.to, command.when, picked)
    // A new destination's trips are unknown; the same one's stay up, dimmed, while it replans.
    if (picked) {
      plans = null
      noTrip = null
    }
    problem = null
    planning = true
    // Recents are destinations picked, the latest first (a recent picked again moves up); the
    // next class has its own row (and its title mustn't be kept in the places file).
    if (to.kind !== 'class') places().addRecent(to)
    runPlan(true)
    if (moved) previewHome()
  }

  /** The plan the card showed, only while it's still at its index: a replan may have landed. */
  function keep(command: Extract<TripCommand, { kind: 'keep' }>): void {
    const picked = plans?.[command.index]
    if (!picked || !to || !planned) return
    const { leave, tripId } = planIdentity(picked)
    if (leave === command.leave && tripId === command.tripId) kept.keep(to, picked, planned)
  }

  async function refreshNextClass(): Promise<void> {
    const seq = ++classSeq
    if (!settings.get().widgets.nextClass) {
      nextClass = null
      emit()
      return
    }
    const found = demoOn && demo ? demo.nextClass : await options.classes.next().catch(() => null)
    if (seq !== classSeq) return
    nextClass = found && found.start > nowSec() ? found : null
    emit()
  }

  /** The card's question forgotten: what it shows as it opens next. */
  function resetCard(): void {
    planSeq += 1
    from = defaultFrom()
    to = null
    when = { kind: 'now' }
    plans = null
    noTrip = null
    planning = false
    problem = null
    waitingForFix = false
    planned = null
    dropHomePreview()
  }

  function openCard(): void {
    open = true
    syncHere()
    const fix = here.fix()
    if (!fix || now() - fix.takenAt > FRESH_FIX_SEC * 1000) here.locate()
    syncLive()
    void refreshNextClass()
    previewHome()
    emit()
  }

  function closeCard(): void {
    open = false
    resetCard()
    stopApple()
    syncHere()
    syncLive()
    emit()
  }

  function setHomeHere(): void {
    if (!hasLocation()) return
    const fix = here.fix()
    if (fix && now() - fix.takenAt <= FRESH_FIX_SEC * 1000) {
      places().setHome(fix.at)
      previewHome()
      emit()
      return
    }
    homePending = true
    syncHere()
    here.locate()
    emit()
  }

  /** Everything let go: trips turned off, the demo switched, or the app quitting. */
  function resetAll(): void {
    open = false
    homePending = false
    askingAccess = false
    clearTimeout(accessTimer)
    accessTimer = undefined
    resetCard()
    kept.end()
    stopApple()
    syncHere()
    syncLive()
  }

  /** A download started or finished: a new schedule's trips are asked for at once. */
  function onTransitChanged(): void {
    if (search.scheduleChanged() && schedule() === 'ready') {
      if (to) runPlan(plans === null)
      kept.live()
      previewHome()
    }
    emit()
  }

  syncTripsOn()

  const unsubscribeSettings = settings.subscribe(() => {
    syncTripsOn()
    if (!enabled()) resetAll()
    else if (settings.get().widgets.nextClass !== nextClassOn && open) void refreshNextClass()
    nextClassOn = settings.get().widgets.nextClass
    emit()
  })
  const unsubscribeTransit = transit.subscribe(onTransitChanged)
  const unsubscribeLive = transit.onLive(() => {
    if (!enabled()) return
    if (open && to && plans !== null) runPlan(false)
    if (open) previewHome()
    kept.live()
  })

  state = compute()

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    command(command) {
      if (STARTING.has(command.kind) && !enabled()) return
      switch (command.kind) {
        case 'open':
          return openCard()
        case 'close':
          return closeCard()
        case 'plan':
          return plan(command)
        case 'keep':
          return keep(command)
        case 'unkeep':
          return kept.end()
        case 'setHomeHere':
          return setHomeHere()
        case 'clearHome':
          places().clearHome()
          if (from.kind === 'place' && from.place.kind === 'home') from = defaultFrom()
          dropHomePreview()
          break
        case 'save':
          places().save(command.place, command.name)
          break
        case 'rename':
          places().rename(command.id, command.name)
          break
        case 'remove':
          places().remove(command.id)
          break
        case 'clearRecents':
          places().clearRecents()
          break
        case 'downloadSchedule':
          // The same yes as Customize › Next bus: the same download.
          if (!demoOn) void transit.download()
          break
        case 'requestAccess':
          return requestAccess()
        case 'openLocationSettings':
          // System Settings is opened by the main process's wiring, not here.
          return
      }
      emit()
    },
    async searchLocal(text) {
      const { home, saved, recents } = places().read()
      const buildings = await options.buildings().catch((): Place[] => [])
      return searchLocal(text, {
        home,
        saved,
        recents,
        nextClass: state.nextClass,
        buildings,
        stops: stopsNow()
      })
    },
    async searchApple(text) {
      if (!enabled() || [...text.trim()].length < MIN_APPLE_TEXT_CHARS) return []
      apple ??= demoOn && demo ? demo.apple() : (options.apple?.() ?? null)
      if (!apple) return []
      // Its helper runs while searches come; a minute without one, it's stopped.
      clearTimeout(appleIdle)
      appleIdle = setTimeout(stopApple, APPLE_IDLE_SEC * 1000)
      return apple.search(text).catch((): Place[] => [])
    },
    setVisible(next) {
      if (next === visible) return
      visible = next
      syncLive()
      kept.syncChecks()
    },
    refresh() {
      kept.wake()
      emit()
    },
    hasDemo: demo !== null,
    isDemoEnabled: () => demoOn,
    setDemoEnabled(on) {
      if (!demo || on === demoOn) return
      const wasOpen = open
      resetAll()
      demoOn = on
      lastAccess = null
      search.scheduleChanged()
      demoPlaces = on ? memoryPlaces(demo.home) : null
      from = defaultFrom()
      if (wasOpen) openCard()
      emit()
    },
    dispose() {
      if (disposed) return
      resetAll()
      disposed = true
      transit.wantLive(false)
      search.dispose()
      unsubscribeSettings()
      unsubscribeTransit()
      unsubscribeLive()
      listeners.clear()
    }
  }
}
