// The weather pill: where the Mac is (the Reminders helper's location mode, shared with the trip
// planner through sharedLocation.ts; this service holds its handle only while weather is on) and
// Open-Meteo's forecast there, read every 15 minutes only while the pill can be seen. The
// position and place stay in memory: never logged, never saved.
import type { SettingsStore } from '../settings/store'
import type { LocationSource } from './location'
import type { WeatherSource } from './openMeteo'
import { movedFar, roundPosition } from './position'
import type { LatLon, LocationAccess, WeatherReading, WeatherState } from './types'

/** Open-Meteo's current conditions change every 15 minutes. */
export const POLL_SEC = 900
/** After a failed read: these waits, then every 15 minutes again. */
export const BACKOFF_SEC = [60, 120, 300]
/** A retry asked for by clicking the pill: at most this often, however often it's clicked. */
export const RETRY_GAP_SEC = 10

const NO_POSITION = 'This Mac’s location couldn’t be found.'
const NO_FORECAST = 'The weather couldn’t be read from Open-Meteo.'

export interface WeatherService {
  get(): WeatherState
  subscribe(listener: (state: WeatherState) => void): () => void
  /** The pill can be seen: the Focus Screen is up and not dimmed. */
  setVisible(visible: boolean): void
  /** After waking: reads now if the pill is showing. */
  refresh(): void
  /** The pill clicked while the weather couldn't be read. */
  retry(): void
  /** macOS's Location prompt, if it hasn't been answered. */
  requestAccess(): void
  /** Dev builds: a made-up Tempe day, with no helper and no network. */
  readonly hasDemo: boolean
  isDemoEnabled(): boolean
  setDemoEnabled(on: boolean): void
  dispose(): void
}

export interface WeatherServiceOptions {
  settings: Pick<SettingsStore, 'get' | 'subscribe'>
  /** null where there's no location source (not a Mac, or the helper isn't built). */
  startLocation: (() => LocationSource) | null
  source: WeatherSource
  /** Dev builds only. */
  demo: { location: () => LocationSource; source: WeatherSource } | null
  /** Milliseconds, like Date.now. */
  now?: () => number
}

export function createWeatherService(options: WeatherServiceOptions): WeatherService {
  const { settings, demo } = options
  const now = options.now ?? Date.now
  const listeners = new Set<(state: WeatherState) => void>()

  let demoOn = false
  let visible = false
  let disposed = false
  let location: LocationSource | null = null
  let unlisten: (() => void) | null = null
  let access: LocationAccess | null = null
  /** Asked macOS already since weather was turned on: its prompt shows once anyway. */
  let asked = false
  let place: string | null = null
  /** The rounded position the place was looked up at; null to look it up on the next read. */
  let placeAt: LatLon | null = null
  let reading: WeatherReading | null = null
  let problem: string | null = null
  let failures = 0
  /** When a read last started (ms); null to read as soon as the pill shows. */
  let lastAttempt: number | null = null
  let inFlight = false
  /** Bumped whenever the location source goes, so a read under way is dropped. */
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const supported = (): boolean => options.startLocation !== null || (demoOn && demo !== null)
  const enabled = (): boolean => !disposed && supported() && settings.get().widgets.weather
  const source = (): WeatherSource => (demoOn && demo ? demo.source : options.source)
  // 'off' still reads: Location Services coming back on says nothing, so only a try finds out.
  const active = (): boolean =>
    enabled() && visible && location !== null && (access === 'granted' || access === 'off')

  function compute(): WeatherState {
    return { supported: supported(), access, place, reading, problem, demo: demoOn }
  }

  let state = compute()

  function emit(): void {
    const next = compute()
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    for (const listener of listeners) listener(state)
  }

  /** Everything about where the Mac is, gone: weather off, or Location taken away. */
  function forgetPlace(): void {
    place = null
    placeAt = null
    reading = null
    problem = null
  }

  function onAccess(next: LocationAccess): void {
    access = next
    if (next === 'notDetermined' && !asked) {
      asked = true
      location?.requestAccess()
    }
    if (next === 'granted') {
      lastAttempt = null
    } else {
      // A read under way mustn't bring back what Location was just taken from.
      generation += 1
      forgetPlace()
    }
    if (next === 'denied') checkServices()
    emit()
    schedule()
  }

  /**
   * CoreLocation says "denied" both when the app is refused and when Location Services is off
   * for the whole Mac; only the helper's locate tells them apart (no fix is taken either way).
   */
  function checkServices(): void {
    const from = location
    if (!from) return
    void from.locate().then((located) => {
      if (location !== from || access !== 'denied') return
      if (!located.ok && located.reason === 'servicesOff') {
        access = 'off'
        emit()
        schedule()
      }
    })
  }

  function startLocation(): void {
    const started = demoOn && demo ? demo.location() : (options.startLocation?.() ?? null)
    if (!started) return
    location = started
    asked = false
    unlisten = started.onAccess((next) => {
      if (location === started) onAccess(next)
    })
    const known = started.access()
    if (known) onAccess(known)
  }

  function stopLocation(): void {
    clearTimeout(timer)
    timer = undefined
    generation += 1
    unlisten?.()
    unlisten = null
    location?.stop()
    location = null
    access = null
    forgetPlace()
    failures = 0
    lastAttempt = null
  }

  /** Starts or stops the helper as weather is turned on or off. */
  function sync(): void {
    const want = enabled()
    if (want && !location) startLocation()
    if (!want && location) stopLocation()
  }

  function schedule(): void {
    clearTimeout(timer)
    timer = undefined
    if (!active() || inFlight) return
    const waitSec =
      failures === 0 || failures > BACKOFF_SEC.length
        ? POLL_SEC
        : (BACKOFF_SEC[failures - 1] ?? POLL_SEC)
    const delay = lastAttempt === null ? 0 : Math.max(0, lastAttempt + waitSec * 1000 - now())
    timer = setTimeout(() => void read(), delay)
  }

  /** The place's name for a rounded position, when the Mac has moved far enough to ask. */
  async function lookUpPlace(
    from: LocationSource,
    rounded: LatLon
  ): Promise<{ name: string | null } | null> {
    if (!movedFar(placeAt, rounded)) return { name: place }
    try {
      return { name: await from.placeName(rounded) }
    } catch {
      return null
    }
  }

  async function read(): Promise<void> {
    const from = location
    if (inFlight || !from) return
    inFlight = true
    lastAttempt = now()
    const asked = generation
    const finish = (): void => {
      inFlight = false
      if (asked === generation) emit()
      schedule()
    }

    const located = await from.locate()
    if (asked !== generation) return finish()
    if (!located.ok) {
      failures += 1
      if (located.reason === 'servicesOff') {
        access = 'off'
        forgetPlace()
      } else {
        problem = NO_POSITION
      }
      return finish()
    }
    if (access === 'off') access = 'granted'

    const rounded = roundPosition(located.position)
    const [forecast, named] = await Promise.all([
      source()
        .read(rounded)
        .catch(() => null),
      lookUpPlace(from, rounded)
    ])
    if (asked !== generation) return finish()
    // A failed lookup after a move shows no place, never the last town; the next read asks again.
    place = named?.name ?? null
    placeAt = named ? rounded : null
    if (forecast) {
      reading = { ...forecast, readAt: Math.floor(now() / 1000) }
      problem = null
      failures = 0
    } else {
      problem = NO_FORECAST
      failures += 1
    }
    finish()
  }

  const unsubscribe = settings.subscribe(() => {
    sync()
    emit()
    schedule()
  })
  sync()
  state = compute()

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setVisible(next) {
      if (next === visible) return
      visible = next
      schedule()
    },
    refresh() {
      if (inFlight) return
      lastAttempt = null
      schedule()
    },
    retry() {
      if (inFlight || !active()) return
      if (lastAttempt !== null && now() - lastAttempt < RETRY_GAP_SEC * 1000) return
      lastAttempt = null
      schedule()
    },
    requestAccess() {
      location?.requestAccess()
    },
    hasDemo: demo !== null,
    isDemoEnabled: () => demoOn,
    setDemoEnabled(on) {
      if (!demo || on === demoOn) return
      stopLocation()
      demoOn = on
      sync()
      emit()
      schedule()
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      stopLocation()
      listeners.clear()
    }
  }
}
