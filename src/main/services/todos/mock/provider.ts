import type { ProviderTodo, TodoProvider } from '../provider'
import { TODO_SOURCE_NAMES, type ExamItem, type TodoDue, type TodoSourceId } from '../types'

/** Long enough to see the pending state, short enough to feel instant. */
const WRITE_DELAY_MS = 150

interface DemoTodo extends ProviderTodo {
  source: TodoSourceId
}

function localDay(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function localTime(offsetDays: number, hours: number, minutes: number): number {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  date.setHours(hours, minutes, 0, 0)
  return Math.floor(date.getTime() / 1000)
}

const day = (offsetDays: number): TodoDue => ({ kind: 'day', day: localDay(offsetDays) })
const at = (offsetDays: number, hours: number, minutes = 0): TodoDue => ({
  kind: 'time',
  at: localTime(offsetDays, hours, minutes)
})

/** The mockup's list, with dates relative to today so it always reads like a real week. */
function demoTodos(): DemoTodo[] {
  const hourAgo = Math.floor(Date.now() / 1000) - 3600
  const canvas = (course: string): string => `Canvas · ${course}`
  return [
    {
      source: 'canvas',
      id: 'c1',
      title: 'Read Chapter 4 + reading quiz',
      context: canvas('BIO 181'),
      due: at(0, 23, 59),
      done: false,
      completedAt: null
    },
    {
      source: 'canvas',
      id: 'c2',
      title: 'Lab report draft',
      context: canvas('CHM 113'),
      due: at(2, 23, 59),
      done: false,
      completedAt: null
    },
    {
      source: 'canvas',
      id: 'c3',
      title: 'Problem set 6',
      context: canvas('MAT 265'),
      due: at(5, 9),
      done: false,
      completedAt: null
    },
    {
      source: 'canvas',
      id: 'c4',
      title: 'Discussion post reply',
      context: canvas('ENG 102'),
      due: at(0, 12),
      done: true,
      completedAt: hourAgo
    },
    {
      source: 'homework',
      id: 'h1',
      title: 'Problem set 7',
      context: 'MAT 265',
      course: 'MAT 265',
      due: day(2),
      done: false,
      completedAt: null
    },
    {
      source: 'homework',
      id: 'h2',
      title: 'Lab write-up',
      context: 'CHM 113',
      course: 'CHM 113',
      due: at(1, 23, 59),
      done: false,
      completedAt: null
    },
    {
      source: 'reminders',
      id: 'r1',
      title: 'Pick up groceries',
      context: TODO_SOURCE_NAMES.reminders,
      due: day(0),
      done: false,
      completedAt: null
    },
    {
      source: 'reminders',
      id: 'r2',
      title: 'Call the dentist',
      context: TODO_SOURCE_NAMES.reminders,
      due: null,
      done: false,
      completedAt: null
    },
    {
      source: 'google',
      id: 'g1',
      title: 'Email advisor about spring classes',
      context: TODO_SOURCE_NAMES.google,
      due: day(1),
      done: false,
      completedAt: null
    },
    {
      source: 'google',
      id: 'g2',
      title: 'Renew parking permit',
      context: TODO_SOURCE_NAMES.google,
      due: day(-1),
      done: true,
      completedAt: hourAgo - 600
    }
  ]
}

/** A quiz soon enough to light up the countdown, and a midterm further off behind it. */
function demoExams(): ExamItem[] {
  return [
    { id: 'x1', title: 'Quiz 3', course: 'CHM 113', due: at(2, 10, 30) },
    { id: 'x2', title: 'Midterm', course: 'BIO 181', due: at(16, 9) }
  ]
}

/** The demo calendar's classes (calendar/mock.ts), for the homework form's chips. */
const DEMO_CLASSES = ['BIO 181', 'CHM 113', 'ENG 101', 'MAT 265']

/**
 * Dev builds only: one made-up source per real one, so the card is full with no accounts.
 * Check-offs stick for this run.
 */
export function createMockTodoProviders(): TodoProvider[] {
  const todos = demoTodos()
  const exams = demoExams()
  const sources: TodoSourceId[] = ['canvas', 'homework', 'reminders', 'google']
  return sources.map((source): TodoProvider => ({
    ...(source === 'homework' ? { exams: () => exams, classes: () => DEMO_CLASSES } : {}),
    source,
    name: TODO_SOURCE_NAMES[source],
    start: () => {},
    connection: () => 'connected',
    list: async () =>
      todos
        .filter((todo) => todo.source === source)
        .map(({ id, title, context, course, due, done, completedAt }) => ({
          id,
          title,
          context,
          course,
          due,
          done,
          completedAt
        })),
    setDone: (id, done) =>
      new Promise((resolve) => {
        setTimeout(() => {
          const todo = todos.find((candidate) => candidate.id === id)
          if (todo) {
            todo.done = done
            todo.completedAt = done ? Math.floor(Date.now() / 1000) : null
          }
          resolve()
        }, WRITE_DELAY_MS)
      }),
    dispose: () => {}
  }))
}
