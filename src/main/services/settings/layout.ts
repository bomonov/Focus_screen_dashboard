// Where the cards sit on the Focus Screen: whole cells of a fixed grid, so a layout looks the
// same on any monitor. Shared with the renderer: keep this file free of imports.

export type CardId = 'music' | 'todos' | 'timer'

/** Also the order cards keep their spot in when two want the same cells. */
export const CARD_IDS: readonly CardId[] = ['music', 'todos', 'timer']

/** A card's spot, in grid cells from the top left. */
export interface GridRect {
  x: number
  y: number
  w: number
  h: number
}

/** Every card has a spot, the hidden ones too, so turning a card back on puts it where it was. */
export type CardLayout = Record<CardId, GridRect>

export type CardVisibility = Record<CardId, boolean>

/** 20 columns put the mockup's 60/40 split on a cell edge. */
export const LAYOUT_COLUMNS = 20
export const LAYOUT_ROWS = 12

/** Below these a card's controls stop fitting, even on a 4:3 screen (the narrowest cells). */
export const MIN_CARD_SIZE: Record<CardId, { w: number; h: number }> = {
  music: { w: 8, h: 6 },
  todos: { w: 5, h: 5 },
  timer: { w: 6, h: 5 }
}

/** The mockup with every card on; where a card goes when it has no spot of its own yet. */
export const FALLBACK_LAYOUT: CardLayout = {
  music: { x: 0, y: 0, w: 12, h: 12 },
  todos: { x: 12, y: 0, w: 8, h: 6 },
  timer: { x: 12, y: 6, w: 8, h: 6 }
}

export function overlaps(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function sameRect(a: GridRect, b: GridRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

export function sameLayout(a: CardLayout | null, b: CardLayout | null): boolean {
  if (a === null || b === null) return a === b
  return CARD_IDS.every((id) => sameRect(a[id], b[id]))
}

/** Whole cells, inside the grid, and at least the card's smallest size. */
export function fitsGrid(rect: GridRect, id: CardId): boolean {
  const min = MIN_CARD_SIZE[id]
  return (
    [rect.x, rect.y, rect.w, rect.h].every(Number.isInteger) &&
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.w >= min.w &&
    rect.h >= min.h &&
    rect.x + rect.w <= LAYOUT_COLUMNS &&
    rect.y + rect.h <= LAYOUT_ROWS
  )
}

function parseRect(value: unknown, id: CardId): GridRect | null {
  if (typeof value !== 'object' || value === null) return null
  const { x, y, w, h } = value as Record<string, unknown>
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof w !== 'number' ||
    typeof h !== 'number'
  ) {
    return null
  }
  const rect = { x, y, w, h }
  return fitsGrid(rect, id) ? rect : null
}

/** A saved layout, or null when anything in it is off (the screen then uses the default). */
export function parseLayout(value: unknown): CardLayout | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const music = parseRect(raw.music, 'music')
  const todos = parseRect(raw.todos, 'todos')
  const timer = parseRect(raw.timer, 'timer')
  return music && todos && timer ? { music, todos, timer } : null
}

/**
 * The free spot for a card that lost its own: the biggest one up to its usual size, then the
 * one nearest where it was. null when even its smallest size doesn't fit anywhere.
 */
export function findSpot(want: GridRect, taken: readonly GridRect[], id: CardId): GridRect | null {
  const min = MIN_CARD_SIZE[id]
  let best: GridRect | null = null
  let bestArea = 0
  let bestDistance = Infinity
  for (let w = Math.min(want.w, LAYOUT_COLUMNS); w >= min.w; w--) {
    for (let h = Math.min(want.h, LAYOUT_ROWS); h >= min.h; h--) {
      const area = w * h
      if (area < bestArea) continue
      for (let y = 0; y + h <= LAYOUT_ROWS; y++) {
        for (let x = 0; x + w <= LAYOUT_COLUMNS; x++) {
          const rect = { x, y, w, h }
          if (taken.some((other) => overlaps(rect, other))) continue
          const distance = Math.abs(x - want.x) + Math.abs(y - want.y)
          if (area > bestArea || distance < bestDistance) {
            best = rect
            bestArea = area
            bestDistance = distance
          }
        }
      }
    }
  }
  return best
}

/**
 * Makes sure the cards on screen don't overlap. Cards in `keep` hold their spot first (the ones
 * that were already showing); a card that collides moves to the nearest free spot, shrinking
 * if it must. null when a card can't fit anywhere, which means "back to the default layout".
 */
export function settleLayout(
  layout: CardLayout,
  visible: CardVisibility,
  keep: readonly CardId[] = []
): CardLayout | null {
  const order = [...keep, ...CARD_IDS.filter((id) => !keep.includes(id))].filter(
    (id) => visible[id]
  )
  const taken: GridRect[] = []
  let settled = layout
  for (const id of order) {
    let rect = layout[id]
    if (taken.some((other) => overlaps(rect, other))) {
      const spot = findSpot(rect, taken, id)
      if (!spot) return null
      rect = spot
      settled = { ...settled, [id]: spot }
    }
    taken.push(rect)
  }
  return settled
}
