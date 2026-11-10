import { useEffect, useState } from 'react'

const epochSeconds = (): number => Date.now() / 1000
/** Land just past the change so the line it starts is already on. */
const MARGIN_MS = 15

/**
 * The moment to draw synced lyrics at. Like useAnchoredNow, but it wakes at each line change
 * (`changes`: song positions, sorted) instead of every second, so a line lights up on its beat
 * rather than up to a second late. `changes` must keep its identity between renders (useMemo).
 */
export function useLineClock(
  runningSince: number | null,
  bankedSec: number,
  changes: readonly number[]
): number {
  const [now, setNow] = useState(epochSeconds)

  useEffect(() => {
    if (runningSince === null) return
    let handle: ReturnType<typeof setTimeout> | undefined
    const scheduleNextChange = (): void => {
      const position = bankedSec + Math.max(0, epochSeconds() - runningSince)
      const next = changes.find((change) => change > position)
      if (next === undefined) return
      handle = setTimeout(
        () => {
          setNow(epochSeconds())
          scheduleNextChange()
        },
        (next - position) * 1000 + MARGIN_MS
      )
    }
    scheduleNextChange()
    return () => clearTimeout(handle)
  }, [runningSince, bankedSec, changes])

  return now
}
