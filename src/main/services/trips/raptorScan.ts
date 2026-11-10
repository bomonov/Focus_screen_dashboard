// A round scans reachable patterns in either direction. Keeping the round mechanics here
// makes the public planner's window, ride limit and result ordering visible together.
import { catchable, insert, insertionIndex, walkingTime, type Label } from './raptorLabels'
import { runTime, type Connection, type Run } from './raptorRuns'
import { MIN_CHANGE_SEC, TRANSFER_MAX_M, type Pattern, type Timetable } from './types'
import { walkSeconds } from './walk'

/** Expand ride labels to same-stop changes and one footpath, never chaining walking edges. */
export function changeLabels(previous: Label[][], connections: Connection[][]): Label[][] {
  const ready: Label[][] = Array.from({ length: previous.length }, () => [])
  for (let stop = 0; stop < previous.length; stop++) {
    const sameStop = ready[stop] as Label[]
    for (const label of previous[stop] as Label[]) {
      const sameTime = label.time + MIN_CHANGE_SEC
      const sameIndex = insertionIndex(sameStop, sameTime, label.rangeTime, label.walkMetres)
      if (sameIndex >= 0) insert(sameStop, { ...label, time: sameTime }, sameIndex)
      for (const connection of connections[stop] as Connection[]) {
        if (connection.metres > TRANSFER_MAX_M) continue
        // Both direction indexes retain the actual walking direction for reconstruction.
        const next = connection.from === stop ? connection.to : connection.from
        const frontier = ready[next] as Label[]
        const time = label.time + walkSeconds(connection.metres)
        const walkMetres = label.walkMetres + (connection.metres < 1 ? 0 : connection.metres)
        const index = insertionIndex(frontier, time, label.rangeTime, walkMetres)
        if (index >= 0) insert(frontier, { ...label, time, walkMetres, connection }, index)
      }
    }
  }
  return ready
}

/** First reachable position in search order, so untouched patterns and prefixes are skipped. */
export function patternStarts(
  tt: Timetable,
  forward: boolean,
  initial: Float64Array,
  ready: Label[][],
  round: number
): Int32Array {
  const starts = new Int32Array(tt.patterns.length).fill(-1)
  tt.patterns.forEach((pattern, p) => {
    for (let i = 0; i < pattern.stops.length; i++) {
      const position = forward ? i : pattern.stops.length - i - 1
      const stop = pattern.stops[position] as number
      if (round === 1 ? Number.isFinite(initial[stop]) : (ready[stop] as Label[]).length > 0) {
        starts[p] = i
        break
      }
    }
  })
  return starts
}

/** Scan each run independently: live overtaking cannot rely on scheduled trip ordering. */
export function scanRuns(
  tt: Timetable,
  runs: Run[],
  forward: boolean,
  initial: Float64Array,
  ready: Label[][],
  round: number,
  lower: number,
  upper: number
): Label[][] {
  const current: Label[][] = Array.from({ length: initial.length }, () => [])
  const starts = patternStarts(tt, forward, initial, ready, round)
  const sign = forward ? 1 : -1
  for (const run of runs) {
    const start = starts[run.pattern] as number
    if (start < 0) continue
    const pattern = tt.patterns[run.pattern] as Pattern
    const length = pattern.stops.length
    // Scheduled runs never go backwards (timetable.runOf); one best boarding suffices.
    // Live predictions can reverse a ride, so retain earlier feasible options on those runs.
    const onboard: Label[] | undefined = run.feed ? [] : undefined
    let best: Label | undefined
    for (let i = start; i < length; i++) {
      const position = forward ? i : length - i - 1
      const stop = pattern.stops[position] as number
      if (run.feed?.skipped[position]) continue
      // Alight before boarding: positions, including repeated stops, remain distinct.
      const endTime = sign * runTime(tt, run, position, forward ? 0 : 1)
      // In both directions this refuses precisely arrival < departure for the ride itself.
      const riding = onboard ? catchable(onboard, endTime) : best
      if (riding) {
        const frontier = current[stop] as Label[]
        const index = insertionIndex(frontier, endTime, riding.rangeTime, riding.walkMetres)
        if (index >= 0) {
          insert(
            frontier,
            {
              time: endTime,
              rangeTime: riding.rangeTime,
              walkMetres: riding.walkMetres,
              path: {
                ...riding.path,
                board: forward ? riding.path.board : position,
                alight: forward ? position : riding.path.alight
              }
            },
            index
          )
        }
      }
      const time = sign * runTime(tt, run, position, forward ? 1 : 0)
      let rangeTime: number
      let walkMetres: number
      let candidate: Label | undefined
      if (round === 1) {
        const metres = initial[stop] as number
        rangeTime = time - walkingTime(metres)
        walkMetres = metres < 1 ? 0 : metres
        // Only in-window seeds enter the frontiers; out-of-window trips cannot dominate.
        if (!(rangeTime >= lower && rangeTime <= upper)) continue
      } else {
        candidate = catchable(ready[stop] as Label[], time)
        if (!candidate) continue
        rangeTime = candidate.rangeTime
        walkMetres = candidate.walkMetres
      }
      const index = onboard ? insertionIndex(onboard, time, rangeTime, walkMetres) : 0
      if (index < 0) continue
      if (
        !onboard &&
        best &&
        (best.rangeTime > rangeTime ||
          (best.rangeTime === rangeTime && best.walkMetres <= walkMetres))
      )
        continue
      const boarding: Label = {
        time,
        rangeTime,
        walkMetres,
        path: {
          run,
          board: position,
          alight: position,
          previous: candidate?.path,
          connection: candidate?.connection
        }
      }
      if (onboard) insert(onboard, boarding, index)
      else best = boarding
    }
  }
  return current
}
