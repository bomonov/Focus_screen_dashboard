import { describe, expect, it } from 'vitest'
import type { ExamItem, TodoDue } from '../../../main/ipc'
import { examCountdown, examStrip } from './examView'

const local = (m: number, d: number, h = 0, min = 0, s = 0): number =>
  new Date(2026, m - 1, d, h, min, s).getTime() / 1000

const NOW = new Date(2026, 9, 27, 6)

function exam(due: TodoDue, changes: Partial<ExamItem> = {}): ExamItem {
  return { id: 'x', title: 'Midterm', course: 'BIO 181', due, ...changes }
}

const at = (m: number, d: number, h = 0, min = 0): TodoDue => ({
  kind: 'time',
  at: local(m, d, h, min)
})

describe('examCountdown', () => {
  it('counts days far off, with the date and time', () => {
    expect(examCountdown(exam(at(11, 12, 9)), NOW, 'en-US')).toEqual({
      id: 'x',
      name: 'BIO 181 Midterm',
      big: '16',
      unit: 'days',
      when: 'Thu, Nov 12 · 9:00 AM',
      brief: '16 days',
      near: false
    })
  })

  it('leaves the time out when there is none, and the class when there is none', () => {
    const countdown = examCountdown(
      exam({ kind: 'day', day: '2026-11-12' }, { course: null }),
      NOW,
      'en-US'
    )
    expect(countdown).toMatchObject({ name: 'Midterm', when: 'Thu, Nov 12' })
  })

  it('turns gold at 3 days or less', () => {
    expect(examCountdown(exam(at(10, 30, 9)), NOW, 'en-US').near).toBe(true)
    expect(examCountdown(exam({ kind: 'day', day: '2026-10-31' }), NOW, 'en-US').near).toBe(false)
  })

  it('says tomorrow the day before', () => {
    expect(examCountdown(exam(at(10, 28, 9)), NOW, 'en-US')).toMatchObject({
      big: '1',
      unit: 'day',
      when: 'Tomorrow · 9:00 AM',
      brief: 'Tomorrow 9:00 AM',
      near: true
    })
  })

  it('counts down the hours and minutes on the day', () => {
    const today = exam(at(10, 27, 9))
    expect(examCountdown(today, NOW, 'en-US')).toMatchObject({
      big: 'Today',
      unit: null,
      when: 'Today · 9:00 AM · in 3 h',
      brief: 'Today 9:00 AM'
    })
    expect(examCountdown(today, new Date(2026, 9, 27, 8, 20), 'en-US').when).toBe(
      'Today · 9:00 AM · in 40 min'
    )
    expect(examCountdown(today, new Date(2026, 9, 27, 8, 59, 30), 'en-US').when).toBe(
      'Today · 9:00 AM · in 1 min'
    )
    expect(examCountdown(today, new Date(2026, 9, 27, 7, 30), 'en-US').when).toBe(
      'Today · 9:00 AM · in 1 h 30 min'
    )
    expect(examCountdown(exam({ kind: 'day', day: '2026-10-27' }), NOW, 'en-US').when).toBe('Today')
  })

  it('steps the day count at midnight, not 24 hours on', () => {
    const late = new Date(2026, 9, 27, 23, 59)
    expect(examCountdown(exam(at(10, 29, 0, 30)), late, 'en-US')).toMatchObject({
      big: '2',
      unit: 'days'
    })
  })
})

describe('examStrip', () => {
  it('has nothing to show without exams', () => {
    expect(examStrip([], NOW, 'en-US')).toBeNull()
  })

  it('puts the first exam up front and keeps the rest for "+2 more"', () => {
    const strip = examStrip(
      [
        exam(at(10, 29, 10), { id: 'a' }),
        exam(at(11, 12, 9), { id: 'b' }),
        exam(at(12, 10, 9), { id: 'c' })
      ],
      NOW,
      'en-US'
    )
    expect(strip?.first.id).toBe('a')
    expect(strip?.rest.map((countdown) => countdown.id)).toEqual(['b', 'c'])
  })
})
