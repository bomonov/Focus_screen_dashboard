// GTFS-realtime Trip Updates and Vehicle Positions (https://gtfs.org/realtime/proto/), read
// with the small wire reader: only the fields the arrival countdown and the route card's bus
// need. Everything in the feed is untrusted.
import { ProtoReader, WIRE_BYTES, WIRE_FIXED32, WIRE_VARINT } from './protobuf'

export interface StopTimeEvent {
  /** Unix epoch seconds; null when the feed gives only a delay. */
  time: number | null
  /** Seconds late (negative: early); null when not given. */
  delay: number | null
}

export type StopRelationship = 'scheduled' | 'skipped' | 'noData' | 'unscheduled'

export interface StopTimeUpdate {
  stopSequence: number | null
  stopId: string
  arrival: StopTimeEvent | null
  departure: StopTimeEvent | null
  relationship: StopRelationship
}

export interface FeedTrip {
  tripId: string
  routeId: string
  /** 0 or 1, as in the schedule's trips.txt; null when not given. */
  directionId: number | null
  /** Canceled or deleted: it won't come. */
  canceled: boolean
  /** The bus running it, when the feed says. */
  vehicleId: string
  stops: StopTimeUpdate[]
}

export interface TripUpdatesFeed {
  /** When the feed was made (Unix seconds); null when the header doesn't say. */
  timestamp: number | null
  trips: FeedTrip[]
}

/** Where a bus is, from the Vehicle Positions feed. */
export interface FeedVehicle {
  /** The bus's own id (as trip updates name it); "" when not given. */
  vehicleId: string
  /** The trip it's running now; "" when not given. */
  tripId: string
  /** That trip's route ("" when not given) and direction (0 or 1; null when not given). */
  routeId: string
  directionId: number | null
  /** The stop on that trip it's at or heading to; "" when not given. */
  stopId: string
  lat: number
  lon: number
  /** Degrees clockwise from north; null when not given. */
  bearing: number | null
  /** When the bus was there (Unix seconds); null when not given. */
  timestamp: number | null
}

export interface VehiclePositionsFeed {
  timestamp: number | null
  vehicles: FeedVehicle[]
}

// TripDescriptor.ScheduleRelationship
const TRIP_CANCELED = 3
const TRIP_DELETED = 7
// StopTimeUpdate.ScheduleRelationship, in its numbering.
const STOP_RELATIONSHIPS: readonly StopRelationship[] = [
  'scheduled',
  'skipped',
  'noData',
  'unscheduled'
]

/** Walks a message's fields, handing each to `read`; it returns false for ones to skip. */
function eachField(reader: ProtoReader, read: (field: number, wire: number) => boolean): void {
  while (!reader.done()) {
    const { field, wire } = reader.tag()
    if (!read(field, wire)) reader.skip(wire)
  }
}

function readHeader(reader: ProtoReader): number | null {
  let timestamp: number | null = null
  eachField(reader, (field, wire) => {
    if (field === 3 && wire === WIRE_VARINT) timestamp = reader.uint()
    else return false
    return true
  })
  return timestamp
}

function readStopTimeEvent(reader: ProtoReader): StopTimeEvent {
  const event: StopTimeEvent = { time: null, delay: null }
  eachField(reader, (field, wire) => {
    if (wire !== WIRE_VARINT) return false
    if (field === 1) event.delay = reader.int()
    else if (field === 2) event.time = reader.int()
    else return false
    return true
  })
  return event
}

function readStopTimeUpdate(reader: ProtoReader): StopTimeUpdate {
  const update: StopTimeUpdate = {
    stopSequence: null,
    stopId: '',
    arrival: null,
    departure: null,
    relationship: 'scheduled'
  }
  eachField(reader, (field, wire) => {
    if (field === 1 && wire === WIRE_VARINT) update.stopSequence = reader.uint()
    else if (field === 2 && wire === WIRE_BYTES)
      update.arrival = readStopTimeEvent(reader.message())
    else if (field === 3 && wire === WIRE_BYTES) {
      update.departure = readStopTimeEvent(reader.message())
    } else if (field === 4 && wire === WIRE_BYTES) update.stopId = reader.string()
    else if (field === 5 && wire === WIRE_VARINT) {
      // A value from a newer version of the spec is one we can't trust the times of.
      update.relationship = STOP_RELATIONSHIPS[reader.uint()] ?? 'noData'
    } else return false
    return true
  })
  return update
}

function readTripDescriptor(reader: ProtoReader, trip: FeedTrip): void {
  eachField(reader, (field, wire) => {
    if (field === 1 && wire === WIRE_BYTES) trip.tripId = reader.string()
    else if (field === 4 && wire === WIRE_VARINT) {
      const relationship = reader.uint()
      trip.canceled = relationship === TRIP_CANCELED || relationship === TRIP_DELETED
    } else if (field === 5 && wire === WIRE_BYTES) trip.routeId = reader.string()
    else if (field === 6 && wire === WIRE_VARINT) trip.directionId = reader.uint()
    else return false
    return true
  })
}

function readVehicleId(reader: ProtoReader): string {
  let id = ''
  eachField(reader, (field, wire) => {
    if (field === 1 && wire === WIRE_BYTES) id = reader.string()
    else return false
    return true
  })
  return id
}

function readTripUpdate(reader: ProtoReader): FeedTrip {
  const trip: FeedTrip = {
    tripId: '',
    routeId: '',
    directionId: null,
    canceled: false,
    vehicleId: '',
    stops: []
  }
  eachField(reader, (field, wire) => {
    if (wire !== WIRE_BYTES) return false
    if (field === 1) readTripDescriptor(reader.message(), trip)
    else if (field === 2) trip.stops.push(readStopTimeUpdate(reader.message()))
    else if (field === 3) trip.vehicleId = readVehicleId(reader.message())
    else return false
    return true
  })
  return trip
}

/** The trip updates in an entity, or null for a deleted entity or one with something else. */
function readEntity(reader: ProtoReader): FeedTrip | null {
  let trip: FeedTrip | null = null
  let deleted = false
  eachField(reader, (field, wire) => {
    if (field === 2 && wire === WIRE_VARINT) deleted = reader.uint() !== 0
    else if (field === 3 && wire === WIRE_BYTES) trip = readTripUpdate(reader.message())
    else return false
    return true
  })
  return deleted ? null : trip
}

/** A FeedMessage's trip updates. Throws ProtobufError when the bytes aren't one. */
export function readTripUpdates(bytes: Uint8Array): TripUpdatesFeed {
  const reader = new ProtoReader(bytes)
  const feed: TripUpdatesFeed = { timestamp: null, trips: [] }
  eachField(reader, (field, wire) => {
    if (wire !== WIRE_BYTES) return false
    if (field === 1) feed.timestamp = readHeader(reader.message())
    else if (field === 2) {
      const trip = readEntity(reader.message())
      if (trip && trip.tripId) feed.trips.push(trip)
    } else return false
    return true
  })
  return feed
}

function readPosition(reader: ProtoReader): Pick<FeedVehicle, 'lat' | 'lon' | 'bearing'> | null {
  let lat: number | null = null
  let lon: number | null = null
  let bearing: number | null = null
  eachField(reader, (field, wire) => {
    if (wire !== WIRE_FIXED32) return false
    if (field === 1) lat = reader.float()
    else if (field === 2) lon = reader.float()
    else if (field === 3) bearing = reader.float()
    else return false
    return true
  })
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null
  const heading =
    bearing !== null && Number.isFinite(bearing) ? ((bearing % 360) + 360) % 360 : null
  return { lat, lon, bearing: heading }
}

function readVehiclePosition(reader: ProtoReader): FeedVehicle | null {
  const trip: FeedTrip = {
    tripId: '',
    routeId: '',
    directionId: null,
    canceled: false,
    vehicleId: '',
    stops: []
  }
  let position: Pick<FeedVehicle, 'lat' | 'lon' | 'bearing'> | null = null
  let timestamp: number | null = null
  let stopId = ''
  eachField(reader, (field, wire) => {
    if (field === 1 && wire === WIRE_BYTES) readTripDescriptor(reader.message(), trip)
    else if (field === 2 && wire === WIRE_BYTES) position = readPosition(reader.message())
    else if (field === 5 && wire === WIRE_VARINT) timestamp = reader.uint()
    else if (field === 7 && wire === WIRE_BYTES) stopId = reader.string()
    else if (field === 8 && wire === WIRE_BYTES) trip.vehicleId = readVehicleId(reader.message())
    else return false
    return true
  })
  // Set inside the callback, which TypeScript can't see: it would narrow this to null.
  const place = position as Pick<FeedVehicle, 'lat' | 'lon' | 'bearing'> | null
  if (!place) return null
  return {
    vehicleId: trip.vehicleId,
    tripId: trip.tripId,
    routeId: trip.routeId,
    directionId: trip.directionId,
    stopId,
    ...place,
    timestamp
  }
}

/** The vehicle in an entity, or null for a deleted entity or one with something else. */
function readVehicleEntity(reader: ProtoReader): FeedVehicle | null {
  let vehicle: FeedVehicle | null = null
  let deleted = false
  eachField(reader, (field, wire) => {
    if (field === 2 && wire === WIRE_VARINT) deleted = reader.uint() !== 0
    else if (field === 4 && wire === WIRE_BYTES) vehicle = readVehiclePosition(reader.message())
    else return false
    return true
  })
  return deleted ? null : vehicle
}

/** A FeedMessage's vehicle positions. Throws ProtobufError when the bytes aren't one. */
export function readVehiclePositions(bytes: Uint8Array): VehiclePositionsFeed {
  const reader = new ProtoReader(bytes)
  const feed: VehiclePositionsFeed = { timestamp: null, vehicles: [] }
  eachField(reader, (field, wire) => {
    if (wire !== WIRE_BYTES) return false
    if (field === 1) feed.timestamp = readHeader(reader.message())
    else if (field === 2) {
      const vehicle = readVehicleEntity(reader.message())
      if (vehicle) feed.vehicles.push(vehicle)
    } else return false
    return true
  })
  return feed
}
