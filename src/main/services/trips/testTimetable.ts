// A small timetable made from a few lines, so the planner's tests say what runs where and when
// instead of loading a schedule. It's written out as a schedule zip and read by buildTimetable,
// so it keeps the real timetable's rules (patterns, overtaking, service days, transfers). Only
// tests import this.
import { distanceM, type LatLon } from '../transit/routeLine'
import { zipOf } from '../transit/testFixtures'
import { buildTimetable } from './timetable'
import type { Timetable } from './types'

export interface TestSpec {
  stops: Record<string, LatLon>
  routes: {
    id: string
    trips: {
      id: string
      /** yyyymmdd dates it runs; Mon 2 Nov 2026 when left out. */
      dates?: number[]
      /** One time a stop ("HH:MM" or "HH:MM:SS", past midnight as 24:10): it arrives and leaves then. */
      stops: [stop: string, time: string][]
    }[]
  }[]
}

const TEMPE: LatLon = [33.4242, -111.9281]
// Degrees a metre is, read off distanceM itself, so `near` can't drift from what it measures.
const DEG_PER_M_NORTH = 1 / distanceM(TEMPE, [TEMPE[0] + 1, TEMPE[1]])
const DEG_PER_M_EAST = 1 / distanceM(TEMPE, [TEMPE[0], TEMPE[1] + 1])

/** A point `northM` north and `eastM` east of Tempe (33.4242, −111.9281), either may be negative. */
export function near(northM: number, eastM: number): LatLon {
  return [TEMPE[0] + northM * DEG_PER_M_NORTH, TEMPE[1] + eastM * DEG_PER_M_EAST]
}

const DEFAULT_DATES = [20261102]

function secondsOf(time: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time)
  if (!match) throw new Error(`Test timetable: can't read the time "${time}"`)
  const [, hours, minutes, seconds] = match
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds ?? 0)
}

/** Seconds as GTFS writes them: "24:10:00" past midnight. */
function clock(seconds: number): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}`
}

/** A CSV field, quoted when it holds a comma, a quote or a line break. */
function field(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const file = (header: string, rows: string[]): string =>
  `${header}\n${rows.map((row) => `${row}\n`).join('')}`

/**
 * The spec as a timetable. Stops are named by their ids; routes are buses with no colours; a trip
 * heads to its last stop, direction unknown. Rejects a stop or time it can't read, so a typo in
 * a test is loud rather than a stop quietly left out.
 */
export async function testTimetable(spec: TestSpec): Promise<Timetable> {
  const ids = Object.keys(spec.stops)
  const services = new Map<string, string>()
  const calendar: string[] = []
  const serviceFor = (dates: number[]): string => {
    const sorted = [...new Set(dates)].sort((a, b) => a - b)
    const key = sorted.join(',')
    let service = services.get(key)
    if (service === undefined) {
      service = `s${services.size}`
      services.set(key, service)
      calendar.push(...sorted.map((date) => `${service},${date},1`))
    }
    return service
  }

  const trips: string[] = []
  const stopTimes: string[] = []
  for (const route of spec.routes) {
    for (const trip of route.trips) {
      if (trip.stops.length === 0) throw new Error(`Test timetable: trip ${trip.id} has no stops`)
      const service = serviceFor(trip.dates ?? DEFAULT_DATES)
      trips.push(`${field(route.id)},${service},${field(trip.id)},,`)
      trip.stops.forEach(([stop, time], i) => {
        if (!ids.includes(stop)) throw new Error(`Test timetable: no stop "${stop}" in the spec`)
        const at = clock(secondsOf(time))
        stopTimes.push(`${field(trip.id)},${at},${at},${field(stop)},${i + 1}`)
      })
    }
  }

  return buildTimetable(
    zipOf({
      'routes.txt': file(
        'route_id,route_short_name,route_long_name,route_type',
        spec.routes.map(({ id }) => `${field(id)},${field(id)},,3`)
      ),
      'stops.txt': file(
        'stop_id,stop_name,stop_lat,stop_lon',
        Object.entries(spec.stops).map(
          ([id, [lat, lon]]) => `${field(id)},${field(id)},${lat},${lon}`
        )
      ),
      'trips.txt': file('route_id,service_id,trip_id,trip_headsign,direction_id', trips),
      'stop_times.txt': file(
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
        stopTimes
      ),
      'calendar_dates.txt': file('service_id,date,exception_type', calendar),
      'feed_info.txt': file('feed_version', ['test'])
    })
  )
}
