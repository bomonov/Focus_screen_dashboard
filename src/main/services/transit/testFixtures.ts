// Tests only: builds GTFS-realtime messages and zip files byte by byte, so the readers are
// tested on made-up data rather than a captured feed.
import { deflateRawSync } from 'zlib'

/** A float field (fixed32), as GTFS-realtime gives positions. */
export class Float32 {
  constructor(readonly value: number) {}
}

/**
 * One protobuf field: a number (varint), a negative number (ten-byte varint), a float or a
 * message.
 */
export type ProtoValue = number | bigint | string | Uint8Array | Float32

function varint(value: bigint): number[] {
  let rest = BigInt.asUintN(64, value)
  const bytes: number[] = []
  do {
    const low = Number(rest & 0x7fn)
    rest >>= 7n
    bytes.push(rest > 0n ? low | 0x80 : low)
  } while (rest > 0n)
  return bytes
}

/** Encodes fields in order: [field number, value]. Strings and bytes are length-delimited. */
export function proto(fields: readonly (readonly [number, ProtoValue])[]): Uint8Array {
  const out: number[] = []
  for (const [field, value] of fields) {
    if (value instanceof Float32) {
      const bytes = new Uint8Array(4)
      new DataView(bytes.buffer).setFloat32(0, value.value, true)
      out.push(...varint(BigInt(field * 8 + 5)), ...bytes)
    } else if (typeof value === 'number' || typeof value === 'bigint') {
      out.push(...varint(BigInt(field * 8)), ...varint(BigInt(value)))
    } else {
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
      out.push(...varint(BigInt(field * 8 + 2)), ...varint(BigInt(bytes.length)), ...bytes)
    }
  }
  return Uint8Array.from(out)
}

export interface TestStop {
  sequence: number
  stopId: string
  arrival?: number
  departure?: number
  delay?: number
  /** StopTimeUpdate.ScheduleRelationship: 1 skipped. */
  relationship?: number
}

export interface TestTrip {
  tripId: string
  routeId: string
  directionId?: number
  /** TripDescriptor.ScheduleRelationship: 3 canceled. */
  relationship?: number
  vehicleId?: string
  stops: TestStop[]
}

function stopTimeEvent(time: number, delay: number | undefined): Uint8Array {
  return proto([...(delay !== undefined ? [[1, delay] as const] : []), [2, time]])
}

/** A FeedMessage of trip updates, laid out as gtfs-realtime.proto says. */
export function tripUpdatesMessage(timestamp: number, trips: readonly TestTrip[]): Uint8Array {
  const header = proto([
    [1, '2.0'],
    [3, timestamp]
  ])
  const entities = trips.map((trip, i) => {
    const descriptor = proto([
      [1, trip.tripId],
      [3, '20261019'],
      ...(trip.relationship !== undefined ? [[4, trip.relationship] as const] : []),
      [5, trip.routeId],
      ...(trip.directionId !== undefined ? [[6, trip.directionId] as const] : [])
    ])
    const updates = trip.stops.map((stop) =>
      proto([
        [1, stop.sequence],
        ...(stop.arrival !== undefined
          ? [[2, stopTimeEvent(stop.arrival, stop.delay)] as const]
          : []),
        ...(stop.departure !== undefined
          ? [[3, stopTimeEvent(stop.departure, stop.delay)] as const]
          : []),
        [4, stop.stopId],
        ...(stop.relationship !== undefined ? [[5, stop.relationship] as const] : [])
      ])
    )
    const tripUpdate = proto([
      [1, descriptor],
      ...updates.map((update) => [2, update] as const),
      ...(trip.vehicleId ? [[3, proto([[1, trip.vehicleId]])] as const] : [])
    ])
    return proto([
      [1, `RT|${i}`],
      [3, tripUpdate]
    ])
  })
  return proto([[1, header], ...entities.map((entity) => [2, entity] as const)])
}

export interface TestVehicle {
  vehicleId?: string
  tripId?: string
  routeId?: string
  directionId?: number
  stopId?: string
  lat?: number
  lon?: number
  bearing?: number
  timestamp?: number
  deleted?: boolean
}

/** A FeedMessage of vehicle positions, laid out as gtfs-realtime.proto says. */
export function vehiclePositionsMessage(
  timestamp: number,
  vehicles: readonly TestVehicle[]
): Uint8Array {
  const header = proto([
    [1, '2.0'],
    [3, timestamp]
  ])
  const entities = vehicles.map((vehicle, i) => {
    const position = proto([
      ...(vehicle.lat !== undefined ? [[1, new Float32(vehicle.lat)] as const] : []),
      ...(vehicle.lon !== undefined ? [[2, new Float32(vehicle.lon)] as const] : []),
      ...(vehicle.bearing !== undefined ? [[3, new Float32(vehicle.bearing)] as const] : [])
    ])
    const vehiclePosition = proto([
      ...(vehicle.tripId
        ? [
            [
              1,
              proto([
                [1, vehicle.tripId],
                ...(vehicle.routeId ? [[5, vehicle.routeId] as const] : []),
                ...(vehicle.directionId !== undefined ? [[6, vehicle.directionId] as const] : [])
              ])
            ] as const
          ]
        : []),
      [2, position],
      ...(vehicle.timestamp !== undefined ? [[5, vehicle.timestamp] as const] : []),
      ...(vehicle.stopId ? [[7, vehicle.stopId] as const] : []),
      ...(vehicle.vehicleId ? [[8, proto([[1, vehicle.vehicleId]])] as const] : [])
    ])
    return proto([
      [1, `VP|${i}`],
      ...(vehicle.deleted ? [[2, 1] as const] : []),
      [4, vehiclePosition]
    ])
  })
  return proto([[1, header], ...entities.map((entity) => [2, entity] as const)])
}

/** A zip of text files, deflated (or stored, for names in `stored`). */
export function zipOf(files: Record<string, string>, stored: readonly string[] = []): Uint8Array {
  const locals: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const raw = Buffer.from(text)
    const store = stored.includes(name)
    const data = store ? raw : deflateRawSync(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(store ? 0 : 8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    locals.push(local, nameBytes, data)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(store ? 0 : 8, 10)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(nameBytes.length, 28)
    entry.writeUInt32LE(offset, 42)
    directory.push(entry, nameBytes)
    offset += 30 + nameBytes.length + data.length
  }
  const directoryBytes = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directoryBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, directoryBytes, end]))
}
