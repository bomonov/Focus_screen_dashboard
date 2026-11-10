// What the screen gets for a journey (describe.ts): names and colours instead of indexes, and the
// search's process's answer to one request.
import { describe, expect, it, vi } from 'vitest'
import type { FeedTrip } from '../transit/gtfsRealtime'
import { answerPlan, describeJourney } from './describe'
import type { PlanRequest } from './messages'
import { noTrip } from './rank'
import type { planTrips } from './raptor'
import { near } from './testTimetable'
import { serviceDayStart } from './timetable'
import type { Journey, Leg, PlanQuery, Timetable, TimetableRoute } from './types'

/** "HH:MM" or "HH:MM:SS" on Mon 2 Nov 2026, unix seconds. */
function at(time: string): number {
  const [hours, minutes, seconds] = time.split(':')
  return (
    serviceDayStart(20261102) + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds ?? 0)
  )
}

const STOPS = [
  { id: 'RT', name: 'Rural Rd & Terrace Rd', at: near(0, 0) },
  { id: 'TTC', name: 'Tempe Transportation Center', at: near(800, 0) },
  { id: 'VW', name: 'Veterans Way/College Ave', at: near(800, 150) },
  { id: 'AM', name: 'Apache Blvd & McClintock Dr', at: near(600, 3000) }
]

const ROUTES: TimetableRoute[] = [
  { id: 'VENU', short: 'VENU', long: 'Orbit Venus', color: '591769', textColor: 'FFFFFF', type: 3 },
  { id: '72', short: '72', long: 'Scottsdale Rd/Rural Rd', color: '', textColor: '', type: 3 },
  { id: 'LR', short: '', long: 'Valley Metro Rail', color: '7A8BA1', textColor: '000000', type: 0 },
  { id: 'SUB', short: 'S', long: 'Subway', color: '', textColor: '', type: 1 },
  { id: 'TRAIN', short: 'T', long: 'Train', color: '', textColor: '', type: 2 },
  { id: 'CAR', short: 'C', long: 'Cable car', color: '', textColor: '', type: 5 }
]

/** One pattern a route, stopping at every stop in order; its times don't matter here. */
const TIMETABLE: Timetable = {
  version: 'test',
  stops: {
    ids: STOPS.map((stop) => stop.id),
    names: STOPS.map((stop) => stop.name),
    lat: Float64Array.from(STOPS, (stop) => stop.at[0]),
    lon: Float64Array.from(STOPS, (stop) => stop.at[1])
  },
  routes: ROUTES,
  patterns: ROUTES.map((_, route) => ({
    route,
    direction: 0,
    headsign: route === 2 ? 'Mesa' : 'Tempe TC',
    stops: Uint32Array.of(0, 1, 2, 3),
    trips: [`trip ${route}`],
    service: Uint16Array.of(0),
    times: new Int32Array(8)
  })),
  services: [Int32Array.of(20261102)],
  transfers: {
    start: new Uint32Array(STOPS.length + 1),
    to: new Uint32Array(0),
    metres: new Uint16Array(0)
  }
}

const stop = (index: number): { kind: 'stop'; stop: number } => ({ kind: 'stop', stop: index })

function walk(
  from: Extract<Leg, { kind: 'walk' }>['from'],
  to: Extract<Leg, { kind: 'walk' }>['to'],
  start: number,
  seconds: number,
  metres: number
): Leg {
  return { kind: 'walk', from, to, start, end: start + seconds, metres }
}

function ride(
  pattern: number,
  board: number,
  alight: number,
  times: { depart: number; arrive: number; late?: number; live?: boolean }
): Leg {
  const late = times.late ?? 0
  return {
    kind: 'ride',
    pattern,
    trip: 0,
    tripId: `trip ${pattern}`,
    board,
    alight,
    depart: times.depart + late,
    arrive: times.arrive + late,
    scheduledDepart: times.depart,
    scheduledArrive: times.arrive,
    live: times.live ?? false
  }
}

/** Walk to Rural & Terrace, Orbit Venus to Tempe TC, walk to the rail, the rail out, walk home. */
const JOURNEY: Journey = {
  legs: [
    walk({ kind: 'origin' }, stop(0), at('08:00'), 340, 250.4),
    ride(0, 0, 1, { depart: at('08:04:10'), arrive: at('08:12'), late: 90, live: true }),
    walk(stop(1), stop(2), at('08:13:30'), 20, 120.3),
    ride(2, 2, 3, { depart: at('08:20'), arrive: at('08:31') }),
    walk(stop(3), { kind: 'destination' }, at('08:31'), 61, 80.2)
  ],
  depart: at('08:00'),
  arrive: at('08:32:01')
}

describe('describeJourney', () => {
  const plan = describeJourney(TIMETABLE, JOURNEY)

  it('gives when to leave and when it gets there, the rides and the metres walked', () => {
    expect(plan.leave).toBe(at('08:00'))
    expect(plan.arrive).toBe(at('08:32:01'))
    expect(plan.rides).toBe(2)
    // 250.4 + 120.3 + 80.2
    expect(plan.walkM).toBe(451)
    expect(plan.steps.map((step) => step.kind)).toEqual(['walk', 'ride', 'walk', 'ride', 'walk'])
  })

  it('names each walk by the stop it walks to, and none for the destination', () => {
    const walks = plan.steps.filter((step) => step.kind === 'walk')
    expect(walks.map((step) => step.toName)).toEqual([
      'Rural Rd & Terrace Rd',
      'Veterans Way/College Ave',
      null
    ])
    expect(walks[0]).toMatchObject({ start: at('08:00'), end: at('08:05:40') })
  })

  it('rounds a walk up to whole minutes, and never under one', () => {
    const walks = plan.steps.filter((step) => step.kind === 'walk')
    // 340 s, 20 s, 61 s.
    expect(walks.map((step) => step.minutes)).toEqual([6, 1, 2])
    const still = describeJourney(TIMETABLE, {
      legs: [walk({ kind: 'origin' }, { kind: 'destination' }, at('08:00'), 0, 0.4)],
      depart: at('08:00'),
      arrive: at('08:00')
    })
    expect(still.steps).toEqual([
      { kind: 'walk', start: at('08:00'), end: at('08:00'), minutes: 1, toName: null }
    ])
  })

  it('names each ride by its route, where it heads, and the stops it is boarded and left at', () => {
    expect(plan.steps[1]).toEqual({
      kind: 'ride',
      routeName: 'Orbit Venus',
      short: 'VENU',
      color: '591769',
      textColor: 'FFFFFF',
      rail: false,
      headsign: 'Tempe TC',
      tripId: 'trip 0',
      fromName: 'Rural Rd & Terrace Rd',
      fromStopId: 'RT',
      toName: 'Tempe Transportation Center',
      toStopId: 'TTC',
      depart: at('08:05:40'),
      arrive: at('08:13:30'),
      stops: 1,
      live: true,
      delayMin: 2
    })
    expect(plan.steps[3]).toMatchObject({
      routeName: 'Valley Metro Rail',
      headsign: 'Mesa',
      tripId: 'trip 2',
      fromName: 'Veterans Way/College Ave',
      fromStopId: 'VW',
      toName: 'Apache Blvd & McClintock Dr',
      toStopId: 'AM'
    })
  })

  it('calls a numbered route "Route 72", and leaves colours the schedule has none for empty', () => {
    const numbered = describeJourney(TIMETABLE, {
      legs: [ride(1, 0, 3, { depart: at('08:00'), arrive: at('08:20') })],
      depart: at('08:00'),
      arrive: at('08:20')
    })
    expect(numbered.steps[0]).toMatchObject({
      routeName: 'Route 72',
      short: '72',
      color: '',
      textColor: '',
      stops: 3
    })
    expect(numbered.walkM).toBe(0)
  })

  it('counts light rail, subways and trains as rail, and buses and anything else not', () => {
    const railOf = (pattern: number): boolean => {
      const step = describeJourney(TIMETABLE, {
        legs: [ride(pattern, 0, 1, { depart: at('08:00'), arrive: at('08:05') })],
        depart: at('08:00'),
        arrive: at('08:05')
      }).steps[0]
      return step?.kind === 'ride' && step.rail
    }
    expect(ROUTES.map((_, pattern) => railOf(pattern))).toEqual([
      false,
      false,
      true,
      true,
      true,
      false
    ])
  })

  it('gives a live ride’s lateness in whole minutes, none when it is on time or not live', () => {
    const delayOf = (late: number, live: boolean): number | null => {
      const step = describeJourney(TIMETABLE, {
        legs: [ride(0, 0, 1, { depart: at('08:00'), arrive: at('08:05'), late, live })],
        depart: at('08:00'),
        arrive: at('08:05')
      }).steps[0]
      return step?.kind === 'ride' ? step.delayMin : null
    }
    expect(delayOf(90, true)).toBe(2)
    expect(delayOf(89, true)).toBe(1)
    expect(delayOf(29, true)).toBeNull()
    expect(delayOf(0, true)).toBeNull()
    expect(delayOf(-120, true)).toBe(-2)
    // -30 s rounds to -0, which is on time too.
    expect(delayOf(-30, true)).toBeNull()
    expect(delayOf(300, false)).toBeNull()
  })

  it('describes walking all the way as one walk to the destination', () => {
    const walking = describeJourney(TIMETABLE, {
      legs: [walk({ kind: 'origin' }, { kind: 'destination' }, at('08:00'), 600, 600.6)],
      depart: at('08:00'),
      arrive: at('08:10')
    })
    expect(walking).toEqual({
      leave: at('08:00'),
      arrive: at('08:10'),
      steps: [{ kind: 'walk', start: at('08:00'), end: at('08:10'), minutes: 10, toName: null }],
      rides: 0,
      walkM: 601
    })
  })
})

describe('answerPlan', () => {
  const query: PlanQuery = {
    from: near(0, -100),
    to: near(600, 3100),
    time: at('08:00'),
    mode: 'depart'
  }
  const NOW = at('07:59')
  /** Trip 0 (whose timetable has it at midnight) a minute late from its first stop on. */
  const FEED: FeedTrip[] = [
    {
      tripId: 'trip 0',
      routeId: 'VENU',
      directionId: 0,
      canceled: false,
      vehicleId: '',
      stops: [
        {
          stopSequence: 1,
          stopId: 'RT',
          arrival: null,
          departure: { time: null, delay: 60 },
          relationship: 'scheduled'
        }
      ]
    }
  ]
  const request = (feed: FeedTrip[] = []): PlanRequest => ({
    kind: 'plan',
    id: 7,
    query,
    feed,
    now: NOW
  })

  it('describes what was found, with nothing to say about no trip', () => {
    const search = vi.fn<typeof planTrips>(() => [JOURNEY])
    const reply = answerPlan(TIMETABLE, request(), search)
    expect(reply.kind).toBe('planned')
    if (reply.kind !== 'planned') return
    expect(reply.id).toBe(7)
    expect(reply.plans[0]).toEqual(describeJourney(TIMETABLE, JOURNEY))
    expect(reply.noTrip).toBeNull()
  })

  it('reads the feed as of `now` and hands the search its live times', () => {
    const search = vi.fn<typeof planTrips>(() => [JOURNEY])
    answerPlan(TIMETABLE, request(FEED), search)
    const [tt, asked, live] = search.mock.calls[0] ?? []
    expect(tt).toBe(TIMETABLE)
    expect(asked).toEqual(query)
    // A delay is put on the run that's on at `now`: 2 Nov's. Without a clock it would be NaN.
    expect(live?.get('trip 0')?.departure[0]).toBe(serviceDayStart(20261102) + 60)
  })

  it('says why there is no trip when nothing was found', () => {
    // 3.2 km apart: past a 45-minute walk, so the walk isn't a trip either.
    const reply = answerPlan(TIMETABLE, request(), () => [])
    expect(reply).toEqual({ kind: 'planned', id: 7, plans: [], noTrip: noTrip(TIMETABLE, query) })
  })

  it('fails without a timetable, or when the search throws', () => {
    expect(answerPlan(null, request(), () => [JOURNEY])).toEqual({ kind: 'failed', id: 7 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = answerPlan(TIMETABLE, request(), () => {
      throw new Error('broken')
    })
    expect(broken).toEqual({ kind: 'failed', id: 7 })
    warn.mockRestore()
  })
})
