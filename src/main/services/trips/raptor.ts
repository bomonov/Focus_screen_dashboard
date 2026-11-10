// The range planner coordinates directional RAPTOR rounds; run preparation, stop frontiers
// and scanning are separate so window membership and the public result contract stay clear.
import { collectAnswers, journeyOf, type Answer, type Label } from './raptorLabels'
import { searchRuns, timetableIndex } from './raptorRuns'
import { changeLabels, scanRuns } from './raptorScan'
import {
  ACCESS_MAX_M,
  MAX_RIDES,
  WINDOW_SEC,
  type Journey,
  type LiveTimes,
  type PlanQuery,
  type Timetable
} from './types'
import { stopsNear } from './walk'

/**
 * The journeys of one to MAX_RIDES rides in the window that no other journey in the window
 * beats, sorted by `depart`, then `arrive`, then rides.
 *
 * - **Which journeys.** The window is leaving in [`time`, `time + WINDOW_SEC`] (depart mode)
 *   or arriving in [`time - WINDOW_SEC`, `time`] (arrive mode). One journey beats another when
 *   it leaves no earlier, arrives no later and has no more rides, and is better in one of them.
 *   Only journeys in the window compete: one outside it never removes one inside. Exact ties in
 *   departure, arrival and rides keep the journey with less total walking (metres); walking
 *   otherwise isn't a Pareto criterion. Journeys equal in all three are returned once. Every
 *   journey has a ride; walking all the way isn't one, takes no part, and is added by the
 *   ranking afterwards.
 * - **Walks.** The first walk goes straight from `query.from` to the first ride's stop
 *   (≤ ACCESS_MAX_M straight-line) and ends exactly at that ride's `depart`; the last goes
 *   straight from the last ride's stop to `query.to` (≤ ACCESS_MAX_M) and starts at its
 *   `arrive`. Each lasts `walkSeconds(metres)` of its straight-line metres. A change between two
 *   stops is one walk of `tt.transfers` (its `metres`, ≤ TRANSFER_MAX_M), starting at the
 *   ride's `arrive`. Walks are never chained, and no walk between stops comes before the first
 *   ride or after the last. Walk legs under 1 m are left out (starting at a stop has no first
 *   walk). `Journey.depart` is the first leg's start (the first ride's `depart` minus the first
 *   walk), `Journey.arrive` the last leg's end.
 * - **Changes.** At the same stop the next ride leaves at least MIN_CHANGE_SEC after the
 *   arrival; between two stops, at least the walk after it (no extra minute).
 * - **Service days.** A trip runs on its service's dates; its times count from that date's
 *   midnight (`serviceDayStart`), so 24:20 on 20261101 is 00:20 on 2 November. The search rides
 *   the runs of exactly these service dates: every Arizona day the window touches, and the day
 *   before each.
 * - **Live.** An entry in `live` belongs to one run of its trip id: the run whose timetable
 *   times are nearest its predictions, if within 12 h (a trip's runs are whole days apart, so its
 *   first prediction decides; after midnight that's often the day before's run, at 24:xx). An
 *   entry 12 h or more from every run belongs to none. An entry with no predictions (a
 *   cancellation, skips) belongs to the run whose first departure is nearest `query.time`. Runs
 *   an entry doesn't belong to keep their timetable. On its run, a ride takes its departure at
 *   the board position and its arrival at the alight position from the feed where they aren't
 *   NaN (else the timetable's); `live` is true when the departure came from the feed;
 *   `scheduledDepart`/`scheduledArrive` are always the timetable's. A ride is refused if its
 *   arrival at the alighting position is before its departure from the boarding position,
 *   in either search mode (equality is allowed). Other position pairs on that run can remain
 *   valid. Live times can make a pattern's trips overtake each other. A canceled run isn't
 *   ridden; a skipped position can't be boarded or left at, but is ridden through.
 */
export function planTrips(tt: Timetable, query: PlanQuery, live: LiveTimes): Journey[] {
  const forward = query.mode === 'depart'
  const size = tt.stops.ids.length
  const access = new Float64Array(size).fill(Infinity)
  const egress = new Float64Array(size).fill(Infinity)
  for (const { stop, metres } of stopsNear(tt, query.from, ACCESS_MAX_M)) access[stop] = metres
  for (const { stop, metres } of stopsNear(tt, query.to, ACCESS_MAX_M)) egress[stop] = metres
  const initial = forward ? access : egress
  const final = forward ? egress : access
  const runs = searchRuns(tt, query, live)
  const index = timetableIndex(tt)
  const connections = forward ? index.outgoing : index.incoming
  // Negating the clocks makes an arrive-by search use the same dominance and boarding rules.
  const lower = (forward ? 1 : -1) * query.time
  const upper = lower + WINDOW_SEC
  let previous: Label[][] = Array.from({ length: size }, () => [])
  const answers: Answer[] = []

  for (let round = 1; round <= MAX_RIDES; round++) {
    const ready = round > 1 ? changeLabels(previous, connections) : previous
    const current = scanRuns(tt, runs, forward, initial, ready, round, lower, upper)
    collectAnswers(answers, current, final, round)
    previous = current
  }
  return answers
    .map(({ label, rides }) => ({
      journey: journeyOf(tt, label.path, forward, access, egress),
      rides
    }))
    .sort(
      (a, b) =>
        a.journey.depart - b.journey.depart ||
        a.journey.arrive - b.journey.arrive ||
        a.rides - b.rides
    )
    .map(({ journey }) => journey)
}
