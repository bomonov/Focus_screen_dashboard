import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeworkInput } from '../types'
import { openHomeworkBook } from './book'
import { DONE_KEEP_SEC } from './shared'

const at = (y: number, m: number, d: number, h = 0, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime() / 1000

const START = at(2026, 10, 27, 14)

const problemSet: HomeworkInput = {
  kind: 'homework',
  title: 'Problem set 7',
  course: 'MAT 265',
  due: { kind: 'day', day: '2026-10-30' }
}
const midterm: HomeworkInput = {
  kind: 'exam',
  title: 'Midterm',
  course: 'BIO 181',
  due: { kind: 'time', at: at(2026, 11, 12, 9) }
}

let dir: string
let filePath: string
let clock: number
let ids: number

function open(): ReturnType<typeof openHomeworkBook> {
  return openHomeworkBook({ filePath, now: () => clock, makeId: () => `id${++ids}` })
}

function onDisk(): { ids: string[]; text: string } {
  const text = readFileSync(filePath, 'utf8')
  const parsed = JSON.parse(text) as { entries: { id: string }[] }
  return { ids: parsed.entries.map((entry) => entry.id), text }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'homework-'))
  filePath = join(dir, 'homework.json')
  clock = START
  ids = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('openHomeworkBook', () => {
  it('keeps what was added for next time', () => {
    const added = open().add(problemSet)
    expect(added).toEqual({ id: 'id1', ...problemSet })
    expect(open().homework().open).toEqual([added])
  })

  it('takes a ticked homework off the disk at once, and keeps it on screen for the hour', () => {
    const book = open()
    const added = book.add(problemSet)
    book.add(midterm)
    expect(added && book.setDone(added.id, true)).toBe(true)
    const disk = onDisk()
    expect(disk.ids).toEqual(['id2'])
    expect(disk.text).not.toContain('Problem set 7')
    expect(book.homework()).toEqual({ open: [], ticked: [{ entry: added, doneAt: START }] })
  })

  it('saves an unticked homework again within the hour', () => {
    const book = open()
    const added = book.add(problemSet)
    if (!added) throw new Error('not added')
    book.setDone(added.id, true)
    clock = START + 59 * 60
    expect(book.setDone(added.id, false)).toBe(true)
    expect(onDisk().ids).toEqual([added.id])
    expect(book.homework()).toEqual({ open: [added], ticked: [] })
  })

  it('lets a ticked homework go after the hour', () => {
    const book = open()
    const added = book.add(problemSet)
    if (!added) throw new Error('not added')
    book.setDone(added.id, true)
    clock = START + DONE_KEEP_SEC - 1
    expect(book.prune()).toBe(false)
    clock = START + DONE_KEEP_SEC
    expect(book.prune()).toBe(true)
    expect(book.homework().ticked).toEqual([])
    expect(book.setDone(added.id, false)).toBe(false)
  })

  it('forgets a ticked homework when the app quits within the hour', () => {
    const book = open()
    const added = book.add(problemSet)
    if (!added) throw new Error('not added')
    book.setDone(added.id, true)
    expect(open().homework()).toEqual({ open: [], ticked: [] })
  })

  it('drops an exam that ended while the app was closed, and rewrites the file', () => {
    open().add(midterm)
    open().add(problemSet)
    clock = at(2026, 11, 12, 9)
    const book = open()
    expect(book.exams()).toEqual([])
    expect(onDisk().ids).toEqual(['id2'])
  })

  it('drops an exam as it ends while the app runs', () => {
    const book = open()
    book.add(midterm)
    book.add(problemSet)
    clock = at(2026, 11, 12, 9)
    // Gone from the strip even before the next prune runs.
    expect(book.exams()).toEqual([])
    expect(book.prune()).toBe(true)
    expect(onDisk().ids).toEqual(['id2'])
  })

  it('lists exams soonest first, a day-only one at the end of its day', () => {
    const book = open()
    book.add({ ...midterm, title: 'Final', due: { kind: 'day', day: '2026-11-12' } })
    book.add({ ...midterm, title: 'Quiz', due: { kind: 'time', at: at(2026, 10, 29, 10) } })
    book.add(midterm)
    book.add(problemSet)
    expect(book.exams().map((exam) => exam.title)).toEqual(['Quiz', 'Midterm', 'Final'])
  })

  it('lists the courses saved entries use, once each', () => {
    const book = open()
    book.add(problemSet)
    book.add(midterm)
    book.add({ ...problemSet, title: 'Problem set 8' })
    book.add({ ...problemSet, title: 'Groceries', course: null })
    expect(book.courses()).toEqual(['MAT 265', 'BIO 181'])
  })

  it('finds open, ticked and exam entries, and says which are ticked', () => {
    const book = open()
    const homework = book.add(problemSet)
    const exam = book.add(midterm)
    if (!homework || !exam) throw new Error('not added')
    expect(book.find(exam.id)).toEqual({ entry: exam, ticked: false })
    book.setDone(homework.id, true)
    expect(book.find(homework.id)).toEqual({ entry: homework, ticked: true })
    expect(book.find('nope')).toBeNull()
  })

  it('edits open entries only', () => {
    const book = open()
    const added = book.add(problemSet)
    if (!added) throw new Error('not added')
    expect(book.edit(added.id, { ...problemSet, title: 'Problem set 7b' })).toBe(true)
    expect(open().homework().open[0]?.title).toBe('Problem set 7b')
    book.setDone(added.id, true)
    expect(book.edit(added.id, problemSet)).toBe(false)
    expect(book.edit('nope', problemSet)).toBe(false)
  })

  it('removes open, ticked and exam entries', () => {
    const book = open()
    const homework = book.add(problemSet)
    const exam = book.add(midterm)
    if (!homework || !exam) throw new Error('not added')
    book.setDone(homework.id, true)
    expect(book.remove(homework.id)).toBe(true)
    expect(book.homework().ticked).toEqual([])
    expect(book.remove(exam.id)).toBe(true)
    expect(book.remove(exam.id)).toBe(false)
  })

  it('removes the file once nothing is left', () => {
    const book = open()
    const added = book.add(problemSet)
    if (!added) throw new Error('not added')
    expect(existsSync(filePath)).toBe(true)
    book.setDone(added.id, true)
    expect(existsSync(filePath)).toBe(false)
  })

  it('opens a broken file as empty and writes a good one after', () => {
    writeFileSync(filePath, '{nope')
    const book = open()
    expect(book.homework()).toEqual({ open: [], ticked: [] })
    book.add(problemSet)
    expect(onDisk().ids).toEqual(['id1'])
  })

  it('tells its listeners about changes, never about nothing', () => {
    const book = open()
    const listener = vi.fn()
    book.subscribe(listener)
    const added = book.add(problemSet)
    if (!added) throw new Error('not added')
    book.edit(added.id, { ...problemSet, title: 'Problem set 7b' })
    book.setDone(added.id, true)
    book.setDone(added.id, true)
    clock = START + DONE_KEEP_SEC
    book.prune()
    book.prune()
    book.remove('nope')
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('stops telling a listener that unsubscribed', () => {
    const book = open()
    const listener = vi.fn()
    book.subscribe(listener)()
    book.add(problemSet)
    expect(listener).not.toHaveBeenCalled()
  })

  it('carries on when the file can’t be written, without naming the homework', () => {
    // A file where the folder should be: every write fails.
    writeFileSync(join(dir, 'blocked'), '')
    filePath = join(dir, 'blocked', 'homework.json')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const book = open()
    expect(book.add(problemSet)).not.toBeNull()
    expect(warn).toHaveBeenCalled()
    for (const call of warn.mock.calls) {
      for (const arg of call) expect(String(arg)).not.toContain('Problem set 7')
    }
  })
})
