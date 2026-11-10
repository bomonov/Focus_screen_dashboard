import { useEffect } from 'react'

/** The pointer counts as resting after this long without moving. */
const REST_MS = 3000
/** Telling main about every mouse move would flood IPC; one note per few seconds is plenty. */
const REPORT_EVERY_MS = 5000

/**
 * On the Focus Screen: reports activity (which wakes it from idle dim) and, when `hideCursor`
 * is on, hides the pointer once it rests.
 */
export function usePointerRest(hideCursor: boolean): void {
  useEffect(() => {
    const root = document.documentElement
    let lastReport = 0
    let restTimer: ReturnType<typeof setTimeout> | undefined

    const rest = (): void => {
      if (hideCursor) root.classList.add('cursor-hidden')
    }
    const onActivity = (): void => {
      root.classList.remove('cursor-hidden')
      clearTimeout(restTimer)
      restTimer = setTimeout(rest, REST_MS)
      const now = Date.now()
      if (now - lastReport >= REPORT_EVERY_MS) {
        lastReport = now
        window.focusScreen.reportActivity()
      }
    }
    const events = ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const
    for (const name of events) window.addEventListener(name, onActivity, { passive: true })
    restTimer = setTimeout(rest, REST_MS)
    return () => {
      for (const name of events) window.removeEventListener(name, onActivity)
      clearTimeout(restTimer)
      root.classList.remove('cursor-hidden')
    }
  }, [hideCursor])
}
