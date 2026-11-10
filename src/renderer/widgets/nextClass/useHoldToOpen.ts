import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SLOP_PX } from './pillSwipe'
import { pressStart, type DoublePress } from './pressStart'

/** How long a pill is held before its card opens: long enough not to be a stray click. */
export const HOLD_MS = 350

export type HoldHandlers = Pick<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  | 'onPointerDown'
  | 'onPointerMove'
  | 'onPointerUp'
  | 'onPointerLeave'
  | 'onPointerCancel'
  | 'onClick'
>

/** A pill's second card: a click, then the next press (held, or at once); or Shift+Enter. */
export interface DoubleHold extends DoublePress {
  open(keyboard: boolean): void
}

/**
 * A pill held down (or Enter) opens its card; a quick click doesn't, nor does a press that
 * moves off (a swipe). With `double`, a click and then a held press opens that one instead (the
 * Bus pill's list), or with `atOnce` a plain double-click does (the class list). While the hold
 * builds, `pressing` is on, so the pill can sink a little. `open` hears whether it was the
 * keyboard.
 */
export function useHoldToOpen(
  open: (keyboard: boolean) => void,
  disabled: boolean,
  double?: DoubleHold
): { pressing: boolean; handlers: HoldHandlers } {
  const [pressing, setPressing] = useState(false)
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const downAt = useRef<{ x: number; y: number; time: number } | null>(null)
  /** When the last quick click let go: the start of a double press. */
  const clickedAt = useRef(-Infinity)
  const latest = useRef({ open, double })
  useLayoutEffect(() => {
    latest.current = { open, double }
  })
  useEffect(() => () => clearTimeout(hold.current), [])

  const release = (): void => {
    clearTimeout(hold.current)
    downAt.current = null
    setPressing(false)
  }
  return {
    pressing,
    handlers: {
      onPointerDown: (down) => {
        if (down.button !== 0 || down.ctrlKey) return
        const starts = pressStart(down.timeStamp - clickedAt.current, disabled, double)
        clickedAt.current = -Infinity
        clearTimeout(hold.current)
        if (starts === 'double') {
          // A double-click's second press: open now, like the menus, on the press.
          downAt.current = null
          setPressing(false)
          latest.current.double?.open(false)
          return
        }
        // Pressed down even when there's nothing to hold for: it may be a double press's first.
        downAt.current = { x: down.clientX, y: down.clientY, time: down.timeStamp }
        if (starts === 'none') return
        setPressing(true)
        hold.current = setTimeout(() => {
          downAt.current = null
          setPressing(false)
          if (starts === 'double-held') latest.current.double?.open(false)
          else latest.current.open(false)
        }, HOLD_MS)
      },
      onPointerMove: (move) => {
        const from = downAt.current
        if (from && Math.hypot(move.clientX - from.x, move.clientY - from.y) > SLOP_PX) release()
      },
      onPointerUp: (up) => {
        // Let go before the hold, where it was pressed: a click, maybe a double press's first.
        const from = downAt.current
        if (from && up.timeStamp - from.time < HOLD_MS) clickedAt.current = up.timeStamp
        release()
      },
      onPointerLeave: release,
      onPointerCancel: release,
      // Enter (a click with no count) opens it at once, Shift+Enter the second card; a quick
      // mouse click doesn't.
      onClick: (click) => {
        if (click.detail !== 0) return
        if (click.shiftKey && double && !double.disabled) double.open(true)
        else if (!disabled) latest.current.open(true)
      }
    }
  }
}
