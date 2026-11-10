import { useEffect, useLayoutEffect, useRef } from 'react'
import { MORPH_EASING, reducedMotion } from './pillMorph'
import {
  createWheelSwipe,
  DRAG_TURN_PX,
  SLOP_PX,
  swipeOffset,
  turnFor,
  WHEEL_QUIET_MS,
  type CanTurn,
  type Turn
} from './pillSwipe'
import type { HoldHandlers } from './useHoldToOpen'

export type SwipeHandlers = Pick<
  React.HTMLAttributes<HTMLElement>,
  | 'onPointerDown'
  | 'onPointerMove'
  | 'onPointerUp'
  | 'onPointerCancel'
  | 'onLostPointerCapture'
  | 'onWheel'
  | 'onKeyDown'
>

/** The words have all but faded once they've slid this far. */
const FADE_PX = 96
const SETTLE_MS = 350
/** A wheel line, for the odd mouse that scrolls sideways in lines rather than pixels. */
const LINE_PX = 16

const fadeAt = (offset: number): number => Math.max(0.15, 1 - Math.abs(offset) / FADE_PX)

/** What a swipe slides: the pill, and the card open from it. Missing ones are skipped. */
export type Movers = () => readonly (HTMLElement | null)[]

/** Each one's contents, slid `offset` px across (CSS: [data-swiping] > *). */
function place(movers: Movers, offset: number): void {
  for (const element of movers()) {
    if (!element) continue
    element.dataset.swiping = ''
    element.style.setProperty('--swipe-x', `${offset}px`)
    element.style.setProperty('--swipe-fade', String(fadeAt(offset)))
  }
}

function clear(movers: Movers): void {
  for (const element of movers()) {
    if (!element) continue
    delete element.dataset.swiping
    element.style.removeProperty('--swipe-x')
    element.style.removeProperty('--swipe-fade')
  }
}

/** A swipe that didn't go far enough: the contents spring back from `offset`. */
function settle(movers: Movers, offset: number): void {
  clear(movers)
  if (offset === 0 || reducedMotion.matches) return
  for (const element of movers()) {
    for (const child of element?.children ?? []) {
      child.animate(
        [{ transform: `translateX(${offset}px)`, opacity: fadeAt(offset) }, { transform: 'none' }],
        { duration: SETTLE_MS, easing: MORPH_EASING }
      )
    }
  }
}

/**
 * Swipes on a pill with pages: a two-finger trackpad swipe, a finger on a touch screen, or the
 * arrow keys. Right to left turns to the next page. The words (`movers`' contents) follow
 * the fingers, and spring back if they don't go far enough or there's no page that way. The
 * handlers can go on more than one element (the pill, and its card while that's open).
 *
 * Never a press-and-drag of the pointer (the user's call): it turned pages while holding a pill
 * for its card, or clicking about near it.
 */
export function usePillSwipe(
  movers: Movers,
  can: CanTurn,
  turn: (to: Turn) => void,
  disabled: boolean
): SwipeHandlers {
  const latest = useRef({ movers, can, turn, disabled })
  useLayoutEffect(() => {
    latest.current = { movers, can, turn, disabled }
  })
  const moving: Movers = () => latest.current.movers()
  const drag = useRef<{ id: number; x: number; y: number; dx: number; swiping: boolean } | null>(
    null
  )
  const wheel = useRef(createWheelSwipe())
  const quiet = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(quiet.current), [])

  const turnTo = (to: Turn): void => {
    clear(moving)
    latest.current.turn(to)
  }

  const end = (pointerId: number, released: boolean): void => {
    const stroke = drag.current
    if (!stroke || stroke.id !== pointerId) return
    drag.current = null
    if (!stroke.swiping) return
    const { can } = latest.current
    const to = released ? turnFor(stroke.dx, can, DRAG_TURN_PX) : null
    if (to) turnTo(to)
    else settle(moving, swipeOffset(stroke.dx, can))
  }

  return {
    onPointerDown: (down) => {
      if (latest.current.disabled || down.pointerType !== 'touch') return
      drag.current = { id: down.pointerId, x: down.clientX, y: down.clientY, dx: 0, swiping: false }
    },
    onPointerMove: (move) => {
      const stroke = drag.current
      if (!stroke || stroke.id !== move.pointerId) return
      let dx = move.clientX - stroke.x
      if (!stroke.swiping) {
        if (Math.abs(dx) <= SLOP_PX || Math.abs(dx) < Math.abs(move.clientY - stroke.y)) return
        stroke.swiping = true
        // Counted from where it became a swipe, so the words don't jump to catch up.
        stroke.x += Math.sign(dx) * SLOP_PX
        dx = move.clientX - stroke.x
        move.currentTarget.setPointerCapture(move.pointerId)
      }
      stroke.dx = dx
      place(moving, swipeOffset(dx, latest.current.can))
    },
    onPointerUp: (up) => end(up.pointerId, true),
    onPointerCancel: (cancel) => end(cancel.pointerId, false),
    // Let go some other way (the window lost focus mid-swipe): back to rest, no turn. After a
    // release, end has already run, so this does nothing.
    onLostPointerCapture: (lost) => end(lost.pointerId, false),
    onWheel: (event) => {
      if (latest.current.disabled || event.ctrlKey) return
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_PX : 1
      const step = wheel.current.feed(
        event.deltaX * scale,
        event.deltaY * scale,
        event.timeStamp,
        latest.current.can
      )
      if (!step) return
      clearTimeout(quiet.current)
      if (step.turn) {
        turnTo(step.turn)
        return
      }
      if (step.offset === 0) {
        clear(moving)
        return
      }
      place(moving, step.offset)
      quiet.current = setTimeout(() => settle(moving, step.offset), WHEEL_QUIET_MS)
    },
    onKeyDown: (key) => {
      const to = key.key === 'ArrowRight' ? 'next' : key.key === 'ArrowLeft' ? 'back' : null
      const { can, disabled } = latest.current
      if (!to || disabled || !can[to]) return
      key.preventDefault()
      turnTo(to)
    }
  }
}

function both<E>(
  first: ((event: E) => void) | undefined,
  second: ((event: E) => void) | undefined
): ((event: E) => void) | undefined {
  if (!first || !second) return first ?? second
  return (event) => {
    first(event)
    second(event)
  }
}

/** One pill that both swipes and holds to open its card. */
export function withSwipe(hold: HoldHandlers, swipe: SwipeHandlers): HoldHandlers & SwipeHandlers {
  return {
    ...hold,
    ...swipe,
    onPointerDown: both(swipe.onPointerDown, hold.onPointerDown),
    onPointerMove: both(swipe.onPointerMove, hold.onPointerMove),
    onPointerUp: both(swipe.onPointerUp, hold.onPointerUp),
    onPointerCancel: both(swipe.onPointerCancel, hold.onPointerCancel)
  }
}
