import type {
  TodoCommand,
  TodoDue,
  TodoItem,
  TodoProblem,
  TodoSourceId,
  TodoSourceState,
  TodoState
} from '../../../main/ipc'

export type TodoFilter = 'all' | TodoSourceId

/** The mockup's chip labels. */
const CHIP_LABELS: Record<TodoSourceId, string> = {
  canvas: 'Canvas',
  homework: 'Homework',
  reminders: 'Reminders',
  google: 'Google'
}

/** Sources the card itself can connect (Customize can connect every source). */
const CONNECT_FROM_CARD: readonly TodoSourceId[] = ['canvas', 'reminders', 'google']

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

export interface DueText {
  text: string
  overdue: boolean
}

function parseDay(day: string): Date | null {
  const match = DAY.exec(day)
  if (!match) return null
  const [, year, month, date] = match
  return new Date(Number(year), Number(month) - 1, Number(date))
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Calendar days from `from` to `to`; rounding absorbs daylight-saving days. */
function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS)
}

const formats = new Map<string, Intl.DateTimeFormat>()
function format(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`
  let formatter = formats.get(key)
  if (!formatter) {
    // undefined locale = the system's, like the clock in the top bar.
    formatter = new Intl.DateTimeFormat(locale, options)
    formats.set(key, formatter)
  }
  return formatter
}

/** "today", "tomorrow", "yesterday", "Thu" within a week, else "Oct 30" (with the year if it differs). */
function dayPhrase(date: Date, diff: number, now: Date, locale?: string): string {
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  if (Math.abs(diff) <= 6) return format(locale, { weekday: 'short' }).format(date)
  return format(locale, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {})
  }).format(date)
}

/**
 * The mockup's wording: a plain day reads "Today" / "Tomorrow" / "Due Fri"; a deadline reads
 * "Due today 11:59 PM" / "Due Thu"; anything past reads "Overdue · …".
 */
export function dueText(due: TodoDue, now: Date, locale?: string): DueText | null {
  if (due.kind === 'day') {
    const date = parseDay(due.day)
    if (!date) return null
    const diff = daysBetween(now, date)
    if (diff === 0) return { text: 'Today', overdue: false }
    if (diff === 1) return { text: 'Tomorrow', overdue: false }
    const phrase = dayPhrase(date, diff, now, locale)
    return diff < 0
      ? { text: `Overdue · ${phrase}`, overdue: true }
      : { text: `Due ${phrase}`, overdue: false }
  }
  const date = new Date(due.at * 1000)
  const diff = daysBetween(now, date)
  const time =
    Math.abs(diff) <= 1
      ? ` ${format(locale, { hour: 'numeric', minute: '2-digit' }).format(date)}`
      : ''
  const phrase = `${dayPhrase(date, diff, now, locale)}${time}`
  return date.getTime() < now.getTime()
    ? { text: `Overdue · ${phrase}`, overdue: true }
    : { text: `Due ${phrase}`, overdue: false }
}

/**
 * The grey line under a to-do: "Canvas · BIO 181 · Due today 11:59 PM". A check-off the
 * source never hears about (`localCheckOff`) says so, so nobody expects it in Canvas.
 */
export function metaText(
  item: TodoItem,
  now: Date,
  locale?: string,
  localCheckOff = false
): DueText {
  if (item.done) {
    return {
      text: `${item.context} · ${localCheckOff ? 'Done on this computer' : 'Done'}`,
      overdue: false
    }
  }
  const due = item.due ? dueText(item.due, now, locale) : null
  return due
    ? { text: `${item.context} · ${due.text}`, overdue: due.overdue }
    : { text: item.context, overdue: false }
}

/** A button in the card and the command it sends. */
export interface TodoAction {
  label: string
  command: TodoCommand
}

export type TodoBody =
  | { kind: 'loading' }
  /** Nothing connected: why, and the buttons that fix it. */
  | { kind: 'signedOut'; heading: string; hint: string; actions: TodoAction[] }
  /** null `cancel`: the wait is for a macOS prompt, which only its own buttons close. */
  | { kind: 'connecting'; heading: string; hint: string; cancel: TodoAction | null }
  /** Connected, but the first list never came. */
  | { kind: 'trouble'; heading: string; hint: string; action: TodoAction }
  | { kind: 'empty'; text: string }
  | { kind: 'list'; items: TodoItem[] }

export interface TodoNote {
  text: string
  /** Reconnect a source that signed out while others still show, or fix its access. */
  action: TodoAction | null
}

export interface TodoView {
  /** null until there's a list to count. */
  leftCount: number | null
  /** All plus one per connected source; empty with fewer than two sources. */
  chips: { filter: TodoFilter; label: string }[]
  /** The filter in effect: a source that went away falls back to All. */
  filter: TodoFilter
  notes: TodoNote[]
  body: TodoBody
  /** Sources whose check-offs stay on this computer. */
  localCheckOffs: TodoSourceId[]
}

const connectAction = (label: string, source: TodoSourceId): TodoAction => ({
  label,
  command: { kind: 'connect', source }
})

/** macOS turned access down: only System Settings can turn it back on. */
function permissionAction(source: TodoSourceId, problem: TodoProblem | null): TodoAction | null {
  return problem?.kind === 'permission'
    ? { label: 'Open System Settings', command: { kind: 'openPrivacySettings', source } }
    : null
}

/** Reminders waits on a macOS prompt; the others on a sign-in page in the browser. */
function connectingText(source: TodoSourceState): { heading: string; hint: string } {
  return source.id === 'reminders'
    ? {
        heading: 'Allow access to your reminders',
        hint: 'Click Allow in the macOS message that just opened.'
      }
    : {
        heading: `Finish signing in to ${source.name}`,
        hint: 'Focus Screen opened the sign-in page in your web browser.'
      }
}

/**
 * The sources that count as connected. Homework is always there, so an empty one doesn't: the
 * card still says nothing's connected and offers the Connect buttons (and the + in its title).
 */
function connectedSources(state: TodoState): TodoSourceState[] {
  const ownStuff = state.items.some((item) => item.source === 'homework') || state.exams.length > 0
  return state.sources.filter(
    (source) => source.connection === 'connected' && (source.id !== 'homework' || ownStuff)
  )
}

function signedOutBody(sources: readonly TodoSourceState[]): TodoBody {
  const troubled = sources.find((source) => source.problem && source.problem.kind !== 'offline')
  if (troubled?.problem) {
    const reconnect = troubled.problem.kind === 'reconnect'
    return {
      kind: 'signedOut',
      heading: reconnect ? `Sign in to ${troubled.name} again` : `${troubled.name} isn’t connected`,
      hint: troubled.problem.message,
      actions: CONNECT_FROM_CARD.includes(troubled.id)
        ? [connectAction(reconnect ? 'Reconnect' : `Connect ${troubled.name}`, troubled.id)]
        : []
    }
  }
  return {
    kind: 'signedOut',
    heading: 'No to-do sources connected',
    hint: sources.some((source) => source.id === 'homework')
      ? 'Connect one, or add your own homework with the + above.'
      : 'Your to-dos show up here once a source is connected.',
    actions: sources
      .filter((source) => CONNECT_FROM_CARD.includes(source.id))
      .map((source) => connectAction(`Connect ${source.name}`, source.id))
  }
}

function chooseBody(state: TodoState, filter: TodoFilter, items: TodoItem[]): TodoBody {
  const connected = connectedSources(state)
  if (connected.length === 0) {
    const connecting = state.sources.find((source) => source.connection === 'connecting')
    if (connecting) {
      return {
        kind: 'connecting',
        ...connectingText(connecting),
        cancel:
          connecting.id === 'reminders'
            ? null
            : { label: 'Cancel', command: { kind: 'cancelConnect', source: connecting.id } }
      }
    }
    return signedOutBody(state.sources)
  }
  if (items.length > 0) return { kind: 'list', items }

  const waiting = connected.filter((source) => source.syncedAt === null)
  const troubled = waiting.find((source) => source.problem)
  if (troubled?.problem) {
    return {
      kind: 'trouble',
      heading: `Can’t show ${troubled.name}`,
      hint: troubled.problem.message,
      action: permissionAction(troubled.id, troubled.problem) ?? {
        label: 'Try Again',
        command: { kind: 'refresh' }
      }
    }
  }
  if (waiting.length > 0) return { kind: 'loading' }
  return {
    kind: 'empty',
    text: filter === 'all' ? 'Nothing on your list' : `Nothing from ${CHIP_LABELS[filter]}`
  }
}

function notesFor(state: TodoState, body: TodoBody): TodoNote[] {
  const notes: TodoNote[] = []
  const showingSources = body.kind === 'list' || body.kind === 'empty'
  if (showingSources) {
    for (const source of state.sources) {
      if (source.connection === 'connecting') {
        notes.push({
          text:
            source.id === 'reminders'
              ? 'Click Allow in the macOS message about your reminders.'
              : `Finish signing in to ${source.name} in your browser.`,
          action: null
        })
      } else if (
        source.problem &&
        (source.connection === 'connected' || source.problem.kind !== 'offline')
      ) {
        notes.push({
          text: source.problem.message,
          action:
            permissionAction(source.id, source.problem) ??
            (source.connection === 'disconnected' && CONNECT_FROM_CARD.includes(source.id)
              ? connectAction('Reconnect', source.id)
              : null)
        })
      }
    }
  }
  if (state.notice) notes.push({ text: state.notice, action: null })
  return notes
}

export function todoView(state: TodoState | null, filter: TodoFilter): TodoView {
  if (!state)
    return {
      leftCount: null,
      chips: [],
      filter: 'all',
      notes: [],
      body: { kind: 'loading' },
      localCheckOffs: []
    }
  const connected = connectedSources(state)
  const chips =
    connected.length >= 2
      ? [
          { filter: 'all' as const, label: 'All' },
          ...connected.map((source) => ({ filter: source.id, label: CHIP_LABELS[source.id] }))
        ]
      : []
  const effective = chips.some((chip) => chip.filter === filter) ? filter : 'all'
  const items =
    effective === 'all' ? state.items : state.items.filter((item) => item.source === effective)
  const body = chooseBody(state, effective, items)
  return {
    // Like the mockup, the count covers every source, whatever the filter. Nothing loaded yet
    // isn't "0 left".
    leftCount: connected.some((source) => source.syncedAt !== null)
      ? state.items.filter((item) => !item.done).length
      : null,
    chips,
    filter: effective,
    notes: notesFor(state, body),
    body,
    localCheckOffs: state.sources
      .filter((source) => source.localCheckOffs)
      .map((source) => source.id)
  }
}

/**
 * The list kept in the order it had (`previous`, by id) while a check-off is shown, so the
 * ticked row stays put for a moment before it moves. Rows that weren't there before follow, in
 * the new order; rows that are gone drop out.
 */
export function heldOrder<T extends { id: string }>(
  items: readonly T[],
  previous: readonly string[]
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const kept = previous.flatMap((id) => {
    const item = byId.get(id)
    return item ? [item] : []
  })
  const seen = new Set(previous)
  return [...kept, ...items.filter((item) => !seen.has(item.id))]
}
