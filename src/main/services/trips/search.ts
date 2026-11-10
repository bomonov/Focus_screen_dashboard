// Which search the trip card asks: the one for the schedule on disk, or the demo's. A new
// download gets a new search and the old one is let go at once, so a running process never
// keeps reading a timetable that's been replaced.
import type { FeedTrip } from '../transit/gtfsRealtime'
import type { TransitService } from '../transit/service'
import { LIVE_STALE_SEC } from '../transit/types'
import type { TripPlanner } from './client'
import type { Planned } from './keptTrip'
import type { PlanQuery, TripState } from './types'

export interface TripSearchOptions {
  transit: Pick<TransitService, 'timetablePath' | 'get' | 'liveTrips'>
  /** The search on the timetable at that path (its own process). */
  planner: (timetablePath: string) => TripPlanner
  /** The demo's search while the demo's on; null otherwise. */
  demo(): TripPlanner | null
  /** ms, like Date.now. */
  now(): number
}

/**
 * The live feed's trips while its last good read is fresh; none once it's older than the Bus pill
 * would show (or there's been none), so rides read "scheduled" rather than live times gone stale.
 */
export function freshTrips(
  live: { trips: FeedTrip[]; updatedAt: number | null },
  now: number
): FeedTrip[] {
  return live.updatedAt !== null && now - live.updatedAt <= LIVE_STALE_SEC ? live.trips : []
}

export interface TripSearch {
  schedule(): TripState['schedule']
  /** The trips for `query` with the live feed as last read, while fresh; null when there's no answer. */
  ask(query: PlanQuery): Promise<Planned | null>
  /** The live feed's trips as last read, while fresh (freshTrips); none otherwise. */
  feed(): FeedTrip[]
  /** Whether the schedule is another since this was last asked; the old one's search goes. */
  scheduleChanged(): boolean
  dispose(): void
}

export function createTripSearch(options: TripSearchOptions): TripSearch {
  const { transit } = options
  let current: { key: string; planner: TripPlanner } | null = null

  /** The timetable's file and when it was downloaded (it's saved under the same name each time). */
  function key(): string | null {
    if (options.demo()) return 'demo'
    const path = transit.timetablePath()
    return path ? `${path}\n${transit.get().schedule?.downloadedAt ?? ''}` : null
  }

  let seen = key()

  function letOldGo(): void {
    if (current && current.key !== key()) {
      current.planner.dispose()
      current = null
    }
  }

  function plannerNow(): TripPlanner | null {
    const demo = options.demo()
    if (demo) return demo
    letOldGo()
    const now = key()
    const path = transit.timetablePath()
    if (!now || !path) return null
    current ??= { key: now, planner: options.planner(path) }
    return current.planner
  }

  const feed = (): FeedTrip[] => freshTrips(transit.liveTrips(), Math.floor(options.now() / 1000))

  return {
    schedule() {
      if (key() !== null) return 'ready'
      return transit.get().downloading ? 'downloading' : 'missing'
    },
    ask(query) {
      const search = plannerNow()
      if (!search) return Promise.resolve(null)
      return search
        .plan(query, feed(), Math.floor(options.now() / 1000))
        .then((reply) => (reply?.kind === 'planned' ? reply : null))
        .catch(() => null)
    },
    scheduleChanged() {
      const now = key()
      if (now === seen) return false
      seen = now
      letOldGo()
      return true
    },
    feed,
    dispose() {
      current?.planner.dispose()
      current = null
    }
  }
}
