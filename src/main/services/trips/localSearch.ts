// The trip card's search among what the Mac already has: Home, the next class, saved and recent
// places, the school's buildings and Valley Metro's stops. Nothing is sent anywhere for these, so
// they show the moment a key is typed; Apple's results (applePlaces.ts) come after them.
import type { SchoolBuilding } from '../calendar/classMap'
import { routeName, type StopList } from '../transit/stopList'
import type { Place } from './types'

export const MAX_LOCAL_RESULTS = 12
/** A stop's second line names this many routes, then "+N more". */
const STOP_ROUTES_SHOWN = 3

export interface LocalSources {
  home: Place | null
  saved: readonly Place[]
  recents: readonly Place[]
  nextClass: Place | null
  buildings: readonly Place[]
  stops: readonly Place[]
}

/** Street words as Valley Metro, Apple and people variously write them: each group is one word. */
const SPELLING_GROUPS: readonly string[][] = [
  ['av', 'ave', 'avenue'],
  ['st', 'street'],
  ['rd', 'road'],
  ['dr', 'drive'],
  ['blvd', 'boulevard']
]
const SPELLINGS = new Map(SPELLING_GROUPS.flatMap((group) => group.map((word) => [word, group])))

/** Lower-case words without accents or apostrophes, as typed: "Trader Joe’s" is trader, joes. */
export function placeWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
}

/**
 * A place's words to match what's typed against: its own, and every other spelling of a street
 * word in it ("Mill Ave" is mill, ave, av, avenue). Only the place's side is spelled out: a word
 * typed is taken as typed, so it finds its street letter by letter ("mill aven", "university
 * dri") and "street" doesn't widen to "st", and so to "Stadium".
 */
export function spelledWords(text: string): string[] {
  return placeWords(text).flatMap((word) => SPELLINGS.get(word) ?? [word])
}

/** Every word typed starts one of `own`: "terr rural" is in "Rural Rd & Terrace Rd". */
export const startsEvery = (typed: readonly string[], own: readonly string[]): boolean =>
  typed.every((word) => own.some((candidate) => candidate.startsWith(word)))

interface Indexed {
  /** The words searched: the name's, and the second line's except for a stop (its routes). */
  words: string[]
  /** A building's code, folded ("coor"); '' for anything else. */
  code: string
}

/** Each place's words, worked out once rather than on every key typed (stops number ~7,000). */
const indexes = new WeakMap<Place, Indexed>()

function indexed(place: Place): Indexed {
  let index = indexes.get(place)
  if (!index) {
    const name = spelledWords(place.name)
    index = {
      words: place.kind === 'stop' ? name : [...name, ...spelledWords(place.detail)],
      code: place.kind === 'building' ? placeWords(place.detail).join('') : ''
    }
    indexes.set(place, index)
  }
  return index
}

const matches = (typed: readonly string[], place: Place): boolean =>
  startsEvery(typed, indexed(place).words)

/** One collator for every sort: one letter typed can match thousands of stops. */
const collator = new Intl.Collator('en')

const byName = (a: Place, b: Place): number =>
  collator.compare(a.name, b.name) ||
  collator.compare(a.detail, b.detail) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Buildings whose code is what's typed come first, by code; then the ones named so, by name. */
function rankBuildings(typed: readonly string[], buildings: readonly Place[]): Place[] {
  const compact = typed.join('')
  const byCode: Place[] = []
  const named: Place[] = []
  for (const building of buildings) {
    if (!matches(typed, building)) continue
    const { code } = indexed(building)
    if (code && code.startsWith(compact)) byCode.push(building)
    else named.push(building)
  }
  const codeOrder = (a: Place, b: Place): number => {
    const [x, y] = [indexed(a).code, indexed(b).code]
    return x < y ? -1 : x > y ? 1 : byName(a, b)
  }
  byCode.sort(codeOrder)
  return [...byCode, ...named.sort(byName)]
}

/**
 * The places whose words start with every word typed, case and accents aside: Home, the next
 * class, saved places, recents (as they're kept), buildings, then stops. A place listed in two
 * (a recent that's also a building) shows once, where it comes first; at most 12.
 */
export function searchLocal(text: string, sources: LocalSources): Place[] {
  if (!/[\p{L}\p{N}]/u.test(text)) return []
  const typed = placeWords(text)
  const keep = (places: readonly Place[]): Place[] =>
    places.filter((place) => matches(typed, place))
  const all = [
    ...keep(sources.home ? [sources.home] : []),
    ...keep(sources.nextClass ? [sources.nextClass] : []),
    ...keep(sources.saved),
    ...keep(sources.recents),
    ...rankBuildings(typed, sources.buildings),
    ...keep(sources.stops).sort(byName)
  ]
  const seen = new Set<string>()
  const found: Place[] = []
  for (const place of all) {
    if (seen.has(place.id)) continue
    seen.add(place.id)
    found.push(place)
    if (found.length === MAX_LOCAL_RESULTS) break
  }
  return found
}

const buildingCache = new WeakMap<readonly SchoolBuilding[], Place[]>()

/** The school's buildings as places, by the key the class map knows them by; the code below. */
export function buildingPlaces(buildings: readonly SchoolBuilding[]): Place[] {
  let places = buildingCache.get(buildings)
  if (!places) {
    places = buildings.map(({ key, code, name, lat, lon }) => ({
      id: `building:${key}`,
      kind: 'building',
      name: name || code || 'Building',
      detail: code ?? '',
      lat,
      lon
    }))
    buildingCache.set(buildings, places)
  }
  return places
}

const stopCache = new WeakMap<StopList, Place[]>()

/** "Orbit Venus · Route 72", what the stop's row says under its name. */
function stopRoutes(list: StopList, stop: StopList['stops'][number]): string {
  const names = [
    ...new Set(stop.serves.map(([route]) => routeName(route, list.routes[route]).name))
  ]
  if (names.length === 0) return stop.code ? `Stop ${stop.code}` : ''
  const shown = names.slice(0, STOP_ROUTES_SHOWN).join(' · ')
  const more = names.length - STOP_ROUTES_SHOWN
  return more > 0 ? `${shown} · +${more} more` : shown
}

/** The stop list's stops as places, each list's once; stops the schedule gives no place are left out. */
export function stopPlaces(list: StopList): Place[] {
  let places = stopCache.get(list)
  if (!places) {
    places = []
    for (const stop of list.stops) {
      if (!stop.position) continue
      const [lat, lon] = stop.position
      places.push({
        id: `stop:${stop.id}`,
        kind: 'stop',
        name: stop.name,
        detail: stopRoutes(list, stop),
        lat,
        lon
      })
    }
    stopCache.set(list, places)
  }
  return places
}
