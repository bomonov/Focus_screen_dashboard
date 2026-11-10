import type { SettingsStore } from '../settings/store'
import type { ScreenCare } from './types'

/** Things that keep the screen awake while they last. */
export type BusyReason = 'music' | 'timer' | 'customize' | 'layout' | 'lyricsEditor'

/** How often the layout moves to its next spot. */
export const BURN_IN_STEP_SEC = 180

/** A slow loop around the center, never more than 4 px from where the layout really is. */
const SHIFT_PATH: readonly { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 3, y: -2 },
  { x: 4, y: 1 },
  { x: 1, y: 4 },
  { x: -2, y: 3 },
  { x: -4, y: 0 },
  { x: -3, y: -3 },
  { x: 0, y: -4 }
]

export function shiftAt(step: number): { x: number; y: number } {
  const index = ((step % SHIFT_PATH.length) + SHIFT_PATH.length) % SHIFT_PATH.length
  return SHIFT_PATH[index] ?? { x: 0, y: 0 }
}

/**
 * When the screen should dim, in seconds: `minutes` after the last activity. null while
 * something keeps it awake, or when dimming is off (0 minutes).
 */
export function dimAt(busy: boolean, lastActiveAt: number, minutes: number): number | null {
  if (busy || minutes <= 0) return null
  return lastActiveAt + minutes * 60
}

export interface ScreenCareService {
  get(): ScreenCare
  subscribe(listener: (state: ScreenCare) => void): () => void
  /**
   * Music playing, a timer running, Customize or Color-Code Lyrics open, or cards being
   * arranged: never dim.
   */
  setBusy(reason: BusyReason, busy: boolean): void
  /** The mouse moved or something was clicked on the Focus Screen. */
  activity(): void
  dispose(): void
}

interface ScreenCareOptions {
  settings: Pick<SettingsStore, 'get' | 'subscribe'>
  /** Unix epoch seconds. */
  now?: () => number
}

export function createScreenCare({
  settings,
  now = () => Date.now() / 1000
}: ScreenCareOptions): ScreenCareService {
  const busy = new Set<BusyReason>()
  const listeners = new Set<(state: ScreenCare) => void>()
  let lastActiveAt = now()
  let step = 0
  let state: ScreenCare = { dimmed: false, shift: shiftAt(0) }
  let dimTimer: ReturnType<typeof setTimeout> | undefined
  let shiftTimer: ReturnType<typeof setInterval> | undefined
  let shifting = false

  function emit(next: ScreenCare): void {
    if (
      next.dimmed === state.dimmed &&
      next.shift.x === state.shift.x &&
      next.shift.y === state.shift.y
    )
      return
    state = next
    for (const listener of listeners) listener(state)
  }

  /** Dims now if it's time, otherwise wakes up exactly when it will be. */
  function checkIdle(): void {
    clearTimeout(dimTimer)
    const at = dimAt(busy.size > 0, lastActiveAt, settings.get().display.idleDimMinutes)
    const dimmed = at !== null && now() >= at
    if (at !== null && !dimmed) {
      dimTimer = setTimeout(checkIdle, Math.max(0, (at - now()) * 1000))
    }
    emit({ ...state, dimmed })
  }

  function applyShiftSetting(): void {
    const on = settings.get().display.burnInShift
    if (on === shifting) return
    shifting = on
    clearInterval(shiftTimer)
    step = 0
    if (on) {
      shiftTimer = setInterval(() => {
        step += 1
        emit({ ...state, shift: shiftAt(step) })
      }, BURN_IN_STEP_SEC * 1000)
    }
    emit({ ...state, shift: shiftAt(0) })
  }

  const unsubscribe = settings.subscribe(() => {
    applyShiftSetting()
    checkIdle()
  })
  applyShiftSetting()
  checkIdle()

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setBusy(reason, on) {
      if (on === busy.has(reason)) return
      if (on) busy.add(reason)
      else busy.delete(reason)
      // The idle wait starts when the last song stops or the timer ends, not when it started.
      lastActiveAt = now()
      checkIdle()
    },
    activity() {
      lastActiveAt = now()
      checkIdle()
    },
    dispose() {
      unsubscribe()
      clearTimeout(dimTimer)
      clearInterval(shiftTimer)
      listeners.clear()
    }
  }
}
