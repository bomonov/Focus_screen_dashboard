import type { HomeworkEntry, HomeworkInput, HomeworkRequest, HomeworkResult } from '../types'
import type { HomeworkBook } from './book'
import { examOver } from './entries'

// Answers say what happened without naming the homework: they can end up in a log.
const GONE: HomeworkResult = { ok: false, message: 'That one’s gone already.' }
const FULL: HomeworkResult = { ok: false, message: 'Your list is full. Delete some first.' }
const PASSED: HomeworkResult = { ok: false, message: 'That exam’s time has already passed.' }
const OK: HomeworkResult = { ok: true }

/** An exam already over would be let go at the next prune: on an edit, gone for good. */
function alreadyOver(input: HomeworkInput, nowSec: number): boolean {
  return input.kind === 'exam' && examOver(input.due, nowSec)
}

/**
 * Adds, edits or deletes one of the user's own homeworks or exams. A delete asks first, since
 * there's no getting it back; saying no isn't a failure.
 */
export async function handleHomeworkRequest(
  book: HomeworkBook,
  request: HomeworkRequest,
  confirmDelete: (entry: HomeworkEntry) => Promise<boolean>,
  now: () => number = () => Date.now() / 1000
): Promise<HomeworkResult> {
  switch (request.kind) {
    case 'add':
      if (alreadyOver(request.input, now())) return PASSED
      return book.add(request.input) ? OK : FULL
    case 'edit':
      if (alreadyOver(request.input, now())) return PASSED
      return book.edit(request.id, request.input) ? OK : GONE
    case 'delete': {
      const found = book.find(request.id)
      if (!found) return GONE
      if (!(await confirmDelete(found.entry))) return OK
      return book.remove(request.id) ? OK : GONE
    }
  }
}
