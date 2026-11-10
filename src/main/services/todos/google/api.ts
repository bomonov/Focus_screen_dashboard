import { TodoSourceError, type ProviderTodo } from '../provider'
import { TODO_SOURCE_NAMES } from '../types'

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1/'
/** Google's maximum page size for tasks. */
const PAGE_SIZE = '100'
const MAX_ID_CHARS = 200
const MAX_TITLE_CHARS = 500
const DAY = /^\d{4}-\d{2}-\d{2}/

export interface GoogleTaskList {
  id: string
  title: string
}

export interface GoogleTask {
  id: string
  title: string
  done: boolean
  /** YYYY-MM-DD. Google keeps only the date of a due time, so it's a plain day. */
  due: string | null
  /** Epoch seconds. */
  completedAt: number | null
  /** A subtask's parent task. */
  parent: string | null
  /** Google's sort key within the list (or within the parent, for a subtask). */
  position: string
}

export interface Page<T> {
  items: T[]
  nextPageToken: string | null
}

export type TaskFilter =
  | { kind: 'open' }
  /** Tasks finished since this moment (epoch seconds), including ones checked off in Google's apps. */
  | { kind: 'doneSince'; since: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function id(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && value.length <= MAX_ID_CHARS ? value : null
}

export function taskListsUrl(pageToken: string | null): string {
  const url = new URL('users/@me/lists', TASKS_API)
  url.searchParams.set('maxResults', PAGE_SIZE)
  if (pageToken) url.searchParams.set('pageToken', pageToken)
  return url.toString()
}

export function tasksUrl(listId: string, filter: TaskFilter, pageToken: string | null): string {
  const url = new URL(`lists/${encodeURIComponent(listId)}/tasks`, TASKS_API)
  url.searchParams.set('maxResults', PAGE_SIZE)
  // Tasks assigned from Docs or Chat show in the user's own Google Tasks, so here too.
  url.searchParams.set('showAssigned', 'true')
  if (filter.kind === 'open') {
    url.searchParams.set('showCompleted', 'false')
  } else {
    url.searchParams.set('showCompleted', 'true')
    // Google hides tasks checked off in its own apps; without this they'd never show as done.
    url.searchParams.set('showHidden', 'true')
    url.searchParams.set('completedMin', new Date(filter.since * 1000).toISOString())
  }
  if (pageToken) url.searchParams.set('pageToken', pageToken)
  return url.toString()
}

export function taskUrl(listId: string, taskId: string): string {
  return new URL(
    `lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    TASKS_API
  ).toString()
}

/** The PATCH body that checks a task off or back on. */
export function doneBody(done: boolean): string {
  return JSON.stringify(done ? { status: 'completed' } : { status: 'needsAction', completed: null })
}

function nextPageToken(body: Record<string, unknown>): string | null {
  return typeof body.nextPageToken === 'string' && body.nextPageToken !== ''
    ? body.nextPageToken
    : null
}

/** Network input: off-shape entries are skipped; an off-shape page is null. */
export function parseTaskListsPage(body: unknown): Page<GoogleTaskList> | null {
  if (!isRecord(body)) return null
  const raw = Array.isArray(body.items) ? (body.items as unknown[]) : []
  const items = raw.flatMap((entry): GoogleTaskList[] => {
    if (!isRecord(entry)) return []
    const listId = id(entry.id)
    if (!listId) return []
    const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, 100) : ''
    return [{ id: listId, title }]
  })
  return { items, nextPageToken: nextPageToken(body) }
}

export function parseTask(entry: unknown): GoogleTask | null {
  if (!isRecord(entry) || entry.deleted === true) return null
  const taskId = id(entry.id)
  const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, MAX_TITLE_CHARS) : ''
  // Google lets a task be saved with no title; there's nothing to show for it.
  if (!taskId || !title) return null
  const due = typeof entry.due === 'string' ? (DAY.exec(entry.due)?.[0] ?? null) : null
  const completed = typeof entry.completed === 'string' ? Date.parse(entry.completed) : NaN
  return {
    id: taskId,
    title,
    done: entry.status === 'completed',
    due,
    completedAt: Number.isFinite(completed) ? Math.floor(completed / 1000) : null,
    parent: id(entry.parent),
    position: typeof entry.position === 'string' ? entry.position : ''
  }
}

export function parseTasksPage(body: unknown): Page<GoogleTask> | null {
  if (!isRecord(body)) return null
  const raw = Array.isArray(body.items) ? (body.items as unknown[]) : []
  const items = raw.map(parseTask).filter((task): task is GoogleTask => task !== null)
  return { items, nextPageToken: nextPageToken(body) }
}

const byPosition = (a: GoogleTask, b: GoogleTask): number =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0

/**
 * The list as Google Tasks shows it: tasks in the user's order, each subtask right under
 * its parent. A subtask whose parent isn't in the list (say, the parent was finished
 * yesterday) stands on its own.
 */
export function orderTasks(tasks: readonly GoogleTask[]): GoogleTask[] {
  const unique = [...new Map(tasks.map((task) => [task.id, task])).values()]
  const ids = new Set(unique.map((task) => task.id))
  const children = new Map<string, GoogleTask[]>()
  const roots: GoogleTask[] = []
  for (const task of unique) {
    if (task.parent && ids.has(task.parent)) {
      children.set(task.parent, [...(children.get(task.parent) ?? []), task])
    } else {
      roots.push(task)
    }
  }
  return roots
    .sort(byPosition)
    .flatMap((root) => [root, ...(children.get(root.id) ?? []).sort(byPosition)])
}

/** "Google Tasks" when there's one list; with several, which list it's on, like Canvas courses. */
export function listContext(list: GoogleTaskList, listCount: number): string {
  if (listCount <= 1 || !list.title) return TODO_SOURCE_NAMES.google
  return `Google · ${list.title}`
}

export function toProviderTodo(
  list: GoogleTaskList,
  task: GoogleTask,
  listCount: number
): ProviderTodo {
  return {
    id: `${list.id}/${task.id}`,
    title: task.title,
    context: listContext(list, listCount),
    due: task.due ? { kind: 'day', day: task.due } : null,
    done: task.done,
    completedAt: task.done ? task.completedAt : null
  }
}

/** Every `reason` Google put in an error body, old style (`errors`) and new (`details`). */
/** The reasons Google gives for an error ("accessNotConfigured"), wherever its reply puts them. */
export function errorReasons(body: unknown): string[] {
  if (!isRecord(body) || !isRecord(body.error)) return []
  const reasons: string[] = []
  const { errors, details, status } = body.error
  if (typeof status === 'string') reasons.push(status)
  for (const list of [errors, details]) {
    if (!Array.isArray(list)) continue
    for (const entry of list as unknown[]) {
      if (isRecord(entry) && typeof entry.reason === 'string') reasons.push(entry.reason)
    }
  }
  return reasons
}

const BUSY = 'Google Tasks asked Focus Screen to slow down. Trying again soon.'

/** What a failed Tasks API answer means for the user. */
export function apiError(status: number, body: unknown): TodoSourceError {
  const reasons = errorReasons(body)
  const has = (...wanted: string[]): boolean => wanted.some((reason) => reasons.includes(reason))
  if (status === 401) {
    return new TodoSourceError('reconnect', 'Google signed Focus Screen out. Connect again.')
  }
  if (status === 403 && has('accessNotConfigured', 'SERVICE_DISABLED')) {
    return new TodoSourceError(
      'setup',
      'The Google Tasks API is turned off in your Google Cloud project. Turn it on in Google Cloud Console, then try again.'
    )
  }
  if (status === 403 && has('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
    return new TodoSourceError(
      'reconnect',
      'Focus Screen can’t see your tasks. Connect again and allow access to Google Tasks.'
    )
  }
  if (
    status === 429 ||
    (status === 403 &&
      has('rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'RATE_LIMIT_EXCEEDED'))
  ) {
    return new TodoSourceError('offline', BUSY)
  }
  if (status === 404) {
    return new TodoSourceError('offline', 'It’s no longer in Google Tasks.')
  }
  if (status >= 500) {
    return new TodoSourceError('offline', 'Google Tasks is having trouble. Trying again soon.')
  }
  return new TodoSourceError('offline', `Google Tasks said no (error ${status}).`)
}

/** Local midnight before `nowSec`: "done today" starts here. */
export function startOfLocalDay(nowSec: number): number {
  const date = new Date(nowSec * 1000)
  date.setHours(0, 0, 0, 0)
  return Math.floor(date.getTime() / 1000)
}
