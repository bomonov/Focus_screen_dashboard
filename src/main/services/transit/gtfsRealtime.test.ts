import { describe, expect, it } from 'vitest'
import { readTripUpdates, readVehiclePositions } from './gtfsRealtime'
import { ProtobufError, ProtoReader } from './protobuf'
import { Float32, proto, tripUpdatesMessage, vehiclePositionsMessage } from './testFixtures'

const NOW = 1_792_460_844

describe('ProtoReader', () => {
  it('reads varints, negative ones included', () => {
    const reader = new ProtoReader(
      proto([
        [1, 300],
        [2, -27],
        [3, NOW]
      ])
    )
    expect(reader.tag()).toEqual({ field: 1, wire: 0 })
    expect(reader.uint()).toBe(300)
    expect(reader.tag()).toEqual({ field: 2, wire: 0 })
    expect(reader.int()).toBe(-27)
    expect(reader.tag()).toEqual({ field: 3, wire: 0 })
    expect(reader.int()).toBe(NOW)
    expect(reader.done()).toBe(true)
  })

  it('skips every wire type it knows', () => {
    const bytes = Uint8Array.from([
      ...proto([[1, 5]]),
      // field 2, fixed64
      0x11,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      // field 3, fixed32
      0x1d,
      1,
      2,
      3,
      4,
      ...proto([[4, 'skip me']]),
      ...proto([[5, 'keep']])
    ])
    const reader = new ProtoReader(bytes)
    for (let i = 0; i < 4; i++) reader.skip(reader.tag().wire)
    expect(reader.tag().field).toBe(5)
    expect(reader.string()).toBe('keep')
  })

  it('throws on cut-off or unknown data instead of reading past the end', () => {
    const whole = proto([[1, 'Orbit Venus']])
    expect(() => new ProtoReader(whole.subarray(0, 5)).message()).toThrow(ProtobufError)
    const cut = new ProtoReader(whole.subarray(0, 5))
    cut.tag()
    expect(() => cut.string()).toThrow(ProtobufError)
    expect(() => new ProtoReader(Uint8Array.from([0x0b])).skip(3)).toThrow(ProtobufError)
    expect(() => new ProtoReader(Uint8Array.from(Array(11).fill(0xff))).uint()).toThrow(
      ProtobufError
    )
  })
})

describe('readTripUpdates', () => {
  it('reads trips, their stops and times', () => {
    const feed = readTripUpdates(
      tripUpdatesMessage(NOW, [
        {
          tripId: '24271149',
          routeId: 'VENU',
          directionId: 1,
          vehicleId: '8117',
          stops: [
            { sequence: 23, stopId: '6439', arrival: NOW + 3, departure: NOW + 3, delay: 27 },
            { sequence: 24, stopId: '6440', arrival: NOW + 58, delay: -12 },
            { sequence: 25, stopId: '6441', relationship: 1 }
          ]
        }
      ])
    )
    expect(feed.timestamp).toBe(NOW)
    expect(feed.trips).toEqual([
      {
        tripId: '24271149',
        routeId: 'VENU',
        directionId: 1,
        canceled: false,
        vehicleId: '8117',
        stops: [
          {
            stopSequence: 23,
            stopId: '6439',
            arrival: { time: NOW + 3, delay: 27 },
            departure: { time: NOW + 3, delay: 27 },
            relationship: 'scheduled'
          },
          {
            stopSequence: 24,
            stopId: '6440',
            arrival: { time: NOW + 58, delay: -12 },
            departure: null,
            relationship: 'scheduled'
          },
          {
            stopSequence: 25,
            stopId: '6441',
            arrival: null,
            departure: null,
            relationship: 'skipped'
          }
        ]
      }
    ])
  })

  it('marks canceled trips and leaves out deleted entities', () => {
    const message = tripUpdatesMessage(NOW, [
      { tripId: 'gone', routeId: '72', relationship: 3, stops: [] }
    ])
    expect(readTripUpdates(message).trips[0]?.canceled).toBe(true)
    const deleted = proto([
      [
        2,
        proto([
          [1, 'x'],
          [2, 1],
          [3, proto([[1, proto([[1, 'trip']])]])]
        ])
      ]
    ])
    expect(readTripUpdates(deleted).trips).toEqual([])
  })

  it('skips fields it doesn’t use, like vehicle positions in the same entity', () => {
    const entity = proto([
      [1, 'e'],
      [4, proto([[1, 'a vehicle position']])],
      [
        3,
        proto([
          [
            1,
            proto([
              [1, 'trip'],
              [5, '30']
            ])
          ],
          [99, 'future field']
        ])
      ]
    ])
    const feed = readTripUpdates(proto([[2, entity]]))
    expect(feed.trips.map((trip) => trip.routeId)).toEqual(['30'])
  })

  it('throws on bytes that aren’t a feed', () => {
    expect(() => readTripUpdates(new TextEncoder().encode('<html>Forbidden</html>'))).toThrow(
      ProtobufError
    )
  })
})

describe('readVehiclePositions', () => {
  it('reads where each bus is, with its trip, the stop it’s heading to and its heading', () => {
    const feed = readVehiclePositions(
      vehiclePositionsMessage(1_760_000_000, [
        {
          vehicleId: '6012',
          tripId: 'VENU0022-1',
          routeId: 'VENU',
          directionId: 1,
          stopId: '12511',
          lat: 33.4211,
          lon: -111.9401,
          bearing: 370,
          timestamp: 1_759_999_990
        },
        { vehicleId: '6013', lat: 33.42, lon: -111.93 }
      ])
    )
    expect(feed.timestamp).toBe(1_760_000_000)
    expect(feed.vehicles).toHaveLength(2)
    const [first, second] = feed.vehicles
    expect(first?.vehicleId).toBe('6012')
    expect(first?.tripId).toBe('VENU0022-1')
    expect(first?.routeId).toBe('VENU')
    expect(first?.directionId).toBe(1)
    expect(first?.stopId).toBe('12511')
    // Floats: as close as 32 bits get.
    expect(first?.lat).toBeCloseTo(33.4211, 4)
    expect(first?.lon).toBeCloseTo(-111.9401, 4)
    expect(first?.bearing).toBeCloseTo(10, 3)
    expect(first?.timestamp).toBe(1_759_999_990)
    expect(second).toMatchObject({
      tripId: '',
      routeId: '',
      directionId: null,
      stopId: '',
      bearing: null,
      timestamp: null
    })
  })

  it('leaves out deleted entities and buses without a real position', () => {
    const feed = readVehiclePositions(
      vehiclePositionsMessage(1, [
        { vehicleId: 'gone', lat: 33.4, lon: -111.9, deleted: true },
        { vehicleId: 'nowhere', lat: 0, lon: 0 },
        { vehicleId: 'half', lat: 33.4 },
        { vehicleId: 'wild', lat: 123, lon: -111.9 },
        { vehicleId: 'ok', lat: 33.4, lon: -111.9 }
      ])
    )
    expect(feed.vehicles.map((vehicle) => vehicle.vehicleId)).toEqual(['ok'])
  })

  it('reads a float field', () => {
    const reader = new ProtoReader(proto([[1, new Float32(-111.5)]]))
    reader.tag()
    expect(reader.float()).toBe(-111.5)
  })

  it('throws on a float cut short', () => {
    const reader = new ProtoReader(Uint8Array.from([0x0d, 0x00, 0x00]))
    reader.tag()
    expect(() => reader.float()).toThrow(ProtobufError)
  })
})
