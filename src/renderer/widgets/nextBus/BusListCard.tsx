import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { TransitStop } from '../../../main/ipc'
import type { Box } from '../cardMenu/cardMenuMotion'
import { MORPH_EASING } from '../nextClass/pillMorph'
import { PeekCard, type PeekCardHandle } from '../peek/PeekCard'
import { busIn, pageKey, type BusPage } from './nextBusView'
import './BusListCard.css'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** A press that moves this far up or down is a drag to reorder, not a click. */
const DRAG_PX = 4
const SETTLE_MS = 280

interface BusListCardProps {
  handle?: React.Ref<PeekCardHandle>
  /** Every route coming to the picked stops, in the pill's order. */
  pages: readonly BusPage[]
  stops: readonly TransitStop[]
  /** The route the pill shows: lit in the list. */
  current: string | null
  /** The user has put them in an order of their own (not soonest first). */
  custom: boolean
  /** The pill's box: the card grows out of it and shrinks back into it. */
  from: Box
  keyboard: boolean
  returnFocus: HTMLElement | null
  /** A row clicked: the pill turns to it. */
  onPick(key: string): void
  /** The rows put in a new order, by a drag or Option+↑/↓. */
  onReorder(keys: string[]): void
  onSoonestFirst(): void
  onPressOutside?(x: number, y: number): void
  onClosed(): void
}

interface Press {
  key: string
  pointerId: number
  y: number
  index: number
  /** One row's height and the gap under it. */
  step: number
  moved: boolean
}

const moved = (keys: readonly string[], from: number, to: number): string[] => {
  const next = [...keys]
  const [key] = next.splice(from, 1)
  if (key !== undefined) next.splice(to, 0, key)
  return next
}

/**
 * Every bus coming to the picked stops, on a card that drops from the Bus pill (a double press
 * held, the user's idea): each route's next two, the one on the pill lit. Dragged up or down (or
 * Option+↑/↓), a row sets the order the pill shows them in; clicked, the pill turns to it.
 */
export function BusListCard({
  handle,
  pages,
  stops,
  current,
  custom,
  from,
  keyboard,
  returnFocus,
  onPick,
  onReorder,
  onSoonestFirst,
  onPressOutside,
  onClosed
}: BusListCardProps): React.JSX.Element {
  const keys = pages.map((page) => pageKey(page.arrival))
  const rows = useRef(new Map<string, HTMLLIElement>())
  const focusRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const press = useRef<Press | null>(null)
  const [drag, setDrag] = useState<{
    key: string
    from: number
    to: number
    dy: number
    step: number
  } | null>(null)
  const hintId = useId()
  const justDragged = useRef(false)
  /** Where each row was on screen before a reorder, for the rows to glide to their new places. */
  const before = useRef<Map<string, number> | null>(null)
  const refocus = useRef<string | null>(null)
  const canOrder = pages.length > 1

  const tops = (): Map<string, number> =>
    new Map([...rows.current].map(([key, row]) => [key, row.getBoundingClientRect().top]))

  function reorder(next: string[], focusKey: string | null): void {
    before.current = tops()
    refocus.current = focusKey
    onReorder(next)
  }

  // After a reorder: no CSS transition this once (the drag's shifts are already where the rows
  // land), then each row glides from where it was to its new place, the dropped one included.
  useLayoutEffect(() => {
    const was = before.current
    if (!was) return
    before.current = null
    const list = listRef.current
    list?.classList.add('bus-list__rows--still')
    const frame = requestAnimationFrame(() => list?.classList.remove('bus-list__rows--still'))
    for (const [key, row] of rows.current) {
      const top = was.get(key)
      const shift = top === undefined ? 0 : top - row.getBoundingClientRect().top
      if (Math.abs(shift) < 0.5 || reducedMotion.matches) continue
      row.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], {
        duration: SETTLE_MS,
        easing: MORPH_EASING
      })
    }
    const focusKey = refocus.current
    refocus.current = null
    if (focusKey) rows.current.get(focusKey)?.querySelector('button')?.focus()
    return () => cancelAnimationFrame(frame)
  })

  const rowStep = (): number => {
    const [first, second] = [...(listRef.current?.children ?? [])]
    if (first instanceof HTMLElement && second instanceof HTMLElement) {
      return second.offsetTop - first.offsetTop
    }
    return first instanceof HTMLElement ? first.offsetHeight : 1
  }
  const targetOf = (stroke: Press, dy: number): number =>
    Math.min(keys.length - 1, Math.max(0, stroke.index + Math.round(dy / stroke.step)))

  function shift(index: number, key: string): string | undefined {
    if (!drag) return undefined
    const { step } = drag
    if (key === drag.key) return `translateY(${drag.dy}px)`
    if (drag.from < drag.to && index > drag.from && index <= drag.to)
      return `translateY(${-step}px)`
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return `translateY(${step}px)`
    return undefined
  }

  const stopName = (id: string): string => stops.find((stop) => stop.id === id)?.name ?? ''

  return (
    <PeekCard
      handle={handle}
      className="bus-list"
      label="Buses at your stops"
      from={from}
      keyboard={keyboard}
      focus={focusRef}
      returnFocus={returnFocus}
      onPressOutside={onPressOutside}
      onClosed={onClosed}
    >
      <div className="bus-list__head">
        <p className="peek-card__heading">Buses at your stops</p>
        {custom && canOrder && (
          <button type="button" className="bus-list__reset" onClick={onSoonestFirst}>
            Soonest first
          </button>
        )}
      </div>
      {canOrder && (
        <p id={hintId} className="bus-list__hint">
          Drag to set the order the pill shows them in
        </p>
      )}
      <ol ref={listRef} className="bus-list__rows">
        {pages.map((page, index) => {
          const key = keys[index] ?? ''
          const { arrival } = page
          const where = [arrival.headsign && `to ${arrival.headsign}`, stopName(arrival.stopId)]
            .filter(Boolean)
            .join(' · ')
          const classes = ['bus-list__row']
          if (key === current) classes.push('bus-list__row--current')
          if (drag?.key === key) classes.push('bus-list__row--dragging')
          return (
            <li
              key={key}
              ref={(row) => {
                if (row) rows.current.set(key, row)
                else rows.current.delete(key)
              }}
              className={classes.join(' ')}
              style={{ transform: shift(index, key) }}
            >
              <button
                ref={key === current || (current === null && index === 0) ? focusRef : undefined}
                type="button"
                className="bus-list__button"
                aria-current={key === current ? 'true' : undefined}
                aria-describedby={canOrder ? hintId : undefined}
                onPointerDown={(down) => {
                  if (!canOrder || (down.pointerType === 'mouse' && down.button !== 0)) return
                  press.current = {
                    key,
                    pointerId: down.pointerId,
                    y: down.clientY,
                    index,
                    step: rowStep(),
                    moved: false
                  }
                }}
                onPointerMove={(move) => {
                  const stroke = press.current
                  if (!stroke || stroke.pointerId !== move.pointerId) return
                  const dy = move.clientY - stroke.y
                  if (!stroke.moved) {
                    if (Math.abs(dy) < DRAG_PX) return
                    stroke.moved = true
                    move.currentTarget.setPointerCapture(move.pointerId)
                  }
                  setDrag({
                    key,
                    from: stroke.index,
                    to: targetOf(stroke, dy),
                    dy,
                    step: stroke.step
                  })
                }}
                onPointerUp={(up) => {
                  const stroke = press.current
                  press.current = null
                  if (!stroke?.moved) return
                  justDragged.current = true
                  const to = targetOf(stroke, up.clientY - stroke.y)
                  if (to !== stroke.index) reorder(moved(keys, stroke.index, to), null)
                  else before.current = tops()
                  setDrag(null)
                }}
                onPointerCancel={() => {
                  press.current = null
                  setDrag(null)
                }}
                onClick={() => {
                  if (justDragged.current) {
                    justDragged.current = false
                    return
                  }
                  onPick(key)
                }}
                onKeyDown={(event) => {
                  if (!canOrder || !event.altKey) return
                  const way = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
                  const to = index + way
                  if (way === 0 || to < 0 || to >= keys.length) return
                  event.preventDefault()
                  reorder(moved(keys, index, to), key)
                }}
              >
                {canOrder && (
                  <svg className="bus-list__grip" viewBox="0 0 10 16" aria-hidden="true">
                    {[3, 8, 13].map((y) => (
                      <g key={y}>
                        <circle cx="2.5" cy={y} r="1.4" />
                        <circle cx="7.5" cy={y} r="1.4" />
                      </g>
                    ))}
                  </svg>
                )}
                <span className="bus-list__route">
                  <span className="bus-list__name">{arrival.route}</span>
                  {where && <span className="bus-list__where">{where}</span>}
                </span>
                <span className="bus-list__times">
                  <span className="bus-list__next">{busIn(page.minutes)}</span>
                  {page.then !== null && (
                    <span className="bus-list__then">then {busIn(page.then)}</span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </PeekCard>
  )
}
