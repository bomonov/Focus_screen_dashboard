// The rules for a trip the user keeps on screen: what its countdown says, and when the Mac has
// moved too far from where the trip began for it still to be theirs.
import { describe, expect, it } from 'vitest'
import { distanceM, type LatLon } from '../transit/routeLine'
import type { FeedTrip } from '../transit/gtfsRealtime'
import {
  MOVED_AWAY_M,
  catchable,
  firstRideGone,
  followFeed,
  keptPhase,
  movedAway,
  sameJourney
} from './kept'
import type { TripPlan, TripRide, TripStep } from './types'

const walk = (start: number, end: number): TripStep => ({
  kind: 'walk',
  start,
  end,
  minutes: Math.max(1, Math.ceil((end - start) / 60)),
  toName: null
})

const ride = (depart: number, arrive: number): TripRide => ({
  kind: 'ride',
  routeName: 'Orbit Venus',
  short: 'VENU',
  color: '',
  textColor: '',
  rail: false,
  headsign: 'Tempe',
  tripId: 'venus-1',
  fromName: 'Stop A',
  fromStopId: 'A',
  toName: 'Stop B',
  toStopId: 'B',
  depart,
  arrive,
  stops: 5,
  live: false,
  delayMin: null
})

/** Leave at 1000: walk 5 min, ride from 1300 to 1900, walk 100 s, there at 2000. */
const LEAVE = 1000
const DEPART = 1300
const ARRIVE = 2000
const PLAN: TripPlan = {
  leave: LEAVE,
  arrive: ARRIVE,
  steps: [walk(1000, 1300), ride(DEPART, 1900), walk(1900, 2000)],
  rides: 1,
  walkM: 500
}

describe('keptPhase', () => {
  it('counts whole minutes down while there are at least one left', () => {
    expect(keptPhase(PLAN, LEAVE - 390)).toEqual({ kind: 'leaveIn', minutes: 6 })
    expect(keptPhase(PLAN, LEAVE - 3600)).toEqual({ kind: 'leaveIn', minutes: 60 })
    expect(keptPhase(PLAN, LEAVE - 119)).toEqual({ kind: 'leaveIn', minutes: 1 })
    expect(keptPhase(PLAN, LEAVE - 60)).toEqual({ kind: 'leaveIn', minutes: 1 })
  })

  it('says leave now under a minute before leaving', () => {
    expect(keptPhase(PLAN, LEAVE - 59)).toEqual({ kind: 'leaveNow' })
    expect(keptPhase(PLAN, LEAVE - 59.5)).toEqual({ kind: 'leaveNow' })
    expect(keptPhase(PLAN, LEAVE - 30)).toEqual({ kind: 'leaveNow' })
    expect(keptPhase(PLAN, LEAVE)).toEqual({ kind: 'leaveNow' })
  })

  it('keeps saying leave now, past the leave time, until the first ride departs', () => {
    expect(keptPhase(PLAN, LEAVE + 120)).toEqual({ kind: 'leaveNow' })
    expect(keptPhase(PLAN, DEPART - 1)).toEqual({ kind: 'leaveNow' })
  })

  it('is missed from the second the first ride departs, until the trip’s arrival', () => {
    expect(keptPhase(PLAN, DEPART)).toEqual({ kind: 'missed' })
    expect(keptPhase(PLAN, DEPART + 1)).toEqual({ kind: 'missed' })
    expect(keptPhase(PLAN, ARRIVE - 1)).toEqual({ kind: 'missed' })
  })

  it('is over at the arrival and after it', () => {
    expect(keptPhase(PLAN, ARRIVE)).toEqual({ kind: 'over' })
    expect(keptPhase(PLAN, ARRIVE + 1)).toEqual({ kind: 'over' })
    expect(keptPhase(PLAN, ARRIVE + 86400)).toEqual({ kind: 'over' })
  })

  it('goes by the first ride only, whatever comes after it', () => {
    const plan: TripPlan = {
      leave: LEAVE,
      arrive: 3000,
      steps: [
        walk(1000, 1100),
        ride(1100, 1500),
        walk(1500, 1560),
        ride(1700, 2900),
        walk(2900, 3000)
      ],
      rides: 2,
      walkM: 300
    }
    expect(keptPhase(plan, 1099)).toEqual({ kind: 'leaveNow' })
    expect(keptPhase(plan, 1100)).toEqual({ kind: 'missed' })
    // Between the rides the first has long gone: it's the first that counts.
    expect(keptPhase(plan, 1650)).toEqual({ kind: 'missed' })
    expect(keptPhase(plan, 3000)).toEqual({ kind: 'over' })
  })

  it('treats a walk-only trip as leave now until it ends, never missed', () => {
    const plan: TripPlan = {
      leave: 5000,
      arrive: 5600,
      steps: [walk(5000, 5600)],
      rides: 0,
      walkM: 780
    }
    expect(keptPhase(plan, 5000 - 120)).toEqual({ kind: 'leaveIn', minutes: 2 })
    expect(keptPhase(plan, 5000 - 30)).toEqual({ kind: 'leaveNow' })
    expect(keptPhase(plan, 5000)).toEqual({ kind: 'leaveNow' })
    expect(keptPhase(plan, 5599)).toEqual({ kind: 'leaveNow' })
    expect(keptPhase(plan, 5600)).toEqual({ kind: 'over' })
  })
})

/** A point `metres` due north of Old Main. */
const START: LatLon = [33.4255, -111.94]
const northOf = (metres: number): LatLon => [START[0] + metres / 110_574, START[1]]

describe('movedAway', () => {
  const fix = (at: LatLon, accuracyM: number): { at: LatLon; accuracyM: number } => ({
    at,
    accuracyM
  })

  it('is false at 200 m when each fix could be 100 m out', () => {
    expect(movedAway(fix(START, 100), fix(northOf(200), 100))).toBe(false)
  })

  it('is true at 400 m with the same accuracies', () => {
    expect(movedAway(fix(START, 100), fix(northOf(400), 100))).toBe(true)
  })

  it('allows 150 m beyond the two fixes’ accuracy, and no more', () => {
    expect(MOVED_AWAY_M).toBe(150)
    // Sanity: the helper really puts the point that far off.
    expect(distanceM(START, northOf(350))).toBeCloseTo(350, 0)
    expect(movedAway(fix(START, 100), fix(northOf(349), 100))).toBe(false)
    expect(movedAway(fix(START, 100), fix(northOf(351), 100))).toBe(true)
    expect(movedAway(fix(START, 0), fix(northOf(149), 0))).toBe(false)
    expect(movedAway(fix(START, 0), fix(northOf(151), 0))).toBe(true)
  })

  it('adds both accuracies, so a poor fix on either side gives more room', () => {
    expect(movedAway(fix(START, 10), fix(northOf(300), 10))).toBe(true)
    expect(movedAway(fix(START, 300), fix(northOf(300), 10))).toBe(false)
    expect(movedAway(fix(START, 10), fix(northOf(300), 300))).toBe(false)
  })

  it('is false when the Mac hasn’t moved', () => {
    expect(movedAway(fix(START, 0), fix(START, 0))).toBe(false)
  })
})

describe('sameJourney', () => {
  const late = (delayMin: number, shift = delayMin * 60): TripPlan => ({
    ...PLAN,
    steps: [
      walk(1000 + shift, 1300 + shift),
      { ...ride(DEPART + shift, 1900 + shift), live: true, delayMin },
      walk(1900 + shift, 2000 + shift)
    ],
    arrive: ARRIVE + shift
  })

  it('is the same rides on the same bus, running late or early', () => {
    expect(sameJourney(PLAN, PLAN)).toBe(true)
    expect(sameJourney(late(3), PLAN)).toBe(true)
    expect(sameJourney(late(-2), PLAN)).toBe(true)
    // Whole minutes late, so its timetable time is read to within half a minute either way.
    expect(sameJourney(late(1, 89), PLAN)).toBe(true)
  })

  it('isn’t the same rides a bus later: another trip, or the same trip another day', () => {
    const later = late(0, 900)
    const bus = { ...(later.steps[1] as TripRide), tripId: 'venus-2' }
    expect(sameJourney({ ...later, steps: [walk(1900, 2200), bus] }, PLAN)).toBe(false)
    const atOnce = {
      ...PLAN,
      steps: [walk(1000, 1300), { ...ride(DEPART, 1900), tripId: 'venus-2' }]
    }
    expect(sameJourney(atOnce, PLAN)).toBe(false)
    // A trip_id runs once a service day: the same one a day on isn't this bus.
    expect(sameJourney(late(0, 86400), PLAN)).toBe(false)
    expect(sameJourney(late(0, 180), PLAN)).toBe(false)
  })

  it('isn’t another route, way, or stop on or off, by their ids', () => {
    const other = (change: Partial<TripRide>): TripPlan => ({
      ...PLAN,
      steps: [walk(1000, 1300), { ...ride(DEPART, 1900), ...change }, walk(1900, 2000)]
    })
    expect(sameJourney(other({ routeName: 'Route 72', short: '72' }), PLAN)).toBe(false)
    expect(sameJourney(other({ headsign: 'Venus Reverse' }), PLAN)).toBe(false)
    expect(sameJourney(other({ fromStopId: 'C' }), PLAN)).toBe(false)
    expect(sameJourney(other({ toStopId: 'C' }), PLAN)).toBe(false)
    // Two stops may share a name; their ids tell them apart, and only their ids count.
    expect(sameJourney(other({ fromName: 'Stop A (other side)' }), PLAN)).toBe(true)
  })

  it('is the same journey when only a later ride’s bus has changed', () => {
    const second = { ...ride(1700, 1900), tripId: 'route72-1', fromStopId: 'B', toStopId: 'C' }
    const twice: TripPlan = {
      ...PLAN,
      steps: [walk(1000, 1300), ride(DEPART, 1600), second, walk(1900, 2000)],
      rides: 2
    }
    const missedChange: TripPlan = {
      ...twice,
      steps: [
        walk(1000, 1300),
        ride(DEPART, 1600),
        { ...second, tripId: 'route72-2', depart: 2600, arrive: 2800 },
        walk(2800, 2900)
      ]
    }
    expect(sameJourney(missedChange, twice)).toBe(true)
  })

  it('isn’t a trip with more rides or none', () => {
    const walking: TripPlan = { ...PLAN, steps: [walk(1000, 2000)], rides: 0 }
    expect(sameJourney(walking, PLAN)).toBe(false)
    expect(sameJourney(walking, walking)).toBe(false)
    const twice: TripPlan = {
      ...PLAN,
      steps: [walk(1000, 1300), ride(DEPART, 1600), ride(1700, 1900), walk(1900, 2000)],
      rides: 2
    }
    expect(sameJourney(twice, PLAN)).toBe(false)
  })
})

/** The first ride's trip as the live feed tells of it. */
const trip = (change: Partial<FeedTrip> = {}): FeedTrip => ({
  tripId: 'venus-1',
  routeId: 'VENU',
  directionId: 0,
  canceled: false,
  vehicleId: '',
  stops: [],
  ...change
})

type Update = FeedTrip['stops'][number]

const update = (stopId: string, relationship: Update['relationship']): Update => ({
  stopSequence: null,
  stopId,
  arrival: null,
  departure: null,
  relationship
})

/** A stop the feed times: leaving at `time` (or `delay` seconds late, with no time). */
const timed = (stopId: string, time: number | null, delay: number | null = null): Update => ({
  ...update(stopId, 'scheduled'),
  arrival: { time, delay },
  departure: { time, delay }
})

describe('firstRideGone', () => {
  it('is gone when the feed cancels the first ride’s trip', () => {
    expect(firstRideGone(PLAN, [trip({ canceled: true })], LEAVE)).toBe(true)
  })

  it('is gone when that trip skips the stop it’s boarded or left at', () => {
    expect(firstRideGone(PLAN, [trip({ stops: [update('A', 'skipped')] })], LEAVE)).toBe(true)
    expect(firstRideGone(PLAN, [trip({ stops: [update('B', 'skipped')] })], LEAVE)).toBe(true)
  })

  it('isn’t gone when it runs: late, skipping another stop, or with no data', () => {
    expect(firstRideGone(PLAN, [], LEAVE)).toBe(false)
    expect(firstRideGone(PLAN, [trip()], LEAVE)).toBe(false)
    expect(firstRideGone(PLAN, [trip({ stops: [update('C', 'skipped')] })], LEAVE)).toBe(false)
    expect(firstRideGone(PLAN, [trip({ stops: [update('A', 'noData')] })], LEAVE)).toBe(false)
    expect(firstRideGone(PLAN, [trip({ tripId: 'venus-2', canceled: true })], LEAVE)).toBe(false)
  })

  it('goes by the first ride only, and a walk has none to lose', () => {
    const later = { ...ride(1700, 1900), tripId: 'route72-1' }
    const twice: TripPlan = { ...PLAN, steps: [walk(1000, 1300), ride(DEPART, 1600), later] }
    expect(firstRideGone(twice, [trip({ tripId: 'route72-1', canceled: true })], LEAVE)).toBe(false)
    expect(
      firstRideGone({ ...PLAN, steps: [walk(1000, 2000)] }, [trip({ canceled: true })], LEAVE)
    ).toBe(false)
  })
})

/** Unix seconds at a time of day in Tempe (UTC−7), on a day of November 2026. */
const tempe = (day: number, hours: number, minutes = 0): number =>
  Date.UTC(2026, 10, day, hours + 7, minutes) / 1000

/** PLAN moved to leave at `leave`, its ride `DEPART - LEAVE` later, as the same trip_id. */
function planAt(leave: number): TripPlan {
  const shift = leave - LEAVE
  return {
    leave,
    arrive: ARRIVE + shift,
    steps: [
      walk(LEAVE + shift, DEPART + shift),
      ride(DEPART + shift, 1900 + shift),
      walk(1900 + shift, ARRIVE + shift)
    ],
    rides: 1,
    walkM: 500
  }
}

describe('firstRideGone · which run of its trip', () => {
  // A trip_id runs every service day it's scheduled: today's news is about today's run.
  const tomorrowMorning = planAt(tempe(4, 8))

  it('leaves a trip kept for tomorrow alone when today’s run of its trip is canceled', () => {
    expect(firstRideGone(tomorrowMorning, [trip({ canceled: true })], tempe(3, 14))).toBe(false)
    // Late in the evening it's within 12 hours, but still another day's run.
    expect(firstRideGone(tomorrowMorning, [trip({ canceled: true })], tempe(3, 23))).toBe(false)
    expect(
      firstRideGone(tomorrowMorning, [trip({ stops: [update('A', 'skipped')] })], tempe(3, 14))
    ).toBe(false)
  })

  it('takes a cancellation with no times as the run today, for a trip kept for later today', () => {
    expect(firstRideGone(planAt(tempe(3, 18)), [trip({ canceled: true })], tempe(3, 14))).toBe(true)
  })

  it('goes by the entry’s times when it has them: the run they’re within a few hours of', () => {
    const evening = planAt(tempe(3, 18))
    const skipsNear = trip({ stops: [timed('Z', tempe(3, 17, 30)), update('A', 'skipped')] })
    expect(firstRideGone(evening, [skipsNear], tempe(3, 14))).toBe(true)
    // The same trip_id timed for this morning: another run, whatever it skips.
    const skipsMorning = trip({ stops: [timed('Z', tempe(3, 7, 30)), update('A', 'skipped')] })
    expect(firstRideGone(evening, [skipsMorning], tempe(3, 14))).toBe(false)
    // Timed for tomorrow's run of a trip kept for tomorrow: that's the one.
    const skipsTomorrow = trip({ stops: [timed('Z', tempe(4, 7, 55)), update('A', 'skipped')] })
    expect(firstRideGone(tomorrowMorning, [skipsTomorrow], tempe(3, 23))).toBe(true)
  })
})

describe('followFeed', () => {
  it('moves the leave time, the walk to the stop and the ride to the time the feed gives', () => {
    const late = followFeed(PLAN, [trip({ stops: [timed('A', DEPART + 300)] })], LEAVE)
    expect(late).toEqual({
      leave: LEAVE + 300,
      // Nothing said where it's left: it's as late there, and so is the trip.
      arrive: ARRIVE + 300,
      steps: [
        walk(LEAVE + 300, DEPART + 300),
        { ...ride(DEPART + 300, 1900 + 300), live: true, delayMin: 5 },
        walk(1900 + 300, ARRIVE + 300)
      ],
      rides: 1,
      walkM: 500
    })
  })

  it('takes where it’s left from the feed too, and a delay with no time', () => {
    const plan = followFeed(
      PLAN,
      [trip({ stops: [timed('A', null, 120), timed('B', 1900 + 60)] })],
      LEAVE
    )
    expect(plan?.leave).toBe(LEAVE + 120)
    expect(plan?.steps[1]).toMatchObject({ depart: DEPART + 120, arrive: 1960, delayMin: 2 })
    expect(plan?.arrive).toBe(ARRIVE + 60)
  })

  it('follows a bus running early, from a ride already late', () => {
    const wasLate: TripPlan = {
      ...planAt(LEAVE + 180),
      steps: [
        walk(LEAVE + 180, DEPART + 180),
        { ...ride(DEPART + 180, 1900 + 180), live: true, delayMin: 3 },
        walk(1900 + 180, ARRIVE + 180)
      ]
    }
    const early = followFeed(wasLate, [trip({ stops: [timed('A', DEPART - 100)] })], LEAVE)
    expect(early?.leave).toBe(LEAVE - 100)
    expect(early?.steps[1]).toMatchObject({ depart: DEPART - 100, delayMin: -2 })
  })

  it('moves only the first ride of several, and what comes before it', () => {
    const second: TripRide = {
      ...ride(1700, 1850),
      tripId: 'route72-1',
      fromStopId: 'B',
      toStopId: 'C'
    }
    const twice: TripPlan = {
      ...PLAN,
      steps: [walk(1000, 1300), ride(DEPART, 1600), second, walk(1850, 2000)],
      rides: 2
    }
    const moved = followFeed(twice, [trip({ stops: [timed('A', DEPART + 60)] })], LEAVE)
    expect(moved?.steps.slice(2)).toEqual(twice.steps.slice(2))
    expect(moved?.arrive).toBe(ARRIVE)
    expect(moved?.leave).toBe(LEAVE + 60)
  })

  it('has nothing to follow: no entry, another run, canceled, no time where it’s boarded, or no change', () => {
    const at = (stops: Update[], change: Partial<FeedTrip> = {}): FeedTrip[] => [
      trip({ stops, ...change })
    ]
    expect(followFeed(PLAN, [], LEAVE)).toBeNull()
    expect(
      followFeed(PLAN, at([timed('A', DEPART + 300)], { tripId: 'venus-2' }), LEAVE)
    ).toBeNull()
    expect(followFeed(PLAN, at([timed('A', DEPART + 86_400)]), LEAVE)).toBeNull()
    expect(followFeed(PLAN, at([timed('A', DEPART + 300)], { canceled: true }), LEAVE)).toBeNull()
    expect(followFeed(PLAN, at([timed('Z', DEPART + 300)]), LEAVE)).toBeNull()
    expect(followFeed(PLAN, at([timed('A', DEPART)]), LEAVE)).toBeNull()
    expect(followFeed({ ...PLAN, steps: [walk(1000, 2000)], rides: 0 }, at([]), LEAVE)).toBeNull()
  })
})

describe('catchable', () => {
  it('is the first plan whose first ride hasn’t gone, and that isn’t over', () => {
    const gone = planAt(LEAVE - 600)
    const next = planAt(LEAVE + 600)
    expect(catchable([gone, next], LEAVE)).toBe(next)
    expect(catchable([gone], LEAVE)).toBeUndefined()
    const walking: TripPlan = { ...PLAN, steps: [walk(900, 2000)], rides: 0, leave: 900 }
    expect(catchable([walking], LEAVE)).toBe(walking)
  })
})
