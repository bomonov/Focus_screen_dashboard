// The ranking's rules (rank.ts): which three of the search's journeys the card shows, walking
// the whole way as a trip, and what "no trip" has to say. The search itself is injected as a
// fake, so these tests say what it returned and don't need it.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { MAX_CHANGE_WAIT_SEC, noTrip, planAll, rankTrips } from './rank'
import type { planTrips } from './raptor'
import { near, testTimetable } from './testTimetable'
import { serviceDayStart } from './timetable'
import type { Journey, Leg, LiveTimes, PlanQuery, Timetable } from './types'
import { walkOnly, walkSeconds } from './walk'

const NO_LIVE: LiveTimes = new Map()

/** "HH:MM" or "HH:MM:SS" on 2 Nov 2026 (or `date`; 26:00 is 02:00 the day after), unix seconds. */
function at(time: string, date = 20261102): number {
  const [hours, minutes, seconds] = time.split(':')
  return serviceDayStart(date) + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds ?? 0)
}

interface Shape {
  depart: string
  arrive: string
  /** One (pattern, board, alight) a ride, in order. */
  rides: [pattern: number, board: number, alight: number][]
  /** Straight-line metres of each walk leg. */
  walks?: number[]
}

/**
 * A journey made for the ranking to read: only its times, its rides and its walks matter to it,
 * so the legs aren't laid end to end.
 */
function journey(shape: Shape): Journey {
  const depart = at(shape.depart)
  const arrive = at(shape.arrive)
  const legs: Leg[] = [
    ...(shape.walks ?? []).map((metres): Leg => ({
      kind: 'walk',
      from: { kind: 'origin' },
      to: { kind: 'stop', stop: 0 },
      start: depart,
      end: depart + walkSeconds(metres),
      metres
    })),
    ...shape.rides.map(([pattern, board, alight]): Leg => ({
      kind: 'ride',
      pattern,
      trip: 0,
      tripId: `trip ${pattern}`,
      board,
      alight,
      depart,
      arrive,
      scheduledDepart: depart,
      scheduledArrive: arrive,
      live: false
    }))
  ]
  return { legs, depart, arrive }
}

/**
 * A timetable with only what the ranking reads: which route each pattern is and which stop each
 * of its positions is. Stops are named by their ids, as testTimetable's are.
 */
function fakeTimetable(patterns: { route: string; stops: string[] }[]): Timetable {
  const stopIds = [...new Set(patterns.flatMap((p) => p.stops))]
  const routeIds = [...new Set(patterns.map((p) => p.route))]
  return {
    version: 'test',
    stops: {
      ids: stopIds,
      names: stopIds,
      lat: new Float64Array(stopIds.length),
      lon: new Float64Array(stopIds.length)
    },
    routes: routeIds.map((id) => ({ id, short: id, long: '', color: '', textColor: '', type: 3 })),
    patterns: patterns.map((p) => ({
      route: routeIds.indexOf(p.route),
      direction: 0,
      headsign: '',
      stops: Uint32Array.from(p.stops, (stop) => stopIds.indexOf(stop)),
      trips: [],
      service: new Uint16Array(0),
      times: new Int32Array(0)
    })),
    services: [],
    transfers: {
      start: new Uint32Array(stopIds.length + 1),
      to: new Uint32Array(0),
      metres: new Uint16Array(0)
    }
  }
}

/**
 * Pattern n is route "R{n}", and position p is stop "S{p}" in every pattern: so the rides of the
 * tests below are the same rides exactly when their (pattern, board, alight) are the same.
 */
const grid = fakeTimetable(
  Array.from({ length: 12 }, (_, n) => ({
    route: `R${n}`,
    stops: Array.from({ length: 12 }, (_, p) => `S${p}`)
  }))
)

/** A ride leg at the given times, no live data. */
function rideLeg(
  pattern: number,
  board: number,
  alight: number,
  depart: string,
  arrive: string
): Leg {
  return {
    kind: 'ride',
    pattern,
    trip: 0,
    tripId: `trip ${pattern}`,
    board,
    alight,
    depart: at(depart),
    arrive: at(arrive),
    scheduledDepart: at(depart),
    scheduledArrive: at(arrive),
    live: false
  }
}

/** A walk leg at the given times. */
function walkLeg(start: string, end: string, metres: number): Leg {
  return {
    kind: 'walk',
    from: { kind: 'stop', stop: 0 },
    to: { kind: 'stop', stop: 1 },
    start: at(start),
    end: at(end),
    metres
  }
}

/** A journey whose legs follow one another, so its waits are the gaps between them. */
function chained(...legs: Leg[]): Journey {
  const first = legs[0] as Leg
  const last = legs[legs.length - 1] as Leg
  return {
    legs,
    depart: first.kind === 'walk' ? first.start : first.depart,
    arrive: last.kind === 'walk' ? last.end : last.arrive
  }
}

/** "HH:MM" for `minutes` after midnight (under 24 h). */
function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** The rides of a ranked list, to read which journeys came out in which order. */
const shown = (ranked: Journey[]): string[] =>
  ranked.map((j) => {
    const rides = j.legs.flatMap((leg) => (leg.kind === 'ride' ? [`${leg.pattern}`] : []))
    return rides.length > 0 ? rides.join('+') : 'walk'
  })

describe('rankTrips · leaving at a time', () => {
  it('shows nothing for nothing', () => {
    expect(rankTrips(grid, [], 'depart')).toEqual([])
  })

  it('puts the earliest arrival first, then the others by arrival', () => {
    const slow = journey({ depart: '08:00', arrive: '08:40', rides: [[1, 0, 5]], walks: [200] })
    const quick = journey({ depart: '08:10', arrive: '08:35', rides: [[2, 0, 4]], walks: [200] })
    const last = journey({ depart: '08:20', arrive: '08:50', rides: [[3, 0, 3]], walks: [200] })
    expect(shown(rankTrips(grid, [slow, last, quick], 'depart'))).toEqual(['2', '1', '3'])
  })

  it("doesn't change the list it's given", () => {
    const a = journey({ depart: '08:00', arrive: '08:40', rides: [[1, 0, 5]] })
    const b = journey({ depart: '08:10', arrive: '08:35', rides: [[2, 0, 4]] })
    const given = [a, b]
    rankTrips(grid, given, 'depart')
    expect(given).toEqual([a, b])
  })

  it('lets one that arrives 2 minutes later with a ride fewer beat the earliest', () => {
    const early = journey({
      depart: '08:00',
      arrive: '08:30',
      rides: [
        [1, 0, 2],
        [2, 0, 3]
      ]
    })
    const direct = journey({ depart: '08:00', arrive: '08:32', rides: [[3, 0, 5]] })
    expect(shown(rankTrips(grid, [early, direct], 'depart'))).toEqual(['3', '1+2'])
  })

  it("doesn't when it arrives 3 minutes later, or 2 minutes and a second", () => {
    const early = journey({
      depart: '08:00',
      arrive: '08:30',
      rides: [
        [1, 0, 2],
        [2, 0, 3]
      ]
    })
    const threeMinutes = journey({ depart: '08:00', arrive: '08:33', rides: [[3, 0, 5]] })
    expect(shown(rankTrips(grid, [early, threeMinutes], 'depart'))).toEqual(['1+2', '3'])
    const justOver = journey({ depart: '08:00', arrive: '08:32:01', rides: [[3, 0, 5]] })
    expect(shown(rankTrips(grid, [early, justOver], 'depart'))).toEqual(['1+2', '3'])
  })

  it('lets one that arrives a minute later with 400 m less walking beat the earliest', () => {
    const early = journey({ depart: '08:00', arrive: '08:30', rides: [[1, 0, 5]], walks: [600] })
    const lessWalking = journey({
      depart: '08:00',
      arrive: '08:31',
      rides: [[2, 0, 5]],
      walks: [200]
    })
    expect(shown(rankTrips(grid, [early, lessWalking], 'depart'))).toEqual(['2', '1'])
  })

  it('counts every walk of a journey, the transfers as well as the ends', () => {
    // 150 + 100 + 150 = 400 m against one walk of 300 m: the second walks less in all, though
    // its one walk is longer than any of the first's.
    const early = journey({
      depart: '08:00',
      arrive: '08:30',
      rides: [[1, 0, 5]],
      walks: [150, 100, 150]
    })
    const lessInAll = journey({
      depart: '08:00',
      arrive: '08:31',
      rides: [[2, 0, 5]],
      walks: [300]
    })
    expect(shown(rankTrips(grid, [early, lessInAll], 'depart'))).toEqual(['2', '1'])
  })

  it("doesn't let a slower one with more rides and more walking beat the earliest", () => {
    const early = journey({ depart: '08:00', arrive: '08:30', rides: [[1, 0, 5]], walks: [200] })
    const worse = journey({
      depart: '08:00',
      arrive: '08:31',
      rides: [
        [2, 0, 1],
        [3, 0, 2]
      ],
      walks: [400]
    })
    expect(shown(rankTrips(grid, [early, worse], 'depart'))).toEqual(['1', '2+3'])
  })

  it('picks, among those that beat the earliest, the fewest rides, then the least walking', () => {
    const early = journey({
      depart: '08:00',
      arrive: '08:30',
      rides: [
        [1, 0, 2],
        [2, 0, 3],
        [3, 0, 4]
      ]
    })
    const twoRides = journey({
      depart: '08:00',
      arrive: '08:31',
      rides: [
        [4, 0, 2],
        [5, 0, 3]
      ]
    })
    const oneRideFar = journey({
      depart: '08:00',
      arrive: '08:32',
      rides: [[6, 0, 5]],
      walks: [500]
    })
    const oneRideNear = journey({
      depart: '08:00',
      arrive: '08:32',
      rides: [[7, 0, 5]],
      walks: [100]
    })
    expect(shown(rankTrips(grid, [early, twoRides, oneRideFar, oneRideNear], 'depart'))).toEqual([
      '7',
      '1+2+3',
      '4+5'
    ])
  })

  it('applies the beating once: the best is not itself beaten by what it beat', () => {
    // b beats a (one ride fewer, 2 min later); c arrives 2 min after b with one ride fewer
    // again, but it is 4 min after a, so it never gets to beat anything.
    const a = journey({
      depart: '08:00',
      arrive: '08:30',
      rides: [
        [1, 0, 2],
        [2, 0, 3],
        [3, 0, 4]
      ]
    })
    const b = journey({
      depart: '08:00',
      arrive: '08:32',
      rides: [
        [4, 0, 2],
        [5, 0, 3]
      ]
    })
    const c = journey({ depart: '08:00', arrive: '08:34', rides: [[6, 0, 5]] })
    expect(shown(rankTrips(grid, [a, b, c], 'depart'))).toEqual(['4+5', '1+2+3', '6'])
  })

  it('breaks a tie in arrival by fewer rides, then less walking, then the later departure', () => {
    const twoRides = journey({
      depart: '08:00',
      arrive: '08:30',
      rides: [
        [1, 0, 2],
        [2, 0, 3]
      ],
      walks: [500]
    })
    const moreWalking = journey({
      depart: '08:00',
      arrive: '08:30',
      rides: [[3, 0, 5]],
      walks: [300]
    })
    const lessWalking = journey({
      depart: '08:00',
      arrive: '08:30',
      rides: [[4, 0, 5]],
      walks: [100]
    })
    expect(shown(rankTrips(grid, [twoRides, moreWalking, lessWalking], 'depart'))).toEqual([
      '4',
      '3',
      '1+2'
    ])
    const later = journey({ depart: '08:10', arrive: '08:30', rides: [[5, 0, 5]], walks: [100] })
    expect(shown(rankTrips(grid, [lessWalking, later], 'depart'))).toEqual(['5', '4'])
  })

  it("never shows the best's rides again, later, among the others", () => {
    const best = journey({ depart: '08:00', arrive: '08:30', rides: [[1, 2, 5]] })
    const sameLater = journey({ depart: '08:20', arrive: '08:50', rides: [[1, 2, 5]] })
    const other = journey({ depart: '08:10', arrive: '08:40', rides: [[2, 0, 3]] })
    const sameLaterStill = journey({ depart: '08:30', arrive: '09:00', rides: [[1, 2, 5]] })
    expect(shown(rankTrips(grid, [sameLater, other, best, sameLaterStill], 'depart'))).toEqual([
      '1',
      '2'
    ])
  })

  it('never shows the same rides twice among the others either', () => {
    const best = journey({ depart: '08:00', arrive: '08:30', rides: [[1, 0, 5]] })
    const second = journey({ depart: '08:10', arrive: '08:40', rides: [[2, 0, 3]] })
    const secondLater = journey({ depart: '08:20', arrive: '08:50', rides: [[2, 0, 3]] })
    const third = journey({ depart: '08:30', arrive: '09:00', rides: [[3, 0, 3]] })
    expect(shown(rankTrips(grid, [best, second, secondLater, third], 'depart'))).toEqual([
      '1',
      '2',
      '3'
    ])
  })

  it('counts the same pattern boarded or left elsewhere, or rides in another order, as other rides', () => {
    const best = journey({ depart: '08:00', arrive: '08:30', rides: [[1, 2, 5]] })
    const boardsElsewhere = journey({ depart: '08:10', arrive: '08:40', rides: [[1, 3, 5]] })
    const leavesElsewhere = journey({ depart: '08:20', arrive: '08:50', rides: [[1, 2, 6]] })
    expect(shown(rankTrips(grid, [best, boardsElsewhere, leavesElsewhere], 'depart'))).toEqual([
      '1',
      '1',
      '1'
    ])
    const ab = journey({
      depart: '08:00',
      arrive: '08:30',
      rides: [
        [1, 0, 2],
        [2, 0, 3]
      ]
    })
    const ba = journey({
      depart: '08:10',
      arrive: '08:40',
      rides: [
        [2, 0, 3],
        [1, 0, 2]
      ]
    })
    const abLater = journey({
      depart: '08:20',
      arrive: '08:50',
      rides: [
        [1, 0, 2],
        [2, 0, 3]
      ]
    })
    expect(shown(rankTrips(grid, [ab, ba, abLater], 'depart'))).toEqual(['1+2', '2+1'])
  })

  it('shows three at most', () => {
    const many = [1, 2, 3, 4, 5].map((n) =>
      journey({ depart: '08:00', arrive: `08:${30 + n * 5}`, rides: [[n, 0, 5]] })
    )
    expect(shown(rankTrips(grid, many, 'depart'))).toEqual(['1', '2', '3'])
  })

  it('shows fewer when there are fewer to show', () => {
    const a = journey({ depart: '08:00', arrive: '08:30', rides: [[1, 0, 5]] })
    const aLater = journey({ depart: '08:20', arrive: '08:50', rides: [[1, 0, 5]] })
    expect(shown(rankTrips(grid, [a, aLater], 'depart'))).toEqual(['1'])
  })

  it('puts walking all the way first when it gets there first', () => {
    const query: PlanQuery = {
      from: near(0, 0),
      to: near(0, 1800),
      time: at('08:00'),
      mode: 'depart'
    }
    const walk = walkOnly(query.from, query.to, query)
    // Gets there 5 minutes after the walk, so it neither beats it nor gets ahead of it.
    const bus = journey({ depart: '08:05', arrive: '08:35', rides: [[1, 0, 5]], walks: [300] })
    expect(shown(rankTrips(grid, [bus, walk], 'depart'))).toEqual(['walk', '1'])
  })

  it('puts walking after a bus that gets there first, and counts it as its own kind of trip', () => {
    const query: PlanQuery = {
      from: near(0, 0),
      to: near(0, 1800),
      time: at('08:00'),
      mode: 'depart'
    }
    const walk = walkOnly(query.from, query.to, query)
    const bus = journey({ depart: '08:05', arrive: '08:20', rides: [[1, 0, 5]], walks: [300] })
    const laterBus = journey({ depart: '08:15', arrive: '08:40', rides: [[1, 0, 5]], walks: [300] })
    expect(shown(rankTrips(grid, [laterBus, walk, bus], 'depart'))).toEqual(['1', 'walk'])
  })
})

describe('rankTrips · the same rides', () => {
  // The A Line's first stop has two platforms, so its trips make two patterns that differ only
  // there (found on Valley Metro's schedule); a rider boards and gets off at the same stops.
  const tt = fakeTimetable([
    { route: 'A', stops: ['P1', 'S1', 'S2', 'S3'] },
    { route: 'A', stops: ['P2', 'S1', 'S2', 'S3'] },
    { route: 'A', stops: ['S1', 'S2', 'S3'] },
    { route: 'B', stops: ['P1', 'S1', 'S2', 'S3'] },
    { route: 'A', stops: ['P1', 'S1', 'S2', 'S4'] }
  ])

  it("counts a route's other pattern, boarded and left at the same stops, as the same rides", () => {
    const best = journey({ depart: '08:00', arrive: '08:30', rides: [[0, 1, 3]] })
    // Another pattern of the route with the same stops, where the platform differs.
    const otherPattern = journey({ depart: '08:12', arrive: '08:42', rides: [[1, 1, 3]] })
    // A pattern that skips the first stop: the same stops, but at other positions.
    const shorter = journey({ depart: '08:24', arrive: '08:54', rides: [[2, 0, 2]] })
    expect(shown(rankTrips(tt, [otherPattern, shorter, best], 'depart'))).toEqual(['0'])
  })

  it('counts another route at the same stops, or the same route to another stop, as other rides', () => {
    const best = journey({ depart: '08:00', arrive: '08:30', rides: [[0, 1, 3]] })
    const otherRoute = journey({ depart: '08:10', arrive: '08:40', rides: [[3, 1, 3]] })
    const otherStop = journey({ depart: '08:20', arrive: '08:50', rides: [[4, 1, 3]] })
    expect(shown(rankTrips(tt, [best, otherRoute, otherStop], 'depart'))).toEqual(['0', '3', '4'])
  })

  it('reads the stops of every ride of a journey, and keeps walking its own kind of trip', () => {
    const query: PlanQuery = {
      from: near(0, 0),
      to: near(0, 1800),
      time: at('08:00'),
      mode: 'depart'
    }
    const walk = walkOnly(query.from, query.to, query)
    const twice = journey({
      depart: '08:00',
      arrive: '08:30',
      rides: [
        [0, 1, 2],
        [3, 1, 3]
      ]
    })
    const twiceOtherPattern = journey({
      depart: '08:12',
      arrive: '08:42',
      rides: [
        [1, 1, 2],
        [3, 1, 3]
      ]
    })
    expect(shown(rankTrips(tt, [twiceOtherPattern, walk, twice], 'depart'))).toEqual([
      '0+3',
      'walk'
    ])
  })
})

describe('rankTrips · arriving by a time', () => {
  it('puts the latest departure first, then the others by departure', () => {
    const early = journey({ depart: '08:00', arrive: '09:00', rides: [[1, 0, 5]] })
    const late = journey({ depart: '08:20', arrive: '09:00', rides: [[2, 0, 5]] })
    const middle = journey({ depart: '08:10', arrive: '08:50', rides: [[3, 0, 5]] })
    expect(shown(rankTrips(grid, [early, late, middle], 'arrive'))).toEqual(['2', '3', '1'])
  })

  it('lets one that leaves 2 minutes earlier with a ride fewer beat the latest, 3 minutes not', () => {
    const late = journey({
      depart: '08:20',
      arrive: '09:00',
      rides: [
        [1, 0, 2],
        [2, 0, 3]
      ]
    })
    const direct = journey({ depart: '08:18', arrive: '09:00', rides: [[3, 0, 5]] })
    expect(shown(rankTrips(grid, [late, direct], 'arrive'))).toEqual(['3', '1+2'])
    const tooEarly = journey({ depart: '08:17', arrive: '09:00', rides: [[3, 0, 5]] })
    expect(shown(rankTrips(grid, [late, tooEarly], 'arrive'))).toEqual(['1+2', '3'])
  })

  it('lets one that leaves a minute earlier with 400 m less walking beat the latest', () => {
    const late = journey({ depart: '08:20', arrive: '09:00', rides: [[1, 0, 5]], walks: [600] })
    const lessWalking = journey({
      depart: '08:19',
      arrive: '09:00',
      rides: [[2, 0, 5]],
      walks: [200]
    })
    expect(shown(rankTrips(grid, [late, lessWalking], 'arrive'))).toEqual(['2', '1'])
  })

  it('breaks a tie in departure by fewer rides, then less walking, then the earlier arrival', () => {
    const twoRides = journey({
      depart: '08:20',
      arrive: '09:00',
      rides: [
        [1, 0, 2],
        [2, 0, 3]
      ],
      walks: [500]
    })
    const moreWalking = journey({
      depart: '08:20',
      arrive: '09:00',
      rides: [[3, 0, 5]],
      walks: [300]
    })
    const lessWalking = journey({
      depart: '08:20',
      arrive: '09:00',
      rides: [[4, 0, 5]],
      walks: [100]
    })
    expect(shown(rankTrips(grid, [twoRides, moreWalking, lessWalking], 'arrive'))).toEqual([
      '4',
      '3',
      '1+2'
    ])
    const earlier = journey({ depart: '08:20', arrive: '08:50', rides: [[5, 0, 5]], walks: [100] })
    expect(shown(rankTrips(grid, [lessWalking, earlier], 'arrive'))).toEqual(['5', '4'])
  })

  it("never shows the best's rides again, earlier, and shows three at most", () => {
    const best = journey({ depart: '08:20', arrive: '09:00', rides: [[1, 2, 5]] })
    const sameEarlier = journey({ depart: '08:10', arrive: '08:50', rides: [[1, 2, 5]] })
    const others = [2, 3, 4].map((n) =>
      journey({ depart: `08:0${n}`, arrive: '08:40', rides: [[n, 0, 3]] })
    )
    expect(shown(rankTrips(grid, [sameEarlier, ...others, best], 'arrive'))).toEqual([
      '1',
      '4',
      '3'
    ])
  })

  it('puts walking all the way first when it leaves latest', () => {
    const query: PlanQuery = {
      from: near(0, 0),
      to: near(0, 1800),
      time: at('09:00'),
      mode: 'arrive'
    }
    // 09:00 less 30 minutes of walking: leaves at 08:30.
    const walk = walkOnly(query.from, query.to, query)
    const bus = journey({ depart: '08:20', arrive: '08:55', rides: [[1, 0, 5]], walks: [300] })
    expect(shown(rankTrips(grid, [bus, walk], 'arrive'))).toEqual(['walk', '1'])
  })
})

describe('planAll', () => {
  const TIME = at('08:00')
  const leaving = (to: [number, number]): PlanQuery => ({
    from: near(0, 0),
    to: near(to[0], to[1]),
    time: TIME,
    mode: 'depart'
  })
  let tt: Timetable
  beforeAll(async () => {
    // The only stop is 2 km from the start: nowhere to walk to for a bus.
    tt = await testTimetable({
      stops: { A: near(2000, 0), B: near(2000, 3000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'r1',
              stops: [
                ['A', '08:10'],
                ['B', '08:30']
              ]
            }
          ]
        }
      ]
    })
  })

  const noBuses = (): Journey[] => []

  it('gives just the walk when the destination is 30 minutes away and no stop is near', () => {
    const query = leaving([0, 1800])
    const ranked = planAll(grid, query, NO_LIVE, noBuses)
    expect(ranked).toHaveLength(1)
    const [trip] = ranked as [Journey]
    expect(trip.legs).toHaveLength(1)
    expect(trip.legs[0]).toMatchObject({
      kind: 'walk',
      from: { kind: 'origin' },
      to: { kind: 'destination' }
    })
    expect(trip.depart).toBe(TIME)
    expect(trip.arrive).toBe(TIME + 1800)
  })

  it('offers the walk up to 45 minutes and no longer', () => {
    expect(planAll(grid, leaving([0, 2700]), NO_LIVE, noBuses)).toHaveLength(1)
    expect(planAll(grid, leaving([0, 2701]), NO_LIVE, noBuses)).toEqual([])
  })

  it('gives nothing when the destination is 50 minutes away and no stop is near, and no trip says why', () => {
    const query = leaving([0, 3000])
    expect(planAll(grid, query, NO_LIVE, noBuses)).toEqual([])
    expect(noTrip(tt, query).walkSec).toBeNull()
  })

  it('walks to a destination that is not far when the search finds nothing', () => {
    const query = leaving([0, 300])
    const [trip] = planAll(grid, query, NO_LIVE, noBuses) as [Journey]
    expect(trip.arrive - trip.depart).toBe(300)
    expect(noTrip(tt, query).walkSec).toBe(300)
  })

  it('arriving by a time, walks so as to be there then', () => {
    const query: PlanQuery = { ...leaving([0, 1800]), time: at('09:00'), mode: 'arrive' }
    const [trip] = planAll(grid, query, NO_LIVE, noBuses) as [Journey]
    expect(trip.arrive).toBe(at('09:00'))
    expect(trip.depart).toBe(at('09:00') - 1800)
  })

  it('gives just the walk when the start and the destination are under a metre apart', () => {
    const plan = vi.fn<typeof planTrips>(() => [
      journey({ depart: '08:05', arrive: '08:20', rides: [[1, 0, 5]] })
    ])
    const query: PlanQuery = { ...leaving([0, 0]), to: near(0.4, 0) }
    const ranked = planAll(grid, query, NO_LIVE, plan)
    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.legs).toHaveLength(1)
    expect(ranked[0]?.legs[0]).toMatchObject({ kind: 'walk' })
    // Nothing to ride to, so the search isn't asked.
    expect(plan).not.toHaveBeenCalled()
  })

  it('asks the search the same question, with the live times', () => {
    const plan = vi.fn<typeof planTrips>(() => [])
    const query = leaving([0, 1800])
    const live: LiveTimes = new Map()
    planAll(grid, query, live, plan)
    expect(plan).toHaveBeenCalledOnce()
    expect(plan).toHaveBeenCalledWith(grid, query, live)
  })

  it('ranks what the search found together with the walk', () => {
    const query = leaving([0, 1800])
    const quick = journey({ depart: '08:05', arrive: '08:20', rides: [[1, 0, 5]], walks: [300] })
    const same = journey({ depart: '08:15', arrive: '08:35', rides: [[1, 0, 5]], walks: [300] })
    const ranked = planAll(grid, query, NO_LIVE, () => [same, quick])
    expect(shown(ranked)).toEqual(['1', 'walk'])
    expect(ranked[0]).toBe(quick)
  })

  it('leaves the walk out once it is past 45 minutes, and keeps what the search found', () => {
    const query = leaving([0, 3000])
    const bus = journey({ depart: '08:05', arrive: '08:50', rides: [[1, 0, 5]], walks: [300] })
    expect(planAll(grid, query, NO_LIVE, () => [bus])).toEqual([bus])
  })

  it('puts the walk first when it gets there first', () => {
    const query = leaving([0, 1200])
    const bus = journey({ depart: '08:05', arrive: '08:35', rides: [[1, 0, 5]], walks: [300] })
    expect(shown(planAll(grid, query, NO_LIVE, () => [bus]))).toEqual(['walk', '1'])
  })
})

describe('planAll · waiting between two rides', () => {
  const query: PlanQuery = {
    from: near(0, 0),
    // 50 minutes' walk away: the walk isn't offered, so what's left is what the search found.
    to: near(0, 3000),
    time: at('08:00'),
    mode: 'depart'
  }
  const found = (...journeys: Journey[]): Journey[] => planAll(grid, query, NO_LIVE, () => journeys)

  /** Two rides, the first arriving at 08:20 and the second leaving `waitMin` minutes after. */
  const waiting = (waitMin: number): Journey =>
    chained(
      rideLeg(1, 0, 2, '08:05', '08:20'),
      rideLeg(2, 0, 3, clockOf(8 * 60 + 20 + waitMin), clockOf(8 * 60 + 40 + waitMin))
    )

  it('is 45 minutes', () => {
    expect(MAX_CHANGE_WAIT_SEC).toBe(45 * 60)
  })

  it('drops a journey that waits 46 minutes between two rides, and keeps one that waits 44', () => {
    expect(found(waiting(46))).toEqual([])
    const kept = waiting(44)
    expect(found(kept)).toEqual([kept])
  })

  it('keeps one that waits exactly 45 minutes, and drops one a second over', () => {
    const exact = waiting(45)
    expect(found(exact)).toEqual([exact])
    const over = chained(rideLeg(1, 0, 2, '08:05', '08:20'), rideLeg(2, 0, 3, '09:05:01', '09:30'))
    expect(found(over)).toEqual([])
  })

  it('counts the wait from the end of the walk between the rides', () => {
    // 600 m is 10 minutes. The ride arrives at 08:20, so the walk ends at 08:30.
    const changes = (departs: string): Journey =>
      chained(
        rideLeg(1, 0, 2, '08:05', '08:20'),
        walkLeg('08:20', '08:30', 600),
        rideLeg(2, 0, 3, departs, '10:00')
      )
    // 54 minutes after the first ride, but 44 after the walk: kept.
    const kept = changes('09:14')
    expect(found(kept)).toEqual([kept])
    expect(found(changes('09:16'))).toEqual([])
  })

  it('counts every change of a journey with three rides', () => {
    const fine = chained(
      rideLeg(1, 0, 2, '08:05', '08:20'),
      rideLeg(2, 0, 3, '08:30', '08:50'),
      rideLeg(3, 0, 4, '09:00', '09:20')
    )
    expect(found(fine)).toEqual([fine])
    const longSecond = chained(
      rideLeg(1, 0, 2, '08:05', '08:20'),
      rideLeg(2, 0, 3, '08:30', '08:50'),
      rideLeg(3, 0, 4, '09:40', '10:00')
    )
    expect(found(longSecond)).toEqual([])
  })

  it("doesn't count waiting before the first ride or after the last", () => {
    const late = chained(walkLeg('08:00', '08:10', 600), rideLeg(1, 0, 2, '10:00', '10:20'))
    expect(found(late)).toEqual([late])
  })

  it('drops only the journeys that wait, and ranks the rest', () => {
    const quickButWaits = waiting(60)
    const slower = chained(rideLeg(3, 0, 2, '08:10', '10:30'))
    expect(found(quickButWaits, slower)).toEqual([slower])
  })

  it('arriving by a time, drops a journey with a long wait the same way', () => {
    const arriving: PlanQuery = { ...query, time: at('11:00'), mode: 'arrive' }
    expect(planAll(grid, arriving, NO_LIVE, () => [waiting(46)])).toEqual([])
    const kept = waiting(44)
    expect(planAll(grid, arriving, NO_LIVE, () => [kept])).toEqual([kept])
  })
})

describe('noTrip', () => {
  const start = near(0, 0)
  const far = near(0, 5000)

  /** The query: leaving at `time` on 2 Nov, from the start to somewhere out of walking. */
  const leaving = (time: string, mode: 'depart' | 'arrive' = 'depart'): PlanQuery => ({
    from: start,
    to: far,
    time: at(time),
    mode
  })

  it('says service starts at the first departure after the window', async () => {
    const tt = await testTimetable({
      stops: { NEAR: near(300, 0), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'gone',
              stops: [
                ['NEAR', '01:00'],
                ['END', '01:30']
              ]
            },
            {
              id: 'first',
              stops: [
                ['NEAR', '05:12'],
                ['END', '05:40']
              ]
            },
            {
              id: 'second',
              stops: [
                ['NEAR', '05:42'],
                ['END', '06:10']
              ]
            }
          ]
        }
      ]
    })
    // 01:30: the 01:00 trip has gone, and nothing leaves in the window, which runs to 02:30.
    expect(noTrip(tt, leaving('01:30'))).toEqual({ walkSec: null, serviceStarts: at('05:12') })
  })

  it('looks only at stops within walking distance of the start', async () => {
    const tt = await testTimetable({
      stops: { EDGE: near(0, 1190), FAR: near(1300, 0), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'too far',
              stops: [
                ['FAR', '04:00'],
                ['END', '04:30']
              ]
            },
            {
              id: 'edge',
              stops: [
                ['EDGE', '05:12'],
                ['END', '05:40']
              ]
            }
          ]
        }
      ]
    })
    expect(noTrip(tt, leaving('01:30')).serviceStarts).toBe(at('05:12'))
    // From somewhere no stop is within reach of:
    expect(noTrip(tt, { ...leaving('01:30'), from: near(0, -3000) }).serviceStarts).toBeNull()
  })

  it("doesn't count a trip that only arrives at the stop", async () => {
    const tt = await testTimetable({
      stops: { NEAR: near(300, 0), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'in',
              stops: [
                ['END', '04:30'],
                ['NEAR', '04:50']
              ]
            },
            {
              id: 'out',
              stops: [
                ['NEAR', '05:12'],
                ['END', '05:40']
              ]
            }
          ]
        }
      ]
    })
    expect(noTrip(tt, leaving('01:30')).serviceStarts).toBe(at('05:12'))
  })

  it('counts a trip that runs past midnight from the day before', async () => {
    const tt = await testTimetable({
      stops: { NEAR: near(300, 0), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'owl',
              dates: [20261101],
              stops: [
                ['NEAR', '26:00'],
                ['END', '26:30']
              ]
            },
            {
              id: 'day',
              stops: [
                ['NEAR', '05:12'],
                ['END', '05:40']
              ]
            }
          ]
        }
      ]
    })
    // 00:30 on 2 Nov: the window runs to 01:30, and the owl leaves at 02:00 by the clock.
    expect(noTrip(tt, leaving('00:30')).serviceStarts).toBe(at('26:00', 20261101))
    expect(at('26:00', 20261101)).toBe(at('02:00'))
  })

  it('takes the first day a trip runs on after the window', async () => {
    const tt = await testTimetable({
      stops: { NEAR: near(300, 0), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'weekday',
              dates: [20261102, 20261103],
              stops: [
                ['NEAR', '05:12'],
                ['END', '05:40']
              ]
            }
          ]
        }
      ]
    })
    expect(noTrip(tt, leaving('06:00')).serviceStarts).toBe(at('05:12', 20261103))
  })

  it('looks 24 hours past the window and no further', async () => {
    const tt = await testTimetable({
      stops: { NEAR: near(300, 0), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'tomorrow',
              dates: [20261103],
              stops: [
                ['NEAR', '05:12'],
                ['END', '05:40']
              ]
            },
            {
              id: 'later',
              dates: [20261104],
              stops: [
                ['NEAR', '04:00'],
                ['END', '04:30']
              ]
            }
          ]
        }
      ]
    })
    // 22:00 on 2 Nov: the window ends at 23:00, and 24 h on is 23:00 on 3 Nov, past 05:12.
    expect(noTrip(tt, leaving('22:00')).serviceStarts).toBe(at('05:12', 20261103))
    // 01:30 on 2 Nov: 24 h past the window is 02:30 on 3 Nov, before either.
    expect(noTrip(tt, leaving('01:30')).serviceStarts).toBeNull()
  })

  it('counts from the arrival time itself when arriving by a time', async () => {
    const tt = await testTimetable({
      stops: { NEAR: near(300, 0), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'a',
              stops: [
                ['NEAR', '04:50'],
                ['END', '05:20']
              ]
            },
            {
              id: 'b',
              stops: [
                ['NEAR', '06:30'],
                ['END', '07:00']
              ]
            },
            {
              id: 'c',
              stops: [
                ['NEAR', '07:30'],
                ['END', '08:00']
              ]
            }
          ]
        }
      ]
    })
    // Arriving by 06:00 the window is 05:00–06:00, so 06:30 is after it; leaving at 06:00 it's
    // inside the window, so service is running.
    expect(noTrip(tt, leaving('06:00', 'arrive')).serviceStarts).toBe(at('06:30'))
    expect(noTrip(tt, leaving('06:00', 'depart')).serviceStarts).toBeNull()
  })

  it('gives the walk when it is 45 minutes or less, and null when it is more', async () => {
    const tt = await testTimetable({
      stops: { NEAR: near(300, 0), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'a',
              stops: [
                ['NEAR', '05:12'],
                ['END', '05:40']
              ]
            }
          ]
        }
      ]
    })
    const walkOf = (metres: number): number | null =>
      noTrip(tt, { ...leaving('01:30'), to: near(0, metres) }).walkSec
    expect(walkOf(1200)).toBe(1200)
    expect(walkOf(2700)).toBe(2700)
    expect(walkOf(2701)).toBeNull()
  })

  it('has no service start when nothing runs from near the start', async () => {
    const tt = await testTimetable({
      stops: { FAR: near(0, 3000), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'a',
              stops: [
                ['FAR', '05:12'],
                ['END', '05:40']
              ]
            }
          ]
        }
      ]
    })
    expect(noTrip(tt, leaving('01:30'))).toEqual({ walkSec: null, serviceStarts: null })
  })

  it('works out, late at night, that service starts at 5:12 that day', async () => {
    const tt = await testTimetable({
      stops: { NEAR: near(300, 0), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: [
            // 01:10 on 2 Nov by the clock: gone before 01:30.
            {
              id: 'owl',
              dates: [20261101],
              stops: [
                ['NEAR', '25:10'],
                ['END', '25:40']
              ]
            },
            {
              id: 'first',
              stops: [
                ['NEAR', '05:12'],
                ['END', '05:40']
              ]
            }
          ]
        }
      ]
    })
    const query = leaving('01:30')
    expect(planAll(tt, query, NO_LIVE, () => [])).toEqual([])
    expect(noTrip(tt, query).serviceStarts).toBe(at('05:12'))
  })

  it('is what answers when every journey the search found waits too long between its rides', async () => {
    // 01:30 on the real schedule: the only journeys leaving inside the window waited 94 minutes
    // or 3 hours on a platform halfway. With those dropped there's nothing to show.
    const tt = await testTimetable({
      stops: { NEAR: near(300, 0), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'leaves',
              stops: [
                ['NEAR', '02:00'],
                ['END', '02:30']
              ]
            }
          ]
        }
      ]
    })
    const query = leaving('01:30')
    const waits = (minutes: number): Journey =>
      chained(
        rideLeg(0, 0, 1, '02:00', '02:20'),
        rideLeg(0, 0, 1, clockOf(2 * 60 + 20 + minutes), '09:00')
      )
    expect(planAll(tt, query, NO_LIVE, () => [waits(94), waits(180)])).toEqual([])
    // A bus does leave from near the start inside the window, so there's no start to announce.
    expect(noTrip(tt, query)).toEqual({ walkSec: null, serviceStarts: null })
  })

  /** A timetable with one trip from NEAR (300 m from the start) at each time, out to END. */
  const leavingNearAt = (...times: string[]): Promise<Timetable> =>
    testTimetable({
      stops: { NEAR: near(300, 0), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: times.map((time, i) => ({
            id: `t${i}`,
            stops: [
              ['NEAR', time],
              ['END', '23:59']
            ]
          }))
        }
      ]
    })

  it('has no service start when a trip leaves from near the start inside the window', async () => {
    // Buses run then; they just don't get there, so "Service starts at 5:12 AM" would be wrong.
    const tt = await leavingNearAt('02:00', '05:12')
    expect(noTrip(tt, leaving('01:30'))).toEqual({ walkSec: null, serviceStarts: null })
  })

  it('counts the window from its first second to its last', async () => {
    expect(noTrip(await leavingNearAt('01:30', '05:12'), leaving('01:30')).serviceStarts).toBeNull()
    expect(noTrip(await leavingNearAt('02:30', '05:12'), leaving('01:30')).serviceStarts).toBeNull()
    const justOutside = await leavingNearAt('01:29:59', '02:30:01')
    expect(noTrip(justOutside, leaving('01:30')).serviceStarts).toBe(at('02:30:01'))
  })

  it('takes the hour before the time as the window when arriving by a time', async () => {
    expect(
      noTrip(await leavingNearAt('05:12', '07:00'), leaving('06:00', 'arrive')).serviceStarts
    ).toBeNull()
    const outside = await leavingNearAt('04:59', '06:30')
    expect(noTrip(outside, leaving('06:00', 'arrive')).serviceStarts).toBe(at('06:30'))
  })

  it('counts a run from the day before that leaves inside the window', async () => {
    const tt = await testTimetable({
      stops: { NEAR: near(300, 0), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'owl',
              dates: [20261101],
              stops: [
                ['NEAR', '25:00'],
                ['END', '25:30']
              ]
            },
            {
              id: 'day',
              stops: [
                ['NEAR', '05:12'],
                ['END', '05:40']
              ]
            }
          ]
        }
      ]
    })
    // 25:00 on 1 Nov is 01:00 on 2 Nov, inside 00:30–01:30.
    expect(noTrip(tt, leaving('00:30')).serviceStarts).toBeNull()
  })

  it("doesn't count, inside the window, a far stop's trip or one that only arrives near the start", async () => {
    const tt = await testTimetable({
      stops: { NEAR: near(300, 0), FAR: near(1300, 0), END: near(0, 4000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'far',
              stops: [
                ['FAR', '02:00'],
                ['END', '02:30']
              ]
            },
            {
              id: 'in',
              stops: [
                ['END', '01:40'],
                ['NEAR', '02:00']
              ]
            },
            {
              id: 'first',
              stops: [
                ['NEAR', '05:12'],
                ['END', '05:40']
              ]
            }
          ]
        }
      ]
    })
    expect(noTrip(tt, leaving('01:30')).serviceStarts).toBe(at('05:12'))
  })
})
