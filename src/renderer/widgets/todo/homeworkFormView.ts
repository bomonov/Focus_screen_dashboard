import type { HomeworkEntry, HomeworkInput, HomeworkKind, TodoDue } from '../../../main/ipc'

/** A Due chip: "Today", "Tomorrow", "Thu", and the day it stands for. */
export interface DueChoice {
  label: string
  /** 'YYYY-MM-DD', local. */
  day: string
}

export interface FormValues {
  kind: HomeworkKind
  title: string
  /** A class chip's text, null for "No class", undefined while none is picked. */
  course: string | null | undefined
  /** 'YYYY-MM-DD', or null while no day is picked. */
  day: string | null
  /** 'HH:MM', or null for no time. */
  time: string | null
}

/** Quick picks for an exam's name. */
export const EXAM_NAMES = ['Midterm', 'Final', 'Quiz'] as const

/** Canvas's own deadline, and most professors'. */
export const DEFAULT_TIME = '23:59'

/** The weekday chips after Tomorrow: the rest of the coming week. */
const MORE_DAYS = 4

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function dayOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDay(day: string): [number, number, number] {
  const [year, month, date] = day.split('-').map(Number)
  return [year ?? 0, month ?? 1, date ?? 1]
}

export function emptyForm(kind: HomeworkKind): FormValues {
  return { kind, title: '', course: undefined, day: null, time: null }
}

export function dueChoices(now: Date, locale?: string): DueChoice[] {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  return Array.from({ length: 2 + MORE_DAYS }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : weekday.format(date)
    return { label, day: dayOf(date) }
  })
}

export function toDue(day: string, time: string | null): TodoDue {
  if (time === null) return { kind: 'day', day }
  const [year, month, date] = parseDay(day)
  const [hours, minutes] = time.split(':').map(Number)
  const at = new Date(year, month - 1, date, hours ?? 0, minutes ?? 0)
  return { kind: 'time', at: at.getTime() / 1000 }
}

export function fromEntry(entry: HomeworkEntry): FormValues {
  const { kind, title, course, due } = entry
  if (due.kind === 'day') return { kind, title, course, day: due.day, time: null }
  const at = new Date(due.at * 1000)
  return {
    kind,
    title,
    course,
    day: dayOf(at),
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`
  }
}

/** What's still missing, in the order the form asks for it; null once it can be added. */
export function formProblem(values: FormValues): string | null {
  if (!values.title.trim()) return 'Give it a name.'
  if (values.course === undefined) return 'Pick a class, or No class.'
  if (values.day === null)
    return values.kind === 'exam' ? 'Pick the exam’s date.' : 'Pick a due date.'
  return null
}

export function toInput(values: FormValues): HomeworkInput | null {
  if (formProblem(values) !== null || values.course === undefined || values.day === null)
    return null
  return {
    kind: values.kind,
    title: values.title.trim(),
    course: values.course,
    due: toDue(values.day, values.time)
  }
}

export function formTitle(kind: HomeworkKind, editing: boolean): string {
  return `${editing ? 'Edit' : 'Add'} ${kind === 'exam' ? 'exam' : 'homework'}`
}

/** "11:59 PM": a picked time, written like the top bar's clock. */
export function timeLabel(time: string, locale?: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  const at = new Date(2000, 0, 1, hours ?? 0, minutes ?? 0)
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(at)
}
