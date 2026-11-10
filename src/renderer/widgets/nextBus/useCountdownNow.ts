import { useEffect, useState } from 'react'

const epochSeconds = (): number => Date.now() / 1000
/** Land just past the boundary, so the old minute is never drawn again. */
const MARGIN_MS = 50

/**
 * Now (Unix seconds), redrawn whenever a whole minute to one of `moments` ticks over, or one
 * of them passes: so "4 min" turns to "3 min" on time, not on the clock's minute. New moments
 * (a fresh read) redraw at once.
 */
export function useCountdownNow(moments: readonly number[]): number {
  const [now, setNow] = useState(epochSeconds)
  const key = moments.join(',')

  useEffect(() => {
    const targets = key === '' ? [] : key.split(',').map(Number)
    let handle = setTimeout(tick, 0)
    function tick(): void {
      const current = epochSeconds()
      setNow(current)
      let waitSec = 60
      for (const target of targets) {
        const left = target - current
        if (left > 0) waitSec = Math.min(waitSec, left % 60 || 60)
      }
      handle = setTimeout(tick, waitSec * 1000 + MARGIN_MS)
    }
    return () => clearTimeout(handle)
  }, [key])

  return now
}
