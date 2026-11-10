import { useEffect, useState } from 'react'

const epochSeconds = (): number => Date.now() / 1000
/** Land just past the boundary so we never draw the previous second again. */
const MARGIN_MS = 15

/**
 * The moment to draw a running count at, for values main sends as an anchor: `bankedSec`
 * plus the time since `runningSince`. Main pushes real changes; the seconds in between are
 * drawn here, so this ticks only while running (`runningSince` set), once per displayed second.
 * Right after a change `now` can be up to a second old, which is harmless: the count never
 * goes back before its anchor.
 */
export function useAnchoredNow(runningSince: number | null, bankedSec: number): number {
  const [now, setNow] = useState(epochSeconds)

  useEffect(() => {
    if (runningSince === null) return
    let handle: ReturnType<typeof setTimeout>
    const scheduleNextSecond = (): void => {
      const count = bankedSec + Math.max(0, epochSeconds() - runningSince)
      const untilNextSecondMs = (Math.floor(count) + 1 - count) * 1000
      handle = setTimeout(() => {
        setNow(epochSeconds())
        scheduleNextSecond()
      }, untilNextSecondMs + MARGIN_MS)
    }
    scheduleNextSecond()
    return () => clearTimeout(handle)
  }, [runningSince, bankedSec])

  return now
}
