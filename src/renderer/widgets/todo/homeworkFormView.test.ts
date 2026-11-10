import { describe, expect, it } from 'vitest'
import type { HomeworkEntry } from '../../../main/ipc'
import {
  DEFAULT_TIME,
  dueChoices,
  emptyForm,
  formProblem,
  formTitle,
  fromEntry,
  timeLabel,
  toDue,
  toInput,
  type FormValues
} from './homeworkFormView'

const local = (y: number, m: number, d: number, h = 0, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime() / 1000

const complete: FormValues = {
  kind: 'homework',
  title: 'Problem set 7',
  course: 'MAT 265',
  day: '2026-10-30',
  time: null
}

describe('dueChoices', () => {
  it('offers today, tomorrow and the next four days by weekday', () => {
    const choices = dueChoices(new Date(2026, 9, 27, 14), 'en-US')
    expect(choices.map((choice) => choice.label)).toEqual([
      'Today',
      'Tomorrow',
      'Thu',
      'Fri',
      'Sat',
      'Sun'
    ])
    expect(choices.map((choice) => choice.day)).toEqual([
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01'
    ])
  })
})

describe('toDue', () => {
  it('keeps a day without a time as a day', () => {
    expect(toDue('2026-10-30', null)).toEqual({ kind: 'day', day: '2026-10-30' })
  })

  it('makes a day and a time into a local moment', () => {
    expect(toDue('2026-10-30', DEFAULT_TIME)).toEqual({
      kind: 'time',
      at: local(2026, 10, 30, 23, 59)
    })
  })
})

describe('fromEntry', () => {
  it('fills the form back in, both kinds of due', () => {
    const entries: HomeworkEntry[] = [
      {
        id: 'a',
        kind: 'homework',
        title: 'Lab',
        course: null,
        due: { kind: 'day', day: '2026-10-30' }
      },
      {
        id: 'b',
        kind: 'exam',
        title: 'Midterm',
        course: 'BIO 181',
        due: { kind: 'time', at: local(2026, 11, 12, 9, 5) }
      }
    ]
    for (const entry of entries) {
      const { id, ...input } = entry
      expect(id).toBeTruthy()
      expect(toInput(fromEntry(entry))).toEqual(input)
    }
    expect(fromEntry(entries[1] as HomeworkEntry)).toMatchObject({
      day: '2026-11-12',
      time: '09:05'
    })
  })
})

describe('formProblem', () => {
  it('asks for a name, a class (or No class) and a day, in that order', () => {
    expect(formProblem({ ...complete, title: '  ' })).toBe('Give it a name.')
    expect(formProblem({ ...complete, course: undefined })).toBe('Pick a class, or No class.')
    expect(formProblem({ ...complete, day: null })).toBe('Pick a due date.')
    expect(formProblem({ ...complete, kind: 'exam', day: null })).toBe('Pick the exam’s date.')
    expect(formProblem(complete)).toBeNull()
    expect(formProblem({ ...complete, course: null })).toBeNull()
  })

  it('gives no input while something’s missing', () => {
    expect(toInput({ ...complete, day: null })).toBeNull()
    expect(toInput(emptyForm('exam'))).toBeNull()
  })
})

describe('formTitle', () => {
  it('names what the form does', () => {
    expect(formTitle('homework', false)).toBe('Add homework')
    expect(formTitle('exam', false)).toBe('Add exam')
    expect(formTitle('homework', true)).toBe('Edit homework')
    expect(formTitle('exam', true)).toBe('Edit exam')
  })
})

describe('timeLabel', () => {
  it('writes a picked time the way the clock does', () => {
    expect(timeLabel('23:59', 'en-US')).toBe('11:59 PM')
    expect(timeLabel('09:05', 'en-US')).toBe('9:05 AM')
  })
})
