import { TodoSourceError, type ProviderTodo, type TodoProvider } from '../provider'
import { TODO_SOURCE_NAMES, type HomeworkEntry } from '../types'
import type { HomeworkBook } from './book'
import { classChoices } from './classes'

/** How often ticked homework past its hour, and exams that ended, are let go. */
const PRUNE_EVERY_MS = 60_000

export type HomeworkProvider = TodoProvider & {
  /** The class calendars' event titles, from Next class's reading of them. */
  setCalendarClasses(titles: readonly string[]): void
}

function toTodo(entry: HomeworkEntry, doneAt: number | null): ProviderTodo {
  return {
    id: entry.id,
    title: entry.title,
    // The icon already says it's homework, so the line under it starts with the class.
    context: entry.course ?? TODO_SOURCE_NAMES.homework,
    course: entry.course,
    due: entry.due,
    done: doneAt !== null,
    completedAt: doneAt
  }
}

/** The user's own homework as a to-do source: always there, nothing to sign in to. */
export function createHomeworkProvider(book: HomeworkBook): HomeworkProvider {
  let calendarClasses: readonly string[] = []
  let itemsChanged = (): void => {}
  let unsubscribe = (): void => {}
  let timer: ReturnType<typeof setInterval> | undefined

  return {
    source: 'homework',
    name: TODO_SOURCE_NAMES.homework,
    start(_onChange, onItemsChanged) {
      itemsChanged = onItemsChanged ?? (() => {})
      unsubscribe = book.subscribe(() => itemsChanged())
      // The book tells its listeners when the prune let anything go.
      timer = setInterval(() => book.prune(), PRUNE_EVERY_MS)
    },
    connection: () => 'connected',
    async list() {
      const { open, ticked } = book.homework()
      return [
        ...open.map((entry) => toTodo(entry, null)),
        ...ticked.map((done) => toTodo(done.entry, done.doneAt))
      ]
    },
    async setDone(id, done) {
      if (!book.setDone(id, done)) throw new TodoSourceError('setup', 'That homework is gone.')
    },
    exams: () => book.exams().map(({ id, title, course, due }) => ({ id, title, course, due })),
    classes: () => classChoices(calendarClasses, book.courses()),
    hasContent() {
      const { open, ticked } = book.homework()
      return open.length > 0 || ticked.length > 0 || book.exams().length > 0
    },
    setCalendarClasses(titles) {
      // A week of events repeats each class; only a new set of classes is news.
      const next = [...new Set(titles)]
      const same =
        next.length === calendarClasses.length &&
        next.every((title, i) => title === calendarClasses[i])
      if (same) return
      calendarClasses = next
      itemsChanged()
    },
    dispose() {
      clearInterval(timer)
      unsubscribe()
      itemsChanged = () => {}
    }
  }
}
