// The trip planner's timetable: Valley Metro's schedule (the zip Next bus downloads for its stop
// list) as patterns of trips for the search to scan, made once per download and saved by
// timetableFile.ts.
import { distanceM, isPosition, type LatLon } from '../transit/routeLine'
import {
  feedVersion,
  MAX_ID_CHARS,
  MAX_TEXT_CHARS,
  MAX_TRIP_STOPS,
  openSchedule,
  type ScheduleZip
} from '../transit/scheduleZip'
import { ZipError } from '../transit/zip'
import { TRANSFER_MAX_M, type Pattern, type Timetable, type TimetableRoute } from './types'

// Valley Metro has ~8,100 stops, ~18,600 trips, ~920,000 stop times and ~1,900 service days
// (2026-11); far more than these isn't a bus schedule, and would only fill the memory.
const MAX_STOPS = 200_000
const MAX_TRIPS = 200_000
const MAX_STOP_TIMES = 5_000_000
const MAX_SERVICE_DAYS = 1_000_000
/** Pattern.service is a Uint16Array. */
const MAX_SERVICES = 0x10000
/** A calendar.txt row counts at most this many days on from its start (Valley Metro's span 91). */
const MAX_CALENDAR_DAYS = 800

const DAY_MS = 86_400_000
/** Arizona keeps UTC−7 all year. */
const ARIZONA_SEC = 7 * 3600
const COLOR = /^#?([0-9A-Fa-f]{6})$/

/**
 * Midnight in Arizona at the start of yyyymmdd, in unix seconds: what the timetable's times count
 * from. GTFS counts from noon minus 12 hours, which is midnight wherever the clocks don't change.
 */
export function serviceDayStart(date: number): number {
  const year = Math.floor(date / 10000)
  const month = Math.floor(date / 100) % 100
  return Date.UTC(year, month - 1, date % 100) / 1000 + ARIZONA_SEC
}

/** yyyymmdd as UTC milliseconds; NaN when it isn't a day. */
function dayMs(text: string): number {
  if (!/^\d{8}$/.test(text)) return NaN
  const date = Number(text)
  const ms = (serviceDayStart(date) - ARIZONA_SEC) * 1000
  return dateOf(ms) === date ? ms : NaN
}

function dateOf(ms: number): number {
  const day = new Date(ms)
  return day.getUTCFullYear() * 10000 + (day.getUTCMonth() + 1) * 100 + day.getUTCDate()
}

/** "25:10:00" is 90600: a trip that runs past midnight counts on from its service day's. */
function secondsOf(text: string): number {
  const match = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(text)
  if (!match) return NaN
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

function tooBig(what: string): ZipError {
  return new ZipError(`The schedule has too many ${what}.`)
}

/**
 * The days each service_id runs: calendar.txt's weekdays between its dates, when there is one
 * (Valley Metro's schedule has none), then calendar_dates.txt's days added (1) and taken off (2).
 */
async function serviceDays(schedule: ScheduleZip): Promise<Map<string, Set<number>>> {
  const hasCalendar = schedule.has('calendar.txt')
  const hasDates = schedule.has('calendar_dates.txt')
  if (!hasCalendar && !hasDates) throw new ZipError('The schedule has no calendar.')
  const days = new Map<string, Set<number>>()
  let count = 0
  const add = (id: string, date: number): void => {
    let dates = days.get(id)
    if (!dates) days.set(id, (dates = new Set()))
    if (++count > MAX_SERVICE_DAYS) throw tooBig('service days')
    dates.add(date)
  }
  if (hasCalendar) {
    await schedule.rows(
      'calendar.txt',
      [
        'service_id',
        // In getUTCDay()'s order, Sunday first.
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'start_date',
        'end_date'
      ],
      ([id, ...rest]) => {
        const weekdays = rest.slice(0, 7).map((flag) => flag === '1')
        const from = dayMs(rest[7])
        const to = Math.min(dayMs(rest[8]), from + (MAX_CALENDAR_DAYS - 1) * DAY_MS)
        if (!id || id.length > MAX_ID_CHARS || Number.isNaN(to)) return
        for (let ms = from; ms <= to; ms += DAY_MS) {
          if (weekdays[new Date(ms).getUTCDay()]) add(id, dateOf(ms))
        }
      }
    )
  }
  if (hasDates) {
    await schedule.rows(
      'calendar_dates.txt',
      ['service_id', 'date', 'exception_type'],
      ([id, date, type]) => {
        if (!id || id.length > MAX_ID_CHARS || Number.isNaN(dayMs(date))) return
        if (type === '1') add(id, Number(date))
        else if (type === '2') days.get(id)?.delete(Number(date))
      }
    )
  }
  return days
}

interface Trip {
  id: string
  route: number
  direction: number
  headsign: string
  service: number
}

/** A stop time's flags: pickup_type or drop_off_type 1, no one gets on or off there. */
const NO_PICKUP = 1
const NO_DROP_OFF = 2
/** A trip's stop times are kept as [stop_sequence, stop, arrival, departure, flags]. */
const STRIDE = 5

/** A trip's stops in visiting order, and its [arrival, departure] at each. */
interface Run {
  stops: number[]
  times: Int32Array
  /** Its departure from its first stop, kept or not: where frequencies.txt's runs count from. */
  start: number
}

/**
 * A trip's stop times (as the file listed them) in stop_sequence order, without the stops riders
 * can't use: at either end, the ones where no one may get on (start) or off (end); along the
 * way, any where one of those is barred, as the search's patterns can't say which, and a ride
 * missed there is better than one the bus won't give. Null when it can't be ridden: fewer than
 * two stops left, or times that go back (the search rides a trip forwards in time).
 */
function runOf(rows: readonly number[]): Run | null {
  const count = rows.length / STRIDE
  if (count < 2 || count > MAX_TRIP_STOPS) return null
  const order = Array.from({ length: count }, (_, i) => i * STRIDE).sort(
    (a, b) => (rows[a] as number) - (rows[b] as number)
  )
  let previous = -Infinity
  for (const at of order) {
    const arrives = rows[at + 2] as number
    const leaves = rows[at + 3] as number
    if (arrives < previous || leaves < arrives) return null
    previous = leaves
  }
  const flags = (p: number): number => rows[(order[p] as number) + 4] as number
  let first = 0
  let last = count - 1
  while (first <= last && flags(first) & NO_PICKUP) first++
  while (last >= first && flags(last) & NO_DROP_OFF) last--
  const stops: number[] = []
  const times: number[] = []
  for (let p = first; p <= last; p++) {
    if (p > first && p < last && flags(p) !== 0) continue
    const at = order[p] as number
    stops.push(rows[at + 1] as number)
    times.push(rows[at + 2] as number, rows[at + 3] as number)
  }
  if (stops.length < 2) return null
  return { stops, times: Int32Array.from(times), start: rows[(order[0] as number) + 3] as number }
}

interface Member {
  id: string
  service: number
  times: Int32Array
}

/**
 * By first departure, then the times after it in order, then trip id: the same order whatever
 * order the file lists them in.
 */
function byDeparture(a: Member, b: Member): number {
  const first = (a.times[1] as number) - (b.times[1] as number)
  if (first !== 0) return first
  for (let k = 0; k < a.times.length; k++) {
    const later = (a.times[k] as number) - (b.times[k] as number)
    if (later !== 0) return later
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function notBefore(times: Int32Array, previous: Int32Array): boolean {
  for (let k = 0; k < times.length; k++) {
    if ((times[k] as number) < (previous[k] as number)) return false
  }
  return true
}

/** Trips of one route, direction and headsign that make the same stops. */
interface Group {
  route: number
  direction: number
  headsign: string
  stops: number[]
  members: Member[]
}

/**
 * One group's trips as patterns. The search takes the first trip it can catch at a stop, which is
 * only the soonest there if none passes another, so a trip that would overtake one before it
 * (anywhere along) goes in the first pattern it keeps order in, or one of its own.
 */
function patternsOf(group: Group): Pattern[] {
  const lanes: Member[][] = []
  for (const member of [...group.members].sort(byDeparture)) {
    const lane = lanes.find((trips) => notBefore(member.times, (trips.at(-1) as Member).times))
    if (lane) lane.push(member)
    else lanes.push([member])
  }
  const width = group.stops.length * 2
  return lanes.map((members) => {
    const times = new Int32Array(members.length * width)
    members.forEach((member, t) => times.set(member.times, t * width))
    return {
      route: group.route,
      direction: group.direction,
      headsign: group.headsign,
      stops: Uint32Array.from(group.stops),
      trips: members.map((member) => member.id),
      service: Uint16Array.from(members, (member) => member.service),
      times
    }
  })
}

/** Metres a degree of latitude is, as distanceM measures it. */
const M_PER_DEG_LAT = distanceM([0, 0], [1, 0])

/**
 * Each stop's neighbours within TRANSFER_MAX_M (never itself), in stop order. Stops are swept by
 * latitude, so each is measured only against the band of stops that near north or south of it.
 */
function transfersOf(lat: Float64Array, lon: Float64Array): Timetable['transfers'] {
  const count = lat.length
  const byLat = Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => (lat[a] as number) - (lat[b] as number)
  )
  // [stop, metres] pairs per stop.
  const near: number[][] = Array.from({ length: count }, () => [])
  // A hair over, so a stop right at the limit isn't lost to rounding.
  const band = TRANSFER_MAX_M / M_PER_DEG_LAT + 1e-9
  for (let a = 0; a < count; a++) {
    const i = byLat[a] as number
    const here: LatLon = [lat[i] as number, lon[i] as number]
    for (let b = a + 1; b < count; b++) {
      const j = byLat[b] as number
      if ((lat[j] as number) - here[0] > band) break
      const there: LatLon = [lat[j] as number, lon[j] as number]
      // distanceM measures in its first point's frame, so each way is measured from its own stop.
      const out = distanceM(here, there)
      const back = distanceM(there, here)
      if (out <= TRANSFER_MAX_M) (near[i] as number[]).push(j, Math.round(out))
      if (back <= TRANSFER_MAX_M) (near[j] as number[]).push(i, Math.round(back))
    }
  }
  const start = new Uint32Array(count + 1)
  const to: number[] = []
  const metres: number[] = []
  near.forEach((pairs, i) => {
    const order = Array.from({ length: pairs.length / 2 }, (_, k) => k * 2).sort(
      (x, y) => (pairs[x] as number) - (pairs[y] as number)
    )
    for (const k of order) {
      to.push(pairs[k] as number)
      metres.push(pairs[k + 1] as number)
    }
    start[i + 1] = to.length
  })
  return { start, to: Uint32Array.from(to), metres: Uint16Array.from(metres) }
}

/**
 * By trip, the first departure of each run frequencies.txt makes of it: every headway_secs from
 * start_time while before end_time. Such a trip's own stop_times are only a template for its
 * runs (Valley Metro's are the PHX Sky Train, every 4½ minutes most of the day). Optional.
 */
async function frequencyRuns(
  schedule: ScheduleZip,
  tripIndex: ReadonlyMap<string, number>,
  tripCount: number
): Promise<Map<number, Set<number>>> {
  const runs = new Map<number, Set<number>>()
  if (!schedule.has('frequencies.txt')) return runs
  let count = tripCount
  await schedule.rows(
    'frequencies.txt',
    ['trip_id', 'start_time', 'end_time', 'headway_secs'],
    ([tripId, startTime, endTime, headway]) => {
      const trip = tripIndex.get(tripId)
      const from = secondsOf(startTime)
      const to = secondsOf(endTime)
      const every = Number(headway)
      if (trip === undefined || Number.isNaN(from) || Number.isNaN(to)) return
      if (headway === '' || !Number.isInteger(every) || every <= 0) return
      let starts = runs.get(trip)
      if (!starts) runs.set(trip, (starts = new Set()))
      for (let at = from; at < to; at += every) {
        if (++count > MAX_TRIPS) throw tooBig('trips')
        starts.add(at)
      }
    }
  )
  return runs
}

/** Reads the schedule's zip into a timetable. Throws ZipError when it isn't a GTFS schedule. */
export async function buildTimetable(zip: Uint8Array): Promise<Timetable> {
  const schedule = openSchedule(zip)

  const routes: TimetableRoute[] = []
  const routeIndex = new Map<string, number>()
  await schedule.rows(
    'routes.txt',
    [
      'route_id',
      'route_short_name',
      'route_long_name',
      'route_type',
      'route_color',
      'route_text_color'
    ],
    ([id, short, long, type, color, textColor]) => {
      if (!id || id.length > MAX_ID_CHARS || routeIndex.has(id)) return
      const kind = Number(type)
      routeIndex.set(id, routes.length)
      routes.push({
        id,
        short: short.slice(0, MAX_TEXT_CHARS),
        long: long.slice(0, MAX_TEXT_CHARS),
        color: COLOR.exec(color)?.[1] ?? '',
        textColor: COLOR.exec(textColor)?.[1] ?? '',
        // A route that doesn't say is most likely a bus, as nearly all of Valley Metro's are.
        type: type !== '' && Number.isInteger(kind) && kind >= 0 && kind < 10000 ? kind : 3
      })
    }
  )

  const days = await serviceDays(schedule)
  const services: Int32Array[] = []
  const serviceByDates = new Map<string, number>()
  const serviceById = new Map<string, number>()
  /** A service_id's index, shared by every service_id that runs the same days; -1 for none. */
  const serviceFor = (id: string): number => {
    let service = serviceById.get(id)
    if (service !== undefined) return service
    const dates = [...(days.get(id) ?? [])].sort((a, b) => a - b)
    const key = dates.join(',')
    service = dates.length === 0 ? -1 : serviceByDates.get(key)
    if (service === undefined) {
      if (services.length >= MAX_SERVICES) throw tooBig('services')
      service = services.length
      services.push(Int32Array.from(dates))
      serviceByDates.set(key, service)
    }
    serviceById.set(id, service)
    return service
  }

  const trips: Trip[] = []
  const tripIndex = new Map<string, number>()
  await schedule.rows(
    'trips.txt',
    ['trip_id', 'route_id', 'service_id', 'trip_headsign', 'direction_id'],
    ([id, routeId, serviceId, headsign, direction]) => {
      const route = routeIndex.get(routeId)
      if (!id || id.length > MAX_ID_CHARS || route === undefined || tripIndex.has(id)) return
      const service = serviceFor(serviceId)
      // A trip that never runs is no use to plan with.
      if (service < 0) return
      if (trips.length >= MAX_TRIPS) throw tooBig('trips')
      tripIndex.set(id, trips.length)
      trips.push({
        id,
        route,
        direction: direction === '0' || direction === '1' ? Number(direction) : -1,
        headsign: headsign.slice(0, MAX_TEXT_CHARS),
        service
      })
    }
  )

  const ids: string[] = []
  const names: string[] = []
  const lats: number[] = []
  const lons: number[] = []
  const stopIndex = new Map<string, number>()
  await schedule.rows(
    'stops.txt',
    ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type'],
    ([id, name, lat, lon, type]) => {
      if (!id || id.length > MAX_ID_CHARS || stopIndex.has(id)) return
      // Stations and entrances (1–4) group stops; buses and trains only stop at plain stops.
      if (type !== '' && type !== '0') return
      const position = [Number(lat), Number(lon)]
      // Without a place there's no walking to it.
      if (!lat || !lon || !isPosition(position)) return
      if (ids.length >= MAX_STOPS) throw tooBig('stops')
      stopIndex.set(id, ids.length)
      ids.push(id)
      names.push(name.slice(0, MAX_TEXT_CHARS))
      lats.push(position[0])
      lons.push(position[1])
    }
  )

  const stopTimes: number[][] = trips.map(() => [])
  let stopTimeCount = 0
  await schedule.rows(
    'stop_times.txt',
    [
      'trip_id',
      'arrival_time',
      'departure_time',
      'stop_id',
      'stop_sequence',
      'pickup_type',
      'drop_off_type'
    ],
    ([tripId, arrival, departure, stopId, sequence, pickup, dropOff]) => {
      const trip = tripIndex.get(tripId)
      const stop = stopIndex.get(stopId)
      const order = Number(sequence)
      if (trip === undefined || stop === undefined || sequence === '') return
      if (!Number.isInteger(order) || order < 0) return
      const arrives = secondsOf(arrival)
      const leaves = secondsOf(departure)
      // GTFS lets stops between timepoints go untimed. Valley Metro times every stop, so a
      // stop without a time is left out of its trip rather than guessed at.
      if (Number.isNaN(arrives) && Number.isNaN(leaves)) return
      if (++stopTimeCount > MAX_STOP_TIMES) throw tooBig('stop times')
      const rows = stopTimes[trip] as number[]
      rows.push(
        order,
        stop,
        Number.isNaN(arrives) ? leaves : arrives,
        Number.isNaN(leaves) ? arrives : leaves,
        // Only 1 bars it: 2 (phone ahead) and 3 (ask the driver) still stop.
        (pickup === '1' ? NO_PICKUP : 0) | (dropOff === '1' ? NO_DROP_OFF : 0)
      )
    }
  )

  const runStarts = await frequencyRuns(schedule, tripIndex, trips.length)

  // In the order the file first lists a trip of each.
  const groups = new Map<string, Group>()
  trips.forEach((trip, t) => {
    const run = runOf(stopTimes[t] as number[])
    if (!run) return
    // No headsign: the last stop says where it's going.
    const headsign = trip.headsign || (names[run.stops.at(-1) as number] ?? '')
    // The headsign goes last: it's the one part that could hold the separator.
    const key = `${trip.route}\n${trip.direction}\n${run.stops.join(',')}\n${headsign}`
    let group = groups.get(key)
    if (!group) {
      group = {
        route: trip.route,
        direction: trip.direction,
        headsign,
        stops: run.stops,
        members: []
      }
      groups.set(key, group)
    }
    const starts = runStarts.get(t)
    if (!starts) {
      group.members.push({ id: trip.id, service: trip.service, times: run.times })
      return
    }
    for (const at of starts) {
      const times = run.times.map((time) => time + at - run.start)
      group.members.push({ id: `${trip.id}@${at}`, service: trip.service, times })
    }
  })

  const lat = Float64Array.from(lats)
  const lon = Float64Array.from(lons)
  return {
    version: await feedVersion(schedule),
    stops: { ids, names, lat, lon },
    routes,
    patterns: [...groups.values()].flatMap(patternsOf),
    services,
    transfers: transfersOf(lat, lon)
  }
}
