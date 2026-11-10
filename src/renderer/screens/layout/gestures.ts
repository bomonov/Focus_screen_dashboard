import {
  CARD_IDS,
  FALLBACK_LAYOUT,
  LAYOUT_COLUMNS,
  LAYOUT_ROWS,
  MIN_CARD_SIZE,
  overlaps,
  settleLayout,
  type CardId,
  type CardLayout,
  type CardVisibility,
  type GridRect
} from '../../../main/services/settings/layout'

/** Which edges a resize handle moves: the four sides and the four corners. */
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const RESIZE_HANDLES: readonly ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

/** Where a card being dragged would land. */
export type DropPreview =
  /** Free cells: the card moves there. */
  | { kind: 'move'; rect: GridRect }
  /** Dropped on another card: the two trade spots. `rect` is the other card's. */
  | { kind: 'swap'; rect: GridRect; with: CardId }
  /** Partly over another card, or a swap one of them is too big for: nothing changes. */
  | { kind: 'blocked'; rect: GridRect }

export interface Cell {
  col: number
  row: number
}

/** Pixels from the grid's top left (the whole grid, half gaps included) and its size. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

function others(
  layout: CardLayout,
  visible: CardVisibility,
  id: CardId
): { id: CardId; rect: GridRect }[] {
  return CARD_IDS.filter((other) => other !== id && visible[other]).map((other) => ({
    id: other,
    rect: layout[other]
  }))
}

function contains(rect: GridRect, cell: Cell): boolean {
  return (
    cell.col >= rect.x &&
    cell.col < rect.x + rect.w &&
    cell.row >= rect.y &&
    cell.row < rect.y + rect.h
  )
}

function roomFor(rect: GridRect, id: CardId): boolean {
  return rect.w >= MIN_CARD_SIZE[id].w && rect.h >= MIN_CARD_SIZE[id].h
}

/** The cell under a point, given the grid's size in pixels. */
export function cellAt(x: number, y: number, width: number, height: number): Cell {
  return {
    col: clamp(Math.floor((x / width) * LAYOUT_COLUMNS), 0, LAYOUT_COLUMNS - 1),
    row: clamp(Math.floor((y / height) * LAYOUT_ROWS), 0, LAYOUT_ROWS - 1)
  }
}

/** A pointer move in pixels as whole cells, rounded so a card snaps to the nearest one. */
export function cellsMoved(dx: number, dy: number, width: number, height: number): Cell {
  // `|| 0` turns the -0 a small upward drag rounds to into a plain 0.
  return {
    col: Math.round((dx / width) * LAYOUT_COLUMNS) || 0,
    row: Math.round((dy / height) * LAYOUT_ROWS) || 0
  }
}

/**
 * Where card `id` lands when moved by `delta` cells, kept inside the grid. On top of another
 * card it swaps with the one under the pointer (`pointer` is null for keyboard moves, which
 * never swap).
 */
export function previewMove(
  layout: CardLayout,
  visible: CardVisibility,
  id: CardId,
  delta: Cell,
  pointer: Cell | null
): DropPreview {
  const start = layout[id]
  const rect = {
    ...start,
    x: clamp(start.x + delta.col, 0, LAYOUT_COLUMNS - start.w),
    y: clamp(start.y + delta.row, 0, LAYOUT_ROWS - start.h)
  }
  const rest = others(layout, visible, id)
  if (!rest.some((other) => overlaps(rect, other.rect))) return { kind: 'move', rect }
  const under = pointer && rest.find((other) => contains(other.rect, pointer))
  if (under && roomFor(under.rect, id) && roomFor(start, under.id)) {
    return { kind: 'swap', rect: under.rect, with: under.id }
  }
  return { kind: 'blocked', rect }
}

export function applyDrop(layout: CardLayout, id: CardId, preview: DropPreview): CardLayout {
  switch (preview.kind) {
    case 'move':
      return { ...layout, [id]: preview.rect }
    case 'swap':
      return { ...layout, [id]: preview.rect, [preview.with]: layout[id] }
    case 'blocked':
      return layout
  }
}

/**
 * Card `id` resized from `handle` by `delta` cells. It never shrinks below its smallest size
 * and stops at the grid's edge and at other cards: sideways first, then up or down.
 */
export function resizeCard(
  layout: CardLayout,
  visible: CardVisibility,
  id: CardId,
  handle: ResizeHandle,
  delta: Cell
): GridRect {
  const start = layout[id]
  const min = MIN_CARD_SIZE[id]
  const rest = others(layout, visible, id).map((other) => other.rect)
  let left = start.x
  let right = start.x + start.w
  let top = start.y
  let bottom = start.y + start.h

  // The card overlaps nothing, so every card beside it is wholly to one side.
  const besideRows = rest.filter((other) => other.y < bottom && top < other.y + other.h)
  if (handle.includes('e')) {
    const stop = Math.min(
      LAYOUT_COLUMNS,
      ...besideRows.filter((other) => other.x >= right).map((other) => other.x)
    )
    right = clamp(right + delta.col, left + min.w, stop)
  }
  if (handle.includes('w')) {
    const stop = Math.max(
      0,
      ...besideRows.filter((other) => other.x + other.w <= left).map((other) => other.x + other.w)
    )
    left = clamp(left + delta.col, stop, right - min.w)
  }

  const besideColumns = rest.filter((other) => other.x < right && left < other.x + other.w)
  if (handle.includes('s')) {
    const stop = Math.min(
      LAYOUT_ROWS,
      ...besideColumns.filter((other) => other.y >= bottom).map((other) => other.y)
    )
    bottom = clamp(bottom + delta.row, top + min.h, stop)
  }
  if (handle.includes('n')) {
    const stop = Math.max(
      0,
      ...besideColumns.filter((other) => other.y + other.h <= top).map((other) => other.y + other.h)
    )
    top = clamp(top + delta.row, stop, bottom - min.h)
  }

  return { x: left, y: top, w: right - left, h: bottom - top }
}

/**
 * The default arrangement as grid cells, from where its cards are on screen. `boxes` are each
 * card's pixels from the cards area's top left; `area` is that area's size, and `gap` the space
 * between cards. Hidden cards keep their fallback spots.
 */
export function snapToGrid(
  boxes: Partial<Record<CardId, Box>>,
  area: { width: number; height: number },
  gap: number,
  visible: CardVisibility
): CardLayout {
  // Each cell carries half a gap on every side, so the grid is one gap bigger than the area.
  const colWidth = (area.width + gap) / LAYOUT_COLUMNS
  const rowHeight = (area.height + gap) / LAYOUT_ROWS
  let layout = FALLBACK_LAYOUT
  for (const id of CARD_IDS) {
    const box = boxes[id]
    if (!box || !visible[id]) continue
    const min = MIN_CARD_SIZE[id]
    const x = clamp(Math.round(box.left / colWidth), 0, LAYOUT_COLUMNS - min.w)
    const y = clamp(Math.round(box.top / rowHeight), 0, LAYOUT_ROWS - min.h)
    const right = clamp(
      Math.round((box.left + box.width + gap) / colWidth),
      x + min.w,
      LAYOUT_COLUMNS
    )
    const bottom = clamp(
      Math.round((box.top + box.height + gap) / rowHeight),
      y + min.h,
      LAYOUT_ROWS
    )
    layout = { ...layout, [id]: { x, y, w: right - x, h: bottom - y } }
  }
  return settleLayout(layout, visible) ?? FALLBACK_LAYOUT
}
