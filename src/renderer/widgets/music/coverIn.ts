/** A new song's cover settling in (on the record, or the animated cover without WebGL): in from
 * a touch larger, over the old one. */
export const COVER_IN: Keyframe[] = [
  { opacity: 0, transform: 'scale(1.08)' },
  { opacity: 1, transform: 'none' }
]
export const COVER_IN_TIMING: KeyframeAnimationOptions = { duration: 700, easing: 'ease-out' }

/** A cover is ready once its picture has loaded and decoded; a placeholder is ready at once. */
export function coverReady(layer: HTMLElement): Promise<unknown> {
  return layer.querySelector('img')?.decode() ?? Promise.resolve()
}
