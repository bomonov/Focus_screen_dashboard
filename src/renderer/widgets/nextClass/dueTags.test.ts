import { describe, expect, it } from 'vitest'
import type { ClassEvent, ExamItem, TodoDue, TodoItem, TodoState } from '../../../main/ipc'
import { classWeek } from './classWeek'
import { dueTags } from './dueTags'

// Tuesday, October 27, 2026, 12:40 PM, as in classWeek.test.ts.
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

// BIO 181 today is over by 12:40; its next meeting is tomorrow.
const WEEK = classWeek(
  [
    event('BIO 181', 27, 9, 0),
    event('MAT 265', 27, 13, 30, 50),
    event('BIO 181', 28, 9, 0),
    event('CHM 113', 29, 10, 30),
    event('MAT 265', 29, 13, 30, 50)
  ],
  NOW,
  null
)

const day = (value: string): TodoDue => ({ kind: 'day', day: value })
const at = (d: number, h: number, min = 0): TodoDue => ({
  kind: 'time',
  at: new Date(2026, 9, d, h, min).getTime() / 1000
})

function homework(id: string, course: string, due: TodoDue, done = false): TodoItem {
  return {
    id: `homework:${id}`,
    source: 'homework',
    title: id,
    context: course,
    course,
    due,
    done,
    completedAt: done ? 1 : null,
    pending: false
  }
}

function state(items: TodoItem[], exams: ExamItem[] = []): TodoState {
  return { sources: [], items, exams, classes: [], supported: [], demo: false, notice: null }
}

const tagsOn = (todos: TodoState | null, eventId: string): unknown =>
  dueTags(WEEK, todos, NOW, 'en-US').get(eventId)

describe('dueTags', () => {
  it('puts a homework on its class’s next meeting, however the class is spelled', () => {
    const tags = dueTags(
      WEEK,
      state([homework('Read Ch. 5', 'bio  181', day('2026-10-28'))]),
      NOW,
      'en-US'
    )
    expect(tags.get('BIO 181@27')).toBeUndefined()
    expect(tags.get('BIO 181@28')).toEqual({
      shown: [
        {
          id: 'homework:Read Ch. 5',
          kind: 'homework',
          text: 'Read Ch. 5 · due tomorrow',
          overdue: false
        }
      ],
      more: 0
    })
  })

  it('only counts what’s due within 3 days', () => {
    expect(
      tagsOn(state([homework('PS 8', 'MAT 265', day('2026-10-31'))]), 'MAT 265@27')
    ).toBeUndefined()
    expect(tagsOn(state([homework('PS 7', 'MAT 265', day('2026-10-30'))]), 'MAT 265@27')).toEqual({
      shown: [{ id: 'homework:PS 7', kind: 'homework', text: 'PS 7 · due Fri', overdue: false }],
      more: 0
    })
  })

  it('says today with its time', () => {
    expect(
      tagsOn(state([homework('Quiz', 'MAT 265', at(27, 23, 59))]), 'MAT 265@27')
    ).toMatchObject({
      shown: [{ text: 'Quiz · due today 11:59 PM' }]
    })
  })

  it('leaves out ticked homework and other sources', () => {
    const canvas: TodoItem = {
      ...homework('Canvas lab', 'CHM 113', day('2026-10-28')),
      id: 'canvas:x',
      source: 'canvas'
    }
    expect(
      tagsOn(state([homework('Done', 'CHM 113', day('2026-10-28'), true), canvas]), 'CHM 113@29')
    ).toBeUndefined()
  })

  it('flags overdue homework that isn’t ticked', () => {
    expect(
      tagsOn(state([homework('Late lab', 'CHM 113', day('2026-10-20'))]), 'CHM 113@29')
    ).toEqual({
      shown: [
        { id: 'homework:Late lab', kind: 'homework', text: 'Late lab · overdue', overdue: true }
      ],
      more: 0
    })
  })

  it('tags an exam with its day and time', () => {
    const exam: ExamItem = { id: 'x1', title: 'Midterm', course: 'CHM 113', due: at(29, 9) }
    expect(tagsOn(state([], [exam]), 'CHM 113@29')).toEqual({
      shown: [{ id: 'x1', kind: 'exam', text: 'Midterm · Thu 9:00 AM', overdue: false }],
      more: 0
    })
    const tomorrow: ExamItem = { ...exam, course: 'BIO 181', due: day('2026-10-28') }
    expect(tagsOn(state([], [tomorrow]), 'BIO 181@28')).toMatchObject({
      shown: [{ text: 'Midterm · tomorrow' }]
    })
  })

  it('shows the soonest two and counts the rest', () => {
    const tags = tagsOn(
      state([
        homework('C', 'MAT 265', day('2026-10-30')),
        homework('A', 'MAT 265', day('2026-10-27')),
        homework('B', 'MAT 265', day('2026-10-28'))
      ]),
      'MAT 265@27'
    ) as { shown: { text: string }[]; more: number }
    expect(tags.shown.map((tag) => tag.text)).toEqual(['A · due today', 'B · due tomorrow'])
    expect(tags.more).toBe(1)
  })

  it('has nothing for a class with no meeting this week, or before the to-dos come', () => {
    expect(
      dueTags(WEEK, state([homework('Essay', 'ENG 101', day('2026-10-28'))]), NOW, 'en-US').size
    ).toBe(0)
    expect(dueTags(WEEK, null, NOW, 'en-US').size).toBe(0)
  })
})
