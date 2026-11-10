import type { TimerLength } from './types'

/** A request this old is dropped: the window has had long enough to load and take it. */
export const PENDING_EDIT_SEC = 10

/**
 * A Timer menu's "Set on the Timer Card…", kept until the Focus Screen takes it. A closed window
 * is opened first, and its page only listens once it has loaded, so a request sent straight away
 * would be lost; the card asks for it as it mounts, and when told one is waiting.
 */
export function createPendingEdit(): {
  set(length: TimerLength, nowSec: number): void
  take(nowSec: number): TimerLength | null
} {
  let pending: { length: TimerLength; at: number } | null = null
  return {
    set(length, nowSec) {
      pending = { length, at: nowSec }
    },
    take(nowSec) {
      const request = pending
      pending = null
      return request && nowSec - request.at <= PENDING_EDIT_SEC ? request.length : null
    }
  }
}
