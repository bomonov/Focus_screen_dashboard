import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  firmTick,
  nudge,
  scrollValues,
  shownOffset,
  stepWheel,
  takesWheel,
  turnWheel,
  typeDigit,
  type ScrollGesture
} from './wheelMath'

/** In a settings row, dragging this far turns the box's number one value. */
const ROW_DRAG_PX = 16
/** Pointer travel (px) that turns a press into a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4
/** A scroll that's gone quiet this long has ended, and the wheel settles on a value. */
const SETTLE_AFTER_MS = 140
/** The numbers above and below the middle one: this much smaller, and this faint. */
const NEAR_SCALE = 0.45
const NEAR_OPACITY = 0.55
/** The card's wheel draws the middle value and two either side, to glide through. */
const ROWS = [-2, -1, 0, 1, 2] as const

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

export type WheelSize = 'card' | 'row'

interface LengthWheelProps {
  value: number
  max: number
  /** Shown under the card's wheel and after the row's ("hours", "min", "sec"). */
  unit: string
  /** The spinbutton's name ("Focus hours"). */
  name: string
  /** The value in words ("25 minutes"). */
  valueText: string
  /** Minutes and seconds show two digits; hours just the number. */
  pad: boolean
  size: WheelSize
  onChange: (value: number) => void
  /** The wheel just came onto 0 (`fast`: quickly): the trackpad's tick, if there is one. */
  onZero?: (fast: boolean) => void
}

/**
 * One wheel of the timer's length: hours, minutes or seconds. Turned by scrolling (a trackpad
 * or mouse wheel), dragging up and down, clicking the dim value above or below, the arrow keys,
 * or typing its digits. Values wrap round (59 → 0) without carrying into the next wheel.
 *
 * On the card the numbers glide with the fingers, a fraction of a value at a time, and settle on
 * the nearest one when the scroll or drag ends, like a picker; the value itself (and the saved
 * length) changes as each number passes the middle. That motion is drawn straight onto the rows,
 * not through React, so it keeps up with every event.
 */
export function LengthWheel({
  value,
  max,
  unit,
  name,
  valueText,
  pad,
  size,
  onChange,
  onZero
}: LengthWheelProps): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const windowRef = useRef<HTMLSpanElement>(null)
  const rows = useRef<(HTMLSpanElement | null)[]>([])
  const digits = useRef<(HTMLSpanElement | null)[]>([])
  // Kept ahead of renders, so two scroll events in one frame both count.
  const valueRef = useRef(value)
  const lastProp = useRef(value)
  const onChangeRef = useRef(onChange)
  const onZeroRef = useRef(onZero)
  /** How far past `valueRef` the wheel is turned, in values (between -0.5 and 0.5 at rest). */
  const offset = useRef(0)
  const scroll = useRef<ScrollGesture | null>(null)
  /** Values this scroll has turned past the middle, so a scroll too short to turn one nudges. */
  const committed = useRef(0)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const frame = useRef(0)
  const typed = useRef({ text: '', at: 0 })
  const drag = useRef<{
    id: number
    startY: number
    lastY: number
    rowPx: number
    lastAt: number
    moved: boolean
  } | null>(null)

  const show = (n: number): string => (pad ? String(n).padStart(2, '0') : String(n))

  /** Draws the rows where the wheel is now: each slides, shrinks and fades away from the middle. */
  function paint(): void {
    if (size !== 'card') return
    // Under reduced motion the numbers change in place rather than gliding. Round zero they're
    // drawn held back: the detent.
    const turned = reducedMotion.matches ? 0 : shownOffset(valueRef.current, max, offset.current)
    ROWS.forEach((k, i) => {
      const row = rows.current[i]
      const digit = digits.current[i]
      if (!row || !digit) return
      const away = k - turned
      const distance = Math.abs(away)
      row.style.transform = `translateY(calc(var(--row) * ${away.toFixed(4)}))`
      row.style.opacity = String(
        distance <= 1
          ? 1 - (1 - NEAR_OPACITY) * distance
          : Math.max(0, (NEAR_OPACITY * (1.8 - distance)) / 0.8)
      )
      digit.style.transform = `scale(${(1 - (1 - NEAR_SCALE) * Math.min(distance, 1)).toFixed(4)})`
      digit.textContent = show(stepWheel(valueRef.current, k, max))
    })
  }

  function stopGlide(): void {
    cancelAnimationFrame(frame.current)
    frame.current = 0
  }

  /** Eases what's left of a turn back to rest on the middle value. */
  function settle(): void {
    stopGlide()
    const from = offset.current
    if (from === 0 || size !== 'card' || reducedMotion.matches) {
      offset.current = 0
      paint()
      return
    }
    const start = performance.now()
    const duration = 160 + 70 * Math.min(Math.abs(from), 2)
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration)
      offset.current = from * Math.pow(1 - t, 3)
      paint()
      frame.current = t < 1 ? requestAnimationFrame(tick) : 0
    }
    frame.current = requestAnimationFrame(tick)
  }

  function set(next: number, way: number): void {
    // Anything but typing (way 0) ends a two-digit number: 1, ↑, 5 is 5, not 15.
    if (way !== 0) typed.current = { text: '', at: 0 }
    if (next === valueRef.current) return
    valueRef.current = next
    onChangeRef.current(next)
  }

  /** The wheel came onto 0: the lines round the middle catch the light, and the trackpad ticks. */
  function landOnZero(fast = false): void {
    onZeroRef.current?.(fast)
    const box = windowRef.current
    if (size !== 'card' || !box || reducedMotion.matches) return
    const style = getComputedStyle(box)
    const lit = style.getPropertyValue('--accent').trim()
    const rest = style.getPropertyValue('--border-strong').trim()
    for (const pseudoElement of ['::before', '::after']) {
      box.animate([{ backgroundColor: lit }, { backgroundColor: rest }], {
        duration: 320,
        easing: 'ease-out',
        pseudoElement
      })
    }
  }

  /** The next value up or down is in the middle now; the turn carries on from there. */
  function commit(way: number): void {
    set(stepWheel(valueRef.current, way, max), way)
    offset.current -= way
    committed.current += way
    if (valueRef.current === 0) landOnZero()
  }

  /**
   * A turn by a fraction of a value (a scroll or drag, `speed` px/ms): the value changes as each
   * passes the middle.
   */
  function turn(values: number, speed = 0): void {
    const turned = turnWheel(valueRef.current, offset.current, values, max)
    offset.current = turned.offset
    committed.current += turned.steps
    set(turned.value, Math.sign(turned.steps))
    if (turned.landedOnZero > 0) landOnZero(firmTick(speed))
    paint()
  }

  /** A whole step (a key, a click): the new value glides in, a couple of rows at most. */
  function step(delta: number): void {
    if (delta === 0) return
    stopGlide()
    set(stepWheel(valueRef.current, delta, max), Math.sign(delta))
    offset.current = Math.max(-2, Math.min(2, offset.current - delta))
    if (valueRef.current === 0) landOnZero()
    settle()
  }

  // The latest onChange, and a value set from outside (a quick pick, Customize) shown at rest.
  useLayoutEffect(() => {
    onChangeRef.current = onChange
    onZeroRef.current = onZero
    if (value !== lastProp.current) {
      lastProp.current = value
      if (value !== valueRef.current) {
        valueRef.current = value
        stopGlide()
        offset.current = 0
      }
    }
    paint()
  })

  // The native listener below lives across renders; it calls this render's handlers.
  const handlers = useRef({ turn, step, commit, settle })
  useLayoutEffect(() => {
    handlers.current = { turn, step, commit, settle }
  })

  // A native listener: React's wheel listeners are passive, and the page mustn't scroll too.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const onWheel = (event: WheelEvent): void => {
      if (!takesWheel(size, document.activeElement === el)) return
      event.preventDefault()
      const result = scrollValues(scroll.current, event.deltaY, event.deltaMode, event.timeStamp)
      const { turn, step, commit, settle } = handlers.current
      if (!result.gesture) {
        // A mouse wheel's line or page: one whole value.
        step(result.values)
        return
      }
      cancelAnimationFrame(frame.current)
      // A scroll of its own (after a pause, or the other way) counts its own values.
      if (result.gesture.values === result.values) committed.current = 0
      scroll.current = result.gesture
      turn(result.values, result.gesture.speed)
      clearTimeout(settleTimer.current)
      settleTimer.current = setTimeout(() => {
        const extra = nudge(scroll.current?.values ?? 0, committed.current)
        if (extra !== 0) commit(extra)
        settle()
      }, SETTLE_AFTER_MS)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      clearTimeout(settleTimer.current)
      cancelAnimationFrame(frame.current)
    }
  }, [size])

  function onKeyDown(event: React.KeyboardEvent): void {
    const big = max > 23 ? 10 : 5
    const moves: Record<string, () => void> = {
      ArrowUp: () => step(1),
      ArrowDown: () => step(-1),
      PageUp: () => step(big),
      PageDown: () => step(-big),
      Home: () => step(-valueRef.current),
      End: () => step(max - valueRef.current)
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      move()
      return
    }
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault()
      const now = performance.now() / 1000
      const result = typeDigit(typed.current.text, Number(event.key), max, now - typed.current.at)
      typed.current = { text: result.typed, at: now }
      stopGlide()
      offset.current = 0
      set(result.value, 0)
      paint()
    }
  }

  function onPointerDown(event: React.PointerEvent): void {
    if (event.button !== 0) return
    root.current?.focus({ preventScroll: true })
    root.current?.setPointerCapture(event.pointerId)
    stopGlide()
    clearTimeout(settleTimer.current)
    drag.current = {
      id: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastAt: event.timeStamp,
      rowPx: size === 'card' ? rowPx() : ROW_DRAG_PX,
      moved: false
    }
  }

  /** One row's height on the card, in px. */
  function rowPx(): number {
    const row = rows.current[2]
    return row ? row.getBoundingClientRect().height || 1 : 1
  }

  function onPointerMove(event: React.PointerEvent): void {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    if (Math.abs(event.clientY - d.startY) > DRAG_THRESHOLD_PX) d.moved = true
    if (!d.moved) return
    // Dragging up brings the bigger numbers below into the middle, as on a picker; the
    // numbers stay under the pointer.
    const dy = event.clientY - d.lastY
    turn(-dy / d.rowPx, Math.abs(dy) / Math.max(1, event.timeStamp - d.lastAt))
    d.lastY = event.clientY
    d.lastAt = event.timeStamp
  }

  function onPointerUp(event: React.PointerEvent): void {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    drag.current = null
    if (d.moved) {
      settle()
      return
    }
    // A click on the dim number above or below turns to it.
    const box = windowRef.current?.getBoundingClientRect()
    if (size !== 'card' || !box) return
    const row = rowPx()
    const middle = box.top + box.height / 2
    if (event.clientY < middle - row / 2) step(-1)
    else if (event.clientY > middle + row / 2) step(1)
  }

  return (
    <div
      ref={root}
      className={`length-wheel length-wheel--${size}`}
      role="spinbutton"
      tabIndex={0}
      aria-label={name}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={valueText}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null
        settle()
      }}
    >
      <span ref={windowRef} className="length-wheel__window">
        {size === 'card' ? (
          ROWS.map((k, i) => (
            <span
              key={k}
              ref={(el) => {
                rows.current[i] = el
              }}
              className="length-wheel__row"
              aria-hidden="true"
            >
              <span
                ref={(el) => {
                  digits.current[i] = el
                }}
                className="length-wheel__digits"
              />
            </span>
          ))
        ) : (
          <span className="length-wheel__value">{show(value)}</span>
        )}
      </span>
      <span className="length-wheel__unit" aria-hidden="true">
        {unit}
      </span>
    </div>
  )
}
