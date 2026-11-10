import type { JsonRequest, JsonResponse } from '../../http'
import type { SecretStore } from '../../secrets/store'
import { TodoSourceError, type ProviderTodo, type TodoProvider } from '../provider'
import { TODO_SOURCE_NAMES, type TodoConnection } from '../types'
import {
  apiError,
  doneBody,
  orderTasks,
  parseTaskListsPage,
  parseTasksPage,
  startOfLocalDay,
  taskListsUrl,
  tasksUrl,
  taskUrl,
  toProviderTodo,
  type GoogleTask,
  type GoogleTaskList,
  type Page
} from './api'
import { createGoogleAuth, type RequestJson } from './auth'
import { createGoogleConnection, type ConnectResult } from './connection'
import type { ListenForRedirect } from './loopback'
import { TASKS_SCOPE, type GoogleClient } from './oauth'

export { SIGN_IN_TIMEOUT_MS, type ConnectResult } from './connection'

/** A full page of 100 tasks with long notes stays well under this. */
export const GOOGLE_MAX_BYTES = 4 * 1024 * 1024
export const GOOGLE_TIMEOUT_MS = 15_000
/** 100 per page: up to 1,000 lists and 2,000 tasks per list, far past any real account. */
const MAX_LIST_PAGES = 10
const MAX_TASK_PAGES = 20

export interface GoogleTasksProvider extends TodoProvider {
  hasClient(): boolean
  setClient(client: GoogleClient): void
  /** Signs in through the browser. Resolves when it's done, declined, timed out or cancelled. */
  connect(): Promise<ConnectResult>
  cancelConnect(): void
  /** Forgets the sign-in here and revokes it at Google. Keeps the OAuth client. */
  disconnect(): Promise<void>
}

export interface GoogleTasksOptions {
  secrets: SecretStore
  request: RequestJson
  listen: ListenForRedirect
  /** Opens the system browser (Google blocks sign-in inside app windows). */
  openBrowser: (url: string) => Promise<void>
  now?: () => number
}

const epochSeconds = (): number => Date.now() / 1000

export function createGoogleTasksProvider({
  secrets,
  request,
  listen,
  openBrowser,
  now = epochSeconds
}: GoogleTasksOptions): GoogleTasksProvider {
  const auth = createGoogleAuth({ secrets, request, now })
  let onChange = (): void => {}
  /** Which list and task each to-do id stands for, from the last list. */
  let refs = new Map<string, { listId: string; taskId: string }>()
  const google = createGoogleConnection({
    auth,
    scopes: [TASKS_SCOPE],
    listen,
    openBrowser,
    changed: () => notifyIfChanged()
  })

  const connection = (): TodoConnection => google.state()
  let reported = connection()

  function notifyIfChanged(): void {
    const current = connection()
    if (current === reported) return
    reported = current
    onChange()
  }

  async function send(url: string, init: JsonRequest, token: string): Promise<JsonResponse> {
    try {
      return await request(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` }
      })
    } catch {
      throw new TodoSourceError('offline', 'Couldn’t reach Google Tasks.')
    }
  }

  /** One Tasks API call with a fresh token, retried once if Google refuses the token. */
  async function call(url: string, init: JsonRequest = { method: 'GET' }): Promise<unknown> {
    try {
      let token = await auth.accessToken()
      let response = await send(url, init, token)
      if (response.status === 401) {
        token = await auth.accessToken(token)
        response = await send(url, init, token)
      }
      if (response.status >= 200 && response.status < 300) return response.body
      const error = apiError(response.status, response.body)
      // The only fix for a dead sign-in is a new one; showing "connected" would be a lie.
      if (error.kind === 'reconnect') auth.forgetSignIn()
      throw error
    } finally {
      notifyIfChanged()
    }
  }

  async function allPages<T>(
    pageUrl: (pageToken: string | null) => string,
    parse: (body: unknown) => Page<T> | null,
    maxPages: number
  ): Promise<T[]> {
    const items: T[] = []
    let pageToken: string | null = null
    for (let page = 0; page < maxPages; page++) {
      const parsed = parse(await call(pageUrl(pageToken)))
      if (!parsed) throw new TodoSourceError('offline', 'Google Tasks sent something unexpected.')
      items.push(...parsed.items)
      pageToken = parsed.nextPageToken
      if (!pageToken) break
    }
    return items
  }

  async function listTasks(list: GoogleTaskList, doneSince: number): Promise<GoogleTask[]> {
    const [open, done] = await Promise.all([
      allPages(
        (token) => tasksUrl(list.id, { kind: 'open' }, token),
        parseTasksPage,
        MAX_TASK_PAGES
      ),
      allPages(
        (token) => tasksUrl(list.id, { kind: 'doneSince', since: doneSince }, token),
        parseTasksPage,
        MAX_TASK_PAGES
      )
    ])
    return orderTasks([...open.filter((task) => !task.done), ...done.filter((task) => task.done)])
  }

  return {
    source: 'google',
    name: TODO_SOURCE_NAMES.google,
    start(listener) {
      onChange = listener
    },
    connection,

    async list(): Promise<ProviderTodo[]> {
      const lists = await allPages(taskListsUrl, parseTaskListsPage, MAX_LIST_PAGES)
      const doneSince = startOfLocalDay(now())
      const todos: ProviderTodo[] = []
      const nextRefs = new Map<string, { listId: string; taskId: string }>()
      // One list at a time: gentler on Google, and a few lists only take a moment.
      for (const list of lists) {
        for (const task of await listTasks(list, doneSince)) {
          const todo = toProviderTodo(list, task, lists.length)
          todos.push(todo)
          nextRefs.set(todo.id, { listId: list.id, taskId: task.id })
        }
      }
      refs = nextRefs
      return todos
    },

    async setDone(id, done) {
      const ref = refs.get(id)
      if (!ref) throw new TodoSourceError('offline', 'It’s no longer in Google Tasks.')
      await call(taskUrl(ref.listId, ref.taskId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: doneBody(done)
      })
    },

    hasClient: () => google.hasClient(),
    setClient: (client: GoogleClient) => google.setClient(client),
    connect: () => google.connect(),
    cancelConnect: () => google.cancel(),

    async disconnect() {
      refs = new Map()
      await google.disconnect()
    },

    dispose() {
      google.cancel()
    }
  }
}
