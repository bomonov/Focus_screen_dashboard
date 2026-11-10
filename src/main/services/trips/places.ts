// Home, saved places and recent destinations: the trip card's own places, kept only in
// userData/trip-places.json. They say where the user lives and whom they visit, so nothing here
// logs a name or a position, and a file that can't be read is simply empty.
import { randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { writeJsonFile } from '../jsonFile'
import { distanceM, type LatLon } from '../transit/routeLine'
import type { Place } from './types'

export const MAX_PLACE_NAME_CHARS = 60
const MAX_DETAIL_CHARS = 200
const MAX_ID_CHARS = 200
const MAX_RECENTS = 10
/** Closer than this, two places are one: the same shop found by Apple and saved, say. */
const SAME_PLACE_M = 25

export interface PlacesStore {
  read(): { home: Place | null; saved: Place[]; recents: Place[] }
  /** Home is only ever set from where the Mac is: no address is typed or looked up. */
  setHome(at: LatLon): void
  clearHome(): void
  /**
   * Saves a found place under the user's name for it (its own name when that's blank), and takes
   * it out of the recents: it's listed with the saved places now.
   */
  save(place: Place, name: string): Place
  rename(id: string, name: string): void
  /** Removes a saved place or a recent one. */
  remove(id: string): void
  /**
   * Puts a picked destination first among the recents, once (by id, or within 25 m), keeping
   * ten; a recent picked again moves to the front. Home and saved places (and a place found
   * another way within 25 m of a saved one) are listed already, so they aren't added.
   */
  addRecent(place: Place): void
  clearRecents(): void
}

/** What's on disk: Home as a position only (its name is always "Home"), the others as places. */
interface PlacesFile {
  home: { lat: number; lon: number } | null
  saved: Stored[]
  recents: Stored[]
}

type Stored = Omit<Place, 'kind'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function position(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}

/** Trimmed, without control characters, cut to `max` characters (whole characters, not halves). */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return [...value.replace(/\p{Cc}/gu, ' ').trim()].slice(0, max).join('').trim()
}

function asStored(raw: unknown): Stored | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' && raw.id.length <= MAX_ID_CHARS ? raw.id : ''
  const name = cleanText(raw.name, MAX_PLACE_NAME_CHARS)
  const at = position(raw.lat, raw.lon)
  if (!id || !name || !at) return null
  return { id, name, detail: cleanText(raw.detail, MAX_DETAIL_CHARS), ...at }
}

function asList(raw: unknown): Stored[] {
  if (!Array.isArray(raw)) return []
  return raw.map(asStored).filter((place): place is Stored => place !== null)
}

function readFile(path: string): PlacesFile {
  let raw: unknown = null
  try {
    raw = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  } catch {
    raw = null
  }
  if (!isRecord(raw)) return { home: null, saved: [], recents: [] }
  return {
    home: isRecord(raw.home) ? position(raw.home.lat, raw.home.lon) : null,
    saved: asList(raw.saved),
    recents: asList(raw.recents).slice(0, MAX_RECENTS)
  }
}

const stored = ({ id, name, detail, lat, lon }: Place): Stored => ({ id, name, detail, lat, lon })

/** The same place: the same id, or within 25 m (one shop found by Apple and saved, say). */
const samePlace = (a: Stored, b: Stored): boolean =>
  a.id === b.id || distanceM([a.lat, a.lon], [b.lat, b.lon]) <= SAME_PLACE_M

export function openPlaces(path: string): PlacesStore {
  let state: PlacesFile | null = null

  function current(): PlacesFile {
    state ??= readFile(path)
    return state
  }

  function write(next: PlacesFile): void {
    state = next
    try {
      writeJsonFile(path, next)
    } catch (error) {
      // The places stay in memory until the next try; the error names only the file.
      console.warn('[trips] Could not save the trip places.', error)
    }
  }

  return {
    read() {
      const { home, saved, recents } = current()
      return {
        home: home
          ? { id: 'home', kind: 'home', name: 'Home', detail: '', lat: home.lat, lon: home.lon }
          : null,
        saved: saved.map((place) => ({ ...place, kind: 'saved' })),
        recents: recents.map((place) => ({ ...place, kind: 'recent' }))
      }
    },

    setHome([lat, lon]) {
      const home = position(lat, lon)
      if (home) write({ ...current(), home })
    },

    clearHome() {
      write({ ...current(), home: null })
    },

    save(place, name) {
      const saved: Place = {
        id: `saved:${randomUUID()}`,
        kind: 'saved',
        name:
          cleanText(name, MAX_PLACE_NAME_CHARS) ||
          cleanText(place.name, MAX_PLACE_NAME_CHARS) ||
          'Saved place',
        detail: cleanText(place.detail, MAX_DETAIL_CHARS),
        lat: place.lat,
        lon: place.lon
      }
      // Commands are checked before they get here; a place nowhere is still never kept.
      if (!position(place.lat, place.lon)) return saved
      const now = current()
      const found = stored(place)
      write({
        ...now,
        saved: [...now.saved, stored(saved)],
        recents: now.recents.filter((recent) => !samePlace(recent, found))
      })
      return saved
    },

    rename(id, name) {
      const cleaned = cleanText(name, MAX_PLACE_NAME_CHARS)
      const now = current()
      if (!cleaned || !now.saved.some((place) => place.id === id)) return
      write({
        ...now,
        saved: now.saved.map((place) => (place.id === id ? { ...place, name: cleaned } : place))
      })
    },

    remove(id) {
      const now = current()
      write({
        ...now,
        saved: now.saved.filter((place) => place.id !== id),
        recents: now.recents.filter((place) => place.id !== id)
      })
    },

    addRecent(place) {
      if (place.kind === 'home' || place.kind === 'saved') return
      const recent = asStored(place)
      if (!recent) return
      const now = current()
      if (now.saved.some((saved) => samePlace(saved, recent))) return
      const others = now.recents.filter((old) => !samePlace(old, recent))
      write({ ...now, recents: [recent, ...others].slice(0, MAX_RECENTS) })
    },

    clearRecents() {
      write({ ...current(), recents: [] })
    }
  }
}
