// Test double for the Reminders helper process. Tests only.
import type { StartHelper } from './client'

export interface FakeHelper {
  start: StartHelper
  /** Requests the client wrote, oldest first. */
  sent: Record<string, unknown>[]
  starts: number
  stops: number
  running: boolean
  /** Prints a line as the helper would. */
  say(message: unknown): void
  /** Answers the latest request for `op` and returns its id. */
  reply(op: string, body: Record<string, unknown>): number
  /** The helper dies; the runner would bring it back, so `say` keeps working. */
  crash(): void
}

export function fakeHelper(): FakeHelper {
  let handlers: Parameters<StartHelper>[0] | null = null
  const fake: FakeHelper = {
    sent: [],
    starts: 0,
    stops: 0,
    running: false,
    start(next) {
      handlers = next
      fake.starts++
      fake.running = true
      return {
        send(message) {
          if (!fake.running) return false
          fake.sent.push(message as Record<string, unknown>)
          return true
        },
        stop() {
          fake.stops++
          fake.running = false
        }
      }
    },
    say(message) {
      handlers?.onMessage(message)
    },
    reply(op, body) {
      const request = [...fake.sent].reverse().find((message) => message.op === op)
      if (typeof request?.id !== 'number') throw new Error(`No ${op} request to answer.`)
      fake.say({ type: 'reply', id: request.id, ...body })
      return request.id
    },
    crash() {
      handlers?.onExit()
    }
  }
  return fake
}
