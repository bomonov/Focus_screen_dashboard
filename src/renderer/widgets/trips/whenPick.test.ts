import { describe, expect, it } from 'vitest'
import type { ClockWords } from './tripView'
import { atDayTime, dayChoices, dayKey, pickFor, whenLabel, whenOf } from './whenPick'

/** Monday, November 2, 2026, 4:07 PM, local time. */
const NOW = new Date(2026, 10, 2, 16, 7)
const nowSec = NOW.getTime() / 1000
const at = (day: number, hour: number, minute: number): number =>
  new Date(2026, 10, day, hour, minute).getTime() / 1000

const clock: ClockWords = {
  time: (unix) => {
    const date = new Date(unix * 1000)
    return `${date.getHours() % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')}`
  },
  day: (unix) =>
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(unix * 1000).getDay()] ?? ''
}

describe('dayChoices', () => {
  it('offers today and the next six days', () => {
    const days = dayChoices(NOW, clock)
    expect(days.map((day) => day.label)).toEqual([
      'Today',
      'Tomorrow',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun'
    ])
    expect(days.map((day) => day.day)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08'
    ])
  })

  it('runs across a month’s end', () => {
    const days = dayChoices(new Date(2026, 9, 30, 9, 0), clock)
    expect(days.map((day) => day.day).slice(1, 3)).toEqual(['2026-10-31', '2026-11-01'])
  })
})

describe('atDayTime', () => {
  it('turns a day and a time of day into a moment', () => {
    expect(atDayTime('2026-11-03', '09:00')).toBe(at(3, 9, 0))
    expect(atDayTime('2026-11-02', '23:59')).toBe(at(2, 23, 59))
  })

  it('refuses anything that isn’t one', () => {
    expect(atDayTime('2026-11-03', '')).toBeNull()
    expect(atDayTime('', '09:00')).toBeNull()
    expect(atDayTime('2026-11-03', '25:00')).toBeNull()
    expect(atDayTime('2026-02-30', '09:00')).toBeNull()
    expect(atDayTime('soon', 'later')).toBeNull()
  })
})

describe('pickFor', () => {
  it('starts a new pick at the next quarter hour, at least ten minutes off', () => {
    expect(pickFor({ kind: 'now' }, 'depart', NOW)).toEqual({
      kind: 'depart',
      day: '2026-11-02',
      time: '16:30'
    })
    expect(pickFor({ kind: 'now' }, 'arrive', new Date(2026, 10, 2, 16, 4))).toEqual({
      kind: 'arrive',
      day: '2026-11-02',
      time: '16:15'
    })
  })

  it('carries over to tomorrow late in the evening', () => {
    expect(pickFor({ kind: 'now' }, 'depart', new Date(2026, 10, 2, 23, 52))).toEqual({
      kind: 'depart',
      day: '2026-11-03',
      time: '00:15'
    })
  })

  it('keeps the day and time already asked for, switching between leave and arrive', () => {
    expect(pickFor({ kind: 'arrive', time: at(3, 8, 55) }, 'depart', NOW)).toEqual({
      kind: 'depart',
      day: '2026-11-03',
      time: '08:55'
    })
  })
})

describe('whenOf', () => {
  it('asks for the picked moment', () => {
    expect(whenOf({ kind: 'arrive', day: '2026-11-03', time: '09:00' }, nowSec)).toEqual({
      kind: 'arrive',
      time: at(3, 9, 0)
    })
  })

  it('won’t plan for a time that’s gone, or one that isn’t a time', () => {
    expect(whenOf({ kind: 'depart', day: '2026-11-02', time: '15:00' }, nowSec)).toBeNull()
    expect(whenOf({ kind: 'depart', day: '2026-11-02', time: '' }, nowSec)).toBeNull()
  })

  it('takes this minute as still to come', () => {
    expect(whenOf({ kind: 'depart', day: '2026-11-02', time: '16:07' }, nowSec + 30)).toEqual({
      kind: 'depart',
      time: at(2, 16, 7)
    })
  })

  it('goes no further than the days offered', () => {
    expect(whenOf({ kind: 'depart', day: '2026-11-08', time: '23:00' }, nowSec)).not.toBeNull()
    expect(whenOf({ kind: 'depart', day: '2026-11-09', time: '09:00' }, nowSec)).toBeNull()
  })

  it('makes a date picked on this Mac the same day key', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('whenLabel', () => {
  it('says when the trip leaves or gets there', () => {
    expect(whenLabel({ kind: 'now' }, nowSec, clock)).toBe('Leave now')
    expect(whenLabel({ kind: 'depart', time: at(2, 17, 30) }, nowSec, clock)).toBe('Leave at 5:30')
    expect(whenLabel({ kind: 'arrive', time: at(3, 8, 55) }, nowSec, clock)).toBe(
      'Arrive by tomorrow 8:55'
    )
    expect(whenLabel({ kind: 'arrive', time: at(5, 8, 55) }, nowSec, clock)).toBe(
      'Arrive by Thu 8:55'
    )
  })
})
