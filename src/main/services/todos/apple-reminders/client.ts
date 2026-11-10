import type { HelperProcess } from '../../helperProcess'
import { parseHelperMessage, type RemindersAccess } from './protocol'

/** Starts the helper (the runner brings it back if it exits). */
export type StartHelper = (handlers: {
  onMessage(message: unknown): void
  onExit(): void
}) => HelperProcess

export class HelperUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HelperUnavailableError'
  }
}

export interface ClientEvents {
  /** The access status is new: the helper (re)started, or the user changed it in System Settings. */
  access(status: RemindersAccess): void
  /** Something changed in Reminders: on this Mac, through iCloud, or by our own check-off. */
  changed(): void
}

/** Request/reply over the helper's stdin and stdout. */
export interface RemindersClient {
  /** null until the helper says, and again while it restarts. */
  access(): RemindersAccess | null
  whenAccessKnown(timeoutMs: number): Promise<RemindersAccess>
  /** Resolves with the reply; rejects if the helper is gone or doesn't answer in time. */
  request(message: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>>
  stop(): void
}

interface Pending {
  resolve(body: Record<string, unknown>): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export function createRemindersClient(
  startHelper: StartHelper,
  events: ClientEvents
): RemindersClient {
  let access: RemindersAccess | null = null
  let stopped = false
  let nextId = 1
  const pending = new Map<number, Pending>()
  const accessWaiters = new Set<(status: RemindersAccess) => void>()

  function failPending(reason: string): void {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new HelperUnavailableError(reason))
    }
    pending.clear()
  }

  const helper = startHelper({
    onMessage(raw) {
      if (stopped) return
      const message = parseHelperMessage(raw)
      if (!message) return
      switch (message.type) {
        case 'access': {
          const isNew = message.status !== access
          access = message.status
          for (const waiter of [...accessWaiters]) waiter(message.status)
          if (isNew) events.access(message.status)
          break
        }
        case 'changed':
          events.changed()
          break
        case 'reply': {
          const request = pending.get(message.id)
          if (!request) return
          pending.delete(message.id)
          clearTimeout(request.timer)
          request.resolve(message.body)
          break
        }
      }
    },
    onExit() {
      // It tells us again once it's back.
      access = null
      failPending('The Reminders helper stopped.')
    }
  })

  return {
    access: () => access,

    whenAccessKnown(timeoutMs) {
      if (access !== null) return Promise.resolve(access)
      if (stopped) return Promise.reject(new HelperUnavailableError('Stopped.'))
      return new Promise((resolve, reject) => {
        const waiter = (status: RemindersAccess): void => {
          accessWaiters.delete(waiter)
          clearTimeout(timer)
          resolve(status)
        }
        const timer = setTimeout(() => {
          accessWaiters.delete(waiter)
          reject(new HelperUnavailableError('The Reminders helper didn’t start.'))
        }, timeoutMs)
        accessWaiters.add(waiter)
      })
    },

    request(message, timeoutMs) {
      if (stopped) return Promise.reject(new HelperUnavailableError('Stopped.'))
      const id = nextId++
      return new Promise((resolve, reject) => {
        if (!helper.send({ ...message, id })) {
          reject(new HelperUnavailableError('The Reminders helper isn’t running.'))
          return
        }
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new HelperUnavailableError('The Reminders helper didn’t answer.'))
        }, timeoutMs)
        pending.set(id, { resolve, reject, timer })
      })
    },

    stop() {
      if (stopped) return
      stopped = true
      helper.stop()
      failPending('Stopped.')
      accessWaiters.clear()
    }
  }
}
