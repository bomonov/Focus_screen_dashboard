// Where a class meets: the building code in its calendar location ("Tempe - COOR195", typed
// "COOR 170") matched against ASU's own facilities list, which has every building's code (the
// same codes the class schedule prints) and position. A match must be exact: a pin on the
// wrong building looks right and isn't, so anything unsure gets no pin at all.

export interface Building {
  /** "COOR" */
  code: string
  /** ASU's name, as it gives it: "COOR HALL". */
  name: string
  /** ASU's campus code: MC Tempe, DT Downtown Phoenix, EC Polytechnic, WC West Valley… */
  campus: string
  lat: number
  lon: number
}

/** Every building, as points, in one request (ASU has about a thousand records). */
export const BUILDINGS_URL =
  'https://gisprodportal.asu.edu/server/rest/services/University_Facilities/FeatureServer/0/query' +
  '?where=1%3D1&outFields=BLDG_CODE,BLDG_NAME,BLDG_CAMPUS_CODE,BLDG_NUMBER' +
  '&outSR=4326&resultRecordCount=2000&f=geojson'

const CODE = /^[A-Z0-9]{1,10}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * ASU's facilities list (GeoJSON points) as a table by code. Outdoor rooms (numbers starting
 * with X, which repeat a building's code) and records placed at 0,0 are dropped; where a code
 * still appears twice, the first one stands.
 */
export function parseBuildings(raw: unknown): Map<string, Building> {
  const table = new Map<string, Building>()
  const features = isRecord(raw) && Array.isArray(raw.features) ? raw.features : []
  for (const feature of features) {
    if (!isRecord(feature) || !isRecord(feature.properties) || !isRecord(feature.geometry)) continue
    const { BLDG_CODE, BLDG_NAME, BLDG_CAMPUS_CODE, BLDG_NUMBER } = feature.properties
    const coordinates = feature.geometry.coordinates
    if (typeof BLDG_CODE !== 'string' || typeof BLDG_NAME !== 'string') continue
    if (typeof BLDG_NUMBER === 'string' && BLDG_NUMBER.toUpperCase().startsWith('X')) continue
    if (!Array.isArray(coordinates)) continue
    const [lon, lat] = coordinates as unknown[]
    if (typeof lat !== 'number' || typeof lon !== 'number') continue
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    const code = BLDG_CODE.trim().toUpperCase()
    if (!CODE.test(code) || table.has(code)) continue
    table.set(code, {
      code,
      name: BLDG_NAME.trim(),
      campus: typeof BLDG_CAMPUS_CODE === 'string' ? BLDG_CAMPUS_CODE.trim().toUpperCase() : '',
      lat,
      lon
    })
  }
  return table
}

/** Small words that stay lower case inside a name. */
const MINOR = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'the', 'to'])

/** One word of a name, without punctuation around it: "(G" is G, "PBS" an acronym. */
function nameWord(word: string, first: boolean): string {
  if (/\d/.test(word) || word.length === 1) return word.toUpperCase()
  // Short and vowelless, it's initials (PBS), not a word.
  if (word.length <= 3 && !/[AEIOUY]/i.test(word)) return word.toUpperCase()
  const lower = word.toLowerCase()
  if (!first && MINOR.has(lower)) return lower
  return lower.startsWith('mc') && lower.length > 2
    ? `Mc${lower.charAt(2).toUpperCase()}${lower.slice(3)}`
    : lower.charAt(0).toUpperCase() + lower.slice(1)
}

/**
 * ASU writes names in capitals ("BATEMAN PHYSICAL SCIENCES CENTER H"); the card shows them in
 * title case. Wing letters, numbered names (ISTB4) and initials (PBS) stay as they are, and
 * words joined by "-" or "/" or wrapped in brackets are each cased on their own.
 */
export function displayName(raw: string): string {
  let first = true
  return raw.trim().replace(/[A-Za-z0-9]+/g, (word) => {
    const cased = nameWord(word, first)
    first = false
    return cased
  })
}

/** The campus names a schedule puts before the room, and ASU's code for each. */
const CAMPUSES: Record<string, string> = {
  tempe: 'MC',
  dtphx: 'DT',
  downtown: 'DT',
  'downtown phoenix': 'DT',
  poly: 'EC',
  polytechnic: 'EC',
  west: 'WC',
  'west valley': 'WC'
}

/** iCourse, ASU Online, "Internet - Hybrid", a Zoom link… there's no building to show. */
const ONLINE =
  /^(icourse|asu online|online|internet\b|zoom|teams|remote|virtual|tbd|tba)|https?:\/\//i

/** What's left after the code must look like a room: "195", "G320", "L1-07", or nothing. */
const ROOM = /^(?:[A-Z]{0,2}\d[A-Z0-9-]*)?$/

export type ClassPlace =
  | { kind: 'online' }
  | { kind: 'building'; building: Building; room: string | null }
  /** Looks like a room somewhere, but not one in ASU's list (or on another campus than it says). */
  | { kind: 'unknown' }

/** A campus named first, with or without a dash: "Tempe - COOR195", "Tempe WCPH 107". */
const CAMPUS_FIRST =
  /^(downtown phoenix|west valley|polytechnic|downtown|dtphx|tempe|poly|west)(?:\s*-\s*|\s+)(.+)$/i

/** The building and room at the start of `text`, or null; "mismatch" when on another campus. */
function buildingAt(
  text: string,
  campus: string | null,
  buildings: Map<string, Building>
): ClassPlace | 'mismatch' | null {
  const compact = text.toUpperCase().replace(/\s+/g, '')
  for (let length = Math.min(compact.length, 10); length > 0; length--) {
    const building = buildings.get(compact.slice(0, length))
    const leftover = compact.slice(length)
    if (!building || !ROOM.test(leftover)) continue
    if (campus && building.campus && building.campus !== campus) return 'mismatch'
    return { kind: 'building', building, room: leftover || null }
  }
  return null
}

/**
 * Where a calendar location says the class is, or null when it says nothing. The building code
 * is the longest known code the location starts with that leaves a room behind, so "ECGG320"
 * is ECG room G320 rather than EC room GG320. A campus named first ("Tempe - COOR195", or
 * "Tempe WCPH 107" as some calendars write it) must be that building's campus; the whole text
 * is tried too, in case a building's code starts with a campus's name.
 */
export function classPlace(location: string, buildings: Map<string, Building>): ClassPlace | null {
  const text = location.trim()
  if (!text) return null
  if (ONLINE.test(text)) return { kind: 'online' }

  const [, named, after] = CAMPUS_FIRST.exec(text) ?? []
  const campus = named ? CAMPUSES[named.toLowerCase().replace(/\s+/g, ' ')] : undefined
  if (campus && after) {
    if (ONLINE.test(after)) return { kind: 'online' }
    const found = buildingAt(after, campus, buildings)
    if (found === 'mismatch') return { kind: 'unknown' }
    if (found) return found
  }
  const whole = buildingAt(text, null, buildings)
  return whole && whole !== 'mismatch' ? whole : { kind: 'unknown' }
}

const MAP_PAGE = 'https://www.asu.edu/about/map'

/** ASU's own campus map, centred on the building when there is one. */
export function campusMapUrl(code: string | null): string {
  return code ? `${MAP_PAGE}?psCode=${encodeURIComponent(code)}` : MAP_PAGE
}

/** "Tempe" for MC, and so on; ASU's code when it's one the card doesn't name. */
export function campusName(code: string): string {
  const names: Record<string, string> = {
    MC: 'Tempe',
    DT: 'Downtown Phoenix',
    EC: 'Polytechnic',
    WC: 'West Valley'
  }
  return names[code] ?? ''
}
