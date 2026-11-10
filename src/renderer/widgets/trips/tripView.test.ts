import { describe, expect, it } from 'vitest'
import type { Place, TripPlan, TripRide, TripState, TripStep } from '../../../main/ipc'
import { timeFormat } from '../clockFormat'
import {
  chipColors,
  countdownMoments,
  countdownParts,
  countdownWords,
  isFindKey,
  keptLeaveWords,
  type ClockWords,
  type FindKeyPress
} from './tripView'

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
    stops: 2,
    live: true,
    delayMin: null,
    ...fields
  }
}

/** Leave 4:18, the Orbit at 4:22, home 4:41. */
const VENUS: TripPlan = {
  leave: at(16, 18),
  arrive: at(16, 41),
  steps: [
    walk(at(16, 18), at(16, 22), 'Rural Rd & Terrace Rd'),
    ride({ depart: at(16, 22), arrive: at(16, 30) }),
    walk(at(16, 30), at(16, 41), null)
  ],
  rides: 1,
  walkM: 1100
}

/** The next way after missing the Orbit: Route 72 (no colour in the schedule), leaving 4:32. */
const NEXT_72: TripPlan = {
  leave: at(16, 32),
  arrive: at(16, 55),
  steps: [
    walk(at(16, 32), at(16, 35), 'Rural Rd & University Dr'),
    ride({
      routeName: 'Route 72',
      short: '72',
      color: '',
      textColor: '',
      depart: at(16, 35),
      arrive: at(16, 44)
    }),
    walk(at(16, 44), at(16, 55), null)
  ],
  rides: 1,
  walkM: 1300
}

const WALK_ONLY: TripPlan = {
  leave: at(16, 18),
  arrive: at(16, 30),
  steps: [walk(at(16, 18), at(16, 30), null)],
  rides: 0,
  walkM: 700
}

/** Tomorrow's class, planned the evening before: leave Tue 8:32, there 9:10. */
const TOMORROW: TripPlan = {
  leave: at(8, 32, 0, 3),
  arrive: at(9, 10, 0, 3),
  steps: [
    walk(at(8, 32, 0, 3), at(8, 40, 0, 3), 'Rural Rd & Terrace Rd'),
    ride({ depart: at(8, 40, 0, 3), arrive: at(8, 50, 0, 3) }),
    walk(at(8, 50, 0, 3), at(9, 10, 0, 3), null)
  ],
  rides: 1,
  walkM: 1500
}

type Kept = NonNullable<TripState['kept']>
/** A kept trip; a missed one has its next way in `plan` unless `nextWay` says otherwise. */
const kept = (plan: TripPlan, to: Place = HOME, missed = false, nextWay = missed): Kept => ({
  to,
  plan,
  missed,
  nextWay
})

describe('keptLeaveWords', () => {
  it('counts whole minutes down to leaving, never rounding up early', () => {
    expect(keptLeaveWords(VENUS, at(16, 11, 30))).toBe('Leave in 6 min')
    expect(keptLeaveWords(VENUS, at(16, 12, 1))).toBe('Leave in 5 min')
    expect(keptLeaveWords(VENUS, at(16, 17))).toBe('Leave in 1 min')
  })

  it('says "Leave now" for the last minute and until the first ride goes', () => {
    expect(keptLeaveWords(VENUS, at(16, 17, 30))).toBe('Leave now')
    expect(keptLeaveWords(VENUS, at(16, 20))).toBe('Leave now')
  })

  it('gives hours and minutes past an hour, then the time once that says enough', () => {
    const later = { ...VENUS, leave: at(16, 18) + 3600 * 2, arrive: at(16, 41) + 3600 * 2 }
    expect(keptLeaveWords(later, at(16, 58), clock)).toBe('Leave in 1 h 20 min')
    expect(keptLeaveWords(later, at(17, 18), clock)).toBe('Leave in 1 h')
    expect(keptLeaveWords(later, at(15, 18), clock)).toBe('Leave at 6:18')
  })

  it('names the day when leaving isn’t today', () => {
    expect(keptLeaveWords(TOMORROW, at(19, 0), clock)).toBe('Leave at Tue 8:32')
  })
})

describe('countdownParts', () => {
  it('is the lead, the first ride’s chip and where it gets to when', () => {
    expect(countdownParts(kept(VENUS), at(16, 11, 30), clock)).toEqual({
      lead: 'Leave in 6 min',
      chip: { text: 'Orbit Venus', color: '#591769', textColor: '#FFFFFF' },
      tail: 'home 4:41',
      due: false
    })
  })

  it('turns due at "Leave now", 30 s before leaving', () => {
    const parts = countdownParts(kept(VENUS), at(16, 17, 30), clock)
    expect(parts?.lead).toBe('Leave now')
    expect(parts?.due).toBe(true)
    expect(parts?.tail).toBe('home 4:41')
  })

  it('names other places by their own name', () => {
    const plan = { ...VENUS, arrive: at(16, 52) }
    expect(countdownParts(kept(plan, TRADER_JOES), at(16, 11), clock)?.tail).toBe(
      'Trader Joe’s 4:52'
    )
  })

  it('names the day when the arrival isn’t today', () => {
    expect(countdownParts(kept(TOMORROW), at(19, 0), clock)?.tail).toBe('home Tue 9:10')
  })

  it('writes the arrival the way the top bar’s clock does', () => {
    const parts = countdownParts(kept(VENUS), at(16, 11))
    expect(parts?.tail).toBe(`home ${timeFormat.format(at(16, 41) * 1000)}`)
  })

  it('offers the next way once main has found it', () => {
    expect(countdownParts(kept(NEXT_72, HOME, true, true), at(16, 22, 30), clock)).toEqual({
      lead: 'Missed it',
      chip: { text: '72', color: 'var(--border)', textColor: 'var(--text)' },
      tail: 'next: leave in 9 min',
      due: false
    })
  })

  it('is due again when the next way’s time to leave comes', () => {
    const parts = countdownParts(kept(NEXT_72, HOME, true, true), at(16, 31, 30), clock)
    expect(parts?.tail).toBe('next: leave now')
    expect(parts?.due).toBe(true)
  })

  it('says only "Missed it" while there’s no next way to offer', () => {
    const alone = { lead: 'Missed it', chip: null, tail: '', due: false }
    // Its bus was canceled before it was due, and nothing else gets there (or main is still
    // looking): the plan is still that bus's, so there's nothing to count down to.
    expect(countdownParts(kept(VENUS, HOME, true, false), at(16, 15), clock)).toEqual(alone)
    expect(countdownParts(kept(VENUS, HOME, true, false), at(16, 18), clock)).toEqual(alone)
    // Its bus has gone and main hasn't marked it missed yet, or has and is still looking.
    expect(countdownParts(kept(VENUS, HOME, false), at(16, 23), clock)).toEqual(alone)
    expect(countdownParts(kept(VENUS, HOME, true, false), at(16, 23), clock)).toEqual(alone)
  })

  it('is gone once the trip has arrived, or when nothing is kept', () => {
    expect(countdownParts(kept(VENUS), at(16, 41), clock)).toBeNull()
    expect(countdownParts(kept(NEXT_72, HOME, true), at(16, 55), clock)).toBeNull()
    expect(countdownParts(null, at(16, 11), clock)).toBeNull()
  })

  it('has no chip for a trip that’s a walk, and is due through the walk', () => {
    expect(countdownParts(kept(WALK_ONLY), at(16, 11, 30), clock)).toEqual({
      lead: 'Leave in 6 min',
      chip: null,
      tail: 'home 4:30',
      due: false
    })
    expect(countdownParts(kept(WALK_ONLY), at(16, 25), clock)?.due).toBe(true)
  })

  it('names numbered routes by their number and others by their name', () => {
    const rail = ride({
      routeName: 'Valley Metro Rail',
      short: 'A',
      color: 'E37222',
      textColor: '000000',
      depart: at(16, 22),
      arrive: at(16, 30)
    })
    const numbered = ride({
      routeName: 'Route 7s',
      short: '7s',
      depart: at(16, 22),
      arrive: at(16, 30)
    })
    const chipOf = (first: TripRide): string | undefined =>
      countdownParts(kept({ ...VENUS, steps: [first] }), at(16, 11), clock)?.chip?.text
    expect(chipOf(rail)).toBe('Valley Metro Rail')
    expect(chipOf(numbered)).toBe('7s')
  })
})

describe('countdownWords', () => {
  const words = (trip: Kept, now: number): string[] => {
    const parts = countdownParts(trip, now, clock)
    return parts ? countdownWords(trip, parts) : []
  }

  it('reads in the order it shows, the arrival naming where it goes', () => {
    expect(words(kept(VENUS), at(16, 11, 30))).toEqual([
      'Leave in 6 min',
      'Orbit Venus',
      'home 4:41'
    ])
  })

  it('puts a missed trip’s next way before its bus, and says where to', () => {
    expect(words(kept(NEXT_72, HOME, true), at(16, 22, 30))).toEqual([
      'Missed it',
      'next: leave in 9 min',
      '72',
      'to home'
    ])
    expect(words(kept(VENUS, TRADER_JOES, true, false), at(16, 15))).toEqual([
      'Missed it',
      'to Trader Joe’s'
    ])
  })
})

describe('countdownMoments', () => {
  it('is when the words change: leaving, the first ride going, arriving', () => {
    expect(countdownMoments(kept(VENUS))).toEqual([at(16, 18), at(16, 22), at(16, 41)])
    expect(countdownMoments(kept(WALK_ONLY))).toEqual([at(16, 18), at(16, 30)])
    expect(countdownMoments(null)).toEqual([])
  })
})

describe('chipColors', () => {
  it('uses the route’s own colours, with "#"', () => {
    expect(chipColors('591769', 'FFFFFF')).toEqual({ bg: '#591769', fg: '#FFFFFF' })
  })

  it('falls back to the theme’s raised surface and text when the schedule has no colour', () => {
    const theme = { bg: 'var(--border)', fg: 'var(--text)' }
    expect(chipColors('', '')).toEqual(theme)
    expect(chipColors('', 'FFFFFF')).toEqual(theme)
    // Junk from the schedule is as good as none.
    expect(chipColors('purple', 'FFFFFF')).toEqual(theme)
  })

  it('picks black or white words when the schedule gives none, or ones that don’t read', () => {
    expect(chipColors('591769', '')).toEqual({ bg: '#591769', fg: '#FFFFFF' })
    expect(chipColors('FFC627', '')).toEqual({ bg: '#FFC627', fg: '#000000' })
    // White on gold is 1.6:1.
    expect(chipColors('FFC627', 'FFFFFF')).toEqual({ bg: '#FFC627', fg: '#000000' })
  })
})

describe('isFindKey', () => {
  const press = (fields: Partial<FindKeyPress>): FindKeyPress => ({
    key: 'f',
    code: 'KeyF',
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    ...fields
  })

  it('is ⌘F, or Ctrl+F where there’s no ⌘', () => {
    expect(isFindKey(press({ metaKey: true }))).toBe(true)
    expect(isFindKey(press({ ctrlKey: true }))).toBe(true)
    expect(isFindKey(press({ key: 'F', metaKey: true }))).toBe(true)
    expect(isFindKey(press({ metaKey: true, target: { tagName: 'BUTTON' } }))).toBe(true)
  })

  it('is the F key on a layout without Latin letters, not another letter on F’s key', () => {
    expect(isFindKey(press({ key: 'а', metaKey: true }))).toBe(true)
    // Dvorak's U sits where QWERTY's F is: that's ⌘U.
    expect(isFindKey(press({ key: 'u', metaKey: true }))).toBe(false)
    expect(isFindKey(press({ key: 'f', code: 'KeyY', metaKey: true }))).toBe(true)
  })

  it('isn’t a plain F, another shortcut, or one held down', () => {
    expect(isFindKey(press({}))).toBe(false)
    expect(isFindKey(press({ metaKey: true, shiftKey: true }))).toBe(false)
    expect(isFindKey(press({ metaKey: true, altKey: true }))).toBe(false)
    expect(isFindKey(press({ metaKey: true, ctrlKey: true }))).toBe(false)
    expect(isFindKey(press({ metaKey: true, repeat: true }))).toBe(false)
  })

  it('leaves the keys to a text field', () => {
    expect(isFindKey(press({ ctrlKey: true, target: { tagName: 'INPUT' } }))).toBe(false)
    expect(isFindKey(press({ metaKey: true, target: { tagName: 'INPUT' } }))).toBe(false)
    expect(isFindKey(press({ metaKey: true, target: { tagName: 'TEXTAREA' } }))).toBe(false)
    expect(isFindKey(press({ metaKey: true, target: { isContentEditable: true } }))).toBe(false)
  })
})
