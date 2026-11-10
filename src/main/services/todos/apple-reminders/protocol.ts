// What the Reminders helper prints (native/mac-reminders). Its output is parsed as untrusted:
// anything off-shape counts as no data.
import type { TodoDue } from '../types'

/** macOS's answer to "may Focus Screen see your reminders?" */
export type RemindersAccess = 'granted' | 'denied' | 'restricted' | 'notDetermined'

export type HelperError = 'access' | 'notFound' | 'readOnly' | 'failed' | 'badRequest'

export interface HelperList {
  id: string
  title: string
}

export interface HelperReminder {
  id: string
  /** The id of its list. */
  list: string
  title: string
  due: TodoDue | null
  done: boolean
  /** Epoch seconds. */
  completedAt: number | null
  createdAt: number | null
}

export type HelperMessage =
  | { type: 'access'; status: RemindersAccess }
  | { type: 'changed' }
  /** The answer to request `id`; `body` is read by whoever made the request. */
  | { type: 'reply'; id: number; body: Record<string, unknown> }

export type HelperFailure = { ok: false; error: HelperError; status: RemindersAccess | null }

export type ListReply =
  { ok: true; lists: HelperList[]; reminders: HelperReminder[] } | HelperFailure

export type WriteReply = { ok: true } | HelperFailure

/** The helper sends at most 2,000 open and 500 done; anything past this is not ours. */
const MAX_REMINDERS = 2500
const MAX_LISTS = 1000
const MAX_ID_CHARS = 500
const MAX_TITLE_CHARS = 300
const MAX_LIST_TITLE_CHARS = 100
const DAY = /^\d{4}-\d{2}-\d{2}$/
const ACCESS: readonly RemindersAccess[] = ['granted', 'denied', 'restricted', 'notDetermined']
const ERRORS: readonly HelperError[] = ['access', 'notFound', 'readOnly', 'failed', 'badRequest']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAccess(value: unknown): RemindersAccess | null {
  return ACCESS.find((status) => status === value) ?? null
}

function parseId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_CHARS
    ? value
    : null
}

function parseEpoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function parseDue(value: unknown): TodoDue | null {
  if (!isRecord(value)) return null
  if (typeof value.day === 'string' && DAY.test(value.day)) return { kind: 'day', day: value.day }
  const at = parseEpoch(value.at)
  return at === null ? null : { kind: 'time', at }
}

export function parseHelperMessage(raw: unknown): HelperMessage | null {
  if (!isRecord(raw)) return null
  switch (raw.type) {
    case 'access': {
      const status = parseAccess(raw.status)
      return status ? { type: 'access', status } : null
    }
    case 'changed':
      return { type: 'changed' }
    case 'reply':
      return typeof raw.id === 'number' && Number.isSafeInteger(raw.id)
        ? { type: 'reply', id: raw.id, body: raw }
        : null
    default:
      return null
  }
}

function parseFailure(body: Record<string, unknown>): HelperFailure | null {
  if (body.ok !== false) return null
  const error = ERRORS.find((kind) => kind === body.error) ?? 'failed'
  return { ok: false, error, status: parseAccess(body.status) }
}

function parseList(raw: unknown): HelperList | null {
  if (!isRecord(raw)) return null
  const id = parseId(raw.id)
  if (!id || typeof raw.title !== 'string') return null
  return { id, title: raw.title.trim().slice(0, MAX_LIST_TITLE_CHARS) }
}

function parseReminder(raw: unknown): HelperReminder | null {
  if (!isRecord(raw)) return null
  const id = parseId(raw.id)
  if (!id || typeof raw.title !== 'string' || typeof raw.done !== 'boolean') return null
  return {
    id,
    list: typeof raw.list === 'string' ? raw.list : '',
    title: raw.title.trim().slice(0, MAX_TITLE_CHARS),
    due: parseDue(raw.due),
    done: raw.done,
    completedAt: raw.done ? parseEpoch(raw.completedAt) : null,
    createdAt: parseEpoch(raw.createdAt)
  }
}

/** null: the reply isn't one the app understands. Malformed entries are skipped one by one. */
export function parseListReply(body: Record<string, unknown>): ListReply | null {
  const failure = parseFailure(body)
  if (failure) return failure
  if (body.ok !== true || !Array.isArray(body.lists) || !Array.isArray(body.items)) return null
  const lists = body.lists
    .slice(0, MAX_LISTS)
    .map(parseList)
    .filter((list) => list !== null)
  const reminders = body.items
    .slice(0, MAX_REMINDERS)
    .map(parseReminder)
    .filter((reminder) => reminder !== null)
  return { ok: true, lists, reminders }
}

export function parseWriteReply(body: Record<string, unknown>): WriteReply | null {
  return parseFailure(body) ?? (body.ok === true ? { ok: true } : null)
}
