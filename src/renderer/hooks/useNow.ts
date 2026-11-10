import { useEffect, useState } from 'react'

const MINUTE_MS = 60_000

/**
 * Current time, refreshed on each minute boundary. The clock is the one thing the renderer
 * keeps itself: it needs no Node access, and pushing ticks over IPC would add nothing.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const scheduleNextMinute = (): void => {
      // A small margin past the boundary so we never render the previous minute again.
      const delay = MINUTE_MS - (Date.now() % MINUTE_MS) + 50
      timer = setTimeout(() => {
        setNow(new Date())
        scheduleNextMinute()
      }, delay)
    }
    scheduleNextMinute()
    return () => clearTimeout(timer)
  }, [])

  return now
}
