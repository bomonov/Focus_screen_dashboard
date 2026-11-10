import { describe, expect, it } from 'vitest'
import { dueSortKey, sortTodos, toTodoItem, type RankedTodo } from './merge'
import type { ProviderTodo } from './provider'
import type { TodoDue, TodoSourceId } from './types'

function todo(id: string, changes: Partial<ProviderTodo> = {}): ProviderTodo {
  return {
    id,
    title: id,
    context: 'Google Tasks',
    due: null,
    done: false,
    completedAt: null,
    ...changes
  }
}

function ranked(
  source: TodoSourceId,
  id: string,
  order: number,
  changes: Partial<ProviderTodo> = {}
): RankedTodo {
  return { item: toTodoItem(source, todo(id, changes), undefined), order }
}

const ids = (todos: RankedTodo[]): string[] => sortTodos(todos).map((item) => item.id)

/** A local time on a day, as epoch seconds, so the tests hold in any time zone. */
function localTime(day: string, hours: number, minutes = 0): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, date, hours, minutes).getTime() / 1000
}

const day = (value: string): TodoDue => ({ kind: 'day', day: value })
const at = (value: number): TodoDue => ({ kind: 'time', at: value })

describe('toTodoItem', () => {
  it('prefixes the id with the source', () => {
    expect(toTodoItem('google', todo('list/task'), undefined)).toMatchObject({
      id: 'google:list/task',
      source: 'google',
      pending: false
    })
  })

  it('drops a completion time on an item that isn’t done', () => {
    expect(toTodoItem('google', todo('a', { completedAt: 5 }), undefined).completedAt).toBeNull()
  })

  it('shows a pending check-off with the time it was pressed', () => {
    const item = toTodoItem('google', todo('a'), { done: true, at: 100, confirmed: false })
    expect(item).toMatchObject({ done: true, completedAt: 100, pending: true })
    const undone = toTodoItem('google', todo('b', { done: true, completedAt: 50 }), {
      done: false,
      at: 100,
      confirmed: false
    })
    expect(undone).toMatchObject({ done: false, completedAt: null, pending: true })
  })

  it('stops showing a check-off as pending once the source confirms it', () => {
    const item = toTodoItem('google', todo('a'), { done: true, at: 100, confirmed: true })
    expect(item).toMatchObject({ done: true, pending: false })
  })
})

describe('dueSortKey', () => {
  it('puts a plain day at the end of that local day', () => {
    expect(dueSortKey(day('2026-10-14'))).toBe(localTime('2026-10-14', 23, 59) + 59)
    expect(dueSortKey(day('2026-10-14'))).toBeGreaterThan(localTime('2026-10-14', 23, 0))
    expect(dueSortKey(day('2026-10-14'))).toBeLessThan(localTime('2026-10-15', 0, 1))
  })

  it('sorts a broken day last', () => {
    expect(dueSortKey(day('soon'))).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('sortTodos', () => {
  it('puts unfinished items before done ones', () => {
    expect(
      ids([
        ranked('google', 'done', 0, { done: true, completedAt: 10 }),
        ranked('google', 'open', 1)
      ])
    ).toEqual(['google:open', 'google:done'])
  })

  it('orders unfinished items by due date, overdue first and undated last', () => {
    expect(
      ids([
        ranked('google', 'none', 0),
        ranked('google', 'tomorrow', 1, { due: day('2026-10-15') }),
        ranked('google', 'overdue', 2, { due: day('2026-10-10') }),
        ranked('google', 'today', 3, { due: day('2026-10-14') })
      ])
    ).toEqual(['google:overdue', 'google:today', 'google:tomorrow', 'google:none'])
  })

  it('puts a deadline today before a plain "today"', () => {
    expect(
      ids([
        ranked('google', 'today', 0, { due: day('2026-10-14') }),
        ranked('canvas', 'quiz', 0, { due: at(localTime('2026-10-14', 23, 59)) }),
        ranked('canvas', 'lab', 1, { due: at(localTime('2026-10-15', 9)) })
      ])
    ).toEqual(['canvas:quiz', 'google:today', 'canvas:lab'])
  })

  it('breaks ties by source, then by each source’s own order', () => {
    expect(
      ids([
        ranked('google', 'second', 1),
        ranked('google', 'first', 0),
        ranked('reminders', 'bell', 4),
        ranked('canvas', 'cap', 9)
      ])
    ).toEqual(['canvas:cap', 'reminders:bell', 'google:first', 'google:second'])
  })

  it('lists done items newest first', () => {
    expect(
      ids([
        ranked('google', 'early', 0, { done: true, completedAt: 100 }),
        ranked('google', 'late', 1, { done: true, completedAt: 300 }),
        ranked('canvas', 'middle', 0, { done: true, completedAt: 200 })
      ])
    ).toEqual(['google:late', 'canvas:middle', 'google:early'])
  })
})

describe('homework among the sources', () => {
  it('sorts after Canvas when both are due at the same moment', () => {
    const due = at(localTime('2026-10-30', 23, 59))
    expect(
      ids([ranked('homework', 'mine', 0, { due }), ranked('canvas', 'theirs', 0, { due })])
    ).toEqual(['canvas:theirs', 'homework:mine'])
  })

  it('carries the course, null when the source has none', () => {
    expect(toTodoItem('homework', todo('a', { course: 'MAT 265' }), undefined).course).toBe(
      'MAT 265'
    )
    expect(toTodoItem('google', todo('b'), undefined).course).toBeNull()
  })
})
