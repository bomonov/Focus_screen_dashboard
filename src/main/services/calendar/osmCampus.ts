// A school's buildings from OpenStreetMap, for schools without a building list of their own
// (ASU has one: campus.ts). Asked for once, on the user's say-so, with only the school's name
// and country; the answer is kept on this Mac and every match is made here.
import type { School } from './schools'

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

/** One building on a school's campus, as OpenStreetMap maps it. */
export interface CampusBuilding {
  /** OpenStreetMap's id ("way/123"), so the card can say which building it means. */
  id: string
  /** "Engineering Center G"; '' when it's only known by its code. */
  name: string
  /** "ECG": its codes where mapped (ref, short_name), upper case. Often none. */
  codes: string[]
  lat: number
  lon: number
}

const MAX_BUILDINGS = 5000
const MAX_TEXT = 200
const CODE = /^[A-Z0-9]{1,10}$/

/** The school's name as a pattern that doesn't mind punctuation: "University of X, Y" or "… X Y". */
function namePattern(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? []
  // Between words, anything but a letter or digit: spaces, commas, dashes ("University of X, Y").
  return `^${words.map((word) => word.replace(/[\\^$.|?*+()[\]{}"]/g, '\\$&')).join('[^A-Za-z0-9]+')}`
}

/**
 * The Overpass query for a school's buildings: its campus areas (amenity=university) named
 * exactly as the school is, and every building inside them, with their middle points. Looking
 * the campus up by its exact name is quick; the pattern below is the slower fallback.
 */
export function campusQuery(school: School): string {
  const name = school.name.replace(/["\\]/g, '\\$&')
  return [
    '[out:json][timeout:90];',
    '(',
    ...['name', 'name:en', 'official_name'].map(
      (key) => `  area["amenity"="university"]["${key}"="${name}"];`
    ),
    ')->.grounds;',
    'nwr["building"](area.grounds);',
    `out tags center ${MAX_BUILDINGS};`
  ].join('\n')
}

/**
 * The same, for a campus OpenStreetMap names a little differently ("University of X Y" for
 * "University of X, Y"): any campus in the school's country whose name starts like it.
 */
export function campusPatternQuery(school: School): string {
  const pattern = namePattern(school.name)
  return [
    '[out:json][timeout:120];',
    `area["ISO3166-1"="${school.country}"][admin_level=2]->.country;`,
    '(',
    ...['name', 'name:en', 'official_name', 'alt_name'].map(
      (key) => `  nwr["amenity"="university"]["${key}"~"${pattern}",i](area.country);`
    ),
    ')->.campus;',
    '.campus map_to_area->.grounds;',
    'nwr["building"](area.grounds);',
    `out tags center ${MAX_BUILDINGS};`
  ].join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : ''
}

function position(element: Record<string, unknown>): { lat: number; lon: number } | null {
  const point = isRecord(element.center) ? element.center : element
  const { lat, lon } = point
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null
  }
  return { lat, lon }
}

/** Overpass's answer as buildings; ones with neither a name nor a code can't be matched, so go. */
export function parseCampusBuildings(raw: unknown): CampusBuilding[] {
  const elements = isRecord(raw) && Array.isArray(raw.elements) ? raw.elements : []
  const buildings: CampusBuilding[] = []
  const seen = new Set<string>()
  for (const element of elements.slice(0, MAX_BUILDINGS)) {
    if (!isRecord(element) || !isRecord(element.tags)) continue
    const type = text(element.type)
    const id =
      typeof element.id === 'number' && Number.isSafeInteger(element.id) ? element.id : null
    const at = position(element)
    if (!['node', 'way', 'relation'].includes(type) || id === null || !at) continue
    const key = `${type}/${id}`
    if (seen.has(key)) continue
    seen.add(key)
    const tags = element.tags
    const fullName = text(tags.name) || text(tags['name:en'])
    // "Physics Building (PHYS)": the code in brackets is a code, and not part of the name.
    const bracketed = /^(.*\S)\s*\(([A-Za-z0-9]{2,10})\)$/.exec(fullName)
    const name = bracketed?.[1] ?? fullName
    const codes = [
      text(tags.ref),
      text(tags['building:ref']),
      text(tags.short_name),
      bracketed?.[2] ?? ''
    ]
      .map((code) => code.toUpperCase().replace(/\s+/g, ''))
      .filter((code, index, all) => CODE.test(code) && all.indexOf(code) === index)
    if (!name && codes.length === 0) continue
    buildings.push({ id: key, name, codes, ...at })
  }
  return buildings
}

/** iCourse, "Online", a Zoom link… there's no building to show. */
const ONLINE = /^(online|internet\b|zoom|teams|remote|virtual|tbd|tba)|https?:\/\//i
/** What's left after the building must look like a room: "195", "G320", "Room 101", or nothing. */
const ROOM = /^(?:(?:room|rm\.?)\s*)?(?:[A-Z]{0,2}\d[A-Z0-9-]*)?$/i

export type CampusPlace =
  | { kind: 'online' }
  | { kind: 'building'; building: CampusBuilding; room: string | null }
  | { kind: 'unknown' }

function fold(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** A building a name or code means only if it's the only one so called. */
function only<T>(found: readonly T[]): T | null {
  return found.length === 1 ? (found[0] ?? null) : null
}

/** Names shorter than this ("Hall") say too little to be matched on. */
const MIN_NAME = 5

/**
 * Where a calendar location says the class is, among a school's mapped buildings: its code
 * ("ENG 101", "ENG101"), the longest that leaves a room behind, or its whole name ("Science
 * Hall 204"), the longest that does. A code or name two buildings share is no match: anything
 * unsure gets no pin. Null when the location says nothing.
 */
export function campusPlace(
  location: string,
  buildings: readonly CampusBuilding[]
): CampusPlace | null {
  const trimmed = location.trim()
  if (!trimmed) return null
  if (ONLINE.test(trimmed)) return { kind: 'online' }
  // "Main Campus - ENG 101": a campus named first, before a dash.
  const tries = [trimmed, ...(/^[^-]{2,40}\s-\s(.+)$/.exec(trimmed)?.slice(1) ?? [])]

  for (const text of tries) {
    const compact = text.toUpperCase().replace(/\s+/g, '')
    for (let length = Math.min(compact.length, 10); length > 0; length--) {
      const code = compact.slice(0, length)
      const leftover = compact.slice(length)
      if (!ROOM.test(leftover)) continue
      const building = only(buildings.filter((b) => b.codes.includes(code)))
      if (building) return { kind: 'building', building, room: leftover || null }
    }
  }

  for (const text of tries) {
    const folded = fold(text)
    const named = buildings
      .map((building) => ({ building, name: fold(building.name) }))
      .filter(
        ({ name }) => name.length >= MIN_NAME && (folded === name || folded.startsWith(`${name} `))
      )
      .sort((a, b) => b.name.length - a.name.length)
    const longest = named[0]
    if (!longest) continue
    const leftover = folded.slice(longest.name.length).trim().toUpperCase()
    if (!ROOM.test(leftover)) continue
    const building = only(named.filter(({ name }) => name === longest.name).map((n) => n.building))
    if (building) {
      return { kind: 'building', building, room: leftover.replace(/^(ROOM|RM)\s*/, '') || null }
    }
  }
  return { kind: 'unknown' }
}

/** Apple Maps at the building, for "Open in Apple Maps": opened on the user's click. */
export function appleMapsUrl(building: CampusBuilding): string {
  const url = new URL('https://maps.apple.com/')
  url.searchParams.set('ll', `${building.lat.toFixed(6)},${building.lon.toFixed(6)}`)
  url.searchParams.set('q', building.name || building.codes[0] || 'Class')
  return url.toString()
}
