// To-do types shared with the renderer.
// Keep this file free of imports: the renderer compiles it too.

/**
 * Every to-do source, in the order the card lists them (the mockup's filter chips). Homework
 * is the user's own, kept on this computer.
 */
export type TodoSourceId = 'canvas' | 'homework' | 'reminders' | 'google'

export type TodoDue =
  /** A calendar day with no time (Google Tasks, all-day reminders): "Today", "Tomorrow". */
  | { kind: 'day'; day: string }
  /** A moment (Canvas deadlines), in Unix epoch seconds: "Due today 11:59 PM". */
  | { kind: 'time'; at: number }

export interface TodoItem {
  /** `${source}:${id within the source}`, unique across sources. */
  id: string
  source: TodoSourceId
  title: string
  /** "Google Tasks", "Google · Groceries", "Canvas · BIO 181". */
  context: string
  /** The class a homework is for ("BIO 181"), so the class list can find it; null elsewhere. */
  course: string | null
  due: TodoDue | null
  done: boolean
  /** Unix epoch seconds; null while not done (or when the source doesn't say). */
  completedAt: number | null
  /** A check-off is on its way to the source. */
  pending: boolean
}

export type TodoConnection = 'connected' | 'connecting' | 'disconnected'

export interface TodoProblem {
  /**
   * offline: couldn't reach the source, the last list stays up.
   * reconnect: the sign-in expired or was revoked.
   * setup: something on the user's side needs fixing first (e.g. an API that's turned off).
   * permission: macOS hasn't given Focus Screen access (Apple Reminders); System Settings fixes it.
   */
  kind: 'offline' | 'reconnect' | 'setup' | 'permission'
  message: string
}

export interface TodoSourceState {
  id: TodoSourceId
  /** "Google Tasks" */
  name: string
  connection: TodoConnection
  problem: TodoProblem | null
  /** Unix epoch seconds of the last good list; null before the first one. */
  syncedAt: number | null
  /** Check-offs stay on this computer (Canvas's read-only calendar feed). */
  localCheckOffs: boolean
}

export interface TodoState {
  /** The sources this computer supports (or the demo's, while the demo shows). */
  sources: TodoSourceState[]
  /** Unfinished first, then by due date; done items last, newest first. */
  items: TodoItem[]
  /** The user's own exams, not over yet, soonest first: the countdown at the top of the card. */
  exams: ExamItem[]
  /** The homework form's class chips: the class calendars' classes and the ones saved. */
  classes: string[]
  /** The real sources this computer supports, even while the demo stands in for them. */
  supported: TodoSourceId[]
  /** Dev builds only: made-up items while no real source is connected. */
  demo: boolean
  /** A short-lived message, e.g. a check-off the source refused. */
  notice: string | null
}

export type TodoCommand =
  | { kind: 'setDone'; id: string; done: boolean }
  | { kind: 'refresh' }
  /**
   * Starts the source's sign-in: Google's dialogs and browser come from the main process;
   * Canvas answers with a connect form in the card; Reminders asks macOS for access.
   */
  | { kind: 'connect'; source: TodoSourceId }
  | { kind: 'cancelConnect'; source: TodoSourceId }
  /** Signs out (Canvas and Google ask first); Reminders just stops reading. */
  | { kind: 'disconnect'; source: TodoSourceId }
  /** A `permission` problem's button: the source's page in System Settings › Privacy & Security. */
  | { kind: 'openPrivacySettings'; source: TodoSourceId }

/** Main asks the card to show a source's connect form, with what it remembers filled in. */
export interface TodoConnectForm {
  source: 'canvas'
  /** The Canvas address used last time ("canvas.school.edu"), or "". */
  address: string
}

/** What the card's Canvas form asks of the main process. */
export type CanvasFormRequest =
  | { kind: 'connectToken'; address: string; token: string }
  /** The read-only calendar feed, for schools that turn access tokens off. */
  | { kind: 'connectFeed'; url: string }
  /** Opens the Canvas page that explains the token or the feed, in the web browser. */
  | { kind: 'openPage'; page: 'token' | 'feed'; address: string }

export type CanvasFormField = 'address' | 'token' | 'url'

export type CanvasFormResult =
  | { ok: true }
  /** `field` is the input the message is about, so the form can show it there. */
  | { ok: false; message: string; field: CanvasFormField | null }

export type HomeworkKind = 'homework' | 'exam'

/** What the homework form sends: the course is a class chip's text, null for "No class". */
export interface HomeworkInput {
  kind: HomeworkKind
  title: string
  course: string | null
  due: TodoDue
}

/** A homework or exam the user added themselves, as saved on this computer. */
export interface HomeworkEntry extends HomeworkInput {
  id: string
}

/** An exam for the countdown at the top of the To-do card, soonest first. */
export interface ExamItem {
  id: string
  title: string
  course: string | null
  due: TodoDue
}

/** What the card's homework form, and the right-click menu, ask of the main process. */
export type HomeworkRequest =
  | { kind: 'add'; input: HomeworkInput }
  | { kind: 'edit'; id: string; input: HomeworkInput }
  | { kind: 'delete'; id: string }

export type HomeworkResult = { ok: true } | { ok: false; message: string }

/** Main asks the card to open its homework form: empty for a new one, filled in to edit. */
export interface HomeworkFormOpen {
  kind: HomeworkKind
  entry: HomeworkEntry | null
}

export const TODO_SOURCE_NAMES: Record<TodoSourceId, string> = {
  canvas: 'Canvas',
  homework: 'Homework',
  reminders: 'Apple Reminders',
  google: 'Google Tasks'
}
