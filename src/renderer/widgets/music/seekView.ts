// The progress bar as a slider (after kube.io's liquid-glass slider): where a pointer on it
// points to in the song, and where the keys move it.

/**
 * How far along the song (0–1) a pointer at `x` points. The knob's centre runs from half a
 * resting knob in from one end to the same in from the other, so the knob never hangs off the
 * bar: a press on either end's last stretch is the very start or end.
 */
export function fractionAt(
  x: number,
  barLeft: number,
  barWidth: number,
  knobWidth: number
): number {
  const travel = barWidth - knobWidth
  if (travel <= 0) return 0
  return Math.min(1, Math.max(0, (x - barLeft - knobWidth / 2) / travel))
}

/** How far the arrow keys move, in seconds; Page Up and Page Down go further. */
const KEY_STEP_SEC = 5
const PAGE_STEP_SEC = 30

/** Where a key moves the song to (seconds), or null for keys that don't move it. */
export function keySeek(key: string, positionSec: number, durationSec: number): number | null {
  const to = (sec: number): number => Math.min(durationSec, Math.max(0, sec))
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return to(positionSec + KEY_STEP_SEC)
    case 'ArrowLeft':
    case 'ArrowDown':
      return to(positionSec - KEY_STEP_SEC)
    case 'PageUp':
      return to(positionSec + PAGE_STEP_SEC)
    case 'PageDown':
      return to(positionSec - PAGE_STEP_SEC)
    case 'Home':
      return 0
    case 'End':
      return durationSec
    default:
      return null
  }
}
