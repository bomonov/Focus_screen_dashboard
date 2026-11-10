import { describe, expect, it } from 'vitest'
import { decodeTimetable, encodeTimetable } from './timetableFile'
import type { Timetable } from './types'

const DOWNLOADED_AT = 1_793_600_000

const TT: Timetable = {
  version: 'GTFS_v4.5_20260914',
  stops: {
    ids: ['A', 'B', 'C'],
    names: ['Rural Rd & Terrace Rd', 'Café “Ünder” the line', 'Apache Blvd & Rural Rd'],
    lat: Float64Array.of(33.4242, 33.42734567, 33.4242),
    lon: Float64Array.of(-111.9281, -111.9281, -111.92327891)
  },
  routes: [
    {
      id: '72',
      short: '72',
      long: 'Scottsdale Rd/Rural Rd',
      color: '591769',
      textColor: 'FFFFFF',
      type: 3
    },
    { id: 'VMR', short: 'VMR', long: 'Valley Metro Rail', color: '', textColor: '', type: 0 }
  ],
  patterns: [
    {
      route: 0,
      direction: 1,
      headsign: 'Chandler',
      stops: Uint32Array.of(0, 1, 2),
      trips: ['t1', 't2'],
      service: Uint16Array.of(0, 1),
      times: Int32Array.of(
        21600,
        21630,
        22200,
        22200,
        22800,
        22800,
        86000,
        86000,
        86600,
        86600,
        90600,
        90600
      )
    },
    {
      // A loop: C again at its end.
      route: 1,
      direction: -1,
      headsign: 'Downtown',
      stops: Uint32Array.of(2, 0, 2),
      trips: ['r1'],
      service: Uint16Array.of(0),
      times: Int32Array.of(28800, 28800, 29100, 29160, 29700, 29700)
    }
  ],
  services: [Int32Array.of(20261102, 20261103), Int32Array.of(20261107)],
  transfers: {
    start: Uint32Array.of(0, 1, 2, 2),
    to: Uint32Array.of(1, 0),
    metres: Uint16Array.of(350, 350)
  }
}

const EMPTY: Timetable = {
  version: '',
  stops: { ids: [], names: [], lat: new Float64Array(0), lon: new Float64Array(0) },
  routes: [],
  patterns: [],
  services: [],
  transfers: { start: Uint32Array.of(0), to: new Uint32Array(0), metres: new Uint16Array(0) }
}

/** Typed arrays as their kind and plain values, so a comparison checks both, element-wise. */
function plain(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) {
    return { [value.constructor.name]: Array.from(value as unknown as ArrayLike<number>) }
  }
  if (Array.isArray(value)) return value.map(plain)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, plain(v)]))
  }
  return value
}

const HEAD = 10
const align8 = (n: number): number => Math.ceil(n / 8) * 8

/** The file's JSON header and the arrays after it, to change one and put them back together. */
function split(bytes: Uint8Array): { header: Record<string, unknown>; data: Uint8Array } {
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(6, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(HEAD, HEAD + length)))
  return { header, data: bytes.subarray(align8(HEAD + length)) }
}

function join(header: unknown, data: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header))
  const out = new Uint8Array(align8(HEAD + json.length) + data.length)
  out.set(new TextEncoder().encode('FSTT1\n'))
  new DataView(out.buffer).setUint32(6, json.length, true)
  out.set(json, HEAD)
  out.set(data, align8(HEAD + json.length))
  return out
}

type Table = [kind: string, offset: number, length: number][]

describe('the timetable file', () => {
  it('reads back what it wrote, typed arrays and all', () => {
    const bytes = encodeTimetable(TT, DOWNLOADED_AT)
    expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('FSTT1\n')
    const read = decodeTimetable(bytes)
    expect(read?.downloadedAt).toBe(DOWNLOADED_AT)
    expect(plain(read?.timetable)).toEqual(plain(TT))
  })

  it('reads an empty timetable back', () => {
    expect(plain(decodeTimetable(encodeTimetable(EMPTY, 0))?.timetable)).toEqual(plain(EMPTY))
  })

  it('reads a file that sits at an odd place in memory, as a Buffer from disk may', () => {
    const bytes = encodeTimetable(TT, DOWNLOADED_AT)
    const roomy = new Uint8Array(bytes.length + 3)
    roomy.set(bytes, 3)
    expect(plain(decodeTimetable(roomy.subarray(3))?.timetable)).toEqual(plain(TT))
  })

  it('gives null for a file cut short', () => {
    const bytes = encodeTimetable(TT, DOWNLOADED_AT)
    for (const length of [0, 5, 9, 20, bytes.length - 8, bytes.length - 1]) {
      expect(decodeTimetable(bytes.subarray(0, length))).toBeNull()
    }
  })

  it('gives null for another kind of file', () => {
    const bytes = encodeTimetable(TT, DOWNLOADED_AT)
    for (const magic of ['FSTT2\n', 'PK\u0003\u0004\0\0']) {
      const other = bytes.slice()
      other.set(new TextEncoder().encode(magic))
      expect(decodeTimetable(other)).toBeNull()
    }
    expect(decodeTimetable(new TextEncoder().encode('{"version":"1"}'))).toBeNull()
  })

  it('gives null for a header naming arrays past the end, or out of line', () => {
    const { header, data } = split(encodeTimetable(TT, DOWNLOADED_AT))
    // The helpers put a file back together as it was.
    expect(plain(decodeTimetable(join(header, data))?.timetable)).toEqual(plain(TT))
    const edits: ((table: Table) => void)[] = [
      (table) => (table[0]![1] = data.length + 8),
      (table) => (table[0]![2] = data.length),
      (table) => (table[table.length - 1]![2] += 1),
      (table) => (table[1]![1] += 4),
      (table) => (table[0]![0] = 'u32')
    ]
    for (const edit of edits) {
      const changed = structuredClone(header)
      edit(changed.arrays as Table)
      expect(decodeTimetable(join(changed, data))).toBeNull()
    }
  })

  it('gives null for a header that doesn’t add up', () => {
    const { header, data } = split(encodeTimetable(TT, DOWNLOADED_AT))
    const edits: ((h: Record<string, unknown>) => void)[] = [
      (h) => delete h.version,
      (h) => ((h.stops as { names: string[] }).names = ['A']),
      (h) => ((h.patterns as { route: number }[])[0]!.route = 2),
      (h) => ((h.patterns as { trips: string[] }[])[0]!.trips = ['t1']),
      (h) => ((h.patterns as { times: number }[])[0]!.times = 99),
      (h) => (h.services = [[20261102], ['soon']]),
      (h) => (h.downloadedAt = 'yesterday')
    ]
    for (const edit of edits) {
      const changed = structuredClone(header)
      edit(changed)
      expect(decodeTimetable(join(changed, data))).toBeNull()
    }
    const notJson = join(header, data)
    notJson[HEAD] = 0x7b + 1
    expect(decodeTimetable(notJson)).toBeNull()
  })

  it('gives null for arrays naming stops or services it hasn’t got', () => {
    const { header, data } = split(encodeTimetable(TT, DOWNLOADED_AT))
    const table = header.arrays as Table
    const patterns = header.patterns as { stops: number; service: number }[]
    const transfers = header.transfers as { start: number; to: number }
    const at = (index: number): number => table[index]![1]
    const cases: [offset: number, write: (view: DataView, offset: number) => void][] = [
      [at(patterns[0]!.stops), (view, offset) => view.setUint32(offset, 3, true)],
      [at(patterns[1]!.service), (view, offset) => view.setUint16(offset, 2, true)],
      [at(transfers.to), (view, offset) => view.setUint32(offset, 7, true)],
      [at(transfers.start) + 4, (view, offset) => view.setUint32(offset, 9, true)]
    ]
    for (const [offset, write] of cases) {
      const changed = data.slice()
      write(new DataView(changed.buffer), offset)
      expect(decodeTimetable(join(header, changed))).toBeNull()
    }
  })

  it('never throws, whatever it’s given', () => {
    const bytes = encodeTimetable(TT, DOWNLOADED_AT)
    // Park–Miller: the same garbling on every run.
    let seed = 7
    const random = (): number => (seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647
    for (let i = 0; i < 200; i++) {
      const garbled = bytes.slice()
      // Keep the magic, so the reading gets past it, and change a few bytes anywhere after.
      for (let k = 0; k < 4; k++) {
        garbled[6 + Math.floor(random() * (garbled.length - 6))] = Math.floor(random() * 256)
      }
      expect(() => decodeTimetable(garbled)).not.toThrow()
    }
  })
})
