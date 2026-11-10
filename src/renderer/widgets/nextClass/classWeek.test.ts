import { describe, expect, it } from 'vitest'
import type { ClassEvent } from '../../../main/ipc'
import { classLength, classWeek } from './classWeek'

// Tuesday, October 27, 2026, 12:40 PM.
const NOW = new Date(2026, 9, 27, 12, 40)

function event(title: string, day: number, hour: number, minute: number, minutes = 75): ClassEvent {
  const start = new Date(2026, 9, day, hour, minute).getTime() / 1000
  return {
    id: `${title}@${day}`,
    calendar: 'C1',
    title,
    location: 'Tempe - LSE104',
    start,
    end: start + minutes * 60
  }
}

const BIO = event('BIO 181', 27, 9, 0)
const MAT = event('MAT 265', 27, 13, 30, 50)
const BIO_WED = event('BIO 181', 28, 9, 0)
const CHM_THU = event('CHM 113', 29, 10, 30)
// October 34 is November 3, a week on.
const BIO_NEXT_TUE = event('BIO 181', 34, 9, 0)

describe('classWeek', () => {
  it('puts each class under the day it starts, named the way the pill names days', () => {
    const days = classWeek([BIO, MAT, BIO_WED, CHM_THU, BIO_NEXT_TUE], NOW, null)
    expect(days.map((day) => [day.name, day.date])).toEqual([
      ['Today', 'Tue, Oct 27'],
      ['Tomorrow', 'Wed, Oct 28'],
      ['Thu', 'Oct 29'],
      ['Next Tue', 'Nov 3']
    ])
    expect(days.map((day) => day.rows.map((row) => row.event))).toEqual([
      [BIO, MAT],
      [BIO_WED],
      [CHM_THU],
      [BIO_NEXT_TUE]
    ])
  })

  it('leaves out days with no classes', () => {
    const days = classWeek([BIO_WED, BIO_NEXT_TUE], NOW, null)
    expect(days.map((day) => day.name)).toEqual(['Tomorrow', 'Next Tue'])
  })

  it('dims today’s classes once they’ve ended, but not the one going on', () => {
    const during = new Date(2026, 9, 27, 13, 45)
    const [today] = classWeek([BIO, MAT, BIO_WED], during, null)
    expect(today?.rows.map((row) => row.past)).toEqual([true, false])
  })

  it('lights the class the pill shows', () => {
    const days = classWeek([BIO, MAT, BIO_WED], NOW, MAT.id)
    expect(days.flatMap((day) => day.rows.map((row) => row.lit))).toEqual([false, true, false])
  })

  it('is empty when the week has no classes', () => {
    expect(classWeek([], NOW, null)).toEqual([])
  })
})

describe('classLength', () => {
  it('says a class under two hours in minutes, the way timetables do', () => {
    expect(classLength(50)).toBe('50 min')
    expect(classLength(75)).toBe('75 min')
  })

  it('says a longer one in hours and minutes', () => {
    expect(classLength(120)).toBe('2 h')
    expect(classLength(170)).toBe('2 h 50 min')
  })
})
