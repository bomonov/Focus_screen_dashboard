// What the main process and the trip search's own process (worker.ts) send each other.
import type { FeedTrip } from '../transit/gtfsRealtime'
import type { PlanQuery, TripPlan } from './types'

export interface PlanRequest {
  kind: 'plan'
  id: number
  query: PlanQuery
  /** Valley Metro's Trip Updates as last read; [] when there are none. */
  feed: FeedTrip[]
  /** Unix seconds, by the main process's clock: what puts the feed's delays on a clock. */
  now: number
}

/** Why there's nothing to show (rank.ts's `noTrip`). */
export interface NoTrip {
  walkSec: number | null
  serviceStarts: number | null
}

export type PlanReply =
  /** `noTrip` is null when there are plans. */
  | { kind: 'planned'; id: number; plans: TripPlan[]; noTrip: NoTrip | null }
  /** It has no timetable it could read, or the search threw. */
  | { kind: 'failed'; id: number }
