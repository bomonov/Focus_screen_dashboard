// One location helper for the weather pill and the trip planner: both hold a handle, the helper
// runs while either does. The source is a fake, so nothing here needs a helper or a position.
import { describe, expect, it } from 'vitest'
import type { LocateResult, LocationSource } from './location'
import { sharedLocation } from './sharedLocation'
import type { LatLon, LocationAccess } from './types'

const HERE: LatLon = { lat: 33.4255, lon: -111.94 }
const FIX: LocateResult = { ok: true, position: HERE, accuracyM: 40 }

interface FakeSource {
  source: LocationSource
  stops: number
  requested: number
  locates: number
  places: LatLon[]
  /** Answers the oldest locate still waiting. */
  answer(result: LocateResult): void
  say(access: LocationAccess): void
  listening(): number
  current: LocationAccess | null
}

function fakeSource(): FakeSource {
  const listeners = new Set<(access: LocationAccess) => void>()
  const waiting: ((result: LocateResult) => void)[] = []
  const fake: FakeSource = {
    stops: 0,
    requested: 0,
    locates: 0,
    places: [],
    current: null,
    answer: (result) => waiting.shift()?.(result),
    say(access) {
      fake.current = access
      for (const listener of listeners) listener(access)
    },
    listening: () => listeners.size,
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
        return new Promise((resolve) => waiting.push(resolve))
      },
      placeName(position) {
        fake.places.push(position)
        return Promise.resolve('Tempe')
      },
      stop() {
        fake.stops++
      }
    }
  }
  return fake
}

function setup(): { share: () => LocationSource; made: FakeSource[] } {
  const made: FakeSource[] = []
  const share = sharedLocation(() => {
    const fake = fakeSource()
    made.push(fake)
    return fake.source
  })
  return { share, made }
}

describe('sharedLocation', () => {
  it('starts nothing until the first handle, and one source for two handles', () => {
    const { share, made } = setup()
    expect(made).toHaveLength(0)
    share()
    share()
    expect(made).toHaveLength(1)
  })

  it('stops the source only once both handles have stopped', () => {
    const { share, made } = setup()
    const weather = share()
    const trips = share()
    weather.stop()
    expect(made[0]?.stops).toBe(0)
    trips.stop()
    expect(made[0]?.stops).toBe(1)
  })

  it('counts a handle’s stop once, however often it is called', () => {
    const { share, made } = setup()
    const weather = share()
    const trips = share()
    weather.stop()
    weather.stop()
    weather.stop()
    expect(made[0]?.stops).toBe(0)
    trips.stop()
    trips.stop()
    expect(made[0]?.stops).toBe(1)
  })

  it('starts a fresh source for a handle taken after the last one stopped', () => {
    const { share, made } = setup()
    share().stop()
    expect(made).toHaveLength(1)
    const again = share()
    expect(made).toHaveLength(2)
    again.requestAccess()
    expect(made[0]?.requested).toBe(0)
    expect(made[1]?.requested).toBe(1)
  })

  it('keeps the source while a handle taken later is still holding it', () => {
    const { share, made } = setup()
    const first = share()
    first.stop()
    const second = share()
    const third = share()
    second.stop()
    expect(made[1]?.stops).toBe(0)
    third.stop()
    expect(made[1]?.stops).toBe(1)
    expect(made).toHaveLength(2)
  })

  it('doesn’t count a handle when the source fails to start', () => {
    let attempts = 0
    const fake = fakeSource()
    const share = sharedLocation(() => {
      attempts++
      if (attempts === 1) throw new Error('no helper')
      return fake.source
    })
    expect(() => share()).toThrow('no helper')
    const handle = share()
    handle.stop()
    expect(attempts).toBe(2)
    expect(fake.stops).toBe(1)
  })

  it('sends access, requests, places and fixes to the shared source', async () => {
    const { share, made } = setup()
    const weather = share()
    const trips = share()
    expect(weather.access()).toBeNull()
    made[0]?.say('granted')
    expect(weather.access()).toBe('granted')
    expect(trips.access()).toBe('granted')
    trips.requestAccess()
    expect(made[0]?.requested).toBe(1)
    expect(await weather.placeName(HERE)).toBe('Tempe')
    expect(made[0]?.places).toEqual([HERE])
    const fix = trips.locate()
    made[0]?.answer(FIX)
    expect(await fix).toEqual(FIX)
  })

  it('hands each handle its own access listeners', () => {
    const { share, made } = setup()
    const weather = share()
    const trips = share()
    const weatherHeard: LocationAccess[] = []
    const tripsHeard: LocationAccess[] = []
    weather.onAccess((access) => weatherHeard.push(access))
    trips.onAccess((access) => tripsHeard.push(access))
    made[0]?.say('notDetermined')
    expect(weatherHeard).toEqual(['notDetermined'])
    expect(tripsHeard).toEqual(['notDetermined'])
    // Weather going away takes its listener with it; the trip's keeps hearing.
    weather.stop()
    made[0]?.say('granted')
    expect(weatherHeard).toEqual(['notDetermined'])
    expect(tripsHeard).toEqual(['notDetermined', 'granted'])
  })

  it('lets a listener be dropped without touching the other handle’s', () => {
    const { share, made } = setup()
    const weather = share()
    const trips = share()
    const weatherHeard: LocationAccess[] = []
    const tripsHeard: LocationAccess[] = []
    const stopListening = weather.onAccess((access) => weatherHeard.push(access))
    trips.onAccess((access) => tripsHeard.push(access))
    stopListening()
    made[0]?.say('denied')
    expect(weatherHeard).toEqual([])
    expect(tripsHeard).toEqual(['denied'])
  })

  it('leaves no listener on the source once every handle has stopped', () => {
    const { share, made } = setup()
    const weather = share()
    const trips = share()
    weather.onAccess(() => undefined)
    trips.onAccess(() => undefined)
    expect(made[0]?.listening()).toBe(2)
    weather.stop()
    trips.stop()
    expect(made[0]?.listening()).toBe(0)
  })

  it('shares one fix between locates asked while one is under way, and asks again after', async () => {
    const { share, made } = setup()
    const weather = share()
    const trips = share()
    const first = weather.locate()
    const second = trips.locate()
    expect(made[0]?.locates).toBe(1)
    made[0]?.answer(FIX)
    expect(await first).toEqual(FIX)
    expect(await second).toEqual(FIX)
    const later = trips.locate()
    expect(made[0]?.locates).toBe(2)
    made[0]?.answer({ ok: false, reason: 'failed' })
    expect(await later).toEqual({ ok: false, reason: 'failed' })
  })

  it('doesn’t hand a fix under way on a stopped source to the next source’s handle', async () => {
    const { share, made } = setup()
    const old = share()
    old.locate().catch(() => undefined)
    old.stop()
    const fresh = share()
    const fix = fresh.locate()
    expect(made).toHaveLength(2)
    expect(made[1]?.locates).toBe(1)
    made[1]?.answer(FIX)
    expect(await fix).toEqual(FIX)
  })

  it('leaves a stopped handle answering "nothing" without reaching the source', async () => {
    const { share, made } = setup()
    const weather = share()
    const trips = share()
    weather.stop()
    expect(weather.access()).toBeNull()
    weather.requestAccess()
    expect(made[0]?.requested).toBe(0)
    expect(await weather.locate()).toEqual({ ok: false, reason: 'failed' })
    expect(made[0]?.locates).toBe(0)
    await expect(weather.placeName(HERE)).rejects.toThrow()
    expect(made[0]?.places).toEqual([])
    // A listener added after stopping is never kept.
    const heard: LocationAccess[] = []
    const off = weather.onAccess((access) => heard.push(access))
    expect(made[0]?.listening()).toBe(0)
    made[0]?.say('granted')
    off()
    expect(heard).toEqual([])
    trips.stop()
  })
})
