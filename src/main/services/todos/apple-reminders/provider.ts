import { TodoSourceError, type ProviderTodo, type TodoProvider } from '../provider'
import { TODO_SOURCE_NAMES, type TodoConnection } from '../types'
import { createRemindersClient, type RemindersClient, type StartHelper } from './client'
import {
  parseListReply,
  parseWriteReply,
  type HelperFailure,
  type RemindersAccess
} from './protocol'
import { toProviderTodos } from './todos'

/** The helper reports its access status within a moment of starting. */
export const HELPER_START_TIMEOUT_MS = 10_000
/** EventKit can take a while on a big iCloud account. */
export const LIST_TIMEOUT_MS = 30_000
export const WRITE_TIMEOUT_MS = 10_000
/** Long enough to read the macOS prompt and answer it. */
export const ACCESS_PROMPT_TIMEOUT_MS = 10 * 60 * 1000

const HELPER_MISSING =
  'The Reminders helper isn’t built. Run “npm run build:reminders”, then restart Focus Screen.'

export interface RemindersProvider extends TodoProvider {
  /** Turns Reminders on and, if macOS has never been asked, asks it for access. */
  connect(): Promise<void>
  /** Stops reading reminders. macOS keeps its permission until it's turned off in System Settings. */
  disconnect(): void
  /** A `permission` problem's button: asks macOS if it never was, else opens System Settings. */
  openPrivacySettings(): void
}

export interface RemindersProviderOptions {
  /** null when the helper isn't there (a dev build that hasn't run `npm run build:reminders`). */
  startHelper: StartHelper | null
  /** Saved from the last run: Reminders was connected. */
  enabled: boolean
  saveEnabled(on: boolean): void
  /** System Settings › Privacy & Security › Reminders. */
  openSystemSettings(): void
}

/**
 * off: not connected. starting: connecting, waiting for the helper to say where access stands.
 * asking: the macOS prompt is up. on: connected (with or without access; the list says which).
 */
type Phase = 'off' | 'starting' | 'asking' | 'on'

function offline(message = 'Couldn’t reach Apple Reminders.'): TodoSourceError {
  return new TodoSourceError('offline', message)
}

function accessProblem(status: RemindersAccess): TodoSourceError {
  switch (status) {
    case 'denied':
      return new TodoSourceError(
        'permission',
        'Focus Screen isn’t allowed to see your reminders. Turn on Focus Screen Reminders in ' +
          'System Settings › Privacy & Security › Reminders.'
      )
    case 'notDetermined':
      return new TodoSourceError('permission', 'Focus Screen needs your OK to see your reminders.')
    case 'restricted':
      return new TodoSourceError(
        'setup',
        'Reminders access is blocked on this Mac (by Screen Time or a device profile).'
      )
    case 'granted':
      return offline()
  }
}

function failureProblem(failure: HelperFailure, fallback: string): TodoSourceError {
  switch (failure.error) {
    case 'access':
      return accessProblem(failure.status ?? 'denied')
    case 'notFound':
      return offline('It’s no longer in Reminders.')
    case 'readOnly':
      return offline('That list can’t be changed from Focus Screen.')
    default:
      return offline(fallback)
  }
}

export function createRemindersProvider(options: RemindersProviderOptions): RemindersProvider {
  const { startHelper, saveEnabled, openSystemSettings } = options
  let phase: Phase = options.enabled ? 'on' : 'off'
  let client: RemindersClient | null = null
  let onChange = (): void => {}
  let onItemsChanged = (): void => {}
  /** macOS is asked once per connect, so a prompt the user ignored doesn't keep coming back. */
  let asked = false
  /** Bumped on disconnect, so a connect or prompt still under way knows it's out of date. */
  let generation = 0

  const connection = (): TodoConnection =>
    phase === 'asking' ? 'connecting' : phase === 'on' ? 'connected' : 'disconnected'
  let reported = connection()

  function notifyIfChanged(): void {
    const current = connection()
    if (current === reported) return
    reported = current
    onChange()
  }

  function onAccess(status: RemindersAccess): void {
    if (phase !== 'on') return
    // Connected before, but macOS forgot (e.g. its privacy settings were reset): ask again.
    if (status === 'notDetermined' && !asked) void ask()
    else onItemsChanged()
  }

  function ensureClient(): RemindersClient | null {
    if (!client && startHelper) {
      client = createRemindersClient(startHelper, {
        access: onAccess,
        changed: () => {
          if (phase === 'on') onItemsChanged()
        }
      })
    }
    return client
  }

  async function ask(): Promise<void> {
    const current = client
    if (!current) return
    asked = true
    const run = generation
    phase = 'asking'
    notifyIfChanged()
    try {
      await current.request({ op: 'requestAccess' }, ACCESS_PROMPT_TIMEOUT_MS)
    } catch {
      // Whatever the answer (or none), the list says where things stand.
    }
    if (run !== generation) return
    phase = 'on'
    notifyIfChanged()
  }

  async function call(
    message: Record<string, unknown>,
    timeoutMs: number
  ): Promise<Record<string, unknown>> {
    if (!startHelper) throw new TodoSourceError('setup', HELPER_MISSING)
    const current = client
    if (!current) throw offline()
    try {
      return await current.request(message, timeoutMs)
    } catch {
      throw offline()
    }
  }

  return {
    source: 'reminders',
    name: TODO_SOURCE_NAMES.reminders,
    start(listener, itemsListener) {
      onChange = listener
      if (itemsListener) onItemsChanged = itemsListener
      if (phase === 'on') ensureClient()
    },
    connection,

    async list(): Promise<ProviderTodo[]> {
      if (!startHelper) throw new TodoSourceError('setup', HELPER_MISSING)
      const current = client
      if (!current) throw offline()
      let status: RemindersAccess
      try {
        status = await current.whenAccessKnown(HELPER_START_TIMEOUT_MS)
      } catch {
        throw offline()
      }
      if (status !== 'granted') throw accessProblem(status)
      const reply = parseListReply(await call({ op: 'list' }, LIST_TIMEOUT_MS))
      if (!reply) throw offline('Apple Reminders sent something unexpected.')
      if (!reply.ok) throw failureProblem(reply, 'Couldn’t read your reminders.')
      return toProviderTodos(reply.lists, reply.reminders)
    },

    async setDone(id, done) {
      const reply = parseWriteReply(await call({ op: 'setDone', item: id, done }, WRITE_TIMEOUT_MS))
      if (!reply) throw offline('Apple Reminders sent something unexpected.')
      if (!reply.ok) throw failureProblem(reply, 'Reminders didn’t save the change.')
    },

    async connect() {
      if (phase !== 'off') return
      saveEnabled(true)
      asked = false
      const run = ++generation
      phase = 'starting'
      const current = ensureClient()
      let status: RemindersAccess | null = null
      try {
        status = current ? await current.whenAccessKnown(HELPER_START_TIMEOUT_MS) : null
      } catch {
        // Connected anyway; the list will say the helper didn't start.
      }
      if (run !== generation) return
      phase = 'on'
      if (status === 'notDetermined') await ask()
      else notifyIfChanged()
    },

    disconnect() {
      if (phase === 'off') return
      generation++
      saveEnabled(false)
      phase = 'off'
      client?.stop()
      client = null
      notifyIfChanged()
    },

    openPrivacySettings() {
      if (phase === 'on' && client?.access() === 'notDetermined') void ask()
      else openSystemSettings()
    },

    dispose() {
      generation++
      client?.stop()
      client = null
    }
  }
}
