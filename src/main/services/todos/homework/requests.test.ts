import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeworkInput } from '../types'
import { openHomeworkBook, type HomeworkBook } from './book'
import { MAX_ENTRIES } from './entries'
import { handleHomeworkRequest } from './requests'

const problemSet: HomeworkInput = {
  kind: 'homework',
  title: 'Problem set 7',
  course: 'MAT 265',
  due: { kind: 'day', day: '2026-10-30' }
}

let dir: string
let book: HomeworkBook

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'homework-'))
  let ids = 0
  book = openHomeworkBook({
    filePath: join(dir, 'homework.json'),
    now: () => new Date(2026, 9, 27, 14).getTime() / 1000,
    makeId: () => `id${++ids}`
  })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

const never = (): Promise<boolean> => Promise.reject(new Error('should not ask'))

describe('handleHomeworkRequest', () => {
  it('adds', async () => {
    expect(await handleHomeworkRequest(book, { kind: 'add', input: problemSet }, never)).toEqual({
      ok: true
    })
    expect(book.homework().open).toEqual([{ id: 'id1', ...problemSet }])
  })

  it('says so when the list is full', async () => {
    for (let i = 0; i < MAX_ENTRIES; i++) book.add(problemSet)
    expect(await handleHomeworkRequest(book, { kind: 'add', input: problemSet }, never)).toEqual({
      ok: false,
      message: 'Your list is full. Delete some first.'
    })
  })

  it('edits', async () => {
    book.add(problemSet)
    const input = { ...problemSet, title: 'Problem set 7b' }
    expect(await handleHomeworkRequest(book, { kind: 'edit', id: 'id1', input }, never)).toEqual({
      ok: true
    })
    expect(book.find('id1')?.entry.title).toBe('Problem set 7b')
  })

  it('answers plainly for one that’s gone, changing nothing', async () => {
    book.add(problemSet)
    const gone = { ok: false, message: 'That one’s gone already.' }
    expect(
      await handleHomeworkRequest(book, { kind: 'edit', id: 'nope', input: problemSet }, never)
    ).toEqual(gone)
    expect(await handleHomeworkRequest(book, { kind: 'delete', id: 'nope' }, never)).toEqual(gone)
    expect(book.homework().open).toHaveLength(1)
  })

  it('deletes only once the user says yes, a ticked one too', async () => {
    const added = book.add(problemSet)
    if (!added) throw new Error('not added')
    book.setDone(added.id, true)
    const no = vi.fn(() => Promise.resolve(false))
    expect(await handleHomeworkRequest(book, { kind: 'delete', id: added.id }, no)).toEqual({
      ok: true
    })
    expect(no).toHaveBeenCalledWith(added)
    expect(book.find(added.id)).not.toBeNull()
    const yes = vi.fn(() => Promise.resolve(true))
    expect(await handleHomeworkRequest(book, { kind: 'delete', id: added.id }, yes)).toEqual({
      ok: true
    })
    expect(book.find(added.id)).toBeNull()
  })

  it('refuses an exam whose time has passed, so an edit slip never loses one', async () => {
    const now = (): number => new Date(2026, 9, 27, 14).getTime() / 1000
    const past = {
      kind: 'exam' as const,
      title: 'Midterm',
      course: null,
      due: { kind: 'day' as const, day: '2026-10-26' }
    }
    const passed = { ok: false, message: 'That exam’s time has already passed.' }
    expect(await handleHomeworkRequest(book, { kind: 'add', input: past }, never, now)).toEqual(
      passed
    )
    expect(book.exams()).toEqual([])

    const exam = book.add({ ...past, due: { kind: 'day', day: '2026-11-12' } })
    if (!exam) throw new Error('not added')
    expect(
      await handleHomeworkRequest(book, { kind: 'edit', id: exam.id, input: past }, never, now)
    ).toEqual(passed)
    expect(book.find(exam.id)?.entry.due).toEqual({ kind: 'day', day: '2026-11-12' })
    // Overdue homework is still fine to add: it's still to do.
    expect(
      await handleHomeworkRequest(
        book,
        { kind: 'add', input: { ...problemSet, due: past.due } },
        never,
        now
      )
    ).toEqual({ ok: true })
  })

  it('never puts the homework’s name in an answer', async () => {
    for (let i = 0; i < MAX_ENTRIES; i++) book.add(problemSet)
    const answers = [
      await handleHomeworkRequest(book, { kind: 'add', input: problemSet }, never),
      await handleHomeworkRequest(book, { kind: 'delete', id: 'nope' }, never)
    ]
    for (const answer of answers) expect(JSON.stringify(answer)).not.toContain('Problem set 7')
  })
})
