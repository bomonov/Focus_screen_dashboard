import { describe, expect, it } from 'vitest'
import type { CalendarState, ClassEvent } from '../../../main/ipc'
import { dayLabel, nextClassView, startsIn } from './nextClassView'

const NOW = new Date(2026, 9, 15, 10, 5)
const at = (day: number, hour: number, minute: number): number =>
  new Date(2026, 9, day, hour, minute).getTime() / 1000

function event(title: string, day: number, hour: number, minute: number, minutes = 75): ClassEvent {
  const start = at(day, hour, minute)
  return { id: title, calendar: 'C1', title, location: 'LSE 104', start, end: start + minutes * 60 }
}

function state(events: ClassEvent[], extra: Partial<CalendarState> = {}): CalendarState {
  return {
    supported: true,
    access: 'granted',
    calendars: [{ id: 'C1', title: 'Classes', source: 'iCloud', color: '#FFC627' }],
    events,
    problem: null,
    demo: false,
    ...extra
  }
}

const BIO = event('BIO 181', 15, 9, 0)
const CHM = event('CHM 113', 15, 10, 30)
const MAT_TOMORROW = event('MAT 265', 16, 9, 0)

describe('nextClassView', () => {
  it('shows the class going on', () => {
    expect(nextClassView(state([BIO, CHM]), ['C1'], NOW)).toEqual({ kind: 'now', event: BIO })
  })

  it('shows the next class today with the minutes until it starts', () => {
    const after = new Date(2026, 9, 15, 10, 16)
    expect(nextClassView(state([BIO, CHM]), ['C1'], after)).toEqual({
      kind: 'next',
      event: CHM,
      minutes: 14
    })
  })

  it('is done for the day once today’s are over, keeping tomorrow’s first for the swipe', () => {
    const evening = new Date(2026, 9, 15, 20, 0)
    expect(nextClassView(state([BIO, CHM, MAT_TOMORROW]), ['C1'], evening)).toEqual({
      kind: 'done',
      later: { event: MAT_TOMORROW, day: 'Tomorrow' }
    })
  })

  it('reaches past days without classes to the next day that has one', () => {
    // Thursday evening, nothing on Friday or the weekend: Monday's first.
    const thursday = new Date(2026, 9, 15, 20, 0)
    const monday = event('MAT 265', 19, 9, 0)
    expect(nextClassView(state([BIO, monday]), ['C1'], thursday)).toEqual({
      kind: 'done',
      later: { event: monday, day: 'Mon' }
    })
  })

  it('is done for the day with no class today at all', () => {
    const morning = new Date(2026, 9, 17, 8, 0)
    const monday = event('MAT 265', 19, 9, 0)
    expect(nextClassView(state([monday]), ['C1'], morning)).toMatchObject({
      kind: 'done',
      later: { event: monday }
    })
  })

  it('stays, blank, with no classes left in the week', () => {
    const evening = new Date(2026, 9, 15, 20, 0)
    expect(nextClassView(state([BIO, CHM]), ['C1'], evening)).toEqual({
      kind: 'done',
      later: null
    })
  })

  it('says nothing before access is known', () => {
    expect(nextClassView(state([], { access: null }), ['C1'], NOW)).toBeNull()
    expect(nextClassView(state([], { supported: false }), ['C1'], NOW)).toBeNull()
    expect(nextClassView(null, ['C1'], NOW)).toBeNull()
  })

  it('points to Customize when macOS said no, or no calendar is picked', () => {
    expect(nextClassView(state([], { access: 'denied' }), ['C1'], NOW)?.kind).toBe('setup')
    expect(nextClassView(state([]), [], NOW)).toEqual({
      kind: 'setup',
      text: 'Pick your class calendars in Customize'
    })
  })

  it('shows the demo’s classes without any calendar picked', () => {
    expect(nextClassView(state([BIO, CHM], { demo: true }), [], NOW)?.kind).toBe('now')
  })

  it('shows the class that began latest when two overlap', () => {
    const lab = event('BIO 181 Lab', 15, 9, 30, 120)
    expect(nextClassView(state([BIO, lab]), ['C1'], NOW)).toEqual({ kind: 'now', event: lab })
  })
})

describe('dayLabel', () => {
  it('names tomorrow, then the weekday, then the same weekday a week on', () => {
    const thursday = new Date(2026, 9, 15, 20, 0)
    expect(dayLabel(new Date(2026, 9, 16, 9, 0), thursday)).toBe('Tomorrow')
    expect(dayLabel(new Date(2026, 9, 19, 9, 0), thursday)).toBe('Mon')
    expect(dayLabel(new Date(2026, 9, 22, 9, 0), thursday)).toBe('Next Thu')
  })
})

describe('startsIn', () => {
  it('counts minutes, then hours, then leaves it to the time', () => {
    expect(startsIn(0)).toBe('in 1 min')
    expect(startsIn(25)).toBe('in 25 min')
    expect(startsIn(60)).toBe('in 1 h')
    expect(startsIn(80)).toBe('in 1 h 20 min')
    expect(startsIn(180)).toBeNull()
  })
})
