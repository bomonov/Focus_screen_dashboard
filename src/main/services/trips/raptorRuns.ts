// Service runs and live predictions are resolved here so the search scans only usable runs,
// while calendar conversions and directed walking edges are shared across queries.
import { serviceDayStart } from './timetable'
import {
  WINDOW_SEC,
  type LiveTimes,
  type LiveTrip,
  type Pattern,
  type PlanQuery,
  type Timetable
} from './types'

const DAY = 86400
const ARIZONA = 7 * 3600

/** One trip on one service day, with the live entry belonging to that run if present. */
export interface Run {
  pattern: number
  trip: number
  midnight: number
  feed?: LiveTrip
}

/** A directed timetable footpath, shared by forward and reverse searches. */
export interface Connection {
  from: number
  to: number
  metres: number
}

interface Bounds {
  earliest: number
  latest: number
}

interface Index {
  days: number[][]
  incoming: Connection[][]
  outgoing: Connection[][]
  bounds: Bounds[][]
}

const indexes = new WeakMap<Timetable, Index>()

/** Cache calendar conversions, run bounds and both directions of the timetable's footpaths. */
export function timetableIndex(tt: Timetable): Index {
  const saved = indexes.get(tt)
  if (saved) return saved
  const incoming: Connection[][] = Array.from({ length: tt.stops.ids.length }, () => [])
  const outgoing: Connection[][] = Array.from({ length: tt.stops.ids.length }, () => [])
  const { start, to, metres } = tt.transfers
  for (let from = 0; from < incoming.length; from++) {
    const outgoingAt = outgoing[from] as Connection[]
    for (let k = start[from] as number; k < (start[from + 1] as number); k++) {
      const connection = { from, to: to[k] as number, metres: metres[k] as number }
      const incomingAt = incoming[connection.to] as Connection[]
      incomingAt.push(connection)
      outgoingAt.push(connection)
    }
  }
  const bounds = tt.patterns.map((pattern) =>
    pattern.trips.map((_, trip): Bounds => {
      let earliest = Infinity
      let latest = -Infinity
      const offset = trip * pattern.stops.length * 2
      for (let i = offset; i < offset + pattern.stops.length * 2; i++) {
        const time = pattern.times[i] as number
        earliest = Math.min(earliest, time)
        latest = Math.max(latest, time)
      }
      return { earliest, latest }
    })
  )
  const index = {
    days: tt.services.map((dates) => Array.from(dates, serviceDayStart)),
    incoming,
    outgoing,
    bounds
  }
  indexes.set(tt, index)
  return index
}

/** Nearest service midnight in sorted days; an exact distance tie chooses the earlier run. */
export function nearestRun(days: number[], target: number): number | undefined {
  let lo = 0
  let hi = days.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((days[mid] as number) < target) lo = mid + 1
    else hi = mid
  }
  const before = days[lo - 1]
  const after = days[lo]
  if (before === undefined) return after
  if (after === undefined || target - before <= after - target) return before
  return after
}

function liveMidnight(
  pattern: Pattern,
  trip: number,
  days: number[],
  feed: LiveTrip,
  time: number
): number | undefined {
  const length = pattern.stops.length
  const offset = trip * length * 2
  let target = time - (pattern.times[offset + 1] as number)
  let predicted = false
  for (let p = 0; p < length && !predicted; p++) {
    // Departure takes precedence when both predictions exist at the first position.
    for (const kind of [1, 0]) {
      const value = (kind ? feed.departure[p] : feed.arrival[p]) ?? NaN
      if (Number.isNaN(value)) continue
      target = value - (pattern.times[offset + p * 2 + kind] as number)
      predicted = true
      break
    }
  }
  const midnight = nearestRun(days, target)
  return midnight !== undefined && (!predicted || Math.abs(midnight - target) < DAY / 2)
    ? midnight
    : undefined
}

// Pruning is exact: accepted rides have arrival >= departure, and changes/walks only advance
// time. A depart search cannot reach a run wholly before its start; an arrive search cannot
// reach one wholly after its deadline. Bounds include every scheduled and predicted time.
function outsideWindow(
  bounds: Bounds,
  midnight: number,
  feed: LiveTrip | undefined,
  query: PlanQuery
): boolean {
  const forward = query.mode === 'depart'
  let edge = midnight + (forward ? bounds.latest : bounds.earliest)
  if (feed) {
    // Include every prediction, not just the endpoints: live times may reorder a pattern.
    for (const times of [feed.arrival, feed.departure]) {
      for (const time of times) {
        if (!Number.isNaN(time)) edge = forward ? Math.max(edge, time) : Math.min(edge, time)
      }
    }
  }
  return forward ? edge < query.time : edge > query.time
}

/** Runs on the window's service dates, with live data applied only to its nearest run. */
export function searchRuns(tt: Timetable, query: PlanQuery, live: LiveTimes): Run[] {
  const { days, bounds } = timetableIndex(tt)
  const lower = query.mode === 'depart' ? query.time : query.time - WINDOW_SEC
  const upper = query.mode === 'depart' ? query.time + WINDOW_SEC : query.time
  const first = Math.floor((lower - ARIZONA) / DAY) * DAY + ARIZONA - DAY
  const last = Math.floor((upper - ARIZONA) / DAY) * DAY + ARIZONA
  const runs: Run[] = []
  tt.patterns.forEach((pattern, p) => {
    pattern.trips.forEach((id, trip) => {
      const dates = days[pattern.service[trip] as number] as number[]
      const entry = live.get(id)
      const liveDay = entry ? liveMidnight(pattern, trip, dates, entry, query.time) : undefined
      for (let midnight = first; midnight <= last; midnight += DAY) {
        // One or two window days, plus their preceding days, give two or three service dates.
        if (nearestRun(dates, midnight) !== midnight) continue
        const feed = liveDay === midnight ? entry : undefined
        const bound = (bounds[p] as Bounds[])[trip] as Bounds
        if (!feed?.canceled && !outsideWindow(bound, midnight, feed, query)) {
          runs.push({ pattern: p, trip, midnight, feed })
        }
      }
    })
  })
  return runs
}

/** Actual arrival (0) or departure (1), falling back separately to schedule at each position. */
export function runTime(tt: Timetable, run: Run, position: number, kind: 0 | 1): number {
  const prediction = (kind ? run.feed?.departure[position] : run.feed?.arrival[position]) ?? NaN
  if (!Number.isNaN(prediction)) return prediction
  const pattern = tt.patterns[run.pattern] as Pattern
  return (
    run.midnight +
    (pattern.times[(run.trip * pattern.stops.length + position) * 2 + kind] as number)
  )
}
