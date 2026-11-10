// The trip search's contract (planTrips' doc comment, and collab/trip-planner/brief.md). Written
// before the search, by Claude, so the search is made to fit it rather than it to the search:
// every expected time below is worked out by hand from the timetable it's planned on. Walks are
// laid out due north, south, east or west of a stop, so their metres (and seconds) are round.
import { beforeAll, describe, expect, it } from 'vitest'
import { distanceM, type LatLon } from '../transit/routeLine'
import { planTrips } from './raptor'
import { near, testTimetable, type TestSpec } from './testTimetable'
import { serviceDayStart } from './timetable'
import {
  ACCESS_MAX_M,
  MAX_RIDES,
  MIN_CHANGE_SEC,
  TRANSFER_MAX_M,
  WINDOW_SEC,
  type Journey,
  type LegEnd,
  type LiveTimes,
  type LiveTrip,
  type Pattern,
  type PlanQuery,
  type RideLeg,
  type Timetable
} from './types'
import { walkSeconds } from './walk'

type TestTrip = TestSpec['routes'][number]['trips'][number]
type Call = [stop: string, time: string]

/** Mon 2 Nov 2026, the test timetable's day unless a trip says otherwise: midnight in Tempe. */
const DAY = serviceDayStart(20261102)
const NO_LIVE: LiveTimes = new Map()

/** "HH:MM" or "HH:MM:SS" on 2 Nov, or `date` (24:20 is 00:20 the day after), in unix seconds. */
function at(time: string, date = 20261102): number {
  const [hours, minutes, seconds] = time.split(':')
  return serviceDayStart(date) + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds ?? 0)
}

const two = (n: number): string => String(n).padStart(2, '0')

/** Seconds as "HH:MM:SS"; past 24:00 when they run into the next day. */
function hms(seconds: number): string {
  return `${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}`
}

/** Unix seconds as the clock on 2 Nov, to read a journey by. */
function clock(unix: number): string {
  const seconds = unix - DAY
  if (!Number.isInteger(seconds)) return `${unix} (not whole seconds)`
  return seconds < 0 ? `${hms(seconds + 86400)} on 1 Nov` : hms(seconds)
}

function trip(id: string, ...calls: Call[]): TestTrip {
  return { id, stops: calls }
}

function tripOn(dates: number[], id: string, ...calls: Call[]): TestTrip {
  return { id, dates, stops: calls }
}

const leaving = (from: LatLon, to: LatLon, time: string, date?: number): PlanQuery => ({
  from,
  to,
  time: at(time, date),
  mode: 'depart'
})

const arrivingBy = (from: LatLon, to: LatLon, time: string): PlanQuery => ({
  from,
  to,
  time: at(time),
  mode: 'arrive'
})

/**
 * A trip as the feed tells it (times on 2 Nov): `times` sets arrival and departure at a
 * position, `departs` only the departure, `arrives` only the arrival.
 */
function liveTrip(
  length: number,
  feed: {
    times?: Record<number, string>
    departs?: Record<number, string>
    arrives?: Record<number, string>
    skips?: number[]
    canceled?: boolean
  }
): LiveTrip {
  const arrival = new Float64Array(length).fill(NaN)
  const departure = new Float64Array(length).fill(NaN)
  const skipped = new Uint8Array(length)
  for (const [position, time] of Object.entries(feed.times ?? {})) {
    arrival[Number(position)] = at(time)
    departure[Number(position)] = at(time)
  }
  for (const [position, time] of Object.entries(feed.departs ?? {})) {
    departure[Number(position)] = at(time)
  }
  for (const [position, time] of Object.entries(feed.arrives ?? {})) {
    arrival[Number(position)] = at(time)
  }
  for (const position of feed.skips ?? []) skipped[position] = 1
  return { canceled: feed.canceled ?? false, arrival, departure, skipped }
}

const rides = (journey: Journey): RideLeg[] =>
  journey.legs.filter((leg): leg is RideLeg => leg.kind === 'ride')

/** One line a leg, after the journey's own times: what the expectations below are written in. */
function read(tt: Timetable, journey: Journey): string[] {
  const name = (end: LegEnd): string =>
    end.kind === 'stop'
      ? (tt.stops.ids[end.stop] ?? `stop ${end.stop}`)
      : end.kind === 'origin'
        ? 'start'
        : 'end'
  const stopAt = (leg: RideLeg, position: number): string =>
    tt.stops.ids[tt.patterns[leg.pattern]?.stops[position] ?? -1] ?? '?'
  return [
    `${clock(journey.depart)} → ${clock(journey.arrive)}`,
    ...journey.legs.map((leg) =>
      leg.kind === 'walk'
        ? `walk ${name(leg.from)}→${name(leg.to)} ${Math.round(leg.metres)} m ${clock(leg.start)}–${clock(leg.end)}`
        : `ride ${leg.tripId} ${stopAt(leg, leg.board)}#${leg.board} ${clock(leg.depart)} → ` +
          `${stopAt(leg, leg.alight)}#${leg.alight} ${clock(leg.arrive)}${leg.live ? ' live' : ''}`
    )
  ]
}

function position(tt: Timetable, stop: number): LatLon {
  return [tt.stops.lat[stop] as number, tt.stops.lon[stop] as number]
}

/** The timetable's walk from stop `from` to stop `to`, in metres; null when it has none. */
function transferMetres(tt: Timetable, from: number, to: number): number | null {
  const { start, to: next, metres } = tt.transfers
  for (let k = start[from] as number; k < (start[from + 1] as number); k++) {
    if (next[k] === to) return metres[k] as number
  }
  return null
}

/** yyyymmdd in Arizona at unix seconds. */
function arizonaDate(unix: number): number {
  const day = new Date((unix - 7 * 3600) * 1000)
  return day.getUTCFullYear() * 10000 + (day.getUTCMonth() + 1) * 100 + day.getUTCDate()
}

/** The service dates a search rides: every Arizona day its window touches, and the day before each. */
function serviceDates(query: PlanQuery): Set<number> {
  const ends =
    query.mode === 'depart'
      ? [query.time, query.time + WINDOW_SEC]
      : [query.time - WINDOW_SEC, query.time]
  const dates = new Set<number>()
  for (const end of ends) {
    const date = arizonaDate(end)
    dates.add(date)
    dates.add(arizonaDate(serviceDayStart(date) - 1))
  }
  return dates
}

const HALF_DAY_SEC = 43_200

/**
 * The midnight of the run a live entry belongs to: the run whose timetable times are nearest its
 * predictions, if within 12 h (a trip's runs are whole days apart, so its first prediction
 * decides); with no predictions, the run whose first departure is nearest the query's time.
 * Null when no run is near enough.
 */
function feedRun(
  tt: Timetable,
  pattern: Pattern,
  trip: number,
  feed: LiveTrip,
  queryTime: number
): number | null {
  const length = pattern.stops.length
  let target = queryTime
  let table = pattern.times[trip * length * 2 + 1] as number
  let predicted = false
  for (let p = 0; p < length && !predicted; p++) {
    for (const [kind, times] of [
      [1, feed.departure],
      [0, feed.arrival]
    ] as const) {
      const value = times[p] ?? NaN
      if (predicted || Number.isNaN(value)) continue
      target = value
      table = pattern.times[(trip * length + p) * 2 + kind] as number
      predicted = true
    }
  }
  let best: number | null = null
  let gap = Infinity
  for (const date of tt.services[pattern.service[trip] as number] ?? []) {
    const midnight = serviceDayStart(date)
    if (Math.abs(midnight + table - target) < gap) {
      gap = Math.abs(midnight + table - target)
      best = midnight
    }
  }
  return predicted && gap >= HALF_DAY_SEC ? null : best
}

function rideProblems(tt: Timetable, query: PlanQuery, live: LiveTimes, leg: RideLeg): string[] {
  const pattern = tt.patterns[leg.pattern]
  if (!pattern) return [`${leg.tripId}: no pattern ${leg.pattern}`]
  const problems: string[] = []
  const say = (what: string): void => {
    problems.push(`${leg.tripId}: ${what}`)
  }
  if (pattern.trips[leg.trip] !== leg.tripId) say(`isn't trip ${leg.trip} of its pattern`)
  const length = pattern.stops.length
  if (
    !Number.isInteger(leg.board) ||
    !Number.isInteger(leg.alight) ||
    leg.board < 0 ||
    leg.alight <= leg.board ||
    leg.alight >= length
  ) {
    say(`boards at ${leg.board} and leaves at ${leg.alight} of ${length} positions`)
    return problems
  }
  const leaves = pattern.times[(leg.trip * length + leg.board) * 2 + 1] as number
  const arrives = pattern.times[(leg.trip * length + leg.alight) * 2] as number
  const dates = Array.from(tt.services[pattern.service[leg.trip] as number] ?? [])
  const ranOn = dates.find(
    (date) =>
      leg.scheduledDepart === serviceDayStart(date) + leaves &&
      leg.scheduledArrive === serviceDayStart(date) + arrives
  )
  if (ranOn === undefined) {
    say("scheduled times aren't the timetable's on a day the trip runs")
    return problems
  }
  if (!serviceDates(query).has(ranOn)) say(`rides its run of ${ranOn}, a day the search skips`)
  // The feed counts only for the run it belongs to; the trip's other runs keep the timetable.
  const entry = live.get(leg.tripId)
  const feed =
    entry && feedRun(tt, pattern, leg.trip, entry, query.time) === serviceDayStart(ranOn)
      ? entry
      : undefined
  if (feed?.canceled) say('is canceled')
  if (feed?.skipped[leg.board]) say('boards where the trip skips the stop')
  if (feed?.skipped[leg.alight]) say('gets off where the trip skips the stop')
  const liveDeparts = feed?.departure[leg.board] ?? NaN
  const liveArrives = feed?.arrival[leg.alight] ?? NaN
  const departs = Number.isNaN(liveDeparts) ? leg.scheduledDepart : liveDeparts
  const arrivesAt = Number.isNaN(liveArrives) ? leg.scheduledArrive : liveArrives
  if (leg.depart !== departs) say(`departs ${clock(leg.depart)}, not ${clock(departs)}`)
  if (leg.arrive !== arrivesAt) say(`arrives ${clock(leg.arrive)}, not ${clock(arrivesAt)}`)
  if (leg.live !== !Number.isNaN(liveDeparts)) say(`live is ${leg.live}`)
  if (leg.live && Math.abs(leg.depart - leg.scheduledDepart) >= HALF_DAY_SEC) {
    say('is live 12 h or more from its timetable')
  }
  return problems
}

const boardStop = (tt: Timetable, leg: RideLeg): number =>
  tt.patterns[leg.pattern]?.stops[leg.board] ?? -1
const alightStop = (tt: Timetable, leg: RideLeg): number =>
  tt.patterns[leg.pattern]?.stops[leg.alight] ?? -1

/** Everything the contract says about one journey, as a list of what's wrong with it. */
function journeyProblems(
  tt: Timetable,
  query: PlanQuery,
  live: LiveTimes,
  journey: Journey
): string[] {
  const problems: string[] = []
  const say = (what: string): void => {
    problems.push(what)
  }
  const { legs } = journey
  const ridden = rides(journey)
  if (ridden.length < 1 || ridden.length > MAX_RIDES) say(`${ridden.length} rides`)
  for (const ride of ridden) problems.push(...rideProblems(tt, query, live, ride))
  if (problems.length > 0) return problems

  legs.forEach((leg, i) => {
    if (leg.kind !== 'walk') return
    const before = legs[i - 1]
    const after = legs[i + 1]
    if (before?.kind === 'walk' || after?.kind === 'walk') say('two walks in a row')
    if (!(leg.metres >= 1)) say(`a walk of ${leg.metres} m`)
    if (leg.end - leg.start !== walkSeconds(leg.metres)) {
      say(`a ${Math.round(leg.metres)} m walk takes ${leg.end - leg.start} s`)
    }
    if (!before) {
      const ride = after?.kind === 'ride' ? after : null
      const stop = ride ? boardStop(tt, ride) : -1
      if (leg.from.kind !== 'origin' || leg.to.kind !== 'stop' || leg.to.stop !== stop) {
        say('the first walk isn’t from the start to the first ride’s stop')
        return
      }
      const straight = distanceM(query.from, position(tt, stop))
      if (Math.abs(leg.metres - straight) >= 1) say(`the first walk is ${leg.metres} m`)
      if (straight > ACCESS_MAX_M) say(`the first walk is ${Math.round(straight)} m`)
      if (ride && leg.end !== ride.depart) say('the first walk doesn’t end as the ride leaves')
    } else if (!after) {
      const stop = before.kind === 'ride' ? alightStop(tt, before) : -1
      if (leg.from.kind !== 'stop' || leg.from.stop !== stop || leg.to.kind !== 'destination') {
        say('the last walk isn’t from the last ride’s stop to the end')
        return
      }
      const straight = distanceM(position(tt, stop), query.to)
      if (Math.abs(leg.metres - straight) >= 1) say(`the last walk is ${leg.metres} m`)
      if (straight > ACCESS_MAX_M) say(`the last walk is ${Math.round(straight)} m`)
      if (before.kind === 'ride' && leg.start !== before.arrive) {
        say('the last walk doesn’t start as the ride arrives')
      }
    } else if (before.kind === 'ride' && after.kind === 'ride') {
      const from = alightStop(tt, before)
      const to = boardStop(tt, after)
      if (leg.from.kind !== 'stop' || leg.from.stop !== from) say('a change walks from elsewhere')
      if (leg.to.kind !== 'stop' || leg.to.stop !== to) say('a change walks to elsewhere')
      const metres = transferMetres(tt, from, to)
      if (metres === null) say('a change walks between stops the timetable has no walk for')
      else if (leg.metres !== metres) say(`a change walks ${leg.metres} m, not ${metres} m`)
      if (leg.metres > TRANSFER_MAX_M) say(`a change walks ${leg.metres} m`)
      if (leg.start !== before.arrive) say('a change walk doesn’t start as the ride arrives')
      if (after.depart < leg.end) say('a ride leaves before the walk to it ends')
    }
  })

  const first = legs[0]
  const last = legs.at(-1)
  if (first?.kind === 'ride' && distanceM(query.from, position(tt, boardStop(tt, first))) >= 1) {
    say('no walk to the first ride')
  }
  if (last?.kind === 'ride' && distanceM(position(tt, alightStop(tt, last)), query.to) >= 1) {
    say('no walk from the last ride')
  }
  legs.forEach((leg, i) => {
    const next = legs[i + 1]
    if (leg.kind !== 'ride' || next?.kind !== 'ride') return
    const from = alightStop(tt, leg)
    const to = boardStop(tt, next)
    if (from === to) {
      if (next.depart < leg.arrive + MIN_CHANGE_SEC) say('less than a minute to change')
    } else {
      // Only stops under a metre apart may change without a walk leg.
      const metres = transferMetres(tt, from, to)
      if (metres === null || metres >= 1) say('a change between stops without the walk')
      if (next.depart < leg.arrive) say('a ride leaves before the one before it arrives')
    }
  })

  const starts = first?.kind === 'walk' ? first.start : first?.depart
  const ends = last?.kind === 'walk' ? last.end : last?.arrive
  if (journey.depart !== starts) say(`depart ${clock(journey.depart)} isn’t its first leg’s`)
  if (journey.arrive !== ends) say(`arrive ${clock(journey.arrive)} isn’t its last leg’s`)
  if (query.mode === 'depart') {
    if (journey.depart < query.time || journey.depart > query.time + WINDOW_SEC) {
      say('leaves outside the window')
    }
  } else if (journey.arrive > query.time || journey.arrive < query.time - WINDOW_SEC) {
    say('arrives outside the window')
  }
  return problems
}

/** True when `a` leaves no earlier, arrives no later and has no more rides than `b`. */
function asGood(a: Journey, b: Journey): boolean {
  return a.depart >= b.depart && a.arrive <= b.arrive && rides(a).length <= rides(b).length
}

/** What's wrong with a whole plan: each journey, then their order and whether one beats another. */
function planProblems(
  tt: Timetable,
  query: PlanQuery,
  live: LiveTimes,
  journeys: Journey[]
): string[] {
  const problems: string[] = []
  journeys.forEach((journey, j) => {
    for (const problem of journeyProblems(tt, query, live, journey)) {
      problems.push(`journey ${j} (${read(tt, journey).join(' | ')}): ${problem}`)
    }
  })
  journeys.forEach((journey, j) => {
    const next = journeys[j + 1]
    if (
      next &&
      (next.depart - journey.depart ||
        next.arrive - journey.arrive ||
        rides(next).length - rides(journey).length) < 0
    ) {
      problems.push(`journeys ${j} and ${j + 1} are out of order`)
    }
    journeys.forEach((other, k) => {
      if (k !== j && asGood(other, journey)) problems.push(`journey ${k} beats or equals ${j}`)
    })
  })
  return problems
}

/** planTrips, checked against every rule the contract has. */
function search(tt: Timetable, query: PlanQuery, live: LiveTimes = NO_LIVE): Journey[] {
  const journeys = planTrips(tt, query, live)
  expect(planProblems(tt, query, live, journeys)).toEqual([])
  return journeys
}

const plan = (tt: Timetable, query: PlanQuery, live: LiveTimes = NO_LIVE): string[][] =>
  search(tt, query, live).map((journey) => read(tt, journey))

const criteria = (journey: Journey): string =>
  `leave ${clock(journey.depart)}, arrive ${clock(journey.arrive)}, ${rides(journey).length} rides`

/**
 * Leaving and arriving must agree. A journey found leaving at `time` is in the window arriving
 * by its arrival, so that search finds it or one as good; and when it arrives within the hour
 * after `time`, anything as good leaves inside the first window too, so it's found exactly (by
 * its times and rides). The same the other way, from journeys arriving by `deadline`.
 */
function expectBothWays(
  tt: Timetable,
  from: LatLon,
  to: LatLon,
  times: { time: number; deadline: number },
  live: LiveTimes = NO_LIVE
): void {
  const expectFound = (journey: Journey, found: Journey[], exactly: boolean): void => {
    if (exactly) expect(found.map(criteria)).toContain(criteria(journey))
    else expect(found.some((other) => asGood(other, journey))).toBe(true)
  }
  const leavingThen = search(tt, { from, to, time: times.time, mode: 'depart' }, live)
  for (const journey of leavingThen) {
    const back = search(tt, { from, to, time: journey.arrive, mode: 'arrive' }, live)
    expectFound(journey, back, journey.arrive <= times.time + WINDOW_SEC)
  }
  const arrivingThen = search(tt, { from, to, time: times.deadline, mode: 'arrive' }, live)
  for (const journey of arrivingThen) {
    const forth = search(tt, { from, to, time: journey.depart, mode: 'depart' }, live)
    expectFound(journey, forth, journey.depart >= times.deadline - WINDOW_SEC)
  }
  expect(leavingThen.length + arrivingThen.length).toBeGreaterThan(0)
}

// Most scenarios start 300 m west of A and end 200 m east of C, 5 km apart.
const A = near(0, 0)
const C = near(0, 5000)
const START = near(0, -300)
const END = near(0, 5200)
/** Somewhere to change, far from A, C and both ends. */
const B = near(3000, 2500)

// These scenarios fix the public contract; focused search-helper tests live in raptor*.test.ts.
// Claude owns this file (collab/trip-planner/brief.md).
describe('planTrips', () => {
  describe('direct ride', () => {
    const made = testTimetable({
      stops: { A, C },
      routes: [
        {
          id: 'R1',
          trips: [
            trip('early', ['A', '09:40'], ['C', '10:00']),
            // Leaves A after 09:50, but the 5 min walk can't make it.
            trip('tight', ['A', '09:54'], ['C', '10:14']),
            trip('a', ['A', '10:00'], ['C', '10:20']),
            trip('b', ['A', '10:30'], ['C', '10:50'])
          ]
        }
      ]
    })

    it('walks to the stop, rides and walks on, leaving in time for each bus', async () => {
      const tt = await made
      // 10:00 − 300 s = 09:55; 10:20 + 200 s = 10:23:20. The 10:30 bus leaves later, so it's
      // worth having too: 10:25 → 10:53:20.
      expect(plan(tt, leaving(START, END, '09:50'))).toEqual([
        [
          '09:55:00 → 10:23:20',
          'walk start→A 300 m 09:55:00–10:00:00',
          'ride a A#0 10:00:00 → C#1 10:20:00',
          'walk C→end 200 m 10:20:00–10:23:20'
        ],
        [
          '10:25:00 → 10:53:20',
          'walk start→A 300 m 10:25:00–10:30:00',
          'ride b A#0 10:30:00 → C#1 10:50:00',
          'walk C→end 200 m 10:50:00–10:53:20'
        ]
      ])
    })

    it('has no walk legs when it starts and ends at the stops', async () => {
      const tt = await made
      // Now the 09:54 can be caught.
      expect(plan(tt, leaving(A, C, '09:50'))).toEqual([
        ['09:54:00 → 10:14:00', 'ride tight A#0 09:54:00 → C#1 10:14:00'],
        ['10:00:00 → 10:20:00', 'ride a A#0 10:00:00 → C#1 10:20:00'],
        ['10:30:00 → 10:50:00', 'ride b A#0 10:30:00 → C#1 10:50:00']
      ])
    })
  })

  describe('same-stop change needs a minute', () => {
    const changing = (second: TestTrip[]): Promise<Timetable> =>
      testTimetable({
        stops: { A, B, C },
        routes: [
          { id: 'R1', trips: [trip('r1', ['A', '10:00'], ['B', '10:10:00'])] },
          { id: 'R2', trips: second }
        ]
      })

    it('misses a bus 30 s after it gets in and takes the next', async () => {
      const tt = await changing([
        trip('r2-early', ['B', '10:10:30'], ['C', '10:30:30']),
        trip('r2-late', ['B', '10:15'], ['C', '10:35'])
      ])
      expect(plan(tt, leaving(START, END, '09:50'))).toEqual([
        [
          '09:55:00 → 10:38:20',
          'walk start→A 300 m 09:55:00–10:00:00',
          'ride r1 A#0 10:00:00 → B#1 10:10:00',
          'ride r2-late B#0 10:15:00 → C#1 10:35:00',
          'walk C→end 200 m 10:35:00–10:38:20'
        ]
      ])
    })

    it('makes a bus exactly a minute after it gets in', async () => {
      const tt = await changing([
        trip('r2-early', ['B', '10:10:30'], ['C', '10:30:30']),
        trip('r2-minute', ['B', '10:11:00'], ['C', '10:31:00'])
      ])
      expect(plan(tt, leaving(START, END, '09:50'))).toEqual([
        [
          '09:55:00 → 10:34:20',
          'walk start→A 300 m 09:55:00–10:00:00',
          'ride r1 A#0 10:00:00 → B#1 10:10:00',
          'ride r2-minute B#0 10:11:00 → C#1 10:31:00',
          'walk C→end 200 m 10:31:00–10:34:20'
        ]
      ])
    })
  })

  describe('walking change between stops', () => {
    // Bnear is 300 m south of B; Bmid 225 m north and Bfar 450 m north, so Bfar is past a
    // change's walk from B, even by way of Bmid (two walks of 225 m aren't one change).
    const made = testTimetable({
      stops: {
        A,
        B,
        Bnear: near(2700, 2500),
        Bmid: near(3225, 2500),
        Bfar: near(3450, 2500),
        C
      },
      routes: [
        { id: 'R1', trips: [trip('r1', ['A', '10:00'], ['B', '10:10'])] },
        {
          id: 'R2',
          trips: [
            // 270 s after the bus gets in: the walk takes 300.
            trip('r2-early', ['Bnear', '10:14:30'], ['C', '10:34:30']),
            trip('r2', ['Bnear', '10:15:00'], ['C', '10:35:00'])
          ]
        },
        // Would get there first, from too far away.
        { id: 'R3', trips: [trip('r3', ['Bfar', '10:20'], ['C', '10:30'])] }
      ]
    })

    const expected = [
      [
        '09:55:00 → 10:38:20',
        'walk start→A 300 m 09:55:00–10:00:00',
        'ride r1 A#0 10:00:00 → B#1 10:10:00',
        'walk B→Bnear 300 m 10:10:00–10:15:00',
        'ride r2 Bnear#0 10:15:00 → C#1 10:35:00',
        'walk C→end 200 m 10:35:00–10:38:20'
      ]
    ]

    it('takes the walk’s 300 s to change, with no minute on top, and never 450 m', async () => {
      expect(plan(await made, leaving(START, END, '09:50'))).toEqual(expected)
    })

    it('finds the same arriving by 10:40', async () => {
      expect(plan(await made, arrivingBy(START, END, '10:40'))).toEqual(expected)
    })
  })

  describe('first and last walk limit', () => {
    it('never boards at a stop 1,300 m from the start, nor walks there by way of another', async () => {
      // North of the start: X 1,000 m, F 1,300 m (300 m past X); south: N 1,150 m.
      const tt = await testTimetable({
        stops: { N: near(-1150, -300), X: near(1000, -300), F: near(1300, -300), C },
        routes: [
          { id: 'RF', trips: [trip('far', ['F', '10:00'], ['C', '10:10'])] },
          { id: 'RN', trips: [trip('near', ['N', '10:00'], ['C', '10:30'])] }
        ]
      })
      // 10:00 − 1,150 s (19 min 10 s) = 09:40:50.
      expect(plan(tt, leaving(START, END, '09:30'))).toEqual([
        [
          '09:40:50 → 10:33:20',
          'walk start→N 1150 m 09:40:50–10:00:00',
          'ride near N#0 10:00:00 → C#1 10:30:00',
          'walk C→end 200 m 10:30:00–10:33:20'
        ]
      ])
    })

    it('never gets off at a stop 1,300 m from the end, nor walks from there by way of another', async () => {
      // North of the end: Y 1,000 m, G 1,300 m; south: H 1,150 m.
      const tt = await testTimetable({
        stops: { A, H: near(-1150, 5200), Y: near(1000, 5200), G: near(1300, 5200) },
        routes: [
          { id: 'RG', trips: [trip('to-g', ['A', '10:00'], ['G', '10:10'])] },
          { id: 'RH', trips: [trip('to-h', ['A', '10:00'], ['H', '10:30'])] }
        ]
      })
      // 10:30 + 1,150 s = 10:49:10.
      expect(plan(tt, leaving(START, END, '09:50'))).toEqual([
        [
          '09:55:00 → 10:49:10',
          'walk start→A 300 m 09:55:00–10:00:00',
          'ride to-h A#0 10:00:00 → H#1 10:30:00',
          'walk H→end 1150 m 10:30:00–10:49:10'
        ]
      ])
    })
  })

  describe('service days', () => {
    const made = testTimetable({
      stops: { A, C },
      routes: [
        {
          id: 'R',
          trips: [
            tripOn([20261101], 'sun', ['A', '10:00'], ['C', '10:20']),
            tripOn([20261103], 'tue', ['A', '10:00'], ['C', '10:20']),
            trip('mon', ['A', '10:30'], ['C', '10:50']),
            trip('early', ['A', '00:25'], ['C', '00:45']),
            // Sunday's last bus, running into Monday.
            tripOn([20261101], 'owl-sun', ['A', '24:20'], ['C', '24:40']),
            // Monday's, which runs into Tuesday.
            trip('owl-mon', ['A', '24:30'], ['C', '24:50'])
          ]
        }
      ]
    })

    it('rides only trips that run that day', async () => {
      expect(plan(await made, leaving(START, END, '09:50'))).toEqual([
        [
          '10:25:00 → 10:53:20',
          'walk start→A 300 m 10:25:00–10:30:00',
          'ride mon A#0 10:30:00 → C#1 10:50:00',
          'walk C→end 200 m 10:50:00–10:53:20'
        ]
      ])
    })

    it('rides the day before’s 24:20 at 00:20, and not the day’s own 24:30', async () => {
      const tt = await made
      const journeys = search(tt, leaving(START, END, '00:10'))
      expect(journeys.map((journey) => read(tt, journey))).toEqual([
        [
          '00:15:00 → 00:43:20',
          'walk start→A 300 m 00:15:00–00:20:00',
          'ride owl-sun A#0 00:20:00 → C#1 00:40:00',
          'walk C→end 200 m 00:40:00–00:43:20'
        ],
        [
          '00:20:00 → 00:48:20',
          'walk start→A 300 m 00:20:00–00:25:00',
          'ride early A#0 00:25:00 → C#1 00:45:00',
          'walk C→end 200 m 00:45:00–00:48:20'
        ]
      ])
      // 20261101's midnight + 24 h 20 min.
      expect(rides(journeys[0]!)[0]!.scheduledDepart).toBe(serviceDayStart(20261101) + 87600)
    })

    it('rides it arriving by 00:45, when the window starts the day before', async () => {
      expect(plan(await made, arrivingBy(START, END, '00:45'))).toEqual([
        [
          '00:15:00 → 00:43:20',
          'walk start→A 300 m 00:15:00–00:20:00',
          'ride owl-sun A#0 00:20:00 → C#1 00:40:00',
          'walk C→end 200 m 00:40:00–00:43:20'
        ]
      ])
    })

    it('rides the next day’s first bus from 23:50, the window running past midnight', async () => {
      const tt = await testTimetable({
        stops: { A, C },
        routes: [
          {
            id: 'R',
            trips: [
              tripOn([20261101], 'sun-first', ['A', '00:10'], ['C', '00:30']),
              tripOn([20261102], 'mon-first', ['A', '00:10'], ['C', '00:30']),
              tripOn([20261103], 'tue-first', ['A', '00:10'], ['C', '00:30'])
            ]
          }
        ]
      })
      // From 23:50 on 1 Nov the window runs to 00:50 on the 2nd, so the 2nd's service is ridden.
      expect(plan(tt, leaving(START, END, '23:50', 20261101))).toEqual([
        [
          '00:05:00 → 00:33:20',
          'walk start→A 300 m 00:05:00–00:10:00',
          'ride mon-first A#0 00:10:00 → C#1 00:30:00',
          'walk C→end 200 m 00:30:00–00:33:20'
        ]
      ])
    })
  })

  describe('live delay', () => {
    const made = testTimetable({
      stops: { A, C },
      routes: [
        {
          id: 'R1',
          trips: [
            trip('a', ['A', '10:00'], ['C', '10:20']),
            trip('b', ['A', '10:30'], ['C', '10:50'])
          ]
        }
      ]
    })
    const onTime = [
      '10:25:00 → 10:53:20',
      'walk start→A 300 m 10:25:00–10:30:00',
      'ride b A#0 10:30:00 → C#1 10:50:00',
      'walk C→end 200 m 10:50:00–10:53:20'
    ]

    it('leaves and arrives 2 min later for a bus 2 min late, keeping the timetable’s times', async () => {
      const tt = await made
      const live = new Map([['a', liveTrip(2, { times: { 0: '10:02', 1: '10:22' } })]])
      const journeys = search(tt, leaving(START, END, '09:50'), live)
      expect(journeys.map((journey) => read(tt, journey))).toEqual([
        [
          '09:57:00 → 10:25:20',
          'walk start→A 300 m 09:57:00–10:02:00',
          'ride a A#0 10:02:00 → C#1 10:22:00 live',
          'walk C→end 200 m 10:22:00–10:25:20'
        ],
        onTime
      ])
      expect(rides(journeys[0]!)[0]).toMatchObject({
        scheduledDepart: at('10:00'),
        scheduledArrive: at('10:20'),
        live: true
      })
      expect(rides(journeys[1]!)[0]).toMatchObject({ scheduledDepart: at('10:30'), live: false })
    })

    it('takes the timetable’s arrival where the feed has only the departure', async () => {
      const tt = await made
      const live = new Map([['a', liveTrip(2, { departs: { 0: '10:02' } })]])
      expect(plan(tt, leaving(START, END, '09:50'), live)).toEqual([
        [
          '09:57:00 → 10:23:20',
          'walk start→A 300 m 09:57:00–10:02:00',
          'ride a A#0 10:02:00 → C#1 10:20:00 live',
          'walk C→end 200 m 10:20:00–10:23:20'
        ],
        onTime
      ])
    })

    it('takes a live arrival without a live departure, and isn’t live', async () => {
      const tt = await made
      const live = new Map([['a', liveTrip(2, { arrives: { 1: '10:25' } })]])
      expect(plan(tt, leaving(START, END, '09:50'), live)).toEqual([
        [
          '09:55:00 → 10:28:20',
          'walk start→A 300 m 09:55:00–10:00:00',
          'ride a A#0 10:00:00 → C#1 10:25:00',
          'walk C→end 200 m 10:25:00–10:28:20'
        ],
        onTime
      ])
    })

    it('drops a bus running early that’s gone before the start can reach it', async () => {
      const tt = await made
      // Leaving at 09:54, A is reached at 09:59; the bus left at 09:58.
      const live = new Map([['a', liveTrip(2, { times: { 0: '09:58', 1: '10:18' } })]])
      expect(plan(tt, leaving(START, END, '09:54'), live)).toEqual([onTime])
    })

    it('finds the bus behind it when a late one is passed by it', async () => {
      const tt = await made
      // The 10:00 is 35 min late, so the 10:30 overtakes it; both are worth taking (the late one
      // leaves later), and the 10:30 is found though it's after the late one in the timetable.
      const live = new Map([['a', liveTrip(2, { times: { 0: '10:35', 1: '10:55' } })]])
      const both = [
        onTime,
        [
          '10:30:00 → 10:58:20',
          'walk start→A 300 m 10:30:00–10:35:00',
          'ride a A#0 10:35:00 → C#1 10:55:00 live',
          'walk C→end 200 m 10:55:00–10:58:20'
        ]
      ]
      expect(plan(tt, leaving(START, END, '09:50'), live)).toEqual(both)
      // Arriving by 11:00 (the window from 10:00), the same two: the late 10:00 leaves A at 10:35,
      // after the 10:30, so it's worth having though it gets in later.
      expect(plan(tt, arrivingBy(START, END, '11:00'), live)).toEqual(both)
    })

    it('puts a live entry on the day’s run when the trip runs the day before too', async () => {
      const tt = await testTimetable({
        stops: { A, C },
        routes: [
          {
            id: 'R',
            trips: [tripOn([20261101, 20261102], 'daily', ['A', '10:00'], ['C', '10:20'])]
          }
        ]
      })
      const live = new Map([['daily', liveTrip(2, { times: { 0: '10:03', 1: '10:23' } })]])
      const journeys = search(tt, leaving(START, END, '09:50'), live)
      expect(journeys.map((journey) => read(tt, journey))).toEqual([
        [
          '09:58:00 → 10:26:20',
          'walk start→A 300 m 09:58:00–10:03:00',
          'ride daily A#0 10:03:00 → C#1 10:23:00 live',
          'walk C→end 200 m 10:23:00–10:26:20'
        ]
      ])
      expect(rides(journeys[0]!)[0]).toMatchObject({ scheduledDepart: at('10:00'), live: true })
    })

    it('puts a live entry after midnight on the day before’s run, which is the one running', async () => {
      const tt = await testTimetable({
        stops: { A, C },
        routes: [
          {
            id: 'R',
            trips: [tripOn([20261101, 20261102], 'owl', ['A', '24:20'], ['C', '24:40'])]
          }
        ]
      })
      // 00:23 on the 2nd is 3 min after the 1st's run (24:20 on the 1st) and 23 h 57 min before
      // the 2nd's (24:20 on the 2nd), so it's the 1st's run that's late.
      const live = new Map([['owl', liveTrip(2, { times: { 0: '00:23', 1: '00:43' } })]])
      const journeys = search(tt, leaving(START, END, '00:10'), live)
      expect(journeys.map((journey) => read(tt, journey))).toEqual([
        [
          '00:18:00 → 00:46:20',
          'walk start→A 300 m 00:18:00–00:23:00',
          'ride owl A#0 00:23:00 → C#1 00:43:00 live',
          'walk C→end 200 m 00:43:00–00:46:20'
        ]
      ])
      // 20261101's midnight + 24 h 20 min.
      expect(rides(journeys[0]!)[0]).toMatchObject({
        scheduledDepart: serviceDayStart(20261101) + 87600,
        live: true
      })
    })

    it('keeps the day before’s run on its timetable when the entry is for the day’s', async () => {
      const tt = await testTimetable({
        stops: { A, C },
        routes: [
          {
            id: 'R',
            trips: [tripOn([20261101, 20261102], 'owl', ['A', '24:20'], ['C', '24:40'])]
          }
        ]
      })
      // The entry is the 2nd's run (00:20 on the 3rd) 3 min late; the 1st's run, 00:20 on the
      // 2nd, keeps its timetable.
      const live = new Map([['owl', liveTrip(2, { times: { 0: '24:23', 1: '24:43' } })]])
      expect(plan(tt, leaving(START, END, '00:10'), live)).toEqual([
        [
          '00:15:00 → 00:43:20',
          'walk start→A 300 m 00:15:00–00:20:00',
          'ride owl A#0 00:20:00 → C#1 00:40:00',
          'walk C→end 200 m 00:40:00–00:43:20'
        ]
      ])
    })

    it('misses a change when the first bus is late', async () => {
      const tt = await testTimetable({
        stops: { A, B, C },
        routes: [
          { id: 'R1', trips: [trip('r1', ['A', '10:00'], ['B', '10:10'])] },
          {
            id: 'R2',
            trips: [
              trip('r2-mid', ['B', '10:12'], ['C', '10:32']),
              trip('r2-late', ['B', '10:20'], ['C', '10:40'])
            ]
          }
        ]
      })
      expect(plan(tt, leaving(START, END, '09:50'))).toEqual([
        [
          '09:55:00 → 10:35:20',
          'walk start→A 300 m 09:55:00–10:00:00',
          'ride r1 A#0 10:00:00 → B#1 10:10:00',
          'ride r2-mid B#0 10:12:00 → C#1 10:32:00',
          'walk C→end 200 m 10:32:00–10:35:20'
        ]
      ])
      // 3 min late into B at 10:13, the 10:12 has gone.
      const live = new Map([['r1', liveTrip(2, { times: { 0: '10:03', 1: '10:13' } })]])
      expect(plan(tt, leaving(START, END, '09:50'), live)).toEqual([
        [
          '09:58:00 → 10:43:20',
          'walk start→A 300 m 09:58:00–10:03:00',
          'ride r1 A#0 10:03:00 → B#1 10:13:00 live',
          'ride r2-late B#0 10:20:00 → C#1 10:40:00',
          'walk C→end 200 m 10:40:00–10:43:20'
        ]
      ])
    })
  })

  describe('canceled and skipped', () => {
    // A, C, then E, far from the end.
    const made = testTimetable({
      stops: { A, C, E: near(0, 10000) },
      routes: [
        {
          id: 'R1',
          trips: [
            trip('a', ['A', '10:00'], ['C', '10:20'], ['E', '10:40']),
            trip('b', ['A', '10:30'], ['C', '10:50'], ['E', '11:10'])
          ]
        }
      ]
    })
    const onlyB = [
      [
        '10:25:00 → 10:53:20',
        'walk start→A 300 m 10:25:00–10:30:00',
        'ride b A#0 10:30:00 → C#1 10:50:00',
        'walk C→end 200 m 10:50:00–10:53:20'
      ]
    ]

    it('never rides a canceled trip', async () => {
      const live = new Map([['a', liveTrip(3, { canceled: true })]])
      expect(plan(await made, leaving(START, END, '09:50'), live)).toEqual(onlyB)
    })

    it('never gets off where a trip skips the stop', async () => {
      const live = new Map([['a', liveTrip(3, { skips: [1] })]])
      expect(plan(await made, leaving(START, END, '09:50'), live)).toEqual(onlyB)
    })

    it('never boards where a trip skips the stop', async () => {
      const live = new Map([['a', liveTrip(3, { skips: [0] })]])
      expect(plan(await made, leaving(START, END, '09:50'), live)).toEqual(onlyB)
    })

    it('does the same arriving by 10:55', async () => {
      const tt = await made
      // Without the feed, the 10:00 (in at 10:23:20) is in this window too.
      expect(plan(tt, arrivingBy(START, END, '10:55'))).toHaveLength(2)
      for (const feed of [{ canceled: true }, { skips: [1] }, { skips: [0] }]) {
        const live = new Map([['a', liveTrip(3, feed)]])
        expect(plan(tt, arrivingBy(START, END, '10:55'), live)).toEqual(onlyB)
      }
    })

    it('rides through a stop the trip skips', async () => {
      // To 200 m east of E: the 10:00 skips C on the way and still gets there.
      const live = new Map([['a', liveTrip(3, { skips: [1] })]])
      expect(plan(await made, leaving(START, near(0, 10200), '09:50'), live)).toEqual([
        [
          '09:55:00 → 10:43:20',
          'walk start→A 300 m 09:55:00–10:00:00',
          'ride a A#0 10:00:00 → E#2 10:40:00',
          'walk E→end 200 m 10:40:00–10:43:20'
        ],
        [
          '10:25:00 → 11:13:20',
          'walk start→A 300 m 10:25:00–10:30:00',
          'ride b A#0 10:30:00 → E#2 11:10:00',
          'walk E→end 200 m 11:10:00–11:13:20'
        ]
      ])
    })
  })

  describe('pareto', () => {
    const made = testTimetable({
      stops: { A, B, C },
      routes: [
        { id: 'D', trips: [trip('direct', ['A', '10:00'], ['C', '10:40'])] },
        // Leaves before the direct one and gets in after it: never worth it.
        { id: 'S', trips: [trip('slow', ['A', '09:58'], ['C', '10:45'])] },
        { id: 'X', trips: [trip('x', ['A', '10:02'], ['B', '10:10'])] },
        { id: 'Y', trips: [trip('y', ['B', '10:15'], ['C', '10:30'])] }
      ]
    })

    it('keeps one ride arriving 10:40 and two arriving 10:30, and drops the slow one', async () => {
      expect(plan(await made, leaving(START, END, '09:50'))).toEqual([
        [
          '09:55:00 → 10:43:20',
          'walk start→A 300 m 09:55:00–10:00:00',
          'ride direct A#0 10:00:00 → C#1 10:40:00',
          'walk C→end 200 m 10:40:00–10:43:20'
        ],
        [
          '09:57:00 → 10:33:20',
          'walk start→A 300 m 09:57:00–10:02:00',
          'ride x A#0 10:02:00 → B#1 10:10:00',
          'ride y B#0 10:15:00 → C#1 10:30:00',
          'walk C→end 200 m 10:30:00–10:33:20'
        ]
      ])
    })

    it('finds the same journeys leaving and arriving', async () => {
      expectBothWays(await made, START, END, { time: at('09:50'), deadline: at('10:45') })
    })

    it('keeps a bus journey that walking all the way would beat', async () => {
      // D is 1,200 m east of A, the end 200 m past D: 1,700 m from the start. Walking from 09:55
      // gets in at 10:23:20, but walking isn't the search's to weigh, so the bus still counts.
      const tt = await testTimetable({
        stops: { A, D: near(0, 1200) },
        routes: [{ id: 'R', trips: [trip('slow', ['A', '10:00'], ['D', '10:30'])] }]
      })
      expect(plan(tt, leaving(START, near(0, 1400), '09:50'))).toEqual([
        [
          '09:55:00 → 10:33:20',
          'walk start→A 300 m 09:55:00–10:00:00',
          'ride slow A#0 10:00:00 → D#1 10:30:00',
          'walk D→end 200 m 10:30:00–10:33:20'
        ]
      ])
    })
  })

  describe('arrive by', () => {
    const buses = [
      // Gets in at 09:43:20, before the window.
      trip('r0920', ['A', '09:20'], ['C', '09:40']),
      trip('r1000', ['A', '10:00'], ['C', '10:20']),
      // 10:41:40 + 200 s: there at 10:45:00 sharp.
      trip('r1021', ['A', '10:21:40'], ['C', '10:41:40']),
      trip('r1030', ['A', '10:30'], ['C', '10:50'])
    ]
    const made = testTimetable({ stops: { A, C }, routes: [{ id: 'R', trips: buses }] })
    const expected = [
      [
        '09:55:00 → 10:23:20',
        'walk start→A 300 m 09:55:00–10:00:00',
        'ride r1000 A#0 10:00:00 → C#1 10:20:00',
        'walk C→end 200 m 10:20:00–10:23:20'
      ],
      [
        '10:16:40 → 10:45:00',
        'walk start→A 300 m 10:16:40–10:21:40',
        'ride r1021 A#0 10:21:40 → C#1 10:41:40',
        'walk C→end 200 m 10:41:40–10:45:00'
      ]
    ]

    it('leaves as late as it can for 10:45, and nothing gets in after it', async () => {
      expect(plan(await made, arrivingBy(START, END, '10:45'))).toEqual(expected)
    })

    it('drops the last one when the feed has it a minute late', async () => {
      // 10:42:40 + 200 s = 10:46:00.
      const live = new Map([['r1021', liveTrip(2, { times: { 0: '10:22:40', 1: '10:42:40' } })]])
      expect(plan(await made, arrivingBy(START, END, '10:45'), live)).toEqual([expected[0]])
    })

    it('takes one getting in exactly an hour before', async () => {
      // 09:41:40 + 200 s = 09:45:00, the window's start; the 09:20 (in at 09:43:20) isn't in it.
      const tt = await testTimetable({
        stops: { A, C },
        routes: [
          {
            id: 'R',
            trips: [
              trip('r0920', ['A', '09:20'], ['C', '09:40']),
              trip('r0921', ['A', '09:21:40'], ['C', '09:41:40']),
              trip('r1000', ['A', '10:00'], ['C', '10:20'])
            ]
          }
        ]
      })
      expect(plan(tt, arrivingBy(START, END, '10:45'))).toEqual([
        [
          '09:16:40 → 09:45:00',
          'walk start→A 300 m 09:16:40–09:21:40',
          'ride r0921 A#0 09:21:40 → C#1 09:41:40',
          'walk C→end 200 m 09:41:40–09:45:00'
        ],
        expected[0]
      ])
    })

    it('keeps one in the window that only a journey before the window beats', async () => {
      // The crawl leaves A at 09:15 and gets in at 09:53:20. The 09:20 leaves later and gets in
      // earlier, at 09:43:20, but that's before the window, so it doesn't count.
      const tt = await testTimetable({
        stops: { A, C },
        routes: [
          { id: 'R', trips: buses },
          { id: 'Z', trips: [trip('crawl', ['A', '09:15'], ['C', '09:50'])] }
        ]
      })
      expect(plan(tt, arrivingBy(START, END, '10:45'))).toEqual([
        [
          '09:10:00 → 09:53:20',
          'walk start→A 300 m 09:10:00–09:15:00',
          'ride crawl A#0 09:15:00 → C#1 09:50:00',
          'walk C→end 200 m 09:50:00–09:53:20'
        ],
        ...expected
      ])
    })
  })

  describe('at most three rides', () => {
    // S0 → S1 → S2 → S3 → S4, 5 km apart; the start is 300 m west of S0.
    const made = testTimetable({
      stops: {
        S0: near(0, 0),
        S1: near(0, 5000),
        S2: near(5000, 5000),
        S3: near(5000, 10000),
        S4: near(10000, 10000)
      },
      routes: [
        { id: 'R1', trips: [trip('r1', ['S0', '10:00'], ['S1', '10:10'])] },
        { id: 'R2', trips: [trip('r2', ['S1', '10:15'], ['S2', '10:25'])] },
        { id: 'R3', trips: [trip('r3', ['S2', '10:30'], ['S3', '10:40'])] },
        { id: 'R4', trips: [trip('r4', ['S3', '10:45'], ['S4', '10:55'])] }
      ]
    })

    it('finds nothing when it takes four', async () => {
      // 200 m north of S4.
      expect(plan(await made, leaving(START, near(10200, 10000), '09:50'))).toEqual([])
    })

    it('rides three', async () => {
      // 200 m north of S3.
      expect(plan(await made, leaving(START, near(5200, 10000), '09:50'))).toEqual([
        [
          '09:55:00 → 10:43:20',
          'walk start→S0 300 m 09:55:00–10:00:00',
          'ride r1 S0#0 10:00:00 → S1#1 10:10:00',
          'ride r2 S1#0 10:15:00 → S2#1 10:25:00',
          'ride r3 S2#0 10:30:00 → S3#1 10:40:00',
          'walk S3→end 200 m 10:40:00–10:43:20'
        ]
      ])
    })
  })

  describe('window', () => {
    const w1000 = [
      '09:55:00 → 10:23:20',
      'walk start→A 300 m 09:55:00–10:00:00',
      'ride w1000 A#0 10:00:00 → C#1 10:20:00',
      'walk C→end 200 m 10:20:00–10:23:20'
    ]
    const w1045 = [
      '10:40:00 → 11:08:20',
      'walk start→A 300 m 10:40:00–10:45:00',
      'ride w1045 A#0 10:45:00 → C#1 11:05:00',
      'walk C→end 200 m 11:05:00–11:08:20'
    ]
    const w1000Trip = trip('w1000', ['A', '10:00'], ['C', '10:20'])
    const w1045Trip = trip('w1045', ['A', '10:45'], ['C', '11:05'])
    // Leaving at 11:00, 70 min after 09:50.
    const w1105Trip = trip('w1105', ['A', '11:05'], ['C', '11:25'])

    it('takes journeys leaving up to an hour on, and none after', async () => {
      const tt = await testTimetable({
        stops: { A, C },
        routes: [
          {
            id: 'R',
            trips: [w1000Trip, w1045Trip, trip('w1055', ['A', '10:55'], ['C', '11:15']), w1105Trip]
          }
        ]
      })
      // Leaving 09:55, 10:40, 10:50 (09:50 + 60 min, the window's end) but not 11:00; from
      // 09:55 the 09:55 is the window's start.
      for (const time of ['09:50', '09:55']) {
        expect(plan(tt, leaving(START, END, time))).toEqual([
          w1000,
          w1045,
          [
            '10:50:00 → 11:18:20',
            'walk start→A 300 m 10:50:00–10:55:00',
            'ride w1055 A#0 10:55:00 → C#1 11:15:00',
            'walk C→end 200 m 11:15:00–11:18:20'
          ]
        ])
      }
    })

    it('keeps one in the window that only a journey after the window beats', async () => {
      // The crawl leaves at 10:49 and gets in at 11:53:20. Leaving at 11:00 gets in earlier, at
      // 11:28:20, but that's after the window, so it doesn't count.
      const tt = await testTimetable({
        stops: { A, C },
        routes: [
          { id: 'R', trips: [w1000Trip, w1045Trip, w1105Trip] },
          { id: 'Z', trips: [trip('crawl', ['A', '10:54'], ['C', '11:50'])] }
        ]
      })
      expect(plan(tt, leaving(START, END, '09:50'))).toEqual([
        w1000,
        w1045,
        [
          '10:49:00 → 11:53:20',
          'walk start→A 300 m 10:49:00–10:54:00',
          'ride crawl A#0 10:54:00 → C#1 11:50:00',
          'walk C→end 200 m 11:50:00–11:53:20'
        ]
      ])
    })
  })

  describe('loop', () => {
    // An Orbit: Q, R, S and back to Q.
    const made = testTimetable({
      stops: { Q: near(0, 0), R: near(0, 5000), S: near(5000, 5000) },
      routes: [
        {
          id: 'O',
          trips: [
            trip('orbit', ['Q', '10:00'], ['R', '10:10'], ['S', '10:20'], ['Q', '10:30']),
            trip('orbit2', ['Q', '10:30'], ['R', '10:40'], ['S', '10:50'], ['Q', '11:00'])
          ]
        }
      ]
    })

    it('boards at its first stop when that stop comes round again', async () => {
      // From 300 m west of Q to 200 m north of S, leaving from 09:50 and arriving by 10:55.
      const tt = await made
      const both = [
        [
          '09:55:00 → 10:23:20',
          'walk start→Q 300 m 09:55:00–10:00:00',
          'ride orbit Q#0 10:00:00 → S#2 10:20:00',
          'walk S→end 200 m 10:20:00–10:23:20'
        ],
        [
          '10:25:00 → 10:53:20',
          'walk start→Q 300 m 10:25:00–10:30:00',
          'ride orbit2 Q#0 10:30:00 → S#2 10:50:00',
          'walk S→end 200 m 10:50:00–10:53:20'
        ]
      ]
      expect(plan(tt, leaving(START, near(5200, 5000), '09:50'))).toEqual(both)
      expect(plan(tt, arrivingBy(START, near(5200, 5000), '10:55'))).toEqual(both)
    })

    it('gets off at the stop it started from, coming round', async () => {
      // From 300 m west of R to 200 m west of Q, leaving from 10:00 and arriving by 11:05.
      const tt = await made
      const both = [
        [
          '10:05:00 → 10:33:20',
          'walk start→R 300 m 10:05:00–10:10:00',
          'ride orbit R#1 10:10:00 → Q#3 10:30:00',
          'walk Q→end 200 m 10:30:00–10:33:20'
        ],
        [
          '10:35:00 → 11:03:20',
          'walk start→R 300 m 10:35:00–10:40:00',
          'ride orbit2 R#1 10:40:00 → Q#3 11:00:00',
          'walk Q→end 200 m 11:00:00–11:03:20'
        ]
      ]
      expect(plan(tt, leaving(near(0, 4700), near(0, -200), '10:00'))).toEqual(both)
      expect(plan(tt, arrivingBy(near(0, 4700), near(0, -200), '11:05'))).toEqual(both)
    })
  })

  describe('speed', () => {
    // 20 rows × 25 columns of stops 250 m apart (6 × 4.75 km). A route runs along every odd
    // row and every odd column up to 19, both ways: 40 patterns, a bus every 10 min from 06:00
    // (each pattern's offset by 47 s more than the last, mod 10 min), a minute a stop.
    const ROWS = 20
    const COLUMNS = 25
    const SPACING_M = 250
    const TRIPS = 100
    const name = (row: number, column: number): string => `r${row}c${column}`
    const place = (row: number, column: number): LatLon => near(row * SPACING_M, column * SPACING_M)
    const firstDeparture = (line: number): number => 6 * 3600 + ((line * 47) % 600)

    function grid(): TestSpec {
      const stops: Record<string, LatLon> = {}
      for (let row = 0; row < ROWS; row++) {
        for (let column = 0; column < COLUMNS; column++)
          stops[name(row, column)] = place(row, column)
      }
      const runs = (id: string, line: number, calls: string[]): TestTrip[] =>
        Array.from({ length: TRIPS }, (_, k) => ({
          id: `${id}-${k}`,
          stops: calls.map((stop, hop): Call => [
            stop,
            hms(firstDeparture(line) + k * 600 + hop * 60)
          ])
        }))
      const routes: TestSpec['routes'] = []
      for (let i = 0; i < 10; i++) {
        const row = 2 * i + 1
        const east = Array.from({ length: COLUMNS }, (_, column) => name(row, column))
        routes.push({
          id: `row${row}`,
          trips: [
            ...runs(`row${row}-east`, i, east),
            ...runs(`row${row}-west`, 10 + i, [...east].reverse())
          ]
        })
      }
      for (let j = 0; j < 10; j++) {
        const column = 2 * j + 1
        const north = Array.from({ length: ROWS }, (_, row) => name(row, column))
        routes.push({
          id: `col${column}`,
          trips: [
            ...runs(`col${column}-north`, 20 + j, north),
            ...runs(`col${column}-south`, 30 + j, [...north].reverse())
          ]
        })
      }
      return { stops, routes }
    }

    // The two trips of the journey worked out below, which the feed leaves alone.
    const OUR_TRIPS = new Set(['row5-east-36', 'col19-north-38'])

    /** Buses leaving 11:40 to 13:10 (k 34–42) 0–3 min late along their whole way, as the feed has them. */
    function lateBuses(tt: Timetable): LiveTimes {
      const live = new Map<string, LiveTrip>()
      tt.patterns.forEach((pattern, p) => {
        const length = pattern.stops.length
        for (let k = 34; k <= 42; k++) {
          const id = pattern.trips[k] as string
          if (OUR_TRIPS.has(id)) continue
          const late = ((p + k) % 4) * 60
          const times = Array.from(
            { length },
            (_, s) => DAY + (pattern.times[(k * length + s) * 2] as number) + late
          )
          live.set(id, {
            canceled: false,
            arrival: Float64Array.from(times),
            departure: Float64Array.from(times),
            skipped: new Uint8Array(length)
          })
        }
      })
      return live
    }

    let tt: Timetable
    let live: LiveTimes
    beforeAll(async () => {
      tt = await testTimetable(grid())
      live = lateBuses(tt)
    }, 60_000)

    // From the stop at row 5, column 3 to the one at row 15, column 19.
    const from = place(5, 3)
    const to = place(15, 19)

    it('is 500 stops and 40 patterns of 100 trips', () => {
      expect(tt.stops.ids).toHaveLength(500)
      expect(tt.patterns).toHaveLength(40)
      expect(tt.patterns.every((pattern) => pattern.trips.length === TRIPS)).toBe(true)
      expect(live.size).toBeGreaterThan(300)
    })

    it('plans across it in under 200 ms, leaving or arriving', () => {
      // One untimed plan first, so what's worked out once per timetable isn't counted.
      planTrips(tt, { from: to, to: from, time: at('12:00'), mode: 'depart' }, live)
      const timed = (query: PlanQuery): { journeys: Journey[]; ms: number } => {
        const began = performance.now()
        const journeys = planTrips(tt, query, live)
        return { journeys, ms: performance.now() - began }
      }
      const leavingQuery: PlanQuery = { from, to, time: at('12:00'), mode: 'depart' }
      const arrivingQuery: PlanQuery = { from, to, time: at('13:00'), mode: 'arrive' }
      const leavingPlan = timed(leavingQuery)
      const arrivingPlan = timed(arrivingQuery)
      expect(leavingPlan.ms).toBeLessThan(200)
      expect(arrivingPlan.ms).toBeLessThan(200)

      expect(planProblems(tt, leavingQuery, live, leavingPlan.journeys)).toEqual([])
      expect(planProblems(tt, arrivingQuery, live, arrivingPlan.journeys)).toEqual([])
      // One journey there, worked out by hand, which some planned one must match or beat:
      // east along row 5 (offset 2 × 47 = 94 s) leaves column 3 at 06:04:34 + 10k min, first at
      // 12:04:34 (k 36), reaching column 19 at 12:20:34; north up column 19 (offset 29 × 47 mod
      // 600 = 163 s) leaves row 5 at 06:07:43 + 10k min, first at 12:27:43 after 12:21:34 (k 38),
      // and reaches row 15 at 12:37:43.
      const byHand = { depart: at('12:04:34'), arrive: at('12:37:43'), rides: 2 }
      expect(
        leavingPlan.journeys.some(
          (journey) =>
            journey.depart >= byHand.depart &&
            journey.arrive <= byHand.arrive &&
            rides(journey).length <= byHand.rides
        )
      ).toBe(true)
      expect(arrivingPlan.journeys.length).toBeGreaterThan(0)
    })

    it('finds the same journeys leaving and arriving', () => {
      expectBothWays(tt, from, to, { time: at('12:00'), deadline: at('13:00') }, live)
    }, 60_000)
  })
})
