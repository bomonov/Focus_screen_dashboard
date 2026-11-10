// Apple's place search, for destinations the Mac doesn't know (a store, a restaurant, a friend's
// street): the Reminders helper's place-search mode, MapKit's local search. Only the words typed
// and the fixed Phoenix-area box go to Apple, never where the Mac is, the start, the destination
// or the trip (approved by the user on 2026-11-02). Its replies are untrusted: anything odd is
// no result, so the Mac's own matches always still show.
import { createRemindersClient, type StartHelper } from '../todos/apple-reminders/client'
import { placeWords, spelledWords, startsEvery } from './localSearch'
import { PHOENIX_AREA, type Place } from './types'

/** The helper gives up after 10 s too; a search that slow is no use while typing. */
export const APPLE_SEARCH_TIMEOUT_MS = 10_000
export const MAX_APPLE_TEXT_CHARS = 100
/** Fewer than two letters say too little to send. */
export const MIN_APPLE_TEXT_CHARS = 2
export const MAX_APPLE_RESULTS = 8
const MAX_NAME_CHARS = 100
const MAX_DETAIL_CHARS = 120
/** More than this in one reply isn't a search answer; the rest isn't even looked at. */
const MAX_RESULTS_READ = 50

export interface ApplePlaces {
  /** At most eight places inside the Phoenix area; none when anything went wrong. */
  search(text: string): Promise<Place[]>
  stop(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Trimmed, without control characters, cut to `max` whole characters. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return [...value.replace(/\p{Cc}/gu, ' ').trim()].slice(0, max).join('').trim()
}

/** The position when it's inside the box asked about; a result outside it isn't one of ours. */
function inArea(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  const { south, west, north, east } = PHOENIX_AREA
  // NaN fails every comparison, so this is the finite check too.
  return lat >= south && lat <= north && lon >= west && lon <= east ? { lat, lon } : null
}

function parseResult(raw: unknown): Place | null {
  if (!isRecord(raw)) return null
  const name = cleanText(raw.name, MAX_NAME_CHARS)
  const at = inArea(raw.lat, raw.lon)
  if (!name || !at) return null
  const { lat, lon } = at
  return {
    // The same place found again gets the same id, so recents and rows know it.
    id: `apple:${lat.toFixed(5)},${lon.toFixed(5)}:${name}`,
    kind: 'apple',
    name,
    detail: cleanText(raw.detail, MAX_DETAIL_CHARS),
    lat,
    lon
  }
}

/**
 * The reply's places, each once, those named with every word typed first: Apple ranks by
 * nearness to the box's middle (west Phoenix), so on 2026-11-03 "Tempe Marketplace" came 11th
 * of 12 for its own name. Otherwise Apple's order stands; at most eight.
 */
function parseResults(body: Record<string, unknown>, text: string): Place[] {
  if (body.ok !== true || !Array.isArray(body.results)) return []
  const typed = placeWords(text)
  const named: Place[] = []
  const others: Place[] = []
  const seen = new Set<string>()
  for (const raw of body.results.slice(0, MAX_RESULTS_READ)) {
    const place = parseResult(raw)
    if (!place || seen.has(place.id)) continue
    seen.add(place.id)
    ;(startsEvery(typed, spelledWords(place.name)) ? named : others).push(place)
  }
  return [...named, ...others].slice(0, MAX_APPLE_RESULTS)
}

export function createApplePlaces(start: StartHelper): ApplePlaces {
  // Place-search mode sends no access line and no change notices: it reads nothing on the Mac.
  const client = createRemindersClient(start, {
    access: () => undefined,
    changed: () => undefined
  })

  return {
    async search(text) {
      const words = [...text.trim()].slice(0, MAX_APPLE_TEXT_CHARS).join('').trim()
      if ([...words].length < MIN_APPLE_TEXT_CHARS) return []
      // Exactly these three fields (the client adds the request's id): nothing else goes.
      const request = { op: 'search', text: words, box: { ...PHOENIX_AREA } }
      const body = await client.request(request, APPLE_SEARCH_TIMEOUT_MS).catch(() => null)
      return body ? parseResults(body, words) : []
    },
    stop: () => client.stop()
  }
}
