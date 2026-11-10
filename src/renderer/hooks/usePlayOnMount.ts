import { useLayoutEffect, useRef } from 'react'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/**
 * Plays `keyframes` once when the element mounts (a new lyric line, a new flip digit). It's done
 * in script rather than CSS on purpose: inside a size container, which every card is on a custom
 * layout, Chromium starts a finished CSS animation over again, so the line kept fading in.
 * `keyframes` and `options` should be module constants.
 */
export function usePlayOnMount<T extends Element>(
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions
): React.RefObject<T | null> {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    if (!reducedMotion.matches) ref.current?.animate(keyframes, options)
  }, [keyframes, options])
  return ref
}
