import type { ColorEdit } from './types'
import { heardAround, nearestOnset } from './waveform'

// A J tap lands on the sound it was meant for: its start moves to the nearest onset in the
// waveform's outline. Audio reaches the outline HOLD_SEC (1.5 s) after it's heard, so on a first
// listen there's nothing there yet the moment J is pressed: the tap waits here until the outline
// round it is heard, at most TAP_WAIT_SEC. Taps land in the order they were made.

/** A start moves to an onset this close to the press, either way. */
export const TAP_SNAP_SEC = 0.12
/** A start whose outline still isn't heard this long after the press lands where it was pressed. */
export const TAP_WAIT_SEC = 3

export type TapEdit = Extract<ColorEdit, { kind: 'tapTime' }>

export interface TapQueue {
  /** `at`: epoch seconds of the press. */
  push(edit: TapEdit, at: number): void
  /**
   * Hands `apply` the taps that are ready, oldest first, stopping at the first that isn't.
   * A start is ready once the outline round it is heard: moved then to the nearest onset
   * within TAP_SNAP_SEC, else left as pressed. It is also ready TAP_WAIT_SEC after the
   * press, left as pressed. An end is ready once everything before it is. With `peaks`
   * null, or `force`, all are ready; a start is still snapped where it's heard.
   */
  flush(
    peaks: Uint8Array | null,
    now: number,
    apply: (edit: TapEdit) => void,
    force?: boolean
  ): void
  clear(): void
  readonly size: number
}

interface Waiting {
  edit: TapEdit
  at: number
}

/** The edit to make now, or null while it waits. */
function landing(
  tap: Waiting,
  peaks: Uint8Array | null,
  now: number,
  force: boolean
): TapEdit | null {
  const { start } = tap.edit
  // An end isn't snapped: it's where J was let go, and lands right after its start.
  if (start === undefined || peaks === null) return tap.edit
  if (heardAround(peaks, start, TAP_SNAP_SEC)) {
    const onset = nearestOnset(peaks, start, TAP_SNAP_SEC)
    return onset === null ? tap.edit : { ...tap.edit, start: onset }
  }
  return force || now - tap.at >= TAP_WAIT_SEC ? tap.edit : null
}

export function createTapQueue(): TapQueue {
  let waiting: Waiting[] = []

  return {
    push(edit, at) {
      waiting.push({ edit, at })
    },
    flush(peaks, now, apply, force = false) {
      while (waiting.length > 0) {
        const first = waiting[0]
        const edit = first ? landing(first, peaks, now, force) : null
        if (!edit) return
        // Taken off before it's applied, so whatever `apply` sets off sees it gone.
        waiting.shift()
        apply(edit)
      }
    },
    clear() {
      waiting = []
    },
    get size() {
      return waiting.length
    }
  }
}
