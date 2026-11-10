import { describe, expect, it } from 'vitest'
import type { ClassPlace, Place, TripFrom, TripState } from '../../../main/ipc'
import {
  firstPickable,
  homeAskNext,
  nothingFound,
  readySections,
  resultSections,
  resultsWords,
  startSections,
  type HomeAsk,
  type PlaceSection
} from './placeRowsView'
import type { PlaceResults } from './placeSearch'
import type { ClockWords } from './tripView'

const at = (hour: number, minute: number, day = 2): number =>
  new Date(2026, 10, day, hour, minute).getTime() / 1000
const NOW = at(15, 0)
const IDLE: HomeAsk = { kind: 'idle' }

const clock: ClockWords = {
  time: (unix) => {
    const date = new Date(unix * 1000)
    return `${date.getHours() % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')}`
  },
  day: (unix) =>
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(unix * 1000).getDay()] ?? ''
}

const place = (kind: Place['kind'], name: string, detail = ''): Place => ({
  id: `${kind}:${name}`,
  kind,
  name,
  detail,
  lat: 33.4,
  lon: -111.9
})

const HOME: Place = { ...place('home', 'Home'), id: 'home' }
const ALEX = place('saved', 'Alex’s', 'Mesa')
const CLASS: ClassPlace = {
  ...place('class', 'Brickyard Engineering', 'BYENG 210'),
  title: 'CSE 240',
  start: at(16, 30)
}
const RECENTS = ['Trader Joe’s', 'Target', 'Chipotle', 'Tempe Library', 'Mill Ave', 'Gym'].map(
  (name) => place('recent', name, 'Tempe')
)

type Lists = Parameters<typeof readySections>[0]
/** Main's start and the card's alike: where the Mac is. */
const START: TripFrom = { kind: 'here' }
const lists = (fields: Partial<Lists> = {}): Lists => ({
  from: START,
  home: HOME,
  supported: { location: true, appleSearch: true },
  here: { status: 'found', name: 'Sun Devil Fitness Complex' },
  nextClass: CLASS,
  saved: [ALEX],
  recents: RECENTS,
  homePreview: null,
  ...fields
})

const titles = (sections: PlaceSection[]): string[] =>
  sections.flatMap((section) => section.rows.map((row) => row.title))

describe('readySections', () => {
  it('lists Home, the next class, saved places and five recent ones, in that order', () => {
    const sections = readySections(lists(), START, NOW, IDLE, clock)
    expect(titles(sections)).toEqual([
      'Home',
      'CSE 240 · 4:30',
      'Alex’s',
      'Trader Joe’s',
      'Target',
      'Chipotle',
      'Tempe Library',
      'Mill Ave'
    ])
    const rows = sections[0]?.rows ?? []
    expect(rows[1]).toMatchObject({ icon: 'class', aside: 'Next class' })
    expect(rows[2]).toMatchObject({ detail: 'Saved · Mesa', savable: undefined })
    expect(rows[3]).toMatchObject({ detail: 'Recent · Tempe', action: { kind: 'to' } })
    expect(rows[3]?.savable).toBe(RECENTS[0])
  })

  it('offers to set Home when there’s none, and says it’s waiting once pressed', () => {
    const [unset] = readySections(lists({ home: null, nextClass: null }), START, NOW, IDLE, clock)
    expect(unset?.rows[0]).toMatchObject({
      title: 'Set Home to where you are now',
      disabled: false,
      action: { kind: 'setHome' }
    })
    const [waiting] = readySections(
      lists({ home: null }),
      START,
      NOW,
      { kind: 'waiting', sawLocating: false },
      clock
    )
    expect(waiting?.rows[0]).toMatchObject({
      title: 'Setting Home…',
      detail: 'Finding where you are…',
      disabled: true
    })
  })

  it('greys setting Home, with why, when Location is off', () => {
    const [off] = readySections(
      lists({ home: null, here: { status: 'denied', name: null } }),
      START,
      NOW,
      IDLE,
      clock
    )
    expect(off?.rows[0]).toMatchObject({ disabled: true, detail: 'Turn on Location first' })
  })

  it('says when to leave for Home, and how, once main has planned it', () => {
    const preview = { leave: at(15, 6), arrive: at(15, 29), first: 'Orbit Venus' }
    const [ready] = readySections(lists({ homePreview: preview }), START, NOW, IDLE, clock)
    expect(ready?.rows[0]).toMatchObject({ title: 'Home', detail: 'Leave in 6 min · Orbit Venus' })
    const walk = { leave: NOW, arrive: at(15, 12), first: 'walk' }
    const [walking] = readySections(lists({ homePreview: walk }), START, NOW, IDLE, clock)
    expect(walking?.rows[0]?.detail).toBe('Walk 12 min')
  })

  it('says nothing of when to leave for Home while the card starts somewhere main didn’t plan from', () => {
    const preview = { leave: at(15, 6), arrive: at(15, 29), first: 'Orbit Venus' }
    const picked: TripFrom = { kind: 'place', place: ALEX }
    // A start picked on the card, not yet asked of main: its Home time is from where the Mac is.
    const [moved] = readySections(lists({ homePreview: preview }), picked, NOW, IDLE, clock)
    expect(moved?.rows[0]).toMatchObject({ title: 'Home', detail: '' })
    // Main has planned from it too: the time is that start's.
    const [both] = readySections(
      lists({ homePreview: preview, from: picked }),
      { kind: 'place', place: { ...ALEX } },
      NOW,
      IDLE,
      clock
    )
    expect(both?.rows[0]?.detail).toBe('Leave in 6 min · Orbit Venus')
  })

  it('says so when setting Home found no fix, and lets it be pressed again', () => {
    const [failed] = readySections(lists({ home: null }), START, NOW, { kind: 'failed' }, clock)
    expect(failed?.rows[0]).toMatchObject({
      title: 'Set Home to where you are now',
      detail: 'Couldn’t find where you are',
      disabled: false
    })
  })

  it('keeps every row’s key apart', () => {
    const rows = readySections(lists(), START, NOW, IDLE, clock).flatMap((section) => section.rows)
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })
})

describe('startSections', () => {
  it('offers where you are first, then Home, saved and recent places, never the class', () => {
    const sections = startSections(lists(), { kind: 'place', place: HOME }, NOW, clock)
    expect(titles(sections).slice(0, 3)).toEqual(['Where you are', 'Home', 'Alex’s'])
    expect(titles(sections)).not.toContain('CSE 240 · 4:30')
    expect(sections[0]?.rows[0]).toMatchObject({
      detail: 'Sun Devil Fitness Complex',
      action: { kind: 'from', from: { kind: 'here' } }
    })
    expect(sections[0]?.rows[1]?.action).toEqual({
      kind: 'from',
      from: { kind: 'place', place: HOME }
    })
  })

  it('leaves out where you are when it’s the start already, or can’t be had', () => {
    const here = { kind: 'here' } as const
    expect(titles(startSections(lists(), here, NOW, clock))[0]).toBe('Home')
    for (const status of ['denied', 'servicesOff'] as const) {
      const off = lists({ here: { status, name: null } })
      expect(titles(startSections(off, { kind: 'place', place: HOME }, NOW, clock))[0]).toBe('Home')
    }
    const windows = lists({ supported: { location: false, appleSearch: false }, home: null })
    expect(titles(startSections(windows, here, NOW, clock))[0]).toBe('Alex’s')
  })
})

describe('resultSections', () => {
  const found: PlaceResults = {
    text: 'tar',
    local: [place('stop', 'Rural Rd & Tarleton', 'Route 72')],
    apple: [place('apple', 'Target', 'Rural Rd & Broadway Rd, Tempe')],
    localWaiting: false,
    appleWaiting: false
  }

  it('puts the Mac’s own matches first and Apple’s under their own heading', () => {
    const sections = resultSections(found, 'tar', 'to', NOW, clock)
    expect(sections.map((section) => [section.heading, section.rows.map((r) => r.title)])).toEqual([
      [null, ['Rural Rd & Tarleton']],
      ['From Apple Maps', ['Target']]
    ])
    expect(sections[1]?.rows[0]).toMatchObject({
      detail: 'Rural Rd & Broadway Rd, Tempe',
      action: { kind: 'to', place: found.apple[0] }
    })
    expect(sections[1]?.rows[0]?.savable).toBe(found.apple[0])
  })

  it('has no Apple heading when Apple found nothing', () => {
    const sections = resultSections({ ...found, apple: [] }, 'tar', 'to', NOW, clock)
    expect(sections.map((section) => section.heading)).toEqual([null])
  })

  it('shows nothing from an answer for other words', () => {
    expect(resultSections(found, 'targ', 'to', NOW, clock)).toEqual([])
  })

  it('starts a trip from a match when the start is being picked', () => {
    const [local] = resultSections(found, 'tar', 'from', NOW, clock)
    expect(local?.rows[0]?.action).toEqual({
      kind: 'from',
      from: { kind: 'place', place: found.local[0] }
    })
  })

  it('keys the same place apart in the two lists', () => {
    const twice = { ...found, local: [{ ...found.apple[0], kind: 'recent' } as Place] }
    const keys = resultSections(twice, 'tar', 'to', NOW, clock).flatMap((s) =>
      s.rows.map((r) => r.key)
    )
    expect(new Set(keys).size).toBe(2)
  })
})

describe('firstPickable', () => {
  it('skips a greyed row: Enter never picks what can’t be', () => {
    const sections = readySections(
      lists({ home: null, here: { status: 'denied', name: null } } as Partial<TripState>),
      START,
      NOW,
      IDLE,
      clock
    )
    expect(firstPickable(sections)?.title).toBe('CSE 240 · 4:30')
    expect(firstPickable([])).toBeNull()
  })
})

describe('homeAskNext', () => {
  const waiting = (sawLocating: boolean): HomeAsk => ({ kind: 'waiting', sawLocating })
  const here = (status: NonNullable<TripState['here']>['status']): TripState['here'] => ({
    status,
    name: null
  })
  const HOME_SET = place('home', 'Home')

  it('is done once Home comes', () => {
    expect(homeAskNext(waiting(true), here('found'), HOME_SET)).toEqual(IDLE)
    expect(homeAskNext({ kind: 'failed' }, here('found'), HOME_SET)).toEqual(IDLE)
  })

  it('fails once the fix it waited for doesn’t come', () => {
    expect(homeAskNext(waiting(false), here('locating'), null)).toEqual(waiting(true))
    expect(homeAskNext(waiting(true), here('failed'), null)).toEqual({ kind: 'failed' })
  })

  it('doesn’t take a failure from before it was pressed as its own', () => {
    expect(homeAskNext(waiting(false), here('failed'), null)).toEqual(waiting(false))
  })

  it('stops waiting when Location is refused or off: the row says why', () => {
    expect(homeAskNext(waiting(true), here('denied'), null)).toEqual(IDLE)
    expect(homeAskNext(waiting(true), here('servicesOff'), null)).toEqual(IDLE)
  })

  it('stays as it is otherwise', () => {
    expect(homeAskNext(IDLE, here('failed'), null)).toEqual(IDLE)
    expect(homeAskNext({ kind: 'failed' }, here('locating'), null)).toEqual({ kind: 'failed' })
    expect(homeAskNext(waiting(true), here('locating'), null)).toEqual(waiting(true))
  })
})

describe('nothingFound and resultsWords', () => {
  const results = (fields: Partial<PlaceResults> = {}): PlaceResults => ({
    text: 'zz',
    local: [],
    apple: [],
    localWaiting: false,
    appleWaiting: false,
    ...fields
  })

  it('says nothing’s found only once the Mac and Apple have both answered', () => {
    expect(nothingFound(results(), 'zz')).toBe(true)
    expect(nothingFound(results({ appleWaiting: true }), 'zz')).toBe(false)
    expect(nothingFound(results({ localWaiting: true }), 'zz')).toBe(false)
    expect(nothingFound(results({ local: [ALEX] }), 'zz')).toBe(false)
    expect(nothingFound(results(), '')).toBe(false)
  })

  it('counts what’s listed for a screen reader, once the Mac’s answer is in', () => {
    expect(resultsWords(results({ local: [ALEX] }), 'zz')).toBe('1 place')
    expect(resultsWords(results({ local: [ALEX, HOME], apple: [ALEX] }), 'zz')).toBe('3 places')
    expect(resultsWords(results(), 'zz')).toBe('No places found')
    expect(resultsWords(results({ localWaiting: true, local: [ALEX] }), 'zz')).toBe('')
    expect(resultsWords(results({ appleWaiting: true }), 'zz')).toBe('')
    expect(resultsWords(results(), '')).toBe('')
  })
})
