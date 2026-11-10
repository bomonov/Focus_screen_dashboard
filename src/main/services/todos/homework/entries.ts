import type { HomeworkEntry, HomeworkInput, HomeworkKind, TodoDue } from '../types'
import { MAX_COURSE_CHARS, MAX_TITLE_CHARS } from './shared'

/** Far more than a semester holds; a hand-edited file can't make the card crawl. */
export const MAX_ENTRIES = 500

const KINDS: readonly HomeworkKind[] = ['homework', 'exam']
/** The furthest a JavaScript Date reaches, in epoch seconds (8.64e15 ms). */
const MAX_EPOCH_SEC = 8.64e12
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
/** Ids become item ids ("homework:<id>") and menu targets, so nothing odd gets through. */
const ID = /^[A-Za-z0-9_-]{1,64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A real calendar day: 2026-02-30 rolls over in Date, so it's refused here. */
function isDay(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DAY.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function parseDue(raw: unknown): TodoDue | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'day') return isDay(raw.day) ? { kind: 'day', day: raw.day } : null
  // Within what a Date can hold, so a hand-edited file can't make the screen throw.
  if (raw.kind === 'time') {
    return typeof raw.at === 'number' && Math.abs(raw.at) <= MAX_EPOCH_SEC
      ? { kind: 'time', at: raw.at }
      : null
  }
  return null
}

/** What the form sends, and each saved entry: only the exact known shape passes. */
export function parseHomeworkInput(raw: unknown): HomeworkInput | null {
  if (!isRecord(raw)) return null
  const kind = KINDS.find((known) => known === raw.kind)
  if (!kind || typeof raw.title !== 'string') return null
  const title = raw.title.trim()
  if (!title || title.length > MAX_TITLE_CHARS) return null
  let course: string | null = null
  if (typeof raw.course === 'string') {
    course = raw.course.trim() || null
    if (course && course.length > MAX_COURSE_CHARS) return null
  } else if (raw.course !== null && raw.course !== undefined) {
    return null
  }
  const due = parseDue(raw.due)
  return due ? { kind, title, course, due } : null
}

/**
 * homework.json, read as untrusted: a broken or odd file only loses what can't be read. An
 * entry with `doneAt` (a ticked one, from a build before ticks left the file) stays gone.
 */
export function parseHomeworkFile(raw: unknown): HomeworkEntry[] {
  if (!isRecord(raw) || !Array.isArray(raw.entries)) return []
  const entries: HomeworkEntry[] = []
  const seen = new Set<string>()
  for (const item of raw.entries) {
    if (entries.length >= MAX_ENTRIES) break
    if (!isRecord(item) || 'doneAt' in item) continue
    if (typeof item.id !== 'string' || !ID.test(item.id) || seen.has(item.id)) continue
    const input = parseHomeworkInput(item)
    if (!input) continue
    seen.add(item.id)
    entries.push({ id: item.id, ...input })
  }
  return entries
}

export function homeworkFile(entries: readonly HomeworkEntry[]): {
  version: 1
  entries: HomeworkEntry[]
} {
  return {
    version: 1,
    entries: entries.map(({ id, kind, title, course, due }) => ({ id, kind, title, course, due }))
  }
}

export function isEntryId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

/** A timed exam is over at its time; one with only a day, at the next local midnight. */
export function examOver(due: TodoDue, nowSec: number): boolean {
  if (due.kind === 'time') return nowSec >= due.at
  const match = DAY.exec(due.day)
  if (!match) return false
  const nextMidnight = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1)
  return nowSec >= nextMidnight.getTime() / 1000
}

/** Overdue homework stays: only the user's tick takes it away. */
export function withoutEndedExams(
  entries: readonly HomeworkEntry[],
  nowSec: number
): HomeworkEntry[] {
  return entries.filter((entry) => entry.kind !== 'exam' || !examOver(entry.due, nowSec))
}
