import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { openPlaces } from './places'
import type { Place } from './types'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function placesFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'trip-places-'))
  dirs.push(dir)
  return join(dir, 'trip-places.json')
}

const place = (id: string, name: string, lat: number, lon: number): Place => ({
  id,
  kind: 'apple',
  name,
  detail: 'E Apache Blvd, Tempe',
  lat,
  lon
})

describe('openPlaces', () => {
  it('starts empty without a file', () => {
    expect(openPlaces(placesFile()).read()).toEqual({ home: null, saved: [], recents: [] })
  })

  it('keeps Home, saved places and recents across a restart', () => {
    const path = placesFile()
    const store = openPlaces(path)
    store.setHome([33.4148, -111.9093])
    const saved = store.save(place('apple:1', 'Some Apartments', 33.42, -111.92), '  Alex’s  ')
    store.addRecent(place('stop:10235', 'Rural Rd & Terrace Rd', 33.41, -111.93))

    expect(saved).toMatchObject({ kind: 'saved', name: 'Alex’s', detail: 'E Apache Blvd, Tempe' })
    expect(saved.id).toMatch(/^saved:/)
    const again = openPlaces(path).read()
    expect(again).toEqual(store.read())
    expect(again.home).toEqual({
      id: 'home',
      kind: 'home',
      name: 'Home',
      detail: '',
      lat: 33.4148,
      lon: -111.9093
    })
    expect(again.saved).toEqual([saved])
    expect(again.recents).toEqual([
      { ...place('stop:10235', 'Rural Rd & Terrace Rd', 33.41, -111.93), kind: 'recent' }
    ])
  })

  it('clears Home', () => {
    const path = placesFile()
    const store = openPlaces(path)
    store.setHome([33.4, -111.9])
    store.clearHome()
    expect(openPlaces(path).read().home).toBeNull()
  })

  it('names saved places in at most 60 characters, falling back to the place’s own name', () => {
    const store = openPlaces(placesFile())
    const long = store.save(place('apple:1', 'Gym', 33.42, -111.92), 'x'.repeat(80))
    expect(long.name).toBe('x'.repeat(60))
    const unnamed = store.save(place('apple:2', 'Trader Joe’s', 33.43, -111.94), '   ')
    expect(unnamed.name).toBe('Trader Joe’s')
  })

  it('renames and removes saved places', () => {
    const path = placesFile()
    const store = openPlaces(path)
    const gym = store.save(place('apple:1', 'Gym', 33.42, -111.92), 'Gym')
    const work = store.save(place('apple:2', 'Work', 33.43, -111.94), 'Work')
    store.rename(gym.id, ' The gym ')
    store.rename(work.id, '   ')
    expect(
      openPlaces(path)
        .read()
        .saved.map((p) => p.name)
    ).toEqual(['The gym', 'Work'])
    store.remove(gym.id)
    expect(
      openPlaces(path)
        .read()
        .saved.map((p) => p.id)
    ).toEqual([work.id])
  })

  it('puts a recent first, once, and keeps ten', () => {
    const store = openPlaces(placesFile())
    for (let i = 0; i < 12; i++)
      store.addRecent(place(`apple:${i}`, `Place ${i}`, 33 + i * 0.01, -112))
    expect(store.read().recents.map((p) => p.id)).toEqual(
      [11, 10, 9, 8, 7, 6, 5, 4, 3, 2].map((i) => `apple:${i}`)
    )
    // Picked again: moved to the front, not listed twice.
    store.addRecent(place('apple:5', 'Place 5', 33.05, -112))
    expect(
      store
        .read()
        .recents.map((p) => p.id)
        .slice(0, 2)
    ).toEqual(['apple:5', 'apple:11'])
    expect(store.read().recents).toHaveLength(10)
  })

  it('puts a recent picked again first', () => {
    const store = openPlaces(placesFile())
    store.addRecent(place('apple:a', 'A', 33.41, -111.9))
    store.addRecent(place('apple:b', 'B', 33.42, -111.9))
    const [, older] = store.read().recents
    if (older) store.addRecent(older)
    expect(store.read().recents.map((p) => p.id)).toEqual(['apple:a', 'apple:b'])
    expect(store.read().recents.map((p) => p.kind)).toEqual(['recent', 'recent'])
  })

  it('takes a place out of the recents as it’s saved, and keeps a saved place out', () => {
    const store = openPlaces(placesFile())
    store.addRecent(place('apple:a', 'Gym', 33.41, -111.9))
    store.addRecent(place('apple:b', 'Work', 33.42, -111.9))
    const [, gym] = store.read().recents
    if (gym) store.save(gym, 'The gym')
    expect(store.read().recents.map((p) => p.id)).toEqual(['apple:b'])
    // The same place found another way (~11 m off), saved: one listing, under saved places.
    store.save(place('building:W', 'Work building', 33.4201, -111.9), 'Work')
    expect(store.read().recents).toEqual([])
    store.addRecent(place('apple:c', 'Gym again', 33.4101, -111.9))
    expect(store.read().recents).toEqual([])
  })

  it('counts a recent within 25 m of another as the same place', () => {
    const store = openPlaces(placesFile())
    store.addRecent(place('apple:a', 'Tempe Marketplace', 33.43, -111.9))
    // ~11 m north: the same place found another way.
    store.addRecent(place('building:X', 'Marketplace', 33.4301, -111.9))
    store.addRecent(place('apple:b', 'Far away', 33.44, -111.9))
    expect(store.read().recents.map((p) => p.id)).toEqual(['apple:b', 'building:X'])
  })

  it('leaves Home and saved places out of recents: they’re listed already', () => {
    const store = openPlaces(placesFile())
    store.setHome([33.4, -111.9])
    const home = store.read().home
    if (home) store.addRecent(home)
    store.addRecent(store.save(place('apple:1', 'Gym', 33.42, -111.92), 'Gym'))
    expect(store.read().recents).toEqual([])
  })

  it('clears recents and removes one', () => {
    const path = placesFile()
    const store = openPlaces(path)
    store.addRecent(place('apple:1', 'One', 33.41, -111.9))
    store.addRecent(place('apple:2', 'Two', 33.42, -111.9))
    store.remove('apple:1')
    expect(store.read().recents.map((p) => p.id)).toEqual(['apple:2'])
    store.clearRecents()
    expect(openPlaces(path).read().recents).toEqual([])
  })

  it('ignores a position that makes no sense', () => {
    const store = openPlaces(placesFile())
    store.setHome([Number.NaN, -111.9])
    store.addRecent(place('apple:1', 'Nowhere', 200, -111.9))
    expect(store.read()).toEqual({ home: null, saved: [], recents: [] })
  })

  it('reads a broken file as empty', () => {
    const path = placesFile()
    writeFileSync(path, 'not json {')
    expect(openPlaces(path).read()).toEqual({ home: null, saved: [], recents: [] })
    writeFileSync(path, JSON.stringify({ home: 'here', saved: 'x', recents: [1, null] }))
    expect(openPlaces(path).read()).toEqual({ home: null, saved: [], recents: [] })
  })

  it('keeps the good entries of a damaged file and drops the rest', () => {
    const path = placesFile()
    const good = { id: 'saved:1', name: 'Gym', detail: '', lat: 33.42, lon: -111.92 }
    writeFileSync(
      path,
      JSON.stringify({
        home: { lat: 33.4, lon: 'west' },
        saved: [good, { id: 'saved:2', name: '', lat: 33, lon: -112 }, { id: 3, name: 'X' }],
        recents: [{ id: 'apple:1', name: 'Y', lat: 91, lon: 0 }]
      })
    )
    expect(openPlaces(path).read()).toEqual({
      home: null,
      saved: [{ ...good, kind: 'saved' }],
      recents: []
    })
  })

  it('writes nothing but the places themselves', () => {
    const path = placesFile()
    const store = openPlaces(path)
    store.setHome([33.4, -111.9])
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      home: { lat: 33.4, lon: -111.9 },
      saved: [],
      recents: []
    })
  })
})
