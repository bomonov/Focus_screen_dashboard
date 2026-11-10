import type { ExamItem } from '../../../main/ipc'
import { DUE_SOON_DAYS } from '../../../main/services/todos/homework/shared'

/** One exam as the countdown at the top of the To-do card shows it. */
export interface ExamCountdown {
  id: string
  /** "BIO 181 Midterm", or the title alone with no class. */
  name: string
  /** "16", "1", or "Today". */
  big: string
  /** "days", "day", or null under "Today". */
  unit: string | null
  /** "Thu, Nov 12 · 9:00 AM", "Tomorrow · 9:00 AM", "Today · 9:00 AM · in 3 h". */
  when: string
  /** The one-line version, for a short card and the other exams: "16 days", "Tomorrow 9:00 AM". */
  brief: string
  /** Within DUE_SOON_DAYS: the accent. */
  near: boolean
}

const DAY_MS = 86_400_000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function examDate(exam: ExamItem): Date {
  if (exam.due.kind === 'time') return new Date(exam.due.at * 1000)
  const [year, month, day] = exam.due.day.split('-').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

/** "in 40 min", "in 1 h 30 min", "in 5 h": what's left on the day itself. */
function inTime(minutes: number): string {
  if (minutes < 60) return `in ${Math.max(1, minutes)} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 || hours >= 3 ? `in ${hours} h` : `in ${hours} h ${rest} min`
}

export function examCountdown(exam: ExamItem, now: Date, locale?: string): ExamCountdown {
  const date = examDate(exam)
  // Calendar days, so the count steps at midnight; rounding absorbs daylight-saving days.
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS)
  const time =
    exam.due.kind === 'time'
      ? new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(date)
      : null
  const withTime = (words: string, joiner: string): string =>
    time ? `${words}${joiner}${time}` : words
  const base = {
    id: exam.id,
    name: exam.course ? `${exam.course} ${exam.title}` : exam.title,
    near: days <= DUE_SOON_DAYS
  }
  if (days <= 0) {
    const left =
      exam.due.kind === 'time'
        ? ` · ${inTime(Math.ceil((exam.due.at * 1000 - now.getTime()) / 60_000))}`
        : ''
    return {
      ...base,
      big: 'Today',
      unit: null,
      when: `${withTime('Today', ' · ')}${left}`,
      brief: withTime('Today', ' ')
    }
  }
  if (days === 1) {
    return {
      ...base,
      big: '1',
      unit: 'day',
      when: withTime('Tomorrow', ' · '),
      brief: withTime('Tomorrow', ' ')
    }
  }
  const day = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {})
  }).format(date)
  return {
    ...base,
    big: String(days),
    unit: 'days',
    when: withTime(day, ' · '),
    brief: `${days} days`
  }
}

/** The soonest exam for the strip, and the others for "+N more". */
export function examStrip(
  exams: readonly ExamItem[],
  now: Date,
  locale?: string
): { first: ExamCountdown; rest: ExamCountdown[] } | null {
  const [first, ...rest] = exams.map((exam) => examCountdown(exam, now, locale))
  return first ? { first, rest } : null
}
