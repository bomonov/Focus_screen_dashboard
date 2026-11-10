import type { BusArrival, TransitState } from '../../../main/ipc'
import { LIVE_STALE_SEC } from '../../../main/services/transit/types'

/** Times older than this say too little about where the buses are now (the trip planner's too). */
export const STALE_SEC = LIVE_STALE_SEC
/** A bus stays "Due" this long past its time: it may still be at the stop. */
export const DUE_GRACE_SEC = 30

/** One route at one stop: its next bus, and the one after. */
export interface BusPage {
  arrival: BusArrival
  /** Whole minutes left; 0 is "Due". */
  minutes: number
  /** The same route's next bus at the same stop, in minutes; null when none is known. */
  then: number | null
}

export type NextBusView =
  /** Turned on, but there's something to set up first (Customize says what). */
  | { kind: 'setup'; text: string }
  /**
   * Nothing to count down: no live times (`retry`: the feed couldn't be read, so clicking the
   * pill tries again now), or no bus soon.
   */
  | { kind: 'quiet'; text: string; retry: boolean }
  /**
   * Every route coming to the picked stops, one page each, in the user's order (soonest first
   * for any it doesn't name): the pill shows the first, and a swipe turns to the others.
   */
  | { kind: 'bus'; pages: [BusPage, ...BusPage[]] }

/** A page's route and stop: what stays put while its buses come and go, and what's ordered. */
export const pageKey = (arrival: BusArrival): string => `${arrival.routeId}\n${arrival.stopId}`

/** The stop in a page's key. */
export const keyStop = (key: string): string => key.slice(key.indexOf('\n') + 1)

/**
 * The saved order once the list's rows are put in `rows` order. Routes the list didn't show
 * (nothing coming just now) keep their places; rows the order didn't name yet go at the end.
 */
export function mergeOrder(saved: readonly string[], rows: readonly string[]): string[] {
  const shown = new Set(rows)
  const queue = [...rows]
  const merged = saved.map((key) => (shown.has(key) ? (queue.shift() ?? key) : key))
  return [...merged, ...queue]
}

/** Whole minutes until `at`, rounded down: better a minute early at the stop than late. */
export function minutesUntil(at: number, now: number): number {
  return Math.max(0, Math.floor((at - now) / 60))
}

/** "Due", "4 min" */
export function busIn(minutes: number): string {
  return minutes < 1 ? 'Due' : `${minutes} min`
}

/**
 * What the Bus pill says at `now` (Unix seconds): the next Valley Metro bus at the picked stops,
 * counted down from the last read, or the first in the user's `order` (its list's). null while there's nothing to say yet (starting up), or
 * when only ASU shuttle stops are picked (their own pill says it).
 */
export function nextBusView(
  state: TransitState | null,
  now: number,
  order: readonly string[] = []
): NextBusView | null {
  if (!state) return null
  if (!state.stops.some((stop) => stop.source === 'valleyMetro')) {
    if (state.stops.length > 0 || state.downloading) return null
    return { kind: 'setup', text: 'Pick a bus stop in Customize' }
  }
  const fresh = state.updatedAt !== null && now - state.updatedAt <= STALE_SEC
  if (!fresh) {
    return state.liveProblem ? { kind: 'quiet', text: 'No live bus times', retry: true } : null
  }
  const coming = state.arrivals.filter((arrival) => arrival.at >= now - DUE_GRACE_SEC)
  // Arrivals come by time, so each route's first one met is its next bus there.
  const pages = new Map<string, BusPage>()
  for (const arrival of coming) {
    const key = pageKey(arrival)
    const page = pages.get(key)
    if (!page) pages.set(key, { arrival, minutes: minutesUntil(arrival.at, now), then: null })
    else if (page.then === null) page.then = minutesUntil(arrival.at, now)
  }
  // Sorting keeps the time order among the routes the user hasn't placed.
  const rank = new Map(order.map((key, index) => [key, index]))
  const placed = (page: BusPage): number => rank.get(pageKey(page.arrival)) ?? order.length
  const [first, ...rest] = [...pages.values()].sort((a, b) => placed(a) - placed(b))
  if (!first) {
    return { kind: 'quiet', text: `No bus in the next ${state.horizonMinutes} min`, retry: false }
  }
  return { kind: 'bus', pages: [first, ...rest] }
}

/**
 * The moments the pill's words can change: a coming bus's minutes ticking over or it going,
 * and the times going stale. Every bus counts: any route's page can be swiped to. The feed
 * looks only 30 min ahead, so there are never many.
 */
export function viewChanges(state: TransitState | null): number[] {
  if (!state) return []
  const moments = state.arrivals.flatMap((arrival) => [arrival.at, arrival.at + DUE_GRACE_SEC])
  if (state.updatedAt !== null) moments.push(state.updatedAt + STALE_SEC)
  return moments
}
