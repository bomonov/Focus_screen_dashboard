// Stop frontiers retain catchable alternatives and walking ties; immutable parent paths let
// the search reconstruct public legs only for journeys that survive the final comparison.
import { runTime, type Connection, type Run } from './raptorRuns'
import type { Journey, Leg, Pattern, RideLeg, Timetable } from './types'
import { walkSeconds } from './walk'

/** One ride and its preceding search path, retained for final journey reconstruction. */
export interface Path {
  run: Run
  board: number
  alight: number
  previous?: Path
  connection?: Connection
}

/** Smaller search time and larger rangeTime win; equal range times prefer less walking. */
export interface Label {
  time: number
  /** Origin departure forwards, negated destination arrival backwards. */
  rangeTime: number
  /** Metres in the path so far, excluding omitted walks under 1 m. */
  walkMetres: number
  path: Path
  connection?: Connection
}

function dominates(a: Label, rangeTime: number, walkMetres: number): boolean {
  return a.rangeTime > rangeTime || (a.rangeTime === rangeTime && a.walkMetres <= walkMetres)
}

/** Locate an offer before allocating its label/path; -1 means an existing label dominates it. */
export function insertionIndex(
  frontier: Label[],
  time: number,
  rangeTime: number,
  walkMetres: number
): number {
  let lo = 0
  let hi = frontier.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((frontier[mid] as Label).time < time) lo = mid + 1
    else hi = mid
  }
  const before = frontier[lo - 1]
  const at = frontier[lo]
  if (before && dominates(before, rangeTime, walkMetres)) return -1
  if (at?.time === time && dominates(at, rangeTime, walkMetres)) return -1
  return lo
}

/**
 * Insert by increasing time and nondecreasing rangeTime. For equal rangeTime, walking strictly
 * decreases: reaching a stop earlier with more walking can tie after waiting for the same ride.
 * At equal time keep the larger rangeTime, then the shorter walk; exact equals keep the first.
 * A prechecked index is valid only while the frontier has not changed.
 */
export function insert(
  frontier: Label[],
  label: Label,
  lo = insertionIndex(frontier, label.time, label.rangeTime, label.walkMetres)
): void {
  if (lo < 0) return
  let end = lo
  while (
    end < frontier.length &&
    dominates(label, (frontier[end] as Label).rangeTime, (frontier[end] as Label).walkMetres)
  )
    end++
  frontier.splice(lo, end - lo, label)
}

/** Best rangeTime catchable at time, with the least walking among its catchable alternatives. */
export function catchable(frontier: Label[], time: number): Label | undefined {
  let lo = 0
  let hi = frontier.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((frontier[mid] as Label).time <= time) lo = mid + 1
    else hi = mid
  }
  return frontier[lo - 1]
}

/** A completed journey label and its ride count for the final Pareto comparison. */
export interface Answer {
  label: Label
  rides: number
}

/** Collect completed journeys in increasing ride-count rounds, resolving exact ties by metres. */
export function collectAnswers(
  answers: Answer[],
  current: Label[][],
  final: Float64Array,
  round: number
): void {
  for (let stop = 0; stop < current.length; stop++) {
    const metres = final[stop] as number
    if (!Number.isFinite(metres)) continue
    for (const label of current[stop] as Label[]) {
      const time = label.time + walkingTime(metres)
      const walkMetres = label.walkMetres + (metres < 1 ? 0 : metres)
      let beaten = false
      for (const answer of answers) {
        if (answer.label.time > time || answer.label.rangeTime < label.rangeTime) continue
        if (
          answer.rides < round ||
          answer.label.time < time ||
          answer.label.rangeTime > label.rangeTime ||
          answer.label.walkMetres <= walkMetres
        ) {
          beaten = true
          break
        }
      }
      if (beaten) continue
      for (let i = answers.length - 1; i >= 0; i--) {
        const answer = answers[i] as Answer
        if (
          answer.rides === round &&
          answer.label.time >= time &&
          answer.label.rangeTime <= label.rangeTime
        ) {
          answers.splice(i, 1)
        }
      }
      answers.push({ label: { ...label, time, walkMetres }, rides: round })
    }
  }
}

function rideLeg(tt: Timetable, path: Path): RideLeg {
  const { run, board, alight } = path
  const pattern = tt.patterns[run.pattern] as Pattern
  const offset = run.trip * pattern.stops.length * 2
  const prediction = run.feed?.departure[board] ?? NaN
  return {
    kind: 'ride',
    pattern: run.pattern,
    trip: run.trip,
    tripId: pattern.trips[run.trip] as string,
    board,
    alight,
    depart: runTime(tt, run, board, 1),
    arrive: runTime(tt, run, alight, 0),
    scheduledDepart: run.midnight + (pattern.times[offset + board * 2 + 1] as number),
    scheduledArrive: run.midnight + (pattern.times[offset + alight * 2] as number),
    live: !Number.isNaN(prediction)
  }
}

/** Duration of a public walk; walks under 1 m are omitted along with their time. */
export function walkingTime(metres: number): number {
  return metres < 1 ? 0 : walkSeconds(metres)
}

/** Only surviving destination labels allocate public legs. Parent paths stay immutable. */
export function journeyOf(
  tt: Timetable,
  path: Path,
  forward: boolean,
  access: Float64Array,
  egress: Float64Array
): Journey {
  const paths: Path[] = []
  for (let step: Path | undefined = path; step; step = step.previous) paths.push(step)
  if (forward) paths.reverse()
  const rides = paths.map((step) => rideLeg(tt, step))
  const first = rides[0] as RideLeg
  const last = rides[rides.length - 1] as RideLeg
  const startStop = (tt.patterns[first.pattern] as Pattern).stops[first.board] as number
  const endStop = (tt.patterns[last.pattern] as Pattern).stops[last.alight] as number
  const firstMetres = access[startStop] as number
  const lastMetres = egress[endStop] as number
  const depart = first.depart - walkingTime(firstMetres)
  const arrive = last.arrive + walkingTime(lastMetres)
  const legs: Leg[] = []
  if (firstMetres >= 1) {
    legs.push({
      kind: 'walk',
      from: { kind: 'origin' },
      to: { kind: 'stop', stop: startStop },
      start: depart,
      end: first.depart,
      metres: firstMetres
    })
  }
  rides.forEach((ride, i) => {
    if (i > 0) {
      const connection = (paths[forward ? i : i - 1] as Path).connection
      if (connection && connection.metres >= 1) {
        const start = (rides[i - 1] as RideLeg).arrive
        legs.push({
          kind: 'walk',
          from: { kind: 'stop', stop: connection.from },
          to: { kind: 'stop', stop: connection.to },
          start,
          end: start + walkSeconds(connection.metres),
          metres: connection.metres
        })
      }
    }
    legs.push(ride)
  })
  if (lastMetres >= 1) {
    legs.push({
      kind: 'walk',
      from: { kind: 'stop', stop: endStop },
      to: { kind: 'destination' },
      start: last.arrive,
      end: arrive,
      metres: lastMetres
    })
  }
  return { legs, depart, arrive }
}
