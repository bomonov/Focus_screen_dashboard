import { courseKey } from './homework/shared'
import { dueSortKey, sortTodos, toTodoItem, type Overlay, type RankedTodo } from './merge'
import { toProblem, type ProviderTodo, type TodoProvider } from './provider'
import type { ExamItem, TodoConnection, TodoProblem, TodoSourceId, TodoState } from './types'

/** The brief's "refreshes every 5 minutes". */
export const REFRESH_INTERVAL_SEC = 5 * 60
const NOTICE_SEC = 8
const NOTICE_TITLE_CHARS = 40

export interface TodoService {
  get(): TodoState
  subscribe(listener: (state: TodoState) => void): () => void
  /** Shows the change at once, then writes it to the source; takes it back if the source says no. */
  setDone(id: string, done: boolean): void
  /** Re-reads every connected source now. */
  refresh(): void
  /** Re-reads the sources whose list is older than this (window focus, waking from sleep). */
  refreshIfOlderThan(maxAgeSec: number): void
  /** Dev builds have demo sources that stand in while no real one is connected. */
  readonly hasDemo: boolean
  isDemoEnabled(): boolean
  setDemoEnabled(on: boolean): void
  dispose(): void
}

export interface TodoServiceOptions {
  /** Real sources, in the card's order. */
  providers: readonly TodoProvider[]
  demo?: readonly TodoProvider[] | null
  /** Unix epoch seconds; injectable for tests. */
  now?: () => number
}

interface Entry {
  provider: TodoProvider
  todos: ProviderTodo[]
  syncedAt: number | null
  problem: TodoProblem | null
  loading: boolean
  /** A refresh was asked for while one was running. */
  again: boolean
  connection: TodoConnection
}

interface Write {
  source: TodoSourceId
  providerId: string
  overlay: Overlay
  /** Sequence number when the source confirmed it; null while it's on its way. */
  confirmedSeq: number | null
}

const epochSeconds = (): number => Date.now() / 1000

/** One chip per class, however each source spells it; the first spelling stays. */
function uniqueClasses(classes: readonly string[]): string[] {
  const seen = new Set<string>()
  return classes.filter((course) => {
    const key = courseKey(course)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function shorten(title: string): string {
  return title.length > NOTICE_TITLE_CHARS ? `${title.slice(0, NOTICE_TITLE_CHARS - 1)}…` : title
}

export function createTodoService({
  providers,
  demo = null,
  now = epochSeconds
}: TodoServiceOptions): TodoService {
  const newEntry = (provider: TodoProvider): Entry => ({
    provider,
    todos: [],
    syncedAt: null,
    problem: null,
    loading: false,
    again: false,
    connection: provider.connection()
  })
  const entries = providers.map(newEntry)
  const demoEntries = (demo ?? []).map(newEntry)
  const listeners = new Set<(state: TodoState) => void>()
  /** Check-offs not yet seen in a fresh list, by item id. */
  const writes = new Map<string, Write>()
  /** Writes to one item go out one after another, so Google never gets them out of order. */
  const chains = new Map<string, Promise<void>>()
  /** Orders list requests against confirmed writes. */
  let seq = 0
  let demoEnabled = demoEntries.length > 0
  let notice: { text: string; timer: ReturnType<typeof setTimeout> } | null = null
  let disposed = false
  let state = compute()

  function demoActive(): boolean {
    return (
      demoEnabled &&
      demoEntries.length > 0 &&
      entries.every(
        (entry) =>
          entry.provider.hasContent?.() === false ||
          (entry.connection === 'disconnected' && entry.problem === null)
      )
    )
  }

  function activeEntries(): Entry[] {
    return demoActive() ? demoEntries : entries
  }

  function compute(): TodoState {
    const showDemo = demoActive()
    const active = showDemo ? demoEntries : entries
    const ranked: RankedTodo[] = active.flatMap((entry) =>
      entry.todos.map((todo, order) => {
        const write = writes.get(`${entry.provider.source}:${todo.id}`)
        return { item: toTodoItem(entry.provider.source, todo, write?.overlay), order }
      })
    )
    const exams: ExamItem[] = active
      .flatMap((entry) => entry.provider.exams?.() ?? [])
      .sort((a, b) => dueSortKey(a.due) - dueSortKey(b.due))
    return {
      sources: active.map((entry) => ({
        id: entry.provider.source,
        name: entry.provider.name,
        connection: entry.connection,
        problem: entry.problem,
        syncedAt: entry.syncedAt,
        localCheckOffs: entry.provider.localCheckOffs?.() ?? false
      })),
      items: sortTodos(ranked),
      exams,
      classes: uniqueClasses(active.flatMap((entry) => entry.provider.classes?.() ?? [])),
      supported: entries.map((entry) => entry.provider.source),
      demo: showDemo,
      notice: notice?.text ?? null
    }
  }

  function publish(): void {
    if (disposed) return
    const next = compute()
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    for (const listener of listeners) listener(state)
  }

  function showNotice(text: string): void {
    if (notice) clearTimeout(notice.timer)
    notice = {
      text,
      timer: setTimeout(() => {
        notice = null
        publish()
      }, NOTICE_SEC * 1000)
    }
  }

  function refreshEntry(entry: Entry): void {
    if (disposed || entry.connection !== 'connected') return
    if (entry.loading) {
      entry.again = true
      return
    }
    entry.loading = true
    const startedSeq = ++seq
    entry.provider
      .list()
      .then(
        (todos) => {
          // Signed out while the list was loading: those items aren't wanted any more.
          if (disposed || entry.connection !== 'connected') return
          entry.todos = todos
          entry.syncedAt = now()
          entry.problem = null
          settleWrites(entry, startedSeq)
        },
        (error: unknown) => {
          if (disposed) return
          const problem = toProblem(error, entry.provider.name)
          // A source the user just disconnected has nothing to be offline from.
          if (entry.connection !== 'disconnected' || problem.kind !== 'offline') {
            entry.problem = problem
          }
        }
      )
      .finally(() => {
        entry.loading = false
        if (disposed) return
        publish()
        if (entry.again) {
          entry.again = false
          refreshEntry(entry)
        }
      })
  }

  function settleWrites(entry: Entry, startedSeq: number): void {
    for (const [id, write] of writes) {
      if (write.source !== entry.provider.source) continue
      const present = entry.todos.some((todo) => todo.id === write.providerId)
      // A list requested after the source confirmed the write already shows it; an older one
      // may not, so the overlay stays until a newer list arrives.
      if (!present || (write.confirmedSeq !== null && startedSeq > write.confirmedSeq)) {
        writes.delete(id)
      }
    }
  }

  function dropWrites(source: TodoSourceId): void {
    for (const [id, write] of writes) if (write.source === source) writes.delete(id)
  }

  function refreshActive(): void {
    for (const entry of activeEntries()) refreshEntry(entry)
  }

  function onConnectionChange(entry: Entry): void {
    if (disposed) return
    const connection = entry.provider.connection()
    if (connection === entry.connection) return
    const demoWasActive = demoActive()
    entry.connection = connection
    // Any change of sign-in starts over: no stale items, no stale problem. A failed request
    // that caused the change sets its own problem right after.
    entry.problem = null
    if (connection !== 'connected') {
      entry.todos = []
      entry.syncedAt = null
      dropWrites(entry.provider.source)
    }
    if (connection === 'connected') refreshEntry(entry)
    if (!demoWasActive && demoActive()) refreshActive()
    publish()
  }

  function findTodo(id: string): { entry: Entry; todo: ProviderTodo } | null {
    for (const entry of activeEntries()) {
      const prefix = `${entry.provider.source}:`
      if (!id.startsWith(prefix)) continue
      const providerId = id.slice(prefix.length)
      const todo = entry.todos.find((candidate) => candidate.id === providerId)
      return todo ? { entry, todo } : null
    }
    return null
  }

  function setDone(id: string, done: boolean): void {
    const found = findTodo(id)
    if (disposed || !found) return
    const { entry, todo } = found
    const shownDone = writes.get(id)?.overlay.done ?? todo.done
    if (shownDone === done) return
    const write: Write = {
      source: entry.provider.source,
      providerId: todo.id,
      overlay: { done, at: now(), confirmed: false },
      confirmedSeq: null
    }
    writes.set(id, write)
    publish()

    const previous = chains.get(id) ?? Promise.resolve()
    const next = previous
      .then(() => entry.provider.setDone(todo.id, done))
      .then(
        () => {
          if (writes.get(id) !== write) return
          write.overlay = { ...write.overlay, confirmed: true }
          write.confirmedSeq = ++seq
        },
        (error: unknown) => {
          if (writes.get(id) === write) writes.delete(id)
          if (disposed) return
          const problem = toProblem(error, entry.provider.name)
          showNotice(`Couldn’t update “${shorten(todo.title)}”. ${problem.message}`)
          if (problem.kind !== 'offline') entry.problem = problem
          // Whatever the source has now is the truth.
          refreshEntry(entry)
        }
      )
      .finally(() => {
        if (chains.get(id) === next) chains.delete(id)
        publish()
      })
    chains.set(id, next)
  }

  for (const entry of [...entries, ...demoEntries]) {
    entry.provider.start(
      () => onConnectionChange(entry),
      () => refreshEntry(entry)
    )
    entry.connection = entry.provider.connection()
  }
  state = compute()
  refreshActive()
  const interval = setInterval(refreshActive, REFRESH_INTERVAL_SEC * 1000)

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setDone,
    refresh: refreshActive,
    refreshIfOlderThan(maxAgeSec) {
      const at = now()
      for (const entry of activeEntries()) {
        if (entry.syncedAt === null || at - entry.syncedAt >= maxAgeSec) refreshEntry(entry)
      }
    },
    hasDemo: demoEntries.length > 0,
    isDemoEnabled: () => demoEnabled,
    setDemoEnabled(on) {
      if (demoEntries.length === 0 || on === demoEnabled) return
      demoEnabled = on
      if (demoActive()) refreshActive()
      publish()
    },
    dispose() {
      disposed = true
      clearInterval(interval)
      if (notice) clearTimeout(notice.timer)
      for (const entry of [...entries, ...demoEntries]) entry.provider.dispose()
      listeners.clear()
    }
  }
}
