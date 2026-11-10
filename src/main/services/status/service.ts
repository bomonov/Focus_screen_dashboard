import type { PlaybackState } from '../music/types'
import type { TodoState } from '../todos/types'
import { cardStatuses, type BrowserLink } from './cardStatus'
import type { CardStatuses } from './types'

export interface StatusServiceOptions {
  music: { get(): PlaybackState; subscribe(listener: () => void): () => void }
  todos: { get(): TodoState; subscribe(listener: () => void): () => void }
  /** The YouTube Music extension's browsers. */
  browsers: { get(): readonly BrowserLink[]; subscribe(listener: () => void): () => void }
  /** Unix epoch seconds. */
  now?: () => number
}

export interface StatusService {
  /** Worked out afresh, so a menu's "updated 2 min ago" is current. */
  get(): CardStatuses
  /** Only called when a dot or one of its lines changes, not on every song second. */
  subscribe(listener: (statuses: CardStatuses) => void): () => void
  dispose(): void
}

export function createStatusService({
  music,
  todos,
  browsers,
  now = () => Date.now() / 1000
}: StatusServiceOptions): StatusService {
  const listeners = new Set<(statuses: CardStatuses) => void>()
  const get = (): CardStatuses =>
    cardStatuses({ music: music.get(), todos: todos.get(), browsers: browsers.get() }, now())
  let last = JSON.stringify(get())

  const update = (): void => {
    const next = get()
    const key = JSON.stringify(next)
    if (key === last) return
    last = key
    for (const listener of listeners) listener(next)
  }
  const unsubscribe = [music.subscribe(update), todos.subscribe(update), browsers.subscribe(update)]

  return {
    get,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      for (const stop of unsubscribe) stop()
      listeners.clear()
    }
  }
}
