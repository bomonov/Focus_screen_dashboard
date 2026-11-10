// Walking, the one way the planner moves without a bus: how long it takes, which stops are near
// enough to walk to, and the trip that's all walking.
import { distanceM, type LatLon } from '../transit/routeLine'
import { WALK_DETOUR, WALK_MPS, type Journey, type PlanQuery, type Timetable } from './types'

/** Seconds to walk between two points `straightM` apart as the crow flies. */
export function walkSeconds(straightM: number): number {
  return Math.round((straightM * WALK_DETOUR) / WALK_MPS)
}

/** The stops within `maxM` (straight-line) of `at`, nearest first. */
export function stopsNear(
  tt: Timetable,
  at: LatLon,
  maxM: number
): { stop: number; metres: number }[] {
  const { lat, lon } = tt.stops
  const found: { stop: number; metres: number }[] = []
  for (let stop = 0; stop < lat.length; stop++) {
    const metres = distanceM(at, [lat[stop] as number, lon[stop] as number])
    if (metres <= maxM) found.push({ stop, metres })
  }
  // The stop index breaks a tie, so the order never depends on how the sort is made.
  return found.sort((a, b) => a.metres - b.metres || a.stop - b.stop)
}

/**
 * The whole trip on foot. Always one leg, even for a few steps, so the card has something to
 * show for a trip with nothing to ride.
 */
export function walkOnly(from: LatLon, to: LatLon, query: PlanQuery): Journey {
  const metres = distanceM(from, to)
  const seconds = walkSeconds(metres)
  const start = query.mode === 'depart' ? query.time : query.time - seconds
  const end = start + seconds
  return {
    legs: [
      { kind: 'walk', from: { kind: 'origin' }, to: { kind: 'destination' }, start, end, metres }
    ],
    depart: start,
    arrive: end
  }
}
