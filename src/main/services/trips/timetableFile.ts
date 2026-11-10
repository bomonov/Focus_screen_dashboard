// The trip planner's timetable on disk (userData/transit-timetable.bin): written when the
// schedule is downloaded, read by the search's process. Binary, as its ~900,000 stop times would
// be several times the size in JSON and slow to parse; the arrays are read where they lie.
//
// Layout: "FSTT1\n"; the JSON header's length in bytes (u32, little-endian); the JSON header
// (the strings, routes, each pattern's details, the services and a table of the arrays); then,
// from the next multiple of 8, the arrays, each at a multiple of 8 (a Float64Array needs it).
// The table gives each array as [kind, offset from where the arrays start, length], and the
// header names an array by its row in the table. Arrays are in the machine's byte order, which
// is little-endian on every Mac and PC the app runs on.
import type { Pattern, Timetable, TimetableRoute } from './types'

const MAGIC = new TextEncoder().encode('FSTT1\n')
/** The magic and the header's length. */
const HEAD = MAGIC.length + 4
/** Far past any header Valley Metro's schedule makes (~1 MB of trip ids and names). */
const MAX_HEADER_BYTES = 64 * 1024 * 1024
const LITTLE_ENDIAN = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1

const ARRAYS = { f64: Float64Array, i32: Int32Array, u32: Uint32Array, u16: Uint16Array }
type Kind = keyof typeof ARRAYS
type Typed = Float64Array | Int32Array | Uint32Array | Uint16Array
type TableRow = [kind: Kind, offset: number, length: number]

interface Header {
  downloadedAt: number
  version: string
  stops: { ids: string[]; names: string[]; lat: number; lon: number }
  routes: TimetableRoute[]
  patterns: (Pick<Pattern, 'route' | 'direction' | 'headsign' | 'trips'> & {
    stops: number
    service: number
    times: number
  })[]
  services: number[][]
  transfers: { start: number; to: number; metres: number }
  arrays: TableRow[]
}

const align8 = (n: number): number => Math.ceil(n / 8) * 8

function kindOf(array: Typed): Kind {
  if (array instanceof Float64Array) return 'f64'
  if (array instanceof Int32Array) return 'i32'
  return array instanceof Uint32Array ? 'u32' : 'u16'
}

export function encodeTimetable(tt: Timetable, downloadedAt: number): Uint8Array {
  const arrays: Typed[] = []
  const table: TableRow[] = []
  let end = 0
  const add = (array: Typed): number => {
    const offset = align8(end)
    table.push([kindOf(array), offset, array.length])
    arrays.push(array)
    end = offset + array.byteLength
    return table.length - 1
  }
  const header: Header = {
    downloadedAt,
    version: tt.version,
    stops: {
      ids: tt.stops.ids,
      names: tt.stops.names,
      lat: add(tt.stops.lat),
      lon: add(tt.stops.lon)
    },
    routes: tt.routes,
    patterns: tt.patterns.map((pattern) => ({
      route: pattern.route,
      direction: pattern.direction,
      headsign: pattern.headsign,
      trips: pattern.trips,
      stops: add(pattern.stops),
      service: add(pattern.service),
      times: add(pattern.times)
    })),
    services: tt.services.map((dates) => Array.from(dates)),
    transfers: {
      start: add(tt.transfers.start),
      to: add(tt.transfers.to),
      metres: add(tt.transfers.metres)
    },
    arrays: table
  }
  const json = new TextEncoder().encode(JSON.stringify(header))
  const dataStart = align8(HEAD + json.length)
  const bytes = new Uint8Array(dataStart + end)
  bytes.set(MAGIC)
  new DataView(bytes.buffer).setUint32(MAGIC.length, json.length, true)
  bytes.set(json, HEAD)
  arrays.forEach((array, i) => {
    const at = dataStart + (table[i] as TableRow)[1]
    bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), at)
  })
  return bytes
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

function allBelow(array: Uint32Array | Uint16Array, limit: number): boolean {
  for (let i = 0; i < array.length; i++) if ((array[i] as number) >= limit) return false
  return true
}

/** The header's arrays by their row in the table, as views of the file; null for a wrong kind. */
interface ArrayReader {
  f64(row: unknown): Float64Array | null
  i32(row: unknown): Int32Array | null
  u32(row: unknown): Uint32Array | null
  u16(row: unknown): Uint16Array | null
}

/** Null when a row of the table isn't one, or doesn't fit inside the file. */
function arrayReader(
  bytes: Uint8Array<ArrayBuffer>,
  dataStart: number,
  table: unknown
): ArrayReader | null {
  if (!Array.isArray(table)) return null
  for (const row of table) {
    if (!Array.isArray(row) || row.length !== 3) return null
    const [kind, offset, length] = row as unknown[]
    if (typeof kind !== 'string' || !Object.hasOwn(ARRAYS, kind)) return null
    if (!isCount(offset) || offset % 8 !== 0 || !isCount(length)) return null
    const size = ARRAYS[kind as Kind].BYTES_PER_ELEMENT
    if (dataStart + offset + length * size > bytes.length) return null
  }
  const rows = table as TableRow[]
  /** Where the row's array starts in the buffer, and its length. */
  const place = (row: unknown, kind: Kind): [number, number] | null => {
    if (!isCount(row) || row >= rows.length) return null
    const [rowKind, offset, length] = rows[row] as TableRow
    return rowKind === kind ? [bytes.byteOffset + dataStart + offset, length] : null
  }
  const { buffer } = bytes
  return {
    f64: (row) => {
      const at = place(row, 'f64')
      return at && new Float64Array(buffer, ...at)
    },
    i32: (row) => {
      const at = place(row, 'i32')
      return at && new Int32Array(buffer, ...at)
    },
    u32: (row) => {
      const at = place(row, 'u32')
      return at && new Uint32Array(buffer, ...at)
    },
    u16: (row) => {
      const at = place(row, 'u16')
      return at && new Uint16Array(buffer, ...at)
    }
  }
}

function readRoute(raw: unknown): TimetableRoute | null {
  if (!isRecord(raw)) return null
  const { id, short, long, color, textColor, type } = raw
  if (typeof id !== 'string' || typeof short !== 'string' || typeof long !== 'string') return null
  if (typeof color !== 'string' || typeof textColor !== 'string') return null
  return Number.isInteger(type) ? { id, short, long, color, textColor, type: type as number } : null
}

/**
 * A timetable file read back, its arrays viewing `bytes` (copied first only when they sit at an
 * odd place in memory), so the caller mustn't reuse them. Null for anything that isn't one, or
 * whose arrays would point past what it has: the search indexes them without checking.
 */
export function decodeTimetable(
  bytes: Uint8Array
): { timetable: Timetable; downloadedAt: number } | null {
  try {
    return decode(bytes)
  } catch {
    // Bad JSON or UTF-8; everything else is checked as it's read.
    return null
  }
}

function decode(input: Uint8Array): { timetable: Timetable; downloadedAt: number } | null {
  if (!LITTLE_ENDIAN || input.length < HEAD || MAGIC.some((byte, i) => input[i] !== byte)) {
    return null
  }
  // A Float64Array view needs its place 8-aligned, which a Buffer read from disk may not be.
  const bytes =
    input.byteOffset % 8 === 0 && input.buffer instanceof ArrayBuffer
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input)
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    MAGIC.length,
    true
  )
  if (length > MAX_HEADER_BYTES || HEAD + length > bytes.length) return null
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(HEAD, HEAD + length))
  const header: unknown = JSON.parse(text)
  if (!isRecord(header)) return null
  const array = arrayReader(bytes, align8(HEAD + length), header.arrays)
  const { downloadedAt, version, stops, routes, patterns, services, transfers } = header
  if (!array || typeof downloadedAt !== 'number' || !Number.isFinite(downloadedAt)) return null
  if (typeof version !== 'string' || !isRecord(stops) || !isRecord(transfers)) return null
  if (!Array.isArray(routes) || !Array.isArray(patterns) || !Array.isArray(services)) return null

  const { ids, names } = stops
  const lat = array.f64(stops.lat)
  const lon = array.f64(stops.lon)
  if (!isStrings(ids) || !isStrings(names) || !lat || !lon) return null
  const stopCount = ids.length
  if (names.length !== stopCount || lat.length !== stopCount || lon.length !== stopCount) {
    return null
  }

  const readRoutes = routes.map(readRoute)
  if (readRoutes.some((route) => route === null)) return null

  const readServices: Int32Array[] = []
  for (const dates of services) {
    if (!Array.isArray(dates) || !dates.every((date) => Number.isInteger(date))) return null
    readServices.push(Int32Array.from(dates as number[]))
  }

  const readPatterns: Pattern[] = []
  for (const raw of patterns) {
    if (!isRecord(raw)) return null
    const { route, direction, headsign, trips } = raw
    const patternStops = array.u32(raw.stops)
    const service = array.u16(raw.service)
    const times = array.i32(raw.times)
    if (!isCount(route) || route >= readRoutes.length || !Number.isInteger(direction)) return null
    if (typeof headsign !== 'string' || !isStrings(trips)) return null
    if (!patternStops || !service || !times || service.length !== trips.length) return null
    if (times.length !== trips.length * patternStops.length * 2) return null
    if (!allBelow(patternStops, stopCount) || !allBelow(service, readServices.length)) return null
    readPatterns.push({
      route,
      direction: direction as number,
      headsign,
      stops: patternStops,
      trips,
      service,
      times
    })
  }

  const start = array.u32(transfers.start)
  const to = array.u32(transfers.to)
  const metres = array.u16(transfers.metres)
  if (!start || !to || !metres || start.length !== stopCount + 1) return null
  if (metres.length !== to.length || start[0] !== 0 || start[stopCount] !== to.length) return null
  for (let i = 0; i < stopCount; i++) {
    if ((start[i] as number) > (start[i + 1] as number)) return null
  }
  if (!allBelow(to, stopCount)) return null

  return {
    downloadedAt,
    timetable: {
      version,
      stops: { ids, names, lat, lon },
      routes: readRoutes as TimetableRoute[],
      patterns: readPatterns,
      services: readServices,
      transfers: { start, to, metres }
    }
  }
}
