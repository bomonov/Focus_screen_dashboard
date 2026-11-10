import type { ExamItem, TodoConnection, TodoDue, TodoProblem, TodoSourceId } from './types'

/** A to-do as one source reads it, before the service merges sources. */
export interface ProviderTodo {
  /** Unique within the source. Only the provider interprets it. */
  id: string
  title: string
  context: string
  /** Homework only: the class it's for. */
  course?: string | null
  due: TodoDue | null
  done: boolean
  completedAt: number | null
}

/** Thrown by `list` and `setDone`; anything else counts as "offline". */
export class TodoSourceError extends Error {
  constructor(
    readonly kind: TodoProblem['kind'],
    message: string
  ) {
    super(message)
    this.name = 'TodoSourceError'
  }
}

/** One to-do source (Google Tasks, Canvas, Reminders, or a mock). */
export interface TodoProvider {
  readonly source: TodoSourceId
  readonly name: string
  /**
   * `onChange` fires whenever `connection()` changes: signed in, signed out, sign-in expired.
   * `onItemsChanged` is for sources that announce their own changes (Reminders), so the list
   * is read again right away instead of at the next refresh.
   */
  start(onChange: () => void, onItemsChanged?: () => void): void
  connection(): TodoConnection
  /** Open items plus the ones finished today, in the source's own order. */
  list(): Promise<ProviderTodo[]>
  setDone(id: string, done: boolean): Promise<void>
  /** True while check-offs are kept on this computer only (a read-only source). */
  localCheckOffs?(): boolean
  /** Homework only: the user's exams, for the countdown. */
  exams?(): ExamItem[]
  /** Homework only: the classes the form offers. */
  classes?(): string[]
  /** A local source with nothing in it doesn't keep the demo away. */
  hasContent?(): boolean
  dispose(): void
}

export function toProblem(error: unknown, sourceName: string): TodoProblem {
  if (error instanceof TodoSourceError) return { kind: error.kind, message: error.message }
  return { kind: 'offline', message: `Couldn’t reach ${sourceName}.` }
}
