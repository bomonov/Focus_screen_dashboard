import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MusicSettings, TimerSettings, WidgetSettings } from '../../../main/ipc'
import {
  CARD_IDS,
  FALLBACK_LAYOUT,
  type CardId,
  type CardLayout,
  type CardVisibility,
  type GridRect
} from '../../../main/services/settings/layout'
import { useCardStatuses } from '../../hooks/useCardStatuses'
import { NowPlaying } from '../../widgets/NowPlaying'
import { StatusDot } from '../../widgets/StatusDot'
import { Timer } from '../../widgets/Timer'
import { TodoList } from '../../widgets/TodoList'
import { RESIZE_HANDLES, snapToGrid, type Box } from './gestures'
import { useCardDrag, type CardDrag } from './useCardDrag'
import './CardArea.css'

const CARD_NAMES: Record<CardId, string> = {
  music: 'Now playing',
  todos: 'To-do',
  timer: 'Timer'
}

function gridArea(rect: GridRect): React.CSSProperties {
  return {
    gridColumn: `${rect.x + 1} / span ${rect.w}`,
    gridRow: `${rect.y + 1} / span ${rect.h}`
  }
}

interface CardAreaProps {
  widgets: WidgetSettings
  music: MusicSettings | null
  timer: TimerSettings | null
  editing: boolean
  /** The card whose dot menu is showing, if any. */
  menuCard: CardId | null
  /** A dot was pressed (or Enter on it, `keyboard`). */
  onOpenMenu(card: CardId, name: string, dot: HTMLButtonElement, keyboard: boolean): void
}

/**
 * The cards. With no saved layout they flow like the mockup (music left, to-do and timer
 * stacked right); a saved layout, or editing one, puts them on the grid instead. Both use the
 * same elements, so switching never restarts a card (a half-typed Canvas form survives).
 */
export function CardArea({
  widgets,
  music,
  timer,
  editing,
  menuCard,
  onOpenMenu
}: CardAreaProps): React.JSX.Element {
  const area = useRef<HTMLElement>(null)
  const statuses = useCardStatuses()
  const visible = useMemo<CardVisibility>(
    () => ({ music: widgets.music, todos: widgets.todos, timer: widgets.timer }),
    [widgets.music, widgets.todos, widgets.timer]
  )
  const visibleKey = CARD_IDS.filter((id) => visible[id]).join()

  /** The default arrangement as grid cells, measured on screen when editing starts from it. */
  const [snapped, setSnapped] = useState<{ key: string; layout: CardLayout } | null>(null)
  /** A drop shows at once; it stands in for `widgets` until main sends the saved settings back. */
  const [pending, setPending] = useState<{ layout: CardLayout; basis: WidgetSettings } | null>(null)
  const [wasEditing, setWasEditing] = useState(editing)
  if (editing !== wasEditing) {
    setWasEditing(editing)
    // Measured again next time: the window may be on another screen by then.
    if (!editing) setSnapped(null)
  }

  // The same elements each render, so opening a dot's menu (or dragging a card) doesn't render
  // every card again: that was most of the time before a menu could show.
  const nowPlaying = useMemo(() => <NowPlaying settings={music} />, [music])
  const todoList = useMemo(() => <TodoList />, [])
  const timerCard = useMemo(() => <Timer settings={timer} />, [timer])

  const fromDefault = editing && snapped?.key === visibleKey ? snapped.layout : null
  const layout =
    (pending?.basis === widgets ? pending.layout : null) ?? widgets.layout ?? fromDefault
  const needsSnap = editing && layout === null

  useLayoutEffect(() => {
    if (!needsSnap) return
    const measure = (): void => {
      const box = area.current
      if (!box) return
      const origin = box.getBoundingClientRect()
      const boxes: Partial<Record<CardId, Box>> = {}
      for (const id of CARD_IDS) {
        const card = box.querySelector(`[data-card="${id}"]`)?.getBoundingClientRect()
        if (!card) continue
        boxes[id] = {
          left: card.left - origin.left,
          top: card.top - origin.top,
          width: card.width,
          height: card.height
        }
      }
      const gap = parseFloat(getComputedStyle(box).columnGap) || 0
      setSnapped({ key: visibleKey, layout: snapToGrid(boxes, origin, gap, visible) })
    }
    measure()
  }, [needsSnap, visibleKey, visible])

  const drag = useCardDrag(layout ?? FALLBACK_LAYOUT, visible, (next) => {
    setPending({ layout: next, basis: widgets })
    window.focusScreen.updateSettings({ widgets: { layout: next } })
  })

  const dragging = drag.gesture !== null
  const { cancel } = drag
  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (dragging) cancel()
      else window.focusScreen.setLayoutEditing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, dragging, cancel])

  const onGrid = layout !== null
  const classes = ['focus-screen__cards']
  if (onGrid) classes.push('focus-screen__cards--grid')
  else if (!widgets.music) classes.push('focus-screen__cards--no-music')
  if (onGrid && editing) classes.push('focus-screen__cards--editing')

  const slot = (id: CardId, card: React.ReactNode): React.JSX.Element => (
    <div
      className={`layout-slot layout-slot--${id}`}
      data-card={id}
      style={onGrid ? gridArea(drag.layout[id]) : undefined}
    >
      {card}
      {/* Arranging cards has its own frames and labels; the dots come back when it's done. */}
      {!editing && (
        <StatusDot
          name={CARD_NAMES[id]}
          status={statuses?.[id] ?? null}
          open={menuCard === id}
          onOpen={(dot, keyboard) => onOpenMenu(id, CARD_NAMES[id], dot, keyboard)}
        />
      )}
    </div>
  )
  const side = widgets.todos || widgets.timer

  return (
    <main ref={area} className={classes.join(' ')}>
      {widgets.music && slot('music', nowPlaying)}
      {side && (
        <div className="focus-screen__side">
          {widgets.todos && slot('todos', todoList)}
          {widgets.timer && slot('timer', timerCard)}
        </div>
      )}
      {!widgets.music && !side && (
        <p className="focus-screen__empty">
          Every card is turned off. Turn some back on in Customize.
        </p>
      )}
      {onGrid && editing && <EditFrames drag={drag} visible={visible} area={area} />}
    </main>
  )
}

/** Over each card while editing: its name, a frame to drag, and handles on every edge. */
function EditFrames({
  drag,
  visible,
  area
}: {
  drag: CardDrag
  visible: CardVisibility
  area: React.RefObject<HTMLElement | null>
}): React.JSX.Element {
  const { gesture } = drag
  const preview = gesture?.kind === 'move' ? gesture.preview : null
  return (
    <>
      {preview && (
        <div
          className={`layout-ghost layout-ghost--${preview.kind}`}
          style={gridArea(preview.rect)}
          aria-hidden="true"
        />
      )}
      {CARD_IDS.filter((id) => visible[id]).map((id) => {
        const moving = gesture?.kind === 'move' && gesture.id === id ? gesture : null
        const swapTarget = preview?.kind === 'swap' && preview.with === id
        const classes = ['layout-frame']
        if (gesture?.id === id) classes.push('layout-frame--active')
        if (swapTarget) classes.push('layout-frame--swap')
        return (
          <div
            key={id}
            className={classes.join(' ')}
            style={{
              ...gridArea(drag.layout[id]),
              transform: moving ? `translate(${moving.dx}px, ${moving.dy}px)` : undefined
            }}
            role="button"
            tabIndex={0}
            aria-label={`${CARD_NAMES[id]} card. Arrow keys move it; Shift and arrow keys resize it.`}
            onPointerDown={(event) => drag.onPointerDown(event, id, area.current)}
            onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp}
            onPointerCancel={drag.cancel}
            onLostPointerCapture={drag.cancel}
            onKeyDown={(event) => {
              if (drag.onKey(id, event.key, event.shiftKey)) event.preventDefault()
            }}
          >
            <div className="layout-frame__box">
              <span className="layout-frame__label">
                <span className="layout-frame__name">{CARD_NAMES[id]}</span>
                <span className="layout-frame__hint">
                  {swapTarget ? 'Swap places' : 'Drag to move'}
                </span>
              </span>
              {RESIZE_HANDLES.map((handle) => (
                <span
                  key={handle}
                  data-handle={handle}
                  className={`layout-frame__handle layout-frame__handle--${handle}`}
                />
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
