import { useLayoutEffect, useRef } from 'react'
import type { TimerTone } from './timerView'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** The whole sweep: across in the new color, a beat full, then handing over to the real one. */
export const SWEEP_TIMING: KeyframeAnimationOptions = { duration: 1400 }

/** The real ring or bar stays hidden under the sweep, and shows again as the sweep fades. */
export const REAL_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 0, offset: 0.72 }, { opacity: 1 }]

/**
 * When a session ends (focus to break, or back), the new color sweeps across: `overlay` plays
 * `sweep` and `real` (the ring or bar showing the time) fades back in under it. Only on a
 * change, never on the first render, so a launch mid-break doesn't sweep.
 */
export function useToneSweep(
  tone: TimerTone,
  overlay: React.RefObject<Element | null>,
  real: React.RefObject<Element | null>,
  sweep: Keyframe[]
): void {
  const last = useRef(tone)
  useLayoutEffect(() => {
    if (tone === last.current) return
    last.current = tone
    if (reducedMotion.matches) return
    overlay.current?.animate(sweep, SWEEP_TIMING)
    real.current?.animate(REAL_IN, SWEEP_TIMING)
  }, [tone, overlay, real, sweep])
}
