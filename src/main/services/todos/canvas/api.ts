import { TodoSourceError, type ProviderTodo } from '../provider'
import { TODO_SOURCE_NAMES } from '../types'

const PER_PAGE = '100'
const MAX_TITLE_CHARS = 500
const MAX_NAME_CHARS = 200
const MAX_LABEL_CHARS = 24
/** Canvas ids are integers, sometimes sent as strings; global ids run to 16 digits or so. */
const ID = /^\d{1,20}$/
/** "BIO 181", "CSE110", "T-MAT265-70345" → the subject and number, the mockup's course code. */
const COURSE_NUMBER = /(?<![A-Za-z])([A-Z]{2,4})[ _-]?(\d{3}[A-Z]?)(?![A-Za-z0-9])/

/** Planner entries that aren't things to do: class meetings and news. */
const SKIPPED_TYPES = new Set(['announcement', 'calendar_event'])

export interface PlannerOverride {
  id: string
  markedComplete: boolean
  /** Epoch seconds; for a check-off made through the planner, about when it happened. */
  updatedAt: number | null
}

/** Where a check-off is written: the planner override's plannable. */
export interface OverrideTarget {
  type: string
  id: string
}

export interface PlannerItem {
  /** `${plannable_type}:${id}`, unique across the planner. */
  key: string
  title: string
  courseId: string | null
  /** The course's name, used when the course list doesn't have it (say, a finished course). */
  contextName: string | null
  /** Epoch seconds. */
  dueAt: number | null
  /** Canvas's own rule, so the list matches the planner. */
  done: boolean
  override: PlannerOverride | null
  target: OverrideTarget
}

export interface Course {
  id: string
  /** "BIO 181" */
  label: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function id(value: unknown): string | null {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  return typeof value === 'string' && ID.test(value) ? value : null
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function epochSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

export function selfUrl(origin: string): string {
  return new URL('/api/v1/users/self', origin).toString()
}

/** Everything the planner has between two moments (epoch seconds). */
export function plannerItemsUrl(origin: string, startSec: number, endSec: number): string {
  const url = new URL('/api/v1/planner/items', origin)
  url.searchParams.set('start_date', new Date(startSec * 1000).toISOString())
  url.searchParams.set('end_date', new Date(endSec * 1000).toISOString())
  url.searchParams.set('per_page', PER_PAGE)
  return url.toString()
}

export function coursesUrl(origin: string): string {
  const url = new URL('/api/v1/courses', origin)
  url.searchParams.set('per_page', PER_PAGE)
  return url.toString()
}

export function overridesUrl(origin: string): string {
  return new URL('/api/v1/planner/overrides', origin).toString()
}

export function overrideUrl(origin: string, overrideId: string): string {
  return new URL(`/api/v1/planner/overrides/${encodeURIComponent(overrideId)}`, origin).toString()
}

/** The POST body for an item that has no override yet. */
export function newOverrideBody(target: OverrideTarget, done: boolean): string {
  return JSON.stringify({
    plannable_type: target.type,
    plannable_id: target.id,
    marked_complete: done
  })
}

/** The PUT body for an existing override. */
export function overrideBody(done: boolean): string {
  return JSON.stringify({ marked_complete: done })
}

export function parseOverride(raw: unknown): PlannerOverride | null {
  if (!isRecord(raw)) return null
  const overrideId = id(raw.id)
  if (!overrideId || typeof raw.marked_complete !== 'boolean') return null
  return {
    id: overrideId,
    markedComplete: raw.marked_complete,
    updatedAt: epochSeconds(raw.updated_at)
  }
}

/** The planner's own rule (Canvas's `isComplete`): a manual check wins, then a submission. */
function isComplete(
  type: string,
  plannable: Record<string, unknown>,
  override: PlannerOverride | null,
  submissions: unknown
): boolean {
  if (override) return override.markedComplete
  if (type === 'assessment_request') return plannable.workflow_state === 'completed'
  if (isRecord(submissions))
    return submissions.submitted === true && submissions.redo_request !== true
  return false
}

/** Network input: an off-shape entry is null, and so is anything that isn't a to-do. */
export function parsePlannerItem(entry: unknown): PlannerItem | null {
  if (!isRecord(entry) || !isRecord(entry.plannable)) return null
  const type = typeof entry.plannable_type === 'string' ? entry.plannable_type : null
  if (!type || !/^[a-z_]{1,40}$/.test(type) || SKIPPED_TYPES.has(type)) return null
  const plannable = entry.plannable
  const plannableId = id(plannable.id) ?? id(plannable.page_id) ?? id(entry.plannable_id)
  const title = text(plannable.title, MAX_TITLE_CHARS)
  if (!plannableId || !title) return null
  const override = parseOverride(entry.planner_override)
  // Graded quizzes and discussions are checked off through their assignment, like the planner does.
  const assignmentId = id(plannable.assignment_id)
  return {
    key: `${type}:${plannableId}`,
    title,
    courseId: id(plannable.course_id) ?? id(entry.course_id),
    contextName: text(entry.context_name, MAX_NAME_CHARS),
    dueAt: epochSeconds(entry.plannable_date),
    done: isComplete(type, plannable, override, entry.submissions),
    override,
    target: assignmentId ? { type: 'assignment', id: assignmentId } : { type, id: plannableId }
  }
}

/** A page of planner items; null when it isn't a list at all. */
export function parsePlannerPage(body: unknown): PlannerItem[] | null {
  if (!Array.isArray(body)) return null
  return (body as unknown[])
    .map(parsePlannerItem)
    .filter((item): item is PlannerItem => item !== null)
}

export function parseCoursesPage(body: unknown): Course[] | null {
  if (!Array.isArray(body)) return null
  return (body as unknown[]).flatMap((entry): Course[] => {
    if (!isRecord(entry)) return []
    const courseId = id(entry.id)
    const label = courseLabel(
      text(entry.course_code, MAX_NAME_CHARS) ?? '',
      text(entry.name, MAX_NAME_CHARS) ?? ''
    )
    return courseId && label ? [{ id: courseId, label }] : []
  })
}

/**
 * The short course code the card shows: "BIO 181" out of "BIO 181", "2026Fall-T-BIO181-70345"
 * or "BIO 181: General Biology I". Codes that don't look like that are shown as they are.
 */
export function courseLabel(code: string, name = ''): string | null {
  for (const candidate of [code, name]) {
    const match = COURSE_NUMBER.exec(candidate)
    if (match) return `${match[1]} ${match[2]}`
  }
  const whole = code.trim() || name.trim()
  if (!whole) return null
  return whole.length > MAX_LABEL_CHARS ? `${whole.slice(0, MAX_LABEL_CHARS - 1)}…` : whole
}

/** "Canvas · BIO 181", or plain "Canvas" for the user's own planner notes. */
export function canvasContext(label: string | null): string {
  return label ? `${TODO_SOURCE_NAMES.canvas} · ${label}` : TODO_SOURCE_NAMES.canvas
}

export function itemLabel(item: PlannerItem, courses: ReadonlyMap<string, string>): string | null {
  if (!item.courseId) return null
  return courses.get(item.courseId) ?? (item.contextName ? courseLabel('', item.contextName) : null)
}

/** What we know about an item's check-off from the lists we've seen. */
export interface Seen {
  done: boolean
  /** Epoch seconds; null when it was already done the first time we saw it. */
  at: number | null
}

/**
 * When each item was finished. Canvas only dates check-offs made in the planner; for a
 * submission, the moment a list first shows it done is close enough.
 */
export function trackCompletions(
  items: readonly PlannerItem[],
  previous: ReadonlyMap<string, Seen>,
  nowSec: number
): Map<string, Seen> {
  const next = new Map<string, Seen>()
  for (const item of items) {
    if (!item.done) {
      next.set(item.key, { done: false, at: null })
    } else if (item.override?.markedComplete && item.override.updatedAt !== null) {
      next.set(item.key, { done: true, at: item.override.updatedAt })
    } else {
      const before = previous.get(item.key)
      next.set(item.key, { done: true, at: before ? (before.done ? before.at : nowSec) : null })
    }
  }
  return next
}

/** Open items, plus done ones finished today or due today, like Google's "done today". */
export function isShown(
  item: { done: boolean; dueAt: number | null },
  completedAt: number | null,
  today: { start: number; end: number }
): boolean {
  if (!item.done) return true
  if (completedAt !== null && completedAt >= today.start) return true
  return item.dueAt !== null && item.dueAt >= today.start && item.dueAt < today.end
}

export function toProviderTodo(
  item: PlannerItem,
  label: string | null,
  completedAt: number | null
): ProviderTodo {
  return {
    id: item.key,
    title: item.title,
    context: canvasContext(label),
    due: item.dueAt !== null ? { kind: 'time', at: item.dueAt } : null,
    done: item.done,
    completedAt: item.done ? completedAt : null
  }
}

const BUSY = 'Canvas asked Focus Screen to slow down. Trying again soon.'

/** What a failed Canvas answer means for the user. Writes never blame the whole connection. */
export function apiError(status: number, body: unknown, during: 'read' | 'write'): TodoSourceError {
  if (status === 401) {
    return new TodoSourceError(
      'reconnect',
      'Canvas stopped accepting Focus Screen’s access token. Connect again with a new one.'
    )
  }
  // Canvas throttles with a plain-text 403 ("Rate Limit Exceeded"); real refusals are JSON.
  if (status === 429 || (status === 403 && body === null)) {
    return new TodoSourceError('offline', BUSY)
  }
  if (status === 403) {
    return during === 'read'
      ? new TodoSourceError(
          'setup',
          'Canvas won’t let this access token read your planner. Your school may limit tokens; the calendar feed works instead.'
        )
      : new TodoSourceError('offline', 'Canvas didn’t allow that change.')
  }
  if (status === 404) {
    return new TodoSourceError('offline', 'It’s no longer in Canvas.')
  }
  if (status >= 500) {
    return new TodoSourceError('offline', 'Canvas is having trouble. Trying again soon.')
  }
  return new TodoSourceError('offline', `Canvas said no (error ${status}).`)
}

/** Local midnight before `nowSec`. */
export function startOfLocalDay(nowSec: number): number {
  const date = new Date(nowSec * 1000)
  date.setHours(0, 0, 0, 0)
  return Math.floor(date.getTime() / 1000)
}

/** Local midnight `days` days from the one before `nowSec` (daylight saving included). */
export function localDayStart(nowSec: number, days: number): number {
  const date = new Date(startOfLocalDay(nowSec) * 1000)
  date.setDate(date.getDate() + days)
  return Math.floor(date.getTime() / 1000)
}
