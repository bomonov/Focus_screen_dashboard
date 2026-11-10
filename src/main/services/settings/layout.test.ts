import { describe, expect, it } from 'vitest'
import {
  FALLBACK_LAYOUT,
  findSpot,
  fitsGrid,
  overlaps,
  parseLayout,
  sameLayout,
  settleLayout,
  type CardLayout
} from './layout'

const ALL = { music: true, todos: true, timer: true }

describe('overlaps', () => {
  it('counts shared cells only, not shared edges', () => {
    const a = { x: 0, y: 0, w: 4, h: 4 }
    expect(overlaps(a, { x: 3, y: 3, w: 4, h: 4 })).toBe(true)
    expect(overlaps(a, { x: 4, y: 0, w: 4, h: 4 })).toBe(false)
    expect(overlaps(a, { x: 0, y: 4, w: 4, h: 4 })).toBe(false)
    expect(overlaps(a, { x: 1, y: 1, w: 1, h: 1 })).toBe(true)
  })
})

describe('fitsGrid', () => {
  it('needs whole cells inside the grid, at least the card’s smallest size', () => {
    expect(fitsGrid({ x: 0, y: 0, w: 20, h: 12 }, 'music')).toBe(true)
    expect(fitsGrid({ x: 1, y: 0, w: 20, h: 12 }, 'music')).toBe(false)
    expect(fitsGrid({ x: 0, y: 0, w: 5, h: 12 }, 'music')).toBe(false)
    expect(fitsGrid({ x: 0, y: 0, w: 5, h: 5 }, 'todos')).toBe(true)
    expect(fitsGrid({ x: 0, y: 0, w: 4, h: 5 }, 'todos')).toBe(false)
    expect(fitsGrid({ x: 0.5, y: 0, w: 5, h: 5 }, 'todos')).toBe(false)
    expect(fitsGrid({ x: -1, y: 0, w: 5, h: 5 }, 'todos')).toBe(false)
  })
})

describe('parseLayout', () => {
  it('keeps a valid layout', () => {
    expect(parseLayout(FALLBACK_LAYOUT)).toEqual(FALLBACK_LAYOUT)
  })

  it('drops the whole layout when any card is off', () => {
    expect(parseLayout({ ...FALLBACK_LAYOUT, timer: { x: 12, y: 6, w: 8 } })).toBeNull()
    expect(parseLayout({ ...FALLBACK_LAYOUT, todos: { x: 18, y: 0, w: 8, h: 6 } })).toBeNull()
    expect(parseLayout({ music: FALLBACK_LAYOUT.music })).toBeNull()
    expect(parseLayout('grid')).toBeNull()
    expect(parseLayout([FALLBACK_LAYOUT])).toBeNull()
    expect(parseLayout(null)).toBeNull()
  })

  it('keeps only the four numbers of each spot', () => {
    const parsed = parseLayout({
      ...FALLBACK_LAYOUT,
      music: { ...FALLBACK_LAYOUT.music, color: 'red' }
    })
    expect(parsed?.music).toEqual(FALLBACK_LAYOUT.music)
  })
})

describe('sameLayout', () => {
  it('compares spots, not objects', () => {
    expect(sameLayout(FALLBACK_LAYOUT, structuredClone(FALLBACK_LAYOUT))).toBe(true)
    expect(
      sameLayout(FALLBACK_LAYOUT, { ...FALLBACK_LAYOUT, timer: { x: 12, y: 6, w: 8, h: 5 } })
    ).toBe(false)
    expect(sameLayout(null, null)).toBe(true)
    expect(sameLayout(FALLBACK_LAYOUT, null)).toBe(false)
  })
})

describe('findSpot', () => {
  it('keeps the card’s size in the free spot nearest where it was', () => {
    const taken = [{ x: 0, y: 0, w: 10, h: 12 }]
    expect(findSpot({ x: 4, y: 2, w: 6, h: 6 }, taken, 'todos')).toEqual({
      x: 10,
      y: 2,
      w: 6,
      h: 6
    })
  })

  it('shrinks the card to the biggest free spot when its size doesn’t fit', () => {
    const taken = [{ x: 0, y: 0, w: 15, h: 12 }]
    expect(findSpot({ x: 0, y: 0, w: 8, h: 12 }, taken, 'todos')).toEqual({
      x: 15,
      y: 0,
      w: 5,
      h: 12
    })
  })

  it('gives up when even the smallest size doesn’t fit', () => {
    const taken = [{ x: 0, y: 0, w: 17, h: 12 }]
    expect(findSpot({ x: 0, y: 0, w: 8, h: 6 }, taken, 'timer')).toBeNull()
  })
})

describe('settleLayout', () => {
  it('leaves a layout without overlaps alone', () => {
    expect(settleLayout(FALLBACK_LAYOUT, ALL)).toBe(FALLBACK_LAYOUT)
  })

  it('ignores hidden cards', () => {
    const layout: CardLayout = { ...FALLBACK_LAYOUT, todos: { x: 12, y: 0, w: 8, h: 12 } }
    expect(settleLayout(layout, { ...ALL, timer: false })).toBe(layout)
  })

  it('moves a card that came back on, not the ones already showing', () => {
    // The to-do list grew into the music card's spot while music was off.
    const layout: CardLayout = {
      music: { x: 0, y: 0, w: 12, h: 12 },
      todos: { x: 0, y: 0, w: 14, h: 6 },
      timer: { x: 14, y: 0, w: 6, h: 6 }
    }
    const settled = settleLayout(layout, ALL, ['todos', 'timer'])
    expect(settled?.todos).toEqual(layout.todos)
    expect(settled?.timer).toEqual(layout.timer)
    expect(settled?.music).toEqual({ x: 0, y: 6, w: 12, h: 6 })
  })

  it('falls back to the default layout when a card can’t fit anywhere', () => {
    const layout: CardLayout = {
      music: { x: 0, y: 0, w: 20, h: 12 },
      todos: { x: 0, y: 0, w: 8, h: 6 },
      timer: FALLBACK_LAYOUT.timer
    }
    expect(settleLayout(layout, ALL, ['music'])).toBeNull()
  })
})
