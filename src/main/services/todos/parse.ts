import { isEntryId, parseHomeworkInput } from './homework/entries'
import type { CanvasFormRequest, HomeworkRequest, TodoCommand, TodoSourceId } from './types'

const SOURCES: readonly TodoSourceId[] = ['canvas', 'reminders', 'google']
/** Item ids are a source prefix plus the source's own ids; nothing real comes close. */
const MAX_ID_CHARS = 1000
/** Generous caps for what the Canvas form sends; site.ts checks the real shape. */
const MAX_ADDRESS_CHARS = 300
const MAX_TOKEN_CHARS = 512
const MAX_FEED_CHARS = 2000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSource(value: unknown): TodoSourceId | undefined {
  return SOURCES.find((source) => source === value)
}

/** Commands come from the renderer, so they're untrusted: only the exact known shapes pass. */
export function parseTodoCommand(raw: unknown): TodoCommand | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'setDone':
      return typeof raw.id === 'string' &&
        raw.id.length > 0 &&
        raw.id.length <= MAX_ID_CHARS &&
        typeof raw.done === 'boolean'
        ? { kind: 'setDone', id: raw.id, done: raw.done }
        : null
    case 'refresh':
      return { kind: 'refresh' }
    case 'connect':
    case 'cancelConnect':
    case 'disconnect':
    case 'openPrivacySettings': {
      const source = parseSource(raw.source)
      return source ? { kind: raw.kind, source } : null
    }
    default:
      return null
  }
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null
}

/** The Canvas form's requests carry what the user typed; only the known shapes pass. */
export function parseCanvasFormRequest(raw: unknown): CanvasFormRequest | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'connectToken': {
      const address = boundedString(raw.address, MAX_ADDRESS_CHARS)
      const token = boundedString(raw.token, MAX_TOKEN_CHARS)
      return address !== null && token !== null ? { kind: 'connectToken', address, token } : null
    }
    case 'connectFeed': {
      const url = boundedString(raw.url, MAX_FEED_CHARS)
      return url !== null ? { kind: 'connectFeed', url } : null
    }
    case 'openPage': {
      const address = boundedString(raw.address, MAX_ADDRESS_CHARS)
      return address !== null && (raw.page === 'token' || raw.page === 'feed')
        ? { kind: 'openPage', page: raw.page, address }
        : null
    }
    default:
      return null
  }
}

/** The homework form's and menus' requests carry what the user typed: checked again here. */
export function parseHomeworkRequest(raw: unknown): HomeworkRequest | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'add': {
      const input = parseHomeworkInput(raw.input)
      return input ? { kind: 'add', input } : null
    }
    case 'edit': {
      const input = parseHomeworkInput(raw.input)
      return input && isEntryId(raw.id) ? { kind: 'edit', id: raw.id, input } : null
    }
    case 'delete':
      return isEntryId(raw.id) ? { kind: 'delete', id: raw.id } : null
    default:
      return null
  }
}

/** The quick menu's target: which of the user's own homeworks a right-click landed on. */
export function parseHomeworkTarget(raw: unknown): string | null {
  return isRecord(raw) && raw.kind === 'homework' && isEntryId(raw.id) ? raw.id : null
}
