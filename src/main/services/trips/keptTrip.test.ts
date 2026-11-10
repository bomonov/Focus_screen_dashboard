// The kept trip on the real search: a small timetable answered the way the search's process
// answers (answerPlan), with the feed as the live read gives it. A bus running late past an
// arrive-by time is followed rather than called missed, one running early is followed from the
// feed, and a canceled one is replanned the way the trip was asked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedTrip, StopTimeUpdate } from '../transit/gtfsRealtime'
import type { LatLon } from '../transit/routeLine'
import { answerPlan } from './describe'
import { firstRide } from './kept'
import { createKeptTrip, type KeptTrip } from './keptTrip'
import { near, testTimetable, type TestSpec } from './testTimetable'
import type { Place, PlanQuery, Timetable, TripPlan } from './types'

/** Unix seconds at a time of Mon 2 Nov 2026 in Tempe (UTC−7): the test timetable's day. */
const at = (hours: number, minutes = 0, seconds = 0): number =>
  Date.UTC(2026, 10, 2, hours + 7, minutes, seconds) / 1000

const START = near(0, 0)
const CLASS = near(0, 5100)
const place = (id: string, kind: Place['kind'], [lat, lon]: LatLon): Place => ({
  id,
  kind,
  name: id,
  detail: '',
  lat,
  lon
})
const HOME = place('home', 'home', START)
const TO = place('class:byeng', 'class', CLASS)

/** One route along the street: a bus every few minutes from A, by the start, to B, by the class. */
const SPEC: TestSpec = {
  stops: { A: near(0, 100), B: near(0, 5000) },
  routes: [
    {
      id: 'R',
      trips: [
        {
          id: 'early',
          stops: [
            ['A', '14:05'],
            ['B', '14:25']
          ]
        },
        {
          id: 'mid',
          stops: [
            ['A', '14:12'],
            ['B', '14:32']
          ]
        },
        {
          id: 'kept',
          stops: [
            ['A', '14:20'],
            ['B', '14:40']
          ]
        },
        {
          id: 'later',
          stops: [
            ['A', '14:50'],
            ['B', '15:10']
          ]
        }
      ]
    }
  ]
}

/** Arrive by 14:45: the latest bus that gets there in time is "kept", at A at 14:20. */
const BY = at(14, 45)
const ASKED: PlanQuery = { from: START, to: CLASS, time: BY, mode: 'arrive' }

const timedAt = (stopId: string, time: number, delay: number): StopTimeUpdate => ({
  stopSequence: null,
  stopId,
  arrival: { time, delay },
  departure: { time, delay },
  relationship: 'scheduled'
})

const feedTrip = (change: Partial<FeedTrip>): FeedTrip => ({
  tripId: 'kept',
  routeId: 'R',
  directionId: null,
  canceled: false,
  vehicleId: '',
  stops: [],
  ...change
})

interface Rig {
  kept: KeptTrip
  asked: PlanQuery[]
  /** The plan kept: the arrive-by question's best. */
  plan: TripPlan
  feed: FeedTrip[]
}

let tt: Timetable

beforeEach(async () => {
  tt = await testTimetable(SPEC)
  vi.useFakeTimers()
  vi.setSystemTime(at(14) * 1000)
})

afterEach(() => {
  vi.useRealTimers()
})

async function keptRig(): Promise<Rig> {
  const rig = { asked: [] as PlanQuery[], feed: [] as FeedTrip[] }
  const ask = (query: PlanQuery): ReturnType<Parameters<typeof createKeptTrip>[0]['ask']> => {
    rig.asked.push(query)
    const now = Math.floor(Date.now() / 1000)
    const reply = answerPlan(tt, { kind: 'plan', id: 1, query, feed: rig.feed, now })
    return Promise.resolve(reply.kind === 'planned' ? reply : null)
  }
  const kept = createKeptTrip({
    now: () => Date.now(),
    ask,
    feed: () => rig.feed,
    startPoint: () => ({ at: START, fix: null }),
    locate: () => undefined,
    canCheck: () => false,
    changed: () => undefined
  })
  const plan = (await ask(ASKED))?.plans[0]
  if (!plan) throw new Error('The test timetable plans no trip to class.')
  expect(firstRide(plan)?.tripId).toBe('kept')
  kept.keep(TO, plan, { query: ASKED, start: { kind: 'place', place: HOME }, fix: null })
  rig.asked.length = 0
  return { kept, plan, ...rig }
}

describe('createKeptTrip on the real search', () => {
  it('follows a bus running 5 minutes late past the arrive-by time, not “Missed it”', async () => {
    const rig = await keptRig()
    rig.feed.push(
      feedTrip({ stops: [timedAt('A', at(14, 25), 300), timedAt('B', at(14, 45), 300)] })
    )
    rig.kept.live()
    await vi.advanceTimersByTimeAsync(0)
    const plan = rig.kept.shown()?.plan
    expect(firstRide(plan as TripPlan)).toMatchObject({
      tripId: 'kept',
      depart: at(14, 25),
      live: true,
      delayMin: 5
    })
    // Past the class's arrive-by time: late, but this is still its bus.
    expect(plan?.arrive).toBeGreaterThan(BY)
    expect(plan?.leave).toBe(rig.plan.leave + 300)
    // Asked from its own time to leave, leaving then: not the arrive-by question again.
    expect(rig.asked).toEqual([{ from: START, to: CLASS, time: rig.plan.leave, mode: 'depart' }])
    // Its timetable time comes and goes: it's late, not missed.
    await vi.advanceTimersByTimeAsync((at(14, 21) - at(14)) * 1000)
    expect(rig.kept.shown()).toMatchObject({ missed: false })
  })

  it('follows a bus running early straight from the feed, when the search can no longer catch it', async () => {
    const rig = await keptRig()
    rig.feed.push(feedTrip({ stops: [timedAt('A', at(14, 18), -120)] }))
    rig.kept.live()
    await vi.advanceTimersByTimeAsync(0)
    const plan = rig.kept.shown()?.plan as TripPlan
    expect(firstRide(plan)).toMatchObject({ tripId: 'kept', depart: at(14, 18), delayMin: -2 })
    expect(plan.leave).toBe(rig.plan.leave - 120)
  })

  it('replans arrive-by when its bus is canceled: the latest way that still gets there in time', async () => {
    const rig = await keptRig()
    rig.feed.push(feedTrip({ canceled: true }))
    rig.kept.live()
    await vi.advanceTimersByTimeAsync(0)
    expect(rig.asked).toEqual([{ from: START, to: CLASS, time: BY, mode: 'arrive' }])
    const shown = rig.kept.shown()
    expect(shown).toMatchObject({ missed: true, nextWay: true })
    // Leaving now would have taken the earliest bus; arriving by 14:45 leaves on the one at 14:12.
    expect(firstRide(shown?.plan as TripPlan)?.tripId).toBe('mid')
  })
})
