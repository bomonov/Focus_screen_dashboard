// The trip kept on screen until the user leaves: its countdown's ends (the first ride missed,
// the arrival passed, a missed trip let go), a check of where the Mac is every 3 minutes while it
// can be seen (moved away: the user took the MacBook and went), and the feed's newer times for
// its rides. Where the Mac is comes in as fixes and stays in memory.
import type { FeedTrip } from '../transit/gtfsRealtime'
import type { LatLon } from '../transit/routeLine'
import {
  catchable,
  firstRide,
  firstRideGone,
  followFeed,
  keptPhase,
  movedAway,
  sameJourney,
  type Fix
} from './kept'
import type { PlanReply } from './messages'
import type { Place, PlanQuery, TripFrom, TripPlan, TripState } from './types'

/** While a trip is kept, where the Mac is is read this often (while the screen can be seen). */
export const KEPT_FIX_SEC = 180
/**
 * A trip missed with no next way found is let go this long after it would first have arrived (or on its
 * second miss, if that's sooner), so "Missed it" doesn't sit on screen all evening.
 */
export const GIVE_UP_AFTER_SEC = 30 * 60

export type Planned = Extract<PlanReply, { kind: 'planned' }>

/** What a trip was planned from: its question, its start, and where the Mac was then. */
export interface PlannedFrom {
  query: PlanQuery
  start: TripFrom
  /** null when it starts from a place: then only its arrival or the user ends it. */
  fix: Fix | null
}

export interface KeptTripOptions {
  /** ms, like Date.now. */
  now(): number
  ask(query: PlanQuery): Promise<Planned | null>
  /** The live feed's trips as last read, while fresh: none once they're too old to go by. */
  feed(): readonly FeedTrip[]
  /** Where a trip from `start` begins now; null while that's the Mac and there's no fix. */
  startPoint(start: TripFrom): { at: LatLon; fix: Fix | null } | null
  /** Asks where the Mac is; the answer comes back through `located`. */
  locate(): void
  /** Where the Mac is can be checked: the location is held and the screen can be seen. */
  canCheck(): boolean
  /** It was kept, changed or went. */
  changed(): void
}

export interface KeptTrip {
  /** What the card and the countdown show; null with nothing kept. */
  shown(): TripState['kept']
  /** Where the Mac was when it was planned, while a trip kept from there is kept. */
  fix(): Fix | null
  keep(to: Place, plan: TripPlan, from: PlannedFrom): void
  end(): void
  /** A new fix: far enough from where the trip was planned, it ends. */
  located(fix: Fix): void
  /**
   * A read of the live feed: its first bus canceled or skipping its stop makes it missed at
   * once; otherwise the same rides' newer times, from the search or else straight from the feed.
   */
  live(): void
  /** The screen or the location came or went: the 3-minute checks follow. */
  syncChecks(): void
  /** After waking: where the Mac is, and the countdown's ends, looked at now. */
  wake(): void
}

interface Kept extends PlannedFrom {
  to: Place
  plan: TripPlan
  missed: boolean
  /** `plan` is the next way found after the miss, not the missed trip's own (TripState). */
  nextWay: boolean
  /** The plan a missed first ride was replanned for already: once is enough. */
  replannedMissed: TripPlan | null
  /** How many times its first ride has gone without the user: the second ends it. */
  misses: number
  /** Unix seconds: once missed, it's let go then, GIVE_UP_AFTER_SEC past its first arrival. */
  giveUpAt: number
}

const pointOf = (place: Place): LatLon => [place.lat, place.lon]

export function createKeptTrip(options: KeptTripOptions): KeptTrip {
  const { now } = options
  let kept: Kept | null = null
  /**
   * Bumped by each replan of its kind and as the trip goes, so a late answer lands nowhere. One
   * for each kind: a live read's replan mustn't drop a missed trip's.
   */
  let liveSeq = 0
  let missedSeq = 0
  let phaseTimer: ReturnType<typeof setTimeout> | undefined
  let checkTimer: ReturnType<typeof setTimeout> | undefined
  /** When it last asked where the Mac is (ms); null to ask as soon as it can. */
  let checkedAt: number | null = null

  function syncChecks(): void {
    clearTimeout(checkTimer)
    checkTimer = undefined
    if (!kept?.fix || !options.canCheck()) return
    const delay = checkedAt === null ? 0 : checkedAt + KEPT_FIX_SEC * 1000 - now()
    checkTimer = setTimeout(
      () => {
        checkedAt = now()
        options.locate()
        syncChecks()
      },
      Math.max(0, delay)
    )
  }

  function end(): void {
    if (!kept) return
    kept = null
    liveSeq += 1
    missedSeq += 1
    clearTimeout(phaseTimer)
    clearTimeout(checkTimer)
    phaseTimer = undefined
    checkTimer = undefined
    options.changed()
  }

  /** Acts on where the countdown is, and wakes again when that next changes. */
  function checkPhase(): void {
    clearTimeout(phaseTimer)
    phaseTimer = undefined
    if (!kept) return
    const phase = keptPhase(kept.plan, now() / 1000)
    // A trip never missed runs to its own arrival, however late its bus; once missed with no next
    // way found, not past half an hour after it would first have got there. A next way found
    // is a trip like any: it ends at its own arrival, a second miss, moving away, or closing.
    const givenUp = kept.missed && !kept.nextWay && now() >= kept.giveUpAt * 1000
    if (phase.kind === 'over' || givenUp) {
      end()
      return
    }
    if (phase.kind === 'missed' && kept.replannedMissed !== kept.plan && !onMissed(kept)) return
    const { plan } = kept
    const ride = firstRide(plan)
    let at = phase.kind === 'missed' || !ride ? plan.arrive : Math.min(ride.depart, plan.arrive)
    if (kept.missed && !kept.nextWay) at = Math.min(at, kept.giveUpAt)
    phaseTimer = setTimeout(checkPhase, Math.max(0, at * 1000 - now()))
  }

  /**
   * Its first ride has gone, or won't come: the next way is looked for, unless it was missed
   * before, when the user has let it go and it ends. False when it ended.
   */
  function onMissed(gone: Kept): boolean {
    if (gone.misses > 0) {
      end()
      return false
    }
    replanMissed(gone)
    return true
  }

  /**
   * The best way still to be caught from `from`, asked the way the trip was: from its time when
   * that's still to come ("Leave at 6 PM"), else now; arriving by its time while that's ahead
   * (a class), and once nothing still to be caught gets there by then, the soonest way, late.
   */
  async function nextWay(
    asked: PlanQuery,
    from: LatLon,
    to: Place
  ): Promise<{ plan: TripPlan; query: PlanQuery } | null> {
    const nowSec = Math.floor(now() / 1000)
    const ends = { from, to: pointOf(to) }
    const first: PlanQuery =
      asked.mode === 'arrive' && asked.time > nowSec
        ? { ...ends, time: asked.time, mode: 'arrive' }
        : { ...ends, time: Math.max(nowSec, asked.time), mode: 'depart' }
    const found = catchable((await options.ask(first))?.plans ?? [], now() / 1000)
    if (found) return { plan: found, query: first }
    if (first.mode === 'depart') return null
    const late: PlanQuery = { ...ends, time: nowSec, mode: 'depart' }
    const soonest = catchable((await options.ask(late))?.plans ?? [], now() / 1000)
    return soonest ? { plan: soonest, query: late } : null
  }

  /** The first ride's gone: the best way from where the trip starts now, shown as missed. */
  function replanMissed(gone: Kept): void {
    const start = options.startPoint(gone.start) ?? (gone.fix && { at: gone.fix.at, fix: gone.fix })
    // Nothing to offer until the replan answers: the plan in hand is the one that's gone.
    const asked: Kept = {
      ...gone,
      missed: true,
      nextWay: false,
      replannedMissed: gone.plan,
      misses: gone.misses + 1
    }
    kept = asked
    options.changed()
    if (!start) return
    const mine = ++missedSeq
    void nextWay(gone.query, start.at, gone.to).then((found) => {
      if (mine !== missedSeq || kept !== asked) return
      // Nothing else gets there: the missed trip stays, as missed, until it would have arrived.
      if (!found) return
      kept = { ...asked, ...found, nextWay: true, fix: start.fix ?? asked.fix }
      checkPhase()
      options.changed()
    })
  }

  return {
    shown: () =>
      kept ? { to: kept.to, plan: kept.plan, missed: kept.missed, nextWay: kept.nextWay } : null,
    fix: () => kept?.fix ?? null,
    keep(to, plan, from) {
      // One kept trip at a time: keeping another replaces it.
      liveSeq += 1
      missedSeq += 1
      kept = {
        to,
        plan,
        missed: false,
        nextWay: false,
        ...from,
        replannedMissed: null,
        misses: 0,
        giveUpAt: plan.arrive + GIVE_UP_AFTER_SEC
      }
      // It was planned from a fresh fix: the next check is 3 minutes on.
      checkedAt = now()
      options.changed()
      syncChecks()
      checkPhase()
    },
    end,
    located(fix) {
      if (kept?.fix && movedAway(kept.fix, fix)) end()
    },
    live() {
      const current = kept
      // Nothing to update: no rides, or the missed trip's own plan, with nothing to count down to.
      if (!current || current.plan.rides === 0 || (current.missed && !current.nextWay)) return
      // Its bus won't come: as good as gone, so the next best is found now, not at its time.
      if (firstRideGone(current.plan, options.feed(), now() / 1000)) {
        onMissed(current)
        return
      }
      const mine = ++liveSeq
      // From its start to its destination at its own time to leave, rather than its question:
      // asked to arrive by a time, a bus running late past it wouldn't come back.
      const query: PlanQuery = {
        from: current.query.from,
        to: current.query.to,
        time: current.plan.leave,
        mode: 'depart'
      }
      void options.ask(query).then((reply) => {
        if (mine !== liveSeq || kept !== current) return
        // Not found (running early, before the time to leave asked from; or other ways crowd it
        // out): its times straight from the feed, so the countdown still follows the bus.
        const same =
          reply?.plans.find((candidate) => sameJourney(candidate, current.plan)) ??
          followFeed(current.plan, options.feed(), now() / 1000)
        if (!same) return
        kept = { ...current, plan: same }
        checkPhase()
        options.changed()
      })
    },
    syncChecks,
    wake() {
      if (kept?.fix && options.canCheck()) {
        checkedAt = null
        syncChecks()
      }
      // A timer that slept through a leave time or an arrival fires late: look now.
      checkPhase()
    }
  }
}
