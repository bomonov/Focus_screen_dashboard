import { describe, expect, it } from 'vitest'
import { FALLBACK_LAYOUT, type CardLayout } from '../../../main/services/settings/layout'
import { applyDrop, cellAt, cellsMoved, previewMove, resizeCard, snapToGrid } from './gestures'

const ALL = { music: true, todos: true, timer: true }

/** Music on the left, to-do and timer stacked on the right. */
const LAYOUT = FALLBACK_LAYOUT

describe('pointer math', () => {
  it('finds the cell under a point, staying inside the grid', () => {
    expect(cellAt(0, 0, 2000, 1200)).toEqual({ col: 0, row: 0 })
    expect(cellAt(1999, 1199, 2000, 1200)).toEqual({ col: 19, row: 11 })
    expect(cellAt(1050, 450, 2000, 1200)).toEqual({ col: 10, row: 4 })
    expect(cellAt(2100, -5, 2000, 1200)).toEqual({ col: 19, row: 0 })
  })

  it('snaps a drag to the nearest whole cell', () => {
    expect(cellsMoved(140, -40, 2000, 1200)).toEqual({ col: 1, row: 0 })
    expect(cellsMoved(160, -60, 2000, 1200)).toEqual({ col: 2, row: -1 })
  })
})

describe('previewMove', () => {
  const roomy: CardLayout = {
    music: { x: 0, y: 0, w: 10, h: 12 },
    todos: { x: 12, y: 0, w: 8, h: 6 },
    timer: { x: 12, y: 7, w: 8, h: 5 }
  }

  it('moves a card into free cells', () => {
    expect(previewMove(roomy, ALL, 'music', { col: 2, row: 0 }, null)).toEqual({
      kind: 'move',
      rect: { x: 2, y: 0, w: 10, h: 12 }
    })
  })

  it('keeps the card inside the grid', () => {
    expect(previewMove(roomy, ALL, 'todos', { col: 5, row: -3 }, null)).toEqual({
      kind: 'move',
      rect: { x: 12, y: 0, w: 8, h: 6 }
    })
  })

  it('swaps with the card under the pointer', () => {
    const preview = previewMove(LAYOUT, ALL, 'timer', { col: 0, row: -7 }, { col: 15, row: 2 })
    expect(preview).toEqual({ kind: 'swap', rect: LAYOUT.todos, with: 'todos' })
    expect(applyDrop(LAYOUT, 'timer', preview)).toEqual({
      ...LAYOUT,
      timer: LAYOUT.todos,
      todos: LAYOUT.timer
    })
  })

  it('won’t swap into a spot too small for the card', () => {
    const preview = previewMove(LAYOUT, ALL, 'music', { col: 8, row: 5 }, { col: 15, row: 9 })
    // The timer's 8×6 spot is fine for music, and music's spot is fine for the timer.
    expect(preview.kind).toBe('swap')
    const small: CardLayout = { ...LAYOUT, timer: { x: 12, y: 6, w: 6, h: 6 } }
    const blocked = previewMove(small, ALL, 'music', { col: 6, row: 0 }, { col: 13, row: 9 })
    expect(blocked.kind).toBe('blocked')
  })

  it('is blocked when partly over a card and the pointer is over empty cells', () => {
    expect(previewMove(roomy, ALL, 'todos', { col: -3, row: 0 }, { col: 10, row: 3 }).kind).toBe(
      'blocked'
    )
    expect(applyDrop(roomy, 'todos', { kind: 'blocked', rect: roomy.music })).toBe(roomy)
  })

  it('never swaps from the keyboard', () => {
    expect(previewMove(LAYOUT, ALL, 'timer', { col: 0, row: -1 }, null).kind).toBe('blocked')
  })

  it('moves freely over hidden cards', () => {
    expect(
      previewMove(LAYOUT, { ...ALL, todos: false }, 'timer', { col: 0, row: -7 }, null)
    ).toEqual({ kind: 'move', rect: { x: 12, y: 0, w: 8, h: 6 } })
  })
})

describe('resizeCard', () => {
  it('grows from a corner into free cells', () => {
    const layout: CardLayout = { ...LAYOUT, music: { x: 0, y: 0, w: 8, h: 8 } }
    expect(resizeCard(layout, ALL, 'music', 'se', { col: 2, row: 3 })).toEqual({
      x: 0,
      y: 0,
      w: 10,
      h: 11
    })
  })

  it('stops at the card next to it', () => {
    expect(resizeCard(LAYOUT, ALL, 'music', 'e', { col: 4, row: 0 })).toEqual(LAYOUT.music)
    expect(resizeCard(LAYOUT, ALL, 'todos', 's', { col: 0, row: 3 })).toEqual(LAYOUT.todos)
  })

  it('moves the left and top edges too', () => {
    expect(resizeCard(LAYOUT, ALL, 'todos', 'w', { col: 2, row: 0 })).toEqual({
      x: 14,
      y: 0,
      w: 6,
      h: 6
    })
    expect(resizeCard(LAYOUT, ALL, 'timer', 'n', { col: 0, row: -3 })).toEqual(LAYOUT.timer)
    expect(resizeCard(LAYOUT, ALL, 'timer', 'n', { col: 0, row: 1 })).toEqual({
      x: 12,
      y: 7,
      w: 8,
      h: 5
    })
  })

  it('never shrinks below the card’s smallest size', () => {
    expect(resizeCard(LAYOUT, ALL, 'timer', 'nw', { col: 6, row: 4 })).toEqual({
      x: 14,
      y: 7,
      w: 6,
      h: 5
    })
  })

  it('grows sideways past a card that is only diagonal, then stops below it', () => {
    const layout: CardLayout = {
      music: { x: 0, y: 0, w: 8, h: 6 },
      todos: { x: 10, y: 7, w: 6, h: 5 },
      timer: { x: 14, y: 0, w: 6, h: 5 }
    }
    expect(resizeCard(layout, ALL, 'music', 'se', { col: 6, row: 6 })).toEqual({
      x: 0,
      y: 0,
      w: 14,
      h: 7
    })
  })
})

describe('snapToGrid', () => {
  it('turns the default arrangement on screen into grid cells', () => {
    // 1860×950 cards area with 29 px gaps: music ~60% wide, to-do above the timer.
    const gap = 29
    const boxes = {
      music: { left: 0, top: 0, width: 1104, height: 950 },
      todos: { left: 1133, top: 0, width: 727, height: 540 },
      timer: { left: 1133, top: 569, width: 727, height: 381 }
    }
    expect(snapToGrid(boxes, { width: 1860, height: 950 }, gap, ALL)).toEqual({
      music: { x: 0, y: 0, w: 12, h: 12 },
      todos: { x: 12, y: 0, w: 8, h: 7 },
      timer: { x: 12, y: 7, w: 8, h: 5 }
    })
  })

  it('keeps hidden cards at their fallback spots', () => {
    const snapped = snapToGrid(
      { todos: { left: 0, top: 0, width: 1860, height: 950 } },
      { width: 1860, height: 950 },
      29,
      { music: false, todos: true, timer: false }
    )
    expect(snapped).toEqual({ ...FALLBACK_LAYOUT, todos: { x: 0, y: 0, w: 20, h: 12 } })
  })
})
