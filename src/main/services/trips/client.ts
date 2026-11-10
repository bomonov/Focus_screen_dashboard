// The trip search runs in a process of its own (worker.ts): the timetable it reads is ~8.5 MB on
// disk and more once laid out, which the app would otherwise keep for good. It's started when a
// trip is asked for and stopped once it sits idle, which gives all of that back.
import type { FeedTrip } from '../transit/gtfsRealtime'
import type { NoTrip, PlanReply, PlanRequest } from './messages'
import { MAX_RESULTS } from './rank'
import { MAX_RIDES, type PlanQuery, type TripPlan, type TripRide, type TripStep } from './types'

/** The search's process, as `utilityProcess.fork` gives it (wrapped, so tests can fake it). */
export interface PlannerProcess {
  postMessage(message: PlanRequest): void
  onMessage(listener: (message: unknown) => void): void
  onExit(listener: () => void): void
  kill(): void
}

export interface TripPlanner {
  /**
   * The trips for `query` with the feed's live times, or null when there's no answer: the process
   * couldn't be started, stopped, took too long, sent something that isn't one, or answered
   * `failed` (a failed reply comes back as null, never as itself). `now` (unix seconds) is the
   * clock the feed's delays are read by: the caller's, so a demo or a test clock is the search's
   * too; the system's when it's left out.
   */
  plan(query: PlanQuery, feed: FeedTrip[], now?: number): Promise<PlanReply | null>
  dispose(): void
}

export interface TripPlannerOptions {
  start(): PlannerProcess
  /** Asking again a minute later (the next live read) finds it running; reading the timetable anew costs a moment. */
  idleMs?: number
  /** A search takes a fraction of a second; one this slow is stuck. */
  timeoutMs?: number
}

const IDLE_MS = 120_000
const TIMEOUT_MS = 10_000
/** Past any name the schedule gives (it keeps 200 characters of one). */
const MAX_TEXT_CHARS = 300
/** GTFS ids are short; a longer string isn't one. */
const MAX_ID_CHARS = 200
/** A walk before, between and after each ride. */
const MAX_STEPS = 2 * MAX_RIDES + 1
const COLOR = /^(?:[0-9A-Fa-f]{6})?$/

interface Pending {
  resolve(reply: PlanReply | null): void
  timer: ReturnType<typeof setTimeout>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_TEXT_CHARS

const isColor = (value: unknown): value is string => typeof value === 'string' && COLOR.test(value)

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_ID_CHARS

function parseStep(raw: unknown): TripStep | TripRide | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'walk') {
    const { start, end, minutes, toName } = raw
    if (!isTime(start) || !isTime(end) || !isCount(minutes)) return null
    if (toName !== null && !isText(toName)) return null
    return { kind: 'walk', start, end, minutes, toName }
  }
  if (raw.kind !== 'ride') return null
  const { routeName, short, color, textColor, rail, headsign, fromName, toName } = raw
  const { tripId, fromStopId, toStopId, depart, arrive, stops, live, delayMin } = raw
  if (!isText(routeName) || !isText(short) || !isText(headsign)) return null
  if (!isText(fromName) || !isText(toName)) return null
  if (!isId(tripId) || !isId(fromStopId) || !isId(toStopId)) return null
  // The renderer puts these in a style: nothing but a colour gets there.
  if (!isColor(color) || !isColor(textColor)) return null
  if (typeof rail !== 'boolean' || typeof live !== 'boolean') return null
  if (!isTime(depart) || !isTime(arrive) || !isCount(stops)) return null
  if (delayMin !== null && !Number.isInteger(delayMin)) return null
  return {
    kind: 'ride',
    routeName,
    short,
    color,
    textColor,
    rail,
    headsign,
    tripId,
    fromName,
    fromStopId,
    toName,
    toStopId,
    depart,
    arrive,
    stops,
    live,
    delayMin: delayMin as number | null
  }
}

function parsePlan(raw: unknown): TripPlan | null {
  if (!isRecord(raw)) return null
  const { leave, arrive, steps, rides, walkM } = raw
  if (!isTime(leave) || !isTime(arrive) || !isCount(rides) || !isTime(walkM)) return null
  if (!Array.isArray(steps) || steps.length > MAX_STEPS) return null
  const read: (TripStep | TripRide)[] = []
  for (const step of steps as unknown[]) {
    const parsed = parseStep(step)
    if (!parsed) return null
    read.push(parsed)
  }
  return { leave, arrive, steps: read, rides, walkM }
}

/** What no trip says, null for nothing to say (there are plans), undefined when it isn't one. */
function parseNoTrip(raw: unknown): NoTrip | null | undefined {
  if (raw === null) return null
  if (!isRecord(raw)) return undefined
  const { walkSec, serviceStarts } = raw
  if (walkSec !== null && !isTime(walkSec)) return undefined
  if (serviceStarts !== null && !isTime(serviceStarts)) return undefined
  return { walkSec, serviceStarts }
}

/**
 * The process's answer, checked like anything from outside. One that names its request but isn't
 * right counts as that request failing; one that names none is no answer at all.
 */
function parseReply(raw: unknown): PlanReply | null {
  if (!isRecord(raw) || typeof raw.id !== 'number') return null
  const failed: PlanReply = { kind: 'failed', id: raw.id }
  const { plans } = raw
  if (raw.kind !== 'planned' || !Array.isArray(plans) || plans.length > MAX_RESULTS) return failed
  const read: TripPlan[] = []
  for (const plan of plans as unknown[]) {
    const parsed = parsePlan(plan)
    if (!parsed) return failed
    read.push(parsed)
  }
  const noTrip = parseNoTrip(raw.noTrip)
  if (noTrip === undefined) return failed
  return { kind: 'planned', id: raw.id, plans: read, noTrip }
}

export function createTripPlanner({
  start,
  idleMs = IDLE_MS,
  timeoutMs = TIMEOUT_MS
}: TripPlannerOptions): TripPlanner {
  let current: PlannerProcess | null = null
  let nextId = 1
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const pending = new Map<number, Pending>()

  /** Stopped once nothing's asked of it: that gives the timetable's memory back. */
  function idleLater(): void {
    clearTimeout(idleTimer)
    if (current && pending.size === 0) idleTimer = setTimeout(stop, idleMs)
  }

  function settle(id: number, reply: PlanReply | null): void {
    const waiting = pending.get(id)
    // An answer to a request that's been settled (timed out, say) or never made: dropped.
    if (!waiting) return
    pending.delete(id)
    clearTimeout(waiting.timer)
    waiting.resolve(reply?.kind === 'planned' ? reply : null)
    idleLater()
  }

  function stop(): void {
    const running = current
    current = null
    clearTimeout(idleTimer)
    for (const id of [...pending.keys()]) settle(id, null)
    running?.kill()
  }

  function processFor(): PlannerProcess | null {
    if (current) return current
    let started: PlannerProcess
    try {
      started = start()
    } catch (error) {
      console.warn('[trips] Could not start the trip search.', error)
      return null
    }
    current = started
    started.onMessage((raw) => {
      // A process that was stopped may still be finishing a search: none of it counts.
      if (current !== started) return
      const reply = parseReply(raw)
      if (reply) settle(reply.id, reply)
    })
    started.onExit(() => {
      if (current !== started) return
      current = null
      clearTimeout(idleTimer)
      for (const id of [...pending.keys()]) settle(id, null)
    })
    return started
  }

  return {
    plan(query, feed, now = Math.floor(Date.now() / 1000)) {
      if (disposed) return Promise.resolve(null)
      clearTimeout(idleTimer)
      const target = processFor()
      if (!target) return Promise.resolve(null)
      const id = nextId++
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          settle(id, null)
          // Stuck: a fresh one is started next time.
          stop()
        }, timeoutMs)
        pending.set(id, { resolve, timer })
        target.postMessage({ kind: 'plan', id, query, feed, now })
      })
    },
    dispose() {
      disposed = true
      stop()
    }
  }
}
