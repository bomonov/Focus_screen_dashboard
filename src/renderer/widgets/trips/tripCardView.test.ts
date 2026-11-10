import { describe, expect, it } from 'vitest'
import type {
  ClassPlace,
  HomePreview,
  Place,
  TripPlan,
  TripRide,
  TripState,
  TripStep
} from '../../../main/ipc'
import {
  arrivalWords,
  askedWhen,
  homeLine,
  canSave,
  classDetail,
  classTitle,
  homeRow,
  keepCommand,
  noTripWords,
  otherLabel,
  otherLegs,
  otherWords,
  placeLine,
  planKey,
  planLeave,
  rideDetail,
  rideStatus,
  routeLineColor,
  shownIndex,
  startView,
  stepRows,
  walkFromNow
} from './tripCardView'
import { contrast } from '../../theme/color'
import type { ClockWords } from './tripView'

/** Monday, November 2, 2026, local time; unix seconds. */
const at = (hour: number, minute: number, second = 0, day = 2): number =>
  new Date(2026, 10, day, hour, minute, second).getTime() / 1000

/** "4:41" and "Tue": a fixed 12-hour clock, so the tests don't hang on this Mac's region. */
const clock: ClockWords = {
  time: (unix) => {
    const date = new Date(unix * 1000)
    return `${date.getHours() % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')}`
  },
  day: (unix) =>
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(unix * 1000).getDay()] ?? ''
}

const HOME: Place = { id: 'home', kind: 'home', name: 'Home', detail: '', lat: 33.41, lon: -111.91 }
const TRADER_JOES: Place = {
  id: 'apple:tj',
  kind: 'apple',
  name: 'Trader Joe’s',
  detail: 'S McClintock Dr',
  lat: 33.39,
  lon: -111.91
}
const CLASS: ClassPlace = {
  id: 'class:byeng',
  kind: 'class',
  name: 'Brickyard Engineering',
  detail: 'BYENG 210',
  lat: 33.42,
  lon: -111.93,
  title: 'CSE 240',
  start: at(16, 30)
}

function walk(start: number, end: number, toName: string | null): TripStep {
  return { kind: 'walk', start, end, minutes: Math.ceil((end - start) / 60), toName }
}

function ride(fields: Partial<TripRide> & Pick<TripRide, 'depart' | 'arrive'>): TripRide {
  return {
    kind: 'ride',
    routeName: 'Orbit Venus',
    short: 'VENU',
    color: '591769',
    textColor: 'FFFFFF',
    rail: false,
    headsign: 'Venus Forward',
    tripId: 'venus-1',
    fromName: 'Rural Rd & Terrace Rd',
    fromStopId: 'rural-terrace',
    toName: 'Apache Blvd & McClintock Dr',
    toStopId: 'apache-mcclintock',
    stops: 8,
    live: true,
    delayMin: 1,
    ...fields
  }
}

/** Mockup B: walk 4:18, the Orbit 4:23, off 4:38, home 4:41. */
const VENUS: TripPlan = {
  leave: at(16, 18),
  arrive: at(16, 41),
  steps: [
    walk(at(16, 18), at(16, 23), 'Rural Rd & Terrace Rd'),
    ride({ depart: at(16, 23), arrive: at(16, 38) }),
    walk(at(16, 38), at(16, 41), null)
  ],
  rides: 1,
  walkM: 600
}

const RAIL = ride({
  routeName: 'A Line',
  short: 'A',
  color: 'E37222',
  textColor: 'FFFFFF',
  rail: true,
  headsign: 'Gilbert Rd/Main St',
  tripId: 'a-7',
  fromName: 'Veterans Way/College Ave',
  fromStopId: 'rail-veterans',
  toName: 'Dorsey Ln/Apache Blvd',
  toStopId: 'rail-dorsey',
  stops: 2,
  live: false,
  delayMin: null,
  depart: at(16, 27),
  arrive: at(16, 32)
})

/** Two rides: the light rail, a walk across to the Orbit, then home. */
const CHANGE: TripPlan = {
  leave: at(16, 20),
  arrive: at(16, 52),
  steps: [
    walk(at(16, 20), at(16, 27), 'Veterans Way/College Ave'),
    RAIL,
    walk(at(16, 32), at(16, 34), 'Apache Blvd & Dorsey Ln'),
    ride({
      tripId: 'venus-2',
      fromName: 'Apache Blvd & Dorsey Ln',
      fromStopId: 'apache-dorsey',
      stops: 1,
      depart: at(16, 36),
      arrive: at(16, 40),
      delayMin: null
    }),
    walk(at(16, 40), at(16, 52), null)
  ],
  rides: 2,
  walkM: 1500
}

const WALK_ONLY: TripPlan = {
  leave: at(16, 18),
  arrive: at(16, 30),
  steps: [walk(at(16, 18), at(16, 30), null)],
  rides: 0,
  walkM: 700
}

describe('planLeave', () => {
  it('counts whole minutes to leaving in the accent', () => {
    expect(planLeave(VENUS, at(16, 11, 30), clock)).toEqual({
      words: 'Leave in 6 min',
      due: false,
      stale: false
    })
    expect(planLeave(VENUS, at(16, 17), clock).words).toBe('Leave in 1 min')
  })

  it('says "Leave now" for the last minute before leaving', () => {
    expect(planLeave(VENUS, at(16, 17, 30), clock)).toEqual({
      words: 'Leave now',
      due: true,
      stale: false
    })
    expect(planLeave(VENUS, at(16, 18), clock).words).toBe('Leave now')
  })

  it('never says "Leave now" once the time to leave has gone: main replaces it', () => {
    expect(planLeave(VENUS, at(16, 18, 1), clock)).toEqual({
      words: 'Leave at 4:18',
      due: false,
      stale: true
    })
  })

  it('gives hours past an hour, and the time from three hours off', () => {
    const later = (hours: number, minutes = 0): TripPlan => ({
      ...VENUS,
      leave: VENUS.leave + hours * 3600 + minutes * 60
    })
    expect(planLeave(later(1, 2), at(16, 18), clock).words).toBe('Leave in 1 h 2 min')
    expect(planLeave(later(2), at(16, 18), clock).words).toBe('Leave in 2 h')
    expect(planLeave(later(3), at(16, 18), clock).words).toBe('Leave at 7:18')
    expect(planLeave(later(16), at(16, 18), clock).words).toBe('Leave at Tue 8:18')
  })
})

describe('arrivalWords and otherWords', () => {
  it('names where it gets to, when, and how long the trip takes', () => {
    expect(arrivalWords(HOME, VENUS, at(16, 11), clock)).toBe('Home 4:41 · 23 min')
    expect(arrivalWords(TRADER_JOES, CHANGE, at(16, 11), clock)).toBe('Trader Joe’s 4:52 · 32 min')
  })

  it('counts a long trip in hours, and says the day only where leaving doesn’t', () => {
    const long = { ...VENUS, leave: at(8, 0, 0, 3), arrive: at(9, 5, 0, 3) }
    // "Leave at Tue 8:00" beside it already says which day.
    expect(arrivalWords(HOME, long, at(16, 11), clock)).toBe('Home 9:05 · 1 h 5 min')
    expect(otherWords(HOME, long, at(16, 11), clock)).toBe('leave at Tue 8:00 · home 9:05')
    const overnight = { ...VENUS, leave: at(23, 50), arrive: at(0, 20, 0, 3) }
    expect(arrivalWords(HOME, overnight, at(23, 30), clock)).toBe('Home Tue 12:20 · 30 min')
  })

  it('puts an other way on one line, "leave in 11 · home 4:52"', () => {
    const other = { ...CHANGE, leave: at(16, 22) }
    expect(otherWords(HOME, other, at(16, 11), clock)).toBe('leave in 11 · home 4:52')
    expect(otherWords(TRADER_JOES, other, at(16, 21, 30), clock)).toBe(
      'leave now · Trader Joe’s 4:52'
    )
    expect(otherWords(HOME, { ...other, leave: at(17, 33) }, at(16, 11), clock)).toBe(
      'leave in 1 h 22 · home 4:52'
    )
    expect(otherWords(HOME, other, at(16, 23), clock)).toBe('leave at 4:22 · home 4:52')
  })

  it('reads an other way out whole for a screen reader', () => {
    expect(otherLabel(HOME, CHANGE, at(16, 11), clock)).toBe(
      'A Line, then Orbit Venus. Leave in 9 min, home 4:52'
    )
    expect(otherLabel(HOME, WALK_ONLY, at(16, 11), clock)).toBe(
      'Walk 12 min. Leave in 7 min, home 4:30'
    )
  })
})

describe('rideStatus', () => {
  it('says live with how late or early, and scheduled otherwise', () => {
    expect(rideStatus(ride({ depart: 0, arrive: 0, delayMin: null }))).toEqual({
      words: 'live',
      live: true
    })
    expect(rideStatus(ride({ depart: 0, arrive: 0, delayMin: 1 })).words).toBe('live, 1 min late')
    expect(rideStatus(ride({ depart: 0, arrive: 0, delayMin: -2 })).words).toBe('live, 2 min early')
    expect(rideStatus(RAIL)).toEqual({ words: 'scheduled', live: false })
  })

  it('never calls a ride the feed doesn’t have live, whatever its delay says', () => {
    expect(rideStatus(ride({ depart: 0, arrive: 0, live: false, delayMin: 3 }))).toEqual({
      words: 'scheduled',
      live: false
    })
  })
})

describe('routeLineColor', () => {
  it('keeps a route’s colour for its line where it already shows, 3:1 on the card', () => {
    expect(routeLineColor('E37222', '#191919')).toBe('#E37222')
  })

  it('lifts a dark route’s line until it shows, keeping its hue', () => {
    for (const card of ['#191919', '#8C1D40', '#0D0D0D']) {
      const line = routeLineColor('591769', card) ?? ''
      expect(contrast(line, card), card).toBeGreaterThanOrEqual(3)
    }
    const onDay = routeLineColor('FFE680', '#FFFFFF') ?? ''
    expect(contrast(onDay, '#FFFFFF')).toBeGreaterThanOrEqual(3)
  })

  it('has none for no colour or junk, so the theme’s grey is used', () => {
    expect(routeLineColor('', '#191919')).toBeNull()
    expect(routeLineColor('purple', '#191919')).toBeNull()
  })
})

describe('rideDetail', () => {
  it('says which way and how many stops', () => {
    expect(rideDetail(ride({ depart: 0, arrive: 0 }), true)).toBe('toward Venus Forward · 8 stops')
    expect(rideDetail(ride({ depart: 0, arrive: 0, stops: 1, headsign: '' }), true)).toBe('1 stop')
  })

  it('names the stop to get on at when no step before it does', () => {
    expect(rideDetail(ride({ depart: 0, arrive: 0 }), false)).toBe(
      'at Rural Rd & Terrace Rd · toward Venus Forward · 8 stops'
    )
  })
})

describe('stepRows', () => {
  it('spells out mockup B: walk, ride, get off with the last walk, there', () => {
    const rows = stepRows(VENUS, 'Home')
    expect(rows.map((row) => [row.kind, row.at, row.title, row.detail])).toEqual([
      ['walk', at(16, 18), 'Walk 5 min', 'to Rural Rd & Terrace Rd'],
      ['ride', at(16, 23), 'Orbit Venus', 'toward Venus Forward · 8 stops'],
      ['alight', at(16, 38), 'Get off at Apache Blvd & McClintock Dr', 'walk 3 min'],
      ['end', at(16, 41), 'Home', '']
    ])
  })

  it('draws a walk dotted and a ride in its route’s line', () => {
    const rows = stepRows(VENUS, 'Home')
    expect(rows.map((row) => [row.above, row.below])).toEqual([
      [null, 'walk'],
      ['walk', 'route'],
      ['route', 'walk'],
      ['walk', null]
    ])
    expect(rows[1]?.ride?.tripId).toBe('venus-1')
    expect(rows[2]?.ride?.tripId).toBe('venus-1')
  })

  it('gives a change its own walk, between getting off and the next ride', () => {
    const rows = stepRows(CHANGE, 'Home')
    expect(rows.map((row) => [row.kind, row.title, row.detail])).toEqual([
      ['walk', 'Walk 7 min', 'to Veterans Way/College Ave'],
      ['ride', 'A Line', 'toward Gilbert Rd/Main St · 2 stops'],
      ['alight', 'Get off at Dorsey Ln/Apache Blvd', ''],
      ['walk', 'Walk 2 min', 'to Apache Blvd & Dorsey Ln'],
      ['ride', 'Orbit Venus', 'toward Venus Forward · 1 stop'],
      ['alight', 'Get off at Apache Blvd & McClintock Dr', 'walk 12 min'],
      ['end', 'Home', '']
    ])
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })

  it('names the stop when a change is at the same stop', () => {
    const same: TripPlan = {
      ...CHANGE,
      steps: [
        walk(at(16, 20), at(16, 27), 'Veterans Way/College Ave'),
        { ...RAIL, toName: 'Apache Blvd & Dorsey Ln' },
        ride({
          tripId: 'venus-2',
          fromName: 'Apache Blvd & Dorsey Ln',
          depart: at(16, 36),
          arrive: at(16, 40)
        }),
        walk(at(16, 40), at(16, 52), null)
      ]
    }
    const rows = stepRows(same, 'Home')
    expect(rows.map((row) => row.detail)).toEqual([
      'to Veterans Way/College Ave',
      'toward Gilbert Rd/Main St · 2 stops',
      '',
      'toward Venus Forward · 8 stops',
      'walk 12 min',
      ''
    ])
  })

  it('reads a walk-only trip as "Walk 12 min" and the place', () => {
    const rows = stepRows(WALK_ONLY, 'Home')
    expect(rows.map((row) => [row.kind, row.at, row.title, row.above, row.below])).toEqual([
      ['walk', at(16, 18), 'Walk 12 min', null, 'walk'],
      ['end', at(16, 30), 'Home', 'walk', null]
    ])
  })

  it('names the stop to get on at for a ride nothing walks to', () => {
    const atTheStop: TripPlan = { ...VENUS, steps: VENUS.steps.slice(1) }
    const rows = stepRows(atTheStop, 'Home')
    expect(rows[0]?.detail).toBe('at Rural Rd & Terrace Rd · toward Venus Forward · 8 stops')
  })
})

describe('walkFromNow', () => {
  it('starts a walk-only trip now once the moment it was planned has gone: a walk can start any time', () => {
    const now = at(16, 20, 30)
    const moved = walkFromNow(WALK_ONLY, now)
    const late = now - WALK_ONLY.leave
    expect(moved.leave).toBe(now)
    expect(moved.arrive).toBe(WALK_ONLY.arrive + late)
    expect(moved.steps).toEqual([walk(now, WALK_ONLY.arrive + late, null)])
    expect(planLeave(moved, now, clock).words).toBe('Leave now')
    expect(arrivalWords(HOME, moved, now, clock)).toBe('Home 4:32 · 12 min')
  })

  it('leaves a walk timed to arrive by a time as it is', () => {
    const by = { kind: 'arrive' as const, time: WALK_ONLY.arrive }
    expect(walkFromNow(WALK_ONLY, at(16, 20, 30), by)).toBe(WALK_ONLY)
    expect(walkFromNow(WALK_ONLY, at(16, 20, 30), { kind: 'now' }).leave).toBe(at(16, 20, 30))
  })

  it('leaves a walk still to start, and any trip with a ride, as they are', () => {
    expect(walkFromNow(WALK_ONLY, at(16, 10))).toBe(WALK_ONLY)
    expect(walkFromNow(VENUS, at(16, 30))).toBe(VENUS)
  })
})

describe('askedWhen', () => {
  const CLASS_WHEN = { kind: 'arrive' as const, time: at(16, 25) }
  const state = { to: CLASS as Place, when: CLASS_WHEN }

  it('re-plans the trip shown with main’s when: a class keeps arriving early', () => {
    expect(askedWhen(state, CLASS, true, { kind: 'now' })).toEqual(CLASS_WHEN)
  })

  it('uses the user’s own when while browsing, or before main has the place', () => {
    expect(askedWhen(state, CLASS, false, { kind: 'now' })).toEqual({ kind: 'now' })
    expect(askedWhen(state, HOME, true, { kind: 'now' })).toEqual({ kind: 'now' })
    expect(askedWhen({ to: null, when: CLASS_WHEN }, CLASS, true, { kind: 'now' })).toEqual({
      kind: 'now'
    })
    expect(askedWhen(state, null, true, { kind: 'now' })).toEqual({ kind: 'now' })
  })
})

describe('homeLine', () => {
  const preview = (leave: number, first = 'Orbit Venus'): HomePreview => ({
    leave,
    arrive: leave + 1380,
    first
  })

  it('says when to leave for Home and on what', () => {
    expect(homeLine(preview(at(16, 18)), at(16, 11, 30), clock)).toBe(
      'Leave in 6 min · Orbit Venus'
    )
    expect(homeLine(preview(at(16, 18), '72'), at(16, 17, 30), clock)).toBe('Leave now · 72')
    expect(homeLine(preview(at(17, 30)), at(16, 11), clock)).toBe(
      'Leave in 1 h 19 min · Orbit Venus'
    )
  })

  it('says how long a walk home is, whenever it starts', () => {
    expect(
      homeLine({ leave: at(16, 0), arrive: at(16, 12), first: 'walk' }, at(16, 5), clock)
    ).toBe('Walk 12 min')
  })

  it('says nothing once its time to leave has gone, or with nothing planned', () => {
    expect(homeLine(preview(at(16, 18)), at(16, 18, 1), clock)).toBe('')
    expect(homeLine(null, at(16, 0), clock)).toBe('')
  })
})

describe('otherLegs', () => {
  it('gives the first walk’s minutes and the rides', () => {
    const legs = otherLegs(CHANGE)
    expect(legs.walkMin).toBe(7)
    expect(legs.rides.map((step) => step.tripId)).toEqual(['a-7', 'venus-2'])
  })

  it('has no walk for a trip that starts at the stop, and no rides for a walk', () => {
    expect(otherLegs({ ...VENUS, steps: VENUS.steps.slice(1) }).walkMin).toBeNull()
    expect(otherLegs(WALK_ONLY)).toEqual({ walkMin: 12, rides: [] })
  })
})

describe('planKey and shownIndex', () => {
  it('keys a plan by its rides, so a live re-plan keeps the one being shown', () => {
    expect(planKey(VENUS)).toBe('venus-1@rural-terrace>apache-mcclintock')
    expect(planKey(CHANGE)).toBe(
      'a-7@rail-veterans>rail-dorsey|venus-2@apache-dorsey>apache-mcclintock'
    )
    expect(planKey(WALK_ONLY)).toBe('walk')
  })

  it('finds the shown plan again, or falls back to the best', () => {
    const plans = [VENUS, CHANGE, WALK_ONLY]
    expect(shownIndex(plans, null)).toBe(0)
    expect(shownIndex(plans, planKey(CHANGE))).toBe(1)
    expect(shownIndex([{ ...CHANGE, leave: at(16, 21) }, VENUS], planKey(CHANGE))).toBe(0)
    expect(shownIndex([VENUS], 'gone')).toBe(0)
    expect(shownIndex([], planKey(CHANGE))).toBe(-1)
  })
})

describe('keepCommand', () => {
  it('names the plan by its place, its time to leave and its first bus, as main has it', () => {
    expect(keepCommand([WALK_ONLY, VENUS], 1)).toEqual({
      kind: 'keep',
      index: 1,
      leave: VENUS.leave,
      tripId: 'venus-1'
    })
    expect(keepCommand([WALK_ONLY], 0)).toEqual({
      kind: 'keep',
      index: 0,
      leave: WALK_ONLY.leave,
      tripId: null
    })
    expect(keepCommand([VENUS], 1)).toBeNull()
    expect(keepCommand(null, 0)).toBeNull()
  })
})

describe('noTripWords', () => {
  const now = at(23, 50)

  it('says nothing gets there in the next hour, and when service starts', () => {
    expect(
      noTripWords({ walkSec: null, serviceStarts: null }, { kind: 'now' }, now, clock)
    ).toEqual({ lead: 'No bus or train gets there in the next hour', detail: null })
    expect(
      noTripWords({ walkSec: null, serviceStarts: at(5, 12, 0, 3) }, { kind: 'now' }, now, clock)
    ).toEqual({
      lead: 'No bus or train gets there in the next hour',
      detail: 'Service starts tomorrow at 5:12'
    })
    expect(
      noTripWords(
        { walkSec: null, serviceStarts: at(5, 12, 0, 3) },
        { kind: 'now' },
        at(1, 30, 0, 3),
        clock
      ).detail
    ).toBe('Service starts at 5:12')
    expect(
      noTripWords({ walkSec: null, serviceStarts: at(5, 12, 0, 5) }, { kind: 'now' }, now, clock)
        .detail
    ).toBe('Service starts Thu at 5:12')
  })

  it('never leans on walkSec: a walk that’s short enough comes as a plan', () => {
    expect(noTripWords({ walkSec: 600, serviceStarts: null }, { kind: 'now' }, now, clock)).toEqual(
      { lead: 'No bus or train gets there in the next hour', detail: null }
    )
  })

  it('speaks of the time asked for', () => {
    const by = { kind: 'arrive' as const, time: at(9, 0, 0, 3) }
    expect(noTripWords(null, by, now, clock).lead).toBe(
      'No bus or train gets there by tomorrow 9:00'
    )
    const from = { kind: 'depart' as const, time: at(23, 55) }
    expect(noTripWords(null, from, now, clock).lead).toBe(
      'No bus or train gets there in the hour after 11:55'
    )
  })
})

describe('the rows’ words', () => {
  it('gives each kind of place its second line', () => {
    expect(placeLine(HOME)).toBe('')
    expect(placeLine({ ...TRADER_JOES, kind: 'saved', name: 'Alex’s', detail: 'Mesa' })).toBe(
      'Saved · Mesa'
    )
    expect(placeLine({ ...TRADER_JOES, kind: 'saved', detail: '' })).toBe('Saved')
    expect(placeLine({ ...TRADER_JOES, kind: 'recent' })).toBe('Recent · S McClintock Dr')
    expect(placeLine({ ...TRADER_JOES, kind: 'building', detail: 'COOR' })).toBe('COOR')
    expect(placeLine({ ...TRADER_JOES, kind: 'stop', detail: '' })).toBe('Stop')
    expect(placeLine(TRADER_JOES)).toBe('S McClintock Dr')
    expect(placeLine(CLASS)).toBe('Brickyard Engineering · BYENG 210')
  })

  it('names the next class, its time and its building', () => {
    expect(classTitle(CLASS, at(15, 0), clock)).toBe('CSE 240 · 4:30')
    expect(classTitle({ ...CLASS, start: at(9, 0, 0, 3) }, at(15, 0), clock)).toBe(
      'CSE 240 · tomorrow 9:00'
    )
    expect(classTitle({ ...CLASS, start: at(9, 0, 0, 5) }, at(15, 0), clock)).toBe(
      'CSE 240 · Thu 9:00'
    )
    expect(classDetail(CLASS)).toBe('Brickyard Engineering · BYENG 210')
    expect(classDetail({ ...CLASS, detail: '' })).toBe('Brickyard Engineering')
  })

  it('lets found places be saved, not Home, saved ones or the class', () => {
    expect(canSave(TRADER_JOES)).toBe(true)
    expect(canSave({ ...TRADER_JOES, kind: 'building' })).toBe(true)
    expect(canSave({ ...TRADER_JOES, kind: 'stop' })).toBe(true)
    expect(canSave({ ...TRADER_JOES, kind: 'recent' })).toBe(true)
    expect(canSave(HOME)).toBe(false)
    expect(canSave({ ...TRADER_JOES, kind: 'saved' })).toBe(false)
    expect(canSave(CLASS)).toBe(false)
  })
})

type Here = TripState['here']
const here = (status: NonNullable<Here>['status'], name: string | null = null): Here => ({
  status,
  name
})

describe('startView', () => {
  it('says where the Mac is', () => {
    expect(startView({ kind: 'here' }, here('found', 'Sun Devil Fitness Complex'), true)).toEqual({
      label: 'From where you are',
      detail: 'Sun Devil Fitness Complex',
      pick: false,
      locationOff: false
    })
    expect(startView({ kind: 'here' }, here('found'), true).detail).toBeNull()
    expect(startView({ kind: 'here' }, here('locating'), true).detail).toBe(
      'Finding where you are…'
    )
    expect(startView({ kind: 'here' }, null, true).detail).toBe('Finding where you are…')
  })

  it('asks for a start when Location is off or refused, and says so', () => {
    for (const status of ['denied', 'servicesOff'] as const) {
      expect(startView({ kind: 'here' }, here(status), true)).toEqual({
        label: 'Pick a start',
        detail: null,
        pick: true,
        locationOff: true
      })
    }
  })

  it('asks for a start when no fix came, rather than waiting', () => {
    expect(startView({ kind: 'here' }, here('failed'), true)).toEqual({
      label: 'Pick a start',
      detail: 'Couldn’t find where you are',
      pick: true,
      locationOff: false
    })
  })

  it('asks for a start where there’s no Location at all', () => {
    expect(startView({ kind: 'here' }, null, false)).toEqual({
      label: 'Pick a start',
      detail: null,
      pick: true,
      locationOff: false
    })
  })

  it('names a picked start', () => {
    expect(startView({ kind: 'place', place: HOME }, here('denied'), true)).toEqual({
      label: 'From Home',
      detail: null,
      pick: false,
      locationOff: false
    })
    expect(startView({ kind: 'place', place: TRADER_JOES }, null, false).label).toBe(
      'From Trader Joe’s'
    )
  })
})

describe('homeRow', () => {
  const base = { home: null, supported: { location: true, appleSearch: true }, here: here('found') }

  it('offers Home once it’s set', () => {
    expect(homeRow({ ...base, home: HOME })).toEqual({ kind: 'home', place: HOME })
  })

  it('offers to set Home where the Mac is, when it can be known', () => {
    expect(homeRow(base)).toEqual({
      kind: 'setHome',
      disabled: false,
      detail: 'Press this while you’re at home'
    })
    expect(homeRow({ ...base, here: here('failed') })).toMatchObject({ disabled: false })
  })

  it('says why it can’t when Location is off or missing', () => {
    expect(homeRow({ ...base, here: here('denied') })).toEqual({
      kind: 'setHome',
      disabled: true,
      detail: 'Turn on Location first'
    })
    expect(homeRow({ ...base, supported: { location: false, appleSearch: false } })).toEqual({
      kind: 'setHome',
      disabled: true,
      detail: 'Needs Location, which this computer doesn’t have'
    })
  })
})
