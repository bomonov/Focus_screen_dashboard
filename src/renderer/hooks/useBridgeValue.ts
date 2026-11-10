import { useEffect, useState } from 'react'

/**
 * Reads a value from the main process once, then follows its change events.
 * `load` and `subscribe` must be stable (module-level) functions.
 */
export function useBridgeValue<T>(
  load: () => Promise<T>,
  subscribe: (listener: (value: T) => void) => () => void
): T | null {
  const [value, setValue] = useState<T | null>(null)

  useEffect(() => {
    let active = true
    let pushed = false
    const unsubscribe = subscribe((next) => {
      pushed = true
      setValue(next)
    })
    load()
      .then((initial) => {
        // A push that arrived while we were loading is newer than the initial read.
        if (active && !pushed) setValue(initial)
      })
      .catch((error: unknown) => console.error(error))
    return () => {
      active = false
      unsubscribe()
    }
  }, [load, subscribe])

  return value
}
