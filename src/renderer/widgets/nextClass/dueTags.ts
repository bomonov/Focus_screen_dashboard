import type { HomeworkKind, TodoDue, TodoState } from '../../../main/ipc'
import { DUE_SOON_DAYS, courseKey } from '../../../main/services/todos/homework/shared'
import { dueSortKey } from '../../../main/services/todos/merge'
import type { ClassWeekDay } from './classWeek'

/** Something of the user's own due soon for a class, under its next meeting in the week list. */
export interface DueTag {
  id: string
  kind: HomeworkKind
  /** "Problem set 7 · due tomorrow", "Midterm · Thu 9:00 AM". */
  text: string
  overdue: boolean
}

export interface RowTags {
  shown: DueTag[]
  /** How many more there are past the two shown: "+1 more". */
  more: number
}

const SHOWN = 2
const DAY_MS = 86_400_000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function dueDate(due: TodoDue): Date {
  if (due.kind === 'time') return new Date(due.at * 1000)
  const [year, month, day] = due.day.split('-').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

/** Calendar days from today; rounding absorbs daylight-saving days. */
function daysAway(due: TodoDue, now: Date): number {
  return Math.round((startOfDay(dueDate(due)) - startOfDay(now)) / DAY_MS)
}

function isOverdue(due: TodoDue, now: Date): boolean {
  return due.kind === 'time' ? due.at * 1000 < now.getTime() : daysAway(due, now) < 0
}

/** "today", "tomorrow", "Thu". */
function dayWord(days: number, date: Date, locale?: string): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date)
}

function timeOf(due: TodoDue, locale?: string): string | null {
  return due.kind === 'time'
    ? new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(dueDate(due))
    : null
}

interface Candidate {
  tag: DueTag
  course: string
  sortKey: number
}

/**
 * The tags for each class's next meeting (the first row of that class not over yet), by event
 * id: the user's own homework due within DUE_SOON_DAYS (overdue too, until it's ticked) and
 * their exams that close, soonest first. Canvas and the other sources stay out.
 */
export function dueTags(
  days: readonly ClassWeekDay[],
  todos: TodoState | null,
  now: Date,
  locale?: string
): Map<string, RowTags> {
  const tags = new Map<string, RowTags>()
  if (!todos) return tags
  const candidates: Candidate[] = []
  for (const item of todos.items) {
    if (item.source !== 'homework' || item.done || !item.course || !item.due) continue
    const away = daysAway(item.due, now)
    const overdue = isOverdue(item.due, now)
    if (!overdue && away > DUE_SOON_DAYS) continue
    const time = away === 0 ? timeOf(item.due, locale) : null
    const when = overdue
      ? 'overdue'
      : `due ${dayWord(away, dueDate(item.due), locale)}${time ? ` ${time}` : ''}`
    candidates.push({
      tag: { id: item.id, kind: 'homework', text: `${item.title} · ${when}`, overdue },
      course: item.course,
      sortKey: dueSortKey(item.due)
    })
  }
  for (const exam of todos.exams) {
    if (!exam.course) continue
    const away = daysAway(exam.due, now)
    if (away > DUE_SOON_DAYS) continue
    const time = timeOf(exam.due, locale)
    const when = `${dayWord(away, dueDate(exam.due), locale)}${time ? ` ${time}` : ''}`
    candidates.push({
      tag: { id: exam.id, kind: 'exam', text: `${exam.title} · ${when}`, overdue: false },
      course: exam.course,
      sortKey: dueSortKey(exam.due)
    })
  }
  if (candidates.length === 0) return tags

  const nextMeeting = new Map<string, string>()
  for (const day of days) {
    for (const row of day.rows) {
      const key = courseKey(row.event.title)
      if (!row.past && !nextMeeting.has(key)) nextMeeting.set(key, row.event.id)
    }
  }
  const byEvent = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const eventId = nextMeeting.get(courseKey(candidate.course))
    if (!eventId) continue
    byEvent.set(eventId, [...(byEvent.get(eventId) ?? []), candidate])
  }
  for (const [eventId, list] of byEvent) {
    const sorted = list.sort((a, b) => a.sortKey - b.sortKey).map((candidate) => candidate.tag)
    tags.set(eventId, { shown: sorted.slice(0, SHOWN), more: Math.max(0, sorted.length - SHOWN) })
  }
  return tags
}
