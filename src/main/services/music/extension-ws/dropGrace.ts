/**
 * Waits before calling a browser gone. Safari puts the extension's background page to sleep now
 * and then, which drops its connection until the YouTube Music page next checks in; without the
 * wait, the card would flip to another player and back each time.
 */
export interface DropGrace<K> {
  /** The connection went away; `gone` runs unless it's `back` within the grace period. */
  dropped(key: K): void
  /** It reconnected (or spoke again): it was never gone. */
  back(key: K): void
  dispose(): void
}

export function createDropGrace<K>(ms: number, gone: (key: K) => void): DropGrace<K> {
  const timers = new Map<K, ReturnType<typeof setTimeout>>()
  const cancel = (key: K): void => {
    clearTimeout(timers.get(key))
    timers.delete(key)
  }
  return {
    dropped(key) {
      cancel(key)
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key)
          gone(key)
        }, ms)
      )
    },
    back: cancel,
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }
}
