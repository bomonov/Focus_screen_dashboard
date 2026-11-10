// The trip search's own process, started by client.ts (utilityProcess.fork) with the timetable
// file's path as its one argument: it reads the timetable once, then answers each trip asked for.
// Nothing here touches the network, and nothing is read but that file.
import { readFile } from 'fs/promises'
import type {
  FeedTrip,
  StopRelationship,
  StopTimeEvent,
  StopTimeUpdate
} from '../transit/gtfsRealtime'
import { answerPlan } from './describe'
import type { PlanReply, PlanRequest } from './messages'
import { decodeTimetable } from './timetableFile'
import type { PlanQuery, Timetable } from './types'

/** A timetable it can't read leaves it answering `failed`, never exiting: the app asks again later. */
async function load(path: string | undefined): Promise<Timetable | null> {
  if (!path) return null
  try {
    const timetable = decodeTimetable(await readFile(path))?.timetable ?? null
    if (!timetable) console.warn('[trips] The timetable file is not one.')
    return timetable
  } catch (error) {
    console.warn('[trips] Could not read the timetable.', error)
    return null
  }
}

const ready = load(process.argv[2])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isNumberOrNull = (value: unknown): value is number | null =>
  value === null || typeof value === 'number'

const isPosition = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber)

const RELATIONSHIPS: readonly StopRelationship[] = ['scheduled', 'skipped', 'noData', 'unscheduled']

function isEvent(value: unknown): value is StopTimeEvent | null {
  return (
    value === null || (isRecord(value) && isNumberOrNull(value.time) && isNumberOrNull(value.delay))
  )
}

function isUpdate(value: unknown): value is StopTimeUpdate {
  return (
    isRecord(value) &&
    isNumberOrNull(value.stopSequence) &&
    typeof value.stopId === 'string' &&
    isEvent(value.arrival) &&
    isEvent(value.departure) &&
    RELATIONSHIPS.includes(value.relationship as StopRelationship)
  )
}

function isFeedTrip(value: unknown): value is FeedTrip {
  return (
    isRecord(value) &&
    typeof value.tripId === 'string' &&
    typeof value.routeId === 'string' &&
    isNumberOrNull(value.directionId) &&
    typeof value.canceled === 'boolean' &&
    typeof value.vehicleId === 'string' &&
    Array.isArray(value.stops) &&
    value.stops.every(isUpdate)
  )
}

function parseQuery(raw: unknown): PlanQuery | null {
  if (!isRecord(raw) || !isPosition(raw.from) || !isPosition(raw.to) || !isFiniteNumber(raw.time)) {
    return null
  }
  if (raw.mode !== 'depart' && raw.mode !== 'arrive') return null
  return { from: raw.from, to: raw.to, time: raw.time, mode: raw.mode }
}

/** What main asked, checked; a feed trip that isn't one is left out rather than failing the plan. */
function parseRequest(raw: Record<string, unknown>, id: number): PlanRequest | null {
  const query = parseQuery(raw.query)
  if (!query || !isFiniteNumber(raw.now) || !Array.isArray(raw.feed)) return null
  const feed = (raw.feed as unknown[]).filter(isFeedTrip)
  return { kind: 'plan', id, query, feed, now: raw.now }
}

// One at a time, in order: the first waits for the timetable, the rest for the one before.
let queue: Promise<void> = Promise.resolve()
process.parentPort.on('message', (event) => {
  const raw: unknown = event.data
  if (!isRecord(raw) || raw.kind !== 'plan' || typeof raw.id !== 'number') return
  const id = raw.id
  // One that names its request but isn't right is answered at once, not left to time out.
  const request = parseRequest(raw, id)
  queue = queue.then(async () => {
    const reply: PlanReply = request ? answerPlan(await ready, request) : { kind: 'failed', id }
    process.parentPort.postMessage(reply)
  })
})
