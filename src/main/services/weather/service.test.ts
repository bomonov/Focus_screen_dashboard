import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, type Settings } from '../settings/schema'
import type { LocateResult, LocationSource } from './location'
import type { WeatherSource } from './openMeteo'
import { createWeatherService, type WeatherService } from './service'
import type { Forecast, LatLon, LocationAccess } from './types'

const FORECAST: Forecast = {
  tempC: 36.7,
  feelsLikeC: 38.1,
  highC: 38.3,
  lowC: 23.4,
  kind: 'clear',
  words: 'Sunny',
  isDay: true,
  hours: []
}
const HERE = { lat: 33.42456, lon: -111.93349 }

function settingsStore(weather: boolean): {
  get(): Settings
  subscribe(listener: (settings: Settings) => void): () => void
  setWeather(on: boolean): void
} {
  const base = defaultSettings()
  let current: Settings = { ...base, widgets: { ...base.widgets, weather } }
  const listeners = new Set<(settings: Settings) => void>()
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setWeather(on) {
      current = { ...current, widgets: { ...current.widgets, weather: on } }
      for (const listener of listeners) listener(current)
    }
  }
}

interface FakeLocation {
  current: LocationAccess | null
  requested: number
  stopped: number
  locates: number
  places: LatLon[]
  next: LocateResult
  placeAnswer: string | null | Error
  setAccess(access: LocationAccess): void
  source: LocationSource
}

function fakeLocation(initial: LocationAccess | null = 'granted'): FakeLocation {
  const listeners = new Set<(access: LocationAccess) => void>()
  const fake: FakeLocation = {
    current: initial,
    requested: 0,
    stopped: 0,
    locates: 0,
    places: [],
    next: { ok: true, position: HERE, accuracyM: 50 },
    placeAnswer: 'Tempe',
    setAccess(access) {
      fake.current = access
      for (const listener of listeners) listener(access)
    },
    source: {
      access: () => fake.current,
      onAccess(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      requestAccess() {
        fake.requested++
      },
      locate() {
        fake.locates++
        return Promise.resolve(fake.next)
      },
      placeName(position) {
        fake.places.push(position)
        const answer = fake.placeAnswer
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
      },
      stop() {
        fake.stopped++
      }
    }
  }
  return fake
}

interface FakeWeather {
  reads: LatLon[]
  answer: Forecast | null
  /** The held read's resolver, while `holding` keeps reads waiting to be answered by hand. */
  hold: ((forecast: Forecast | null) => void) | null
  holding: boolean
  source: WeatherSource
}

function fakeWeather(): FakeWeather {
  const fake: FakeWeather = {
    reads: [],
    answer: FORECAST,
    hold: null,
    holding: false,
    source: {
      read(position) {
        fake.reads.push(position)
        if (fake.holding) {
          return new Promise<Forecast | null>((resolve) => {
            fake.hold = resolve
          })
        }
        return Promise.resolve(fake.answer)
      }
    }
  }
  return fake
}

interface Rig {
  service: WeatherService
  store: ReturnType<typeof settingsStore>
  location: FakeLocation
  weather: FakeWeather
  starts: () => number
}

function rig({
  on = true,
  access = 'granted' as LocationAccess | null,
  visible = true,
  hasHelper = true
} = {}): Rig {
  const store = settingsStore(on)
  const location = fakeLocation(access)
  const weather = fakeWeather()
  let starts = 0
  const demoLocation = fakeLocation('granted')
  demoLocation.placeAnswer = 'Tempe'
  const service = createWeatherService({
    settings: store,
    startLocation: hasHelper
      ? () => {
          starts++
          return location.source
        }
      : null,
    source: weather.source,
    demo: { location: () => demoLocation.source, source: fakeWeather().source }
  })
  service.setVisible(visible)
  return { service, store, location, weather, starts: () => starts }
}

/** Lets the reads under way finish. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}
async function minutes(count: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(count * 60_000)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 9, 27, 21, 45))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createWeatherService', () => {
  it('does nothing while off', async () => {
    const { service, starts, weather } = rig({ on: false })
    await minutes(30)
    expect(starts()).toBe(0)
    expect(weather.reads).toHaveLength(0)
    expect(service.get().access).toBeNull()
  })

  it('turning on starts the helper and asks once when not determined', async () => {
    const { service, store, starts, location } = rig({ on: false, access: 'notDetermined' })
    store.setWeather(true)
    await settle()
    expect(starts()).toBe(1)
    expect(location.requested).toBe(1)
    location.setAccess('notDetermined')
    expect(location.requested).toBe(1)
    expect(service.get().access).toBe('notDetermined')
  })

  it('reads at once when visible, then every 15 minutes', async () => {
    const { service, weather } = rig()
    await settle()
    expect(weather.reads).toHaveLength(1)
    expect(service.get().reading).toMatchObject({
      tempC: 36.7,
      readAt: Date.UTC(2026, 9, 27, 21, 45) / 1000
    })
    expect(service.get().place).toBe('Tempe')
    await vi.advanceTimersByTimeAsync(899_000)
    expect(weather.reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(weather.reads).toHaveLength(2)
  })

  it('sends only the rounded position', async () => {
    const { weather, location } = rig()
    await settle()
    expect(weather.reads[0]).toEqual({ lat: 33.42, lon: -111.93 })
    expect(location.places[0]).toEqual({ lat: 33.42, lon: -111.93 })
  })

  it('doesn’t read while hidden', async () => {
    const { service, weather } = rig({ visible: false })
    await minutes(16)
    expect(weather.reads).toHaveLength(0)
    service.setVisible(true)
    await settle()
    expect(weather.reads).toHaveLength(1)
    service.setVisible(false)
    await minutes(20)
    expect(weather.reads).toHaveLength(1)
    service.setVisible(true)
    await settle()
    expect(weather.reads).toHaveLength(2)
  })

  it('backs off after failures', async () => {
    const { weather } = rig()
    weather.answer = null
    await settle()
    expect(weather.reads).toHaveLength(1)
    await minutes(1)
    expect(weather.reads).toHaveLength(2)
    await minutes(2)
    expect(weather.reads).toHaveLength(3)
    await minutes(5)
    expect(weather.reads).toHaveLength(4)
    await minutes(14)
    expect(weather.reads).toHaveLength(4)
    await minutes(1)
    expect(weather.reads).toHaveLength(5)
  })

  it('keeps the last good reading after a failure and sets problem', async () => {
    const { service, weather } = rig()
    await settle()
    weather.answer = null
    await minutes(15)
    expect(service.get().reading?.tempC).toBe(36.7)
    expect(service.get().problem).toBeTruthy()
    weather.answer = FORECAST
    await minutes(1)
    expect(service.get().problem).toBeNull()
  })

  it('looks the place up again only after 1 km', async () => {
    const { service, location } = rig()
    await settle()
    expect(location.places).toHaveLength(1)
    location.next = { ok: true, position: { lat: 33.4246, lon: -111.9395 }, accuracyM: 50 }
    await minutes(15)
    expect(location.places).toHaveLength(1)
    location.next = { ok: true, position: { lat: 33.306, lon: -111.841 }, accuracyM: 50 }
    location.placeAnswer = 'Chandler'
    await minutes(15)
    expect(location.places).toHaveLength(2)
    expect(service.get().place).toBe('Chandler')
  })

  it('a failed place lookup shows no place and retries', async () => {
    const { service, location } = rig()
    await settle()
    location.next = { ok: true, position: { lat: 33.306, lon: -111.841 }, accuracyM: 50 }
    location.placeAnswer = new Error('offline')
    await minutes(15)
    expect(service.get().place).toBeNull()
    expect(service.get().reading).not.toBeNull()
    location.placeAnswer = 'Chandler'
    await minutes(15)
    expect(location.places).toHaveLength(3)
    expect(service.get().place).toBe('Chandler')
  })

  it('a place that has no name isn’t asked again until the Mac moves', async () => {
    const { service, location } = rig()
    location.placeAnswer = null
    await settle()
    await minutes(15)
    expect(location.places).toHaveLength(1)
    expect(service.get().place).toBeNull()
  })

  it('servicesOff from locate shows access off', async () => {
    const { service, weather, location } = rig()
    await settle()
    location.next = { ok: false, reason: 'servicesOff' }
    await minutes(15)
    expect(service.get().access).toBe('off')
    expect(service.get().reading).toBeNull()
    expect(service.get().place).toBeNull()
    expect(weather.reads).toHaveLength(1)
    // Turned back on: the next try finds it.
    location.next = { ok: true, position: HERE, accuracyM: 50 }
    await minutes(1)
    expect(service.get().access).toBe('granted')
    expect(service.get().reading).not.toBeNull()
  })

  it('access turning denied clears the reading', async () => {
    const { service, location, weather } = rig()
    await settle()
    location.setAccess('denied')
    expect(service.get().access).toBe('denied')
    expect(service.get().reading).toBeNull()
    expect(service.get().place).toBeNull()
    await minutes(30)
    expect(weather.reads).toHaveLength(1)
    location.setAccess('granted')
    await settle()
    expect(weather.reads).toHaveLength(2)
  })

  it('drops a read that finishes after weather is turned off', async () => {
    const { service, store, weather, location } = rig()
    weather.holding = true
    await settle()
    expect(weather.reads).toHaveLength(1)
    store.setWeather(false)
    expect(location.stopped).toBe(1)
    weather.hold?.(FORECAST)
    await settle()
    expect(service.get()).toMatchObject({ access: null, place: null, reading: null })
    // Turned on again: the late answer mustn't come back with it, before a new read lands.
    weather.holding = false
    store.setWeather(true)
    expect(service.get()).toMatchObject({ access: 'granted', place: null, reading: null })
  })

  it('retry reads now but at most every 10 s', async () => {
    const { service, weather } = rig()
    weather.answer = null
    await settle()
    service.retry()
    await settle()
    expect(weather.reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10_000)
    service.retry()
    await settle()
    expect(weather.reads).toHaveLength(2)
  })

  it('demo needs no location helper', async () => {
    const { service } = rig({ hasHelper: false })
    expect(service.get().supported).toBe(false)
    service.setDemoEnabled(true)
    await settle()
    expect(service.get()).toMatchObject({ supported: true, demo: true, place: 'Tempe' })
    expect(service.get().reading).not.toBeNull()
  })

  it('supported is false with no location source and no demo', async () => {
    const { service, weather } = rig({ hasHelper: false })
    await minutes(15)
    expect(service.get().supported).toBe(false)
    expect(weather.reads).toHaveLength(0)
  })

  it('stops the helper when it’s disposed', () => {
    const { service, location } = rig()
    service.dispose()
    expect(location.stopped).toBe(1)
  })

  it('tells Location Services off for the whole Mac from a denied app', async () => {
    // CoreLocation says "denied" for both; only the helper's locate can tell them apart.
    const { service, location, weather } = rig({ access: 'notDetermined' })
    location.next = { ok: false, reason: 'servicesOff' }
    location.setAccess('denied')
    await settle()
    expect(service.get().access).toBe('off')
    expect(weather.reads).toHaveLength(0)
  })

  it('keeps a denied app denied', async () => {
    const { service, location } = rig({ access: 'notDetermined' })
    location.next = { ok: false, reason: 'access' }
    location.setAccess('denied')
    await settle()
    expect(service.get().access).toBe('denied')
  })

  it('drops a read that lands after Location is taken away', async () => {
    const { service, weather, location } = rig()
    weather.holding = true
    await settle()
    location.setAccess('denied')
    weather.hold?.(FORECAST)
    await settle()
    expect(service.get()).toMatchObject({ reading: null, place: null })
    // Given back: nothing from before shows until a new read lands.
    weather.holding = true
    location.setAccess('granted')
    expect(service.get()).toMatchObject({ access: 'granted', reading: null, place: null })
  })
})
