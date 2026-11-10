import { describe, expect, it } from 'vitest'
import type { HomeworkEntry } from '../types'
import {
  MAX_ENTRIES,
  examOver,
  homeworkFile,
  parseHomeworkFile,
  parseHomeworkInput,
  withoutEndedExams
} from './entries'

const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0): number =>
  new Date(y, m - 1, d, h, min, s).getTime() / 1000

const input = {
  kind: 'homework',
  title: 'Problem set 7',
  course: 'MAT 265',
  due: { kind: 'day', day: '2026-10-30' }
}

function entry(id: string, overrides: Partial<HomeworkEntry> = {}): HomeworkEntry {
  return {
    id,
    kind: 'homework',
    title: `Homework ${id}`,
    course: 'MAT 265',
    due: { kind: 'day', day: '2026-10-30' },
    ...overrides
  }
}

describe('parseHomeworkInput', () => {
  it('trims the title and the course', () => {
    expect(
      parseHomeworkInput({ ...input, title: '  Problem set 7 ', course: ' MAT 265 ' })
    ).toEqual(input)
  })

  it('takes an empty course as no class', () => {
    expect(parseHomeworkInput({ ...input, course: '' })?.course).toBeNull()
    expect(parseHomeworkInput({ ...input, course: '   ' })?.course).toBeNull()
    expect(parseHomeworkInput({ ...input, course: null })?.course).toBeNull()
  })

  it('takes an exam with a time', () => {
    const due = { kind: 'time', at: at(2026, 11, 12, 9) }
    expect(parseHomeworkInput({ ...input, kind: 'exam', title: 'Midterm', due })).toEqual({
      kind: 'exam',
      title: 'Midterm',
      course: 'MAT 265',
      due
    })
  })

  it('needs a name, up to 200 characters', () => {
    expect(parseHomeworkInput({ ...input, title: '' })).toBeNull()
    expect(parseHomeworkInput({ ...input, title: '   ' })).toBeNull()
    expect(parseHomeworkInput({ ...input, title: ` ${'a'.repeat(200)} ` })?.title).toHaveLength(200)
    expect(parseHomeworkInput({ ...input, title: 'a'.repeat(201) })).toBeNull()
  })

  it('caps the course at 60 characters', () => {
    expect(parseHomeworkInput({ ...input, course: 'c'.repeat(60) })?.course).toHaveLength(60)
    expect(parseHomeworkInput({ ...input, course: 'c'.repeat(61) })).toBeNull()
  })

  it('refuses unknown kinds and odd dues', () => {
    expect(parseHomeworkInput({ ...input, kind: 'quiz' })).toBeNull()
    expect(parseHomeworkInput({ ...input, due: { kind: 'day', day: '2026-02-30' } })).toBeNull()
    expect(parseHomeworkInput({ ...input, due: { kind: 'day', day: '2026-1-5' } })).toBeNull()
    expect(parseHomeworkInput({ ...input, due: { kind: 'time', at: Number.NaN } })).toBeNull()
    expect(
      parseHomeworkInput({ ...input, due: { kind: 'time', at: Number.POSITIVE_INFINITY } })
    ).toBeNull()
    expect(parseHomeworkInput({ ...input, due: { kind: 'time', at: '1000' } })).toBeNull()
    // Past what a Date can hold (a hand-edited file, microseconds): the screen would throw.
    expect(parseHomeworkInput({ ...input, due: { kind: 'time', at: 1e20 } })).toBeNull()
    expect(parseHomeworkInput({ ...input, due: { kind: 'time', at: -9e12 } })).toBeNull()
    expect(parseHomeworkInput({ ...input, due: { kind: 'time', at: 8.64e12 } })).not.toBeNull()
    expect(parseHomeworkInput({ ...input, due: null })).toBeNull()
    expect(parseHomeworkInput({ ...input, title: 7 })).toBeNull()
    expect(parseHomeworkInput('homework')).toBeNull()
    expect(parseHomeworkInput(null)).toBeNull()
  })
})

describe('parseHomeworkFile', () => {
  it('reads back what homeworkFile wrote', () => {
    const entries = [entry('a'), entry('b', { kind: 'exam', title: 'Midterm', course: null })]
    expect(parseHomeworkFile(JSON.parse(JSON.stringify(homeworkFile(entries))))).toEqual(entries)
  })

  it('keeps the valid entries, the first of a repeated id', () => {
    const raw = {
      version: 1,
      entries: [
        entry('a'),
        { id: 5 },
        entry('a', { title: 'Again' }),
        entry('bad id/with slash'),
        entry('x'.repeat(65)),
        'nope',
        entry('b')
      ]
    }
    expect(parseHomeworkFile(raw).map((e) => [e.id, e.title])).toEqual([
      ['a', 'Homework a'],
      ['b', 'Homework b']
    ])
  })

  it('gives nothing for a file of the wrong shape', () => {
    expect(parseHomeworkFile(null)).toEqual([])
    expect(parseHomeworkFile([])).toEqual([])
    expect(parseHomeworkFile({ version: 1 })).toEqual([])
    expect(parseHomeworkFile({ version: 1, entries: {} })).toEqual([])
  })

  it(`keeps at most ${MAX_ENTRIES}`, () => {
    const entries = Array.from({ length: 10_000 }, (_, i) => entry(`e${i}`))
    expect(parseHomeworkFile({ version: 1, entries })).toHaveLength(MAX_ENTRIES)
  })

  it('never brings back a ticked homework from an older build', () => {
    const ticked = { ...entry('t'), doneAt: 1000 }
    expect(
      parseHomeworkFile({ version: 1, entries: [ticked, entry('a')] }).map((e) => e.id)
    ).toEqual(['a'])
  })
})

describe('examOver', () => {
  it('ends a timed exam at its time', () => {
    expect(examOver({ kind: 'time', at: 1000 }, 999)).toBe(false)
    expect(examOver({ kind: 'time', at: 1000 }, 1000)).toBe(true)
  })

  it('ends a day-only exam at the next local midnight', () => {
    const due = { kind: 'day', day: '2026-11-12' } as const
    expect(examOver(due, at(2026, 11, 12, 23, 59, 59))).toBe(false)
    expect(examOver(due, at(2026, 11, 13))).toBe(true)
  })
})

describe('withoutEndedExams', () => {
  it('drops ended exams only, never overdue homework', () => {
    const now = at(2026, 11, 20)
    const entries = [
      entry('old-exam', { kind: 'exam', due: { kind: 'day', day: '2026-11-12' } }),
      entry('next-exam', { kind: 'exam', due: { kind: 'day', day: '2026-12-01' } }),
      entry('overdue-homework', { due: { kind: 'day', day: '2026-11-01' } })
    ]
    expect(withoutEndedExams(entries, now).map((e) => e.id)).toEqual([
      'next-exam',
      'overdue-homework'
    ])
  })
})
