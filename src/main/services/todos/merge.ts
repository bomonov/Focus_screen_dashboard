import type { ProviderTodo } from './provider'
import type { TodoDue, TodoItem, TodoSourceId } from './types'

const SOURCE_ORDER: readonly TodoSourceId[] = ['canvas', 'homework', 'reminders', 'google']
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** A check-off shown before the source confirms it. */
export interface Overlay {
  done: boolean
  /** When it was pressed (epoch seconds), so a fresh "done" sorts as the newest. */
  at: number
  /** The source said yes; the overlay stays until a fresh list shows the change. */
  confirmed: boolean
}

/** A merged item plus where it sat in its source's list, the last tie-break. */
export interface RankedTodo {
  item: TodoItem
  order: number
}

export function toTodoItem(
  source: TodoSourceId,
  todo: ProviderTodo,
  overlay: Overlay | undefined
): TodoItem {
  const item: TodoItem = {
    id: `${source}:${todo.id}`,
    source,
    title: todo.title,
    context: todo.context,
    course: todo.course ?? null,
    due: todo.due,
    done: todo.done,
    completedAt: todo.done ? todo.completedAt : null,
    pending: false
  }
  if (!overlay) return item
  return {
    ...item,
    done: overlay.done,
    completedAt: overlay.done ? ((todo.done ? todo.completedAt : null) ?? overlay.at) : null,
    pending: !overlay.confirmed
  }
}

/**
 * Epoch seconds a due date sorts by. A day without a time counts as the end of that local
 * day, so "Due today 9:00 AM" comes before a plain "Today".
 */
export function dueSortKey(due: TodoDue): number {
  if (due.kind === 'time') return due.at
  const match = DAY.exec(due.day)
  if (!match) return Number.POSITIVE_INFINITY
  const [, year, month, day] = match
  return new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59).getTime() / 1000
}

function compareOpen(a: RankedTodo, b: RankedTodo): number {
  const dueA = a.item.due ? dueSortKey(a.item.due) : Number.POSITIVE_INFINITY
  const dueB = b.item.due ? dueSortKey(b.item.due) : Number.POSITIVE_INFINITY
  if (dueA !== dueB) return dueA < dueB ? -1 : 1
  return compareSourceThenOrder(a, b)
}

function compareDone(a: RankedTodo, b: RankedTodo): number {
  const atA = a.item.completedAt ?? 0
  const atB = b.item.completedAt ?? 0
  if (atA !== atB) return atB - atA
  return compareSourceThenOrder(a, b)
}

function compareSourceThenOrder(a: RankedTodo, b: RankedTodo): number {
  const source = SOURCE_ORDER.indexOf(a.item.source) - SOURCE_ORDER.indexOf(b.item.source)
  return source !== 0 ? source : a.order - b.order
}

/**
 * One list from every source: unfinished first, soonest due at the top (overdue included),
 * undated after dated, each source's own order breaking ties. Done items go last, newest first.
 */
export function sortTodos(todos: readonly RankedTodo[]): TodoItem[] {
  const open = todos.filter((todo) => !todo.item.done).sort(compareOpen)
  const done = todos.filter((todo) => todo.item.done).sort(compareDone)
  return [...open, ...done].map((todo) => todo.item)
}
