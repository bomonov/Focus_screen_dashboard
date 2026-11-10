import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TodoSourceError } from '../provider'
import type { HomeworkInput } from '../types'
import { openHomeworkBook, type HomeworkBook } from './book'
import { createHomeworkProvider } from './provider'

const START = new Date(2026, 9, 27, 14).getTime() / 1000

const problemSet: HomeworkInput = {
  kind: 'homework',
  title: 'Problem set 7',
  course: 'MAT 265',
  due: { kind: 'day', day: '2026-10-30' }
}
const groceries: HomeworkInput = { ...problemSet, title: 'Groceries', course: null }
const midterm: HomeworkInput = {
  kind: 'exam',
  title: 'Midterm',
  course: 'BIO 181',
  due: { kind: 'time', at: START + 16 * 86_400 }
}

let dir: string
let clock: number
let book: HomeworkBook

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'homework-'))
  clock = START
  let ids = 0
  book = openHomeworkBook({
    filePath: join(dir, 'homework.json'),
    now: () => clock,
    makeId: () => `id${++ids}`
  })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('createHomeworkProvider', () => {
  it('is always connected, as Homework', () => {
    const provider = createHomeworkProvider(book)
    expect(provider).toMatchObject({ source: 'homework', name: 'Homework' })
    expect(provider.connection()).toBe('connected')
  })

  it('lists open homework, then the ticked ones, but no exams', async () => {
    const provider = createHomeworkProvider(book)
    const done = book.add(problemSet)
    book.add(groceries)
    book.add(midterm)
    if (!done) throw new Error('not added')
    book.setDone(done.id, true)
    expect(await provider.list()).toEqual([
      {
        id: 'id2',
        title: 'Groceries',
        context: 'Homework',
        course: null,
        due: groceries.due,
        done: false,
        completedAt: null
      },
      {
        id: 'id1',
        title: 'Problem set 7',
        context: 'MAT 265',
        course: 'MAT 265',
        due: problemSet.due,
        done: true,
        completedAt: START
      }
    ])
  })

  it('ticks through the book, and says when the homework is gone', async () => {
    const provider = createHomeworkProvider(book)
    const added = book.add(problemSet)
    if (!added) throw new Error('not added')
    await provider.setDone(added.id, true)
    expect(book.homework().ticked).toHaveLength(1)
    await expect(provider.setDone('nope', true)).rejects.toBeInstanceOf(TodoSourceError)
  })

  it('gives the exams, soonest first', () => {
    const provider = createHomeworkProvider(book)
    book.add(problemSet)
    book.add(midterm)
    book.add({ ...midterm, title: 'Quiz 3', due: { kind: 'time', at: START + 2 * 86_400 } })
    expect(provider.exams?.().map((exam) => exam.title)).toEqual(['Quiz 3', 'Midterm'])
    expect(provider.exams?.()[0]).toEqual({
      id: 'id3',
      title: 'Quiz 3',
      course: 'BIO 181',
      due: { kind: 'time', at: START + 2 * 86_400 }
    })
  })

  it('has content once anything is in the book, an exam alone too', () => {
    const provider = createHomeworkProvider(book)
    expect(provider.hasContent?.()).toBe(false)
    book.add(midterm)
    expect(provider.hasContent?.()).toBe(true)
  })

  it('offers the calendar’s classes and the saved ones', () => {
    const provider = createHomeworkProvider(book)
    book.add(midterm)
    provider.setCalendarClasses(['MAT 265', 'bio 181'])
    expect(provider.classes?.()).toEqual(['bio 181', 'MAT 265'])
  })

  it('tells the service when the book or the calendar’s classes change', () => {
    const provider = createHomeworkProvider(book)
    const itemsChanged = vi.fn()
    provider.start(() => {}, itemsChanged)
    book.add(problemSet)
    expect(itemsChanged).toHaveBeenCalledTimes(1)
    provider.setCalendarClasses(['MAT 265'])
    expect(itemsChanged).toHaveBeenCalledTimes(2)
    provider.setCalendarClasses(['MAT 265'])
    expect(itemsChanged).toHaveBeenCalledTimes(2)
    provider.dispose()
    book.add(groceries)
    expect(itemsChanged).toHaveBeenCalledTimes(2)
  })

  it('lets ticked homework go after the hour, checking every minute', () => {
    vi.useFakeTimers()
    const provider = createHomeworkProvider(book)
    const itemsChanged = vi.fn()
    provider.start(() => {}, itemsChanged)
    const added = book.add(problemSet)
    if (!added) throw new Error('not added')
    book.setDone(added.id, true)
    itemsChanged.mockClear()
    clock = START + 3600
    vi.advanceTimersByTime(60_000)
    expect(book.homework().ticked).toEqual([])
    expect(itemsChanged).toHaveBeenCalledTimes(1)
    provider.dispose()
  })
})
