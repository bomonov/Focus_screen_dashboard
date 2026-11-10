import { useCallback, useState } from 'react'
import {
  sameLayout,
  type CardId,
  type CardLayout,
  type CardVisibility,
  type GridRect
} from '../../../main/services/settings/layout'
import {
  applyDrop,
  cellAt,
  cellsMoved,
  previewMove,
  resizeCard,
  RESIZE_HANDLES,
  type Cell,
  type DropPreview,
  type ResizeHandle
} from './gestures'

/** The grid's place on screen when the gesture started, in CSS pixels. */
interface GridBox {
  left: number
  top: number
  width: number
  height: number
}

export type CardGesture =
  | {
      kind: 'move'
      id: CardId
      grid: GridBox
      startX: number
      startY: number
      /** How far the pointer has gone, so the card can follow it. */
      dx: number
      dy: number
      preview: DropPreview
    }
  | {
      kind: 'resize'
      id: CardId
      grid: GridBox
      startX: number
      startY: number
      handle: ResizeHandle
      rect: GridRect
    }

const ARROWS: Record<string, Cell> = {
  ArrowLeft: { col: -1, row: 0 },
  ArrowRight: { col: 1, row: 0 },
  ArrowUp: { col: 0, row: -1 },
  ArrowDown: { col: 0, row: 1 }
}

function handleOf(target: EventTarget): ResizeHandle | null {
  if (!(target instanceof Element)) return null
  const raw = target.closest<HTMLElement>('[data-handle]')?.dataset.handle
  return RESIZE_HANDLES.find((handle) => handle === raw) ?? null
}

export interface CardDrag {
  /** What to draw: a card being resized shows its new size as it goes. */
  layout: CardLayout
  gesture: CardGesture | null
  /** Pointer handlers for a card's edit frame; its resize handles carry `data-handle`. */
  onPointerDown(event: React.PointerEvent<HTMLElement>, id: CardId, grid: HTMLElement | null): void
  onPointerMove(event: React.PointerEvent<HTMLElement>): void
  onPointerUp(): void
  /** Drops the gesture without changing anything (Esc, or the pointer was taken away). Stable. */
  cancel: () => void
  /** Arrow keys move a card one cell; with Shift they resize it. True when the key was used. */
  onKey(id: CardId, key: string, shift: boolean): boolean
}

/** Moving and resizing cards with the pointer or the keyboard; `commit` saves a new layout. */
export function useCardDrag(
  layout: CardLayout,
  visible: CardVisibility,
  commit: (next: CardLayout) => void
): CardDrag {
  const [gesture, setGesture] = useState<CardGesture | null>(null)
  const cancel = useCallback(() => setGesture(null), [])

  const save = (next: CardLayout): void => {
    if (!sameLayout(next, layout)) commit(next)
  }

  return {
    layout: gesture?.kind === 'resize' ? { ...layout, [gesture.id]: gesture.rect } : layout,
    gesture,

    onPointerDown(event, id, grid) {
      if (event.button !== 0 || !grid) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      const { left, top, width, height } = grid.getBoundingClientRect()
      const common = {
        id,
        grid: { left, top, width, height },
        startX: event.clientX,
        startY: event.clientY
      }
      const handle = handleOf(event.target)
      setGesture(
        handle
          ? { ...common, kind: 'resize', handle, rect: layout[id] }
          : { ...common, kind: 'move', dx: 0, dy: 0, preview: { kind: 'move', rect: layout[id] } }
      )
    },

    onPointerMove(event) {
      if (!gesture) return
      const dx = event.clientX - gesture.startX
      const dy = event.clientY - gesture.startY
      const { grid } = gesture
      const delta = cellsMoved(dx, dy, grid.width, grid.height)
      if (gesture.kind === 'move') {
        const pointer = cellAt(
          event.clientX - grid.left,
          event.clientY - grid.top,
          grid.width,
          grid.height
        )
        setGesture({
          ...gesture,
          dx,
          dy,
          preview: previewMove(layout, visible, gesture.id, delta, pointer)
        })
      } else {
        setGesture({
          ...gesture,
          rect: resizeCard(layout, visible, gesture.id, gesture.handle, delta)
        })
      }
    },

    onPointerUp() {
      if (!gesture) return
      setGesture(null)
      save(
        gesture.kind === 'move'
          ? applyDrop(layout, gesture.id, gesture.preview)
          : { ...layout, [gesture.id]: gesture.rect }
      )
    },

    cancel,

    onKey(id, key, shift) {
      const delta = ARROWS[key]
      if (!delta) return false
      save(
        shift
          ? { ...layout, [id]: resizeCard(layout, visible, id, 'se', delta) }
          : applyDrop(layout, id, previewMove(layout, visible, id, delta, null))
      )
      return true
    }
  }
}
