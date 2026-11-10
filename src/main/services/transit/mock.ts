// Dev builds only: two real stops by ASU's Tempe campus with their real routes and paths (from
// Valley Metro's schedule of 2026-09-14, simplified), and made-up buses that keep coming along
// them, so Next bus and its route card can be worked on without the schedule download or the
// live feeds. Never shipped.
import type { FeedTrip, FeedVehicle, TripUpdatesFeed } from './gtfsRealtime'
import { decodeLine, isLoop, lineDistances, placeOnLine, pointAlong } from './routeLine'
import type { StopList } from './stopList'
import type { ArrivalFeed, VehicleFeed } from './valleyMetro'

const MILL_UNIVERSITY = 'demo:mill-university'
const RURAL_TERRACE = 'demo:rural-terrace'

const POSITIONS: Record<string, [number, number]> = {
  [MILL_UNIVERSITY]: [33.421085, -111.94014],
  [RURAL_TERRACE]: [33.418279, -111.926478]
}

/** The paths these routes take past the two stops: lat, lon, lat, lon… */
const LINES: Record<string, number[]> = {
  // VENU0022: 25 points, 9.6 km
  VENU0022: [
    33.42581, -111.93606, 33.42577, -111.93548, 33.42551, -111.93535, 33.4255, -111.93497, 33.42193,
    -111.93497, 33.42197, -111.94006, 33.41906, -111.94001, 33.41904, -111.94325, 33.4189,
    -111.94424, 33.41462, -111.94427, 33.41463, -111.94789, 33.40738, -111.94787, 33.40741,
    -111.95527, 33.40877, -111.95517, 33.41067, -111.95605, 33.41467, -111.95603, 33.41463,
    -111.95649, 33.42192, -111.95648, 33.42193, -111.96523, 33.42562, -111.96525, 33.42572,
    -111.96186, 33.4255, -111.96043, 33.4255, -111.93667, 33.42573, -111.9366, 33.42581, -111.93606
  ],
  // JUPI0027: 34 points, 10.0 km
  JUPI0027: [
    33.42581, -111.93612, 33.42573, -111.9366, 33.4255, -111.93667, 33.42549, -111.94005, 33.41762,
    -111.93999, 33.41745, -111.93984, 33.41744, -111.93661, 33.41462, -111.93657, 33.41462,
    -111.93492, 33.38961, -111.93501, 33.38951, -111.93398, 33.38874, -111.93177, 33.38865,
    -111.93071, 33.39292, -111.93063, 33.39296, -111.92634, 33.3911, -111.92638, 33.3911,
    -111.92724, 33.39071, -111.92739, 33.39069, -111.92822, 33.39085, -111.92871, 33.39121,
    -111.92897, 33.39294, -111.92891, 33.39296, -111.92303, 33.39127, -111.92306, 33.39128,
    -111.91982, 33.39159, -111.91818, 33.39159, -111.91559, 33.39051, -111.9156, 33.3905,
    -111.91211, 33.39061, -111.91144, 33.39297, -111.91138, 33.39297, -111.9091, 33.39662,
    -111.90914, 33.39661, -111.90443
  ],
  // 720115: 32 points, 45.7 km
  '720115': [
    33.66978, -111.92141, 33.66978, -111.92537, 33.61123, -111.92582, 33.61121, -111.92314,
    33.60991, -111.92412, 33.60981, -111.9248, 33.60984, -111.92539, 33.61025, -111.92532, 33.61062,
    -111.92466, 33.61063, -111.92333, 33.61121, -111.92314, 33.61123, -111.92582, 33.55292,
    -111.92609, 33.5314, -111.92569, 33.48991, -111.92611, 33.48914, -111.92669, 33.48763,
    -111.92615, 33.39296, -111.92634, 33.38293, -111.92657, 33.37913, -111.92866, 33.32, -111.92815,
    33.30544, -111.92862, 33.3056, -111.90291, 33.3033, -111.90228, 33.29974, -111.90225, 33.29883,
    -111.9019, 33.29828, -111.90136, 33.29872, -111.90084, 33.29828, -111.89938, 33.29881,
    -111.89792, 33.29778, -111.89793, 33.29774, -111.89982
  ]
}

export function demoStopList(now: number): StopList {
  return {
    downloadedAt: now,
    version: 'demo',
    routes: {
      VENU: { short: 'VENU', long: 'Orbit Venus' },
      JUPI: { short: 'JUPI', long: 'Orbit Jupiter' },
      '72': { short: '72', long: 'Scottsdale Rd/Rural Rd' }
    },
    stops: [
      {
        id: MILL_UNIVERSITY,
        code: '12511',
        name: 'Mill Ave & University Dr',
        detail: 'SB Mill Av & FS University Dr',
        station: '',
        serves: [
          ['JUPI', 1, 'McClintock High School', 'JUPI0027'],
          ['VENU', 0, 'Venus Forward', 'VENU0022']
        ],
        position: POSITIONS[MILL_UNIVERSITY]
      },
      {
        id: RURAL_TERRACE,
        code: '14817',
        name: 'Rural Rd & Terrace Rd',
        detail: 'SB Rural Rd & FS Terrace Mall',
        station: '',
        serves: [['72', 1, 'Chandler Fashion Ctr', '720115']],
        position: POSITIONS[RURAL_TERRACE]
      }
    ],
    lines: LINES
  }
}

/** The first stop is the one shown when none of the picked stops are demo stops. */
export const DEMO_STOP = MILL_UNIVERSITY

/** [route, direction, stop, path, minutes between buses, minutes past the hour of the first] */
const RUNS: readonly (readonly [string, number, string, string, number, number])[] = [
  ['VENU', 0, MILL_UNIVERSITY, 'VENU0022', 15, 4],
  ['JUPI', 1, MILL_UNIVERSITY, 'JUPI0027', 15, 9],
  ['72', 1, RURAL_TERRACE, '720115', 20, 2]
]

/** A city bus's pace, stops included: about 25 km/h. */
const SPEED_M_PER_SEC = 7

interface DemoTrip {
  id: string
  route: string
  direction: number
  stop: string
  line: string
  /** When it reaches the stop (Unix seconds). */
  at: number
  vehicleId: string
}

/** The made-up buses due in the next half hour. */
function demoTrips(nowSec: number): DemoTrip[] {
  const hour = nowSec - (nowSec % 3600)
  const trips: DemoTrip[] = []
  for (const [route, direction, stop, line, every, first] of RUNS) {
    for (let at = hour - 3600 + first * 60; at < nowSec + 30 * 60; at += every * 60) {
      if (at < nowSec - 60) continue
      const id = `demo:${route}:${at}`
      trips.push({ id, route, direction, stop, line, at, vehicleId: `bus-${id}` })
    }
  }
  return trips
}

/** The made-up buses, like the live feed would give them. */
export function demoFeed(now: () => number): ArrivalFeed {
  return {
    read: async () => {
      const nowSec = Math.floor(now() / 1000)
      const trips = demoTrips(nowSec).map((trip): FeedTrip => ({
        tripId: trip.id,
        routeId: trip.route,
        directionId: trip.direction,
        canceled: false,
        vehicleId: trip.vehicleId,
        stops: [
          {
            stopSequence: 1,
            stopId: trip.stop,
            arrival: { time: trip.at, delay: 0 },
            departure: null,
            relationship: 'scheduled'
          }
        ]
      }))
      const feed: TripUpdatesFeed = { timestamp: nowSec, trips }
      return { ok: true, feed }
    }
  }
}

/** Where a made-up bus is: on its path, as far before the stop as it has time left to go. */
function demoPosition(trip: DemoTrip, nowSec: number): FeedVehicle | null {
  const line = decodeLine(LINES[trip.line])
  const stop = POSITIONS[trip.stop]
  const place = line && stop ? placeOnLine(line, stop) : null
  if (!line || !place) return null
  const total = lineDistances(line).at(-1) ?? 0
  let along = place.along - Math.max(0, trip.at - nowSec) * SPEED_M_PER_SEC
  // A loop's bus comes round from its last stretch; any other waits at the start.
  along = isLoop(line) ? ((along % total) + total) % total : Math.max(0, along)
  const position = pointAlong(line, along)
  if (!position) return null
  const [lat, lon] = position
  return {
    vehicleId: trip.vehicleId,
    tripId: trip.id,
    routeId: trip.route,
    directionId: trip.direction,
    stopId: trip.stop,
    lat,
    lon,
    bearing: null,
    timestamp: nowSec
  }
}

/** The made-up buses' positions, like Valley Metro's Vehicle Locations would give them. */
export function demoVehicles(now: () => number): VehicleFeed {
  return {
    read: async () => {
      const nowSec = Math.floor(now() / 1000)
      const vehicles = demoTrips(nowSec).flatMap((trip) => demoPosition(trip, nowSec) ?? [])
      return { ok: true, feed: { timestamp: nowSec, vehicles } }
    }
  }
}
