import { describe, expect, it } from 'vitest'
import { planClick, type Click } from './clicks'
import type { RecipePart } from './recipe'

const tail: RecipePart = {
  id: 'p1',
  kind: 'sway',
  turn: 0,
  strokes: [
    { x: 600, y: 150, add: true, size: 0 },
    { x: 110, y: 230, add: true, size: 1 }
  ]
}
/** A part saved before parts kept their clicks. */
const old: RecipePart = { id: 'p2', kind: 'drift', turn: 0 }

const click = (over: Partial<Click>): Click => ({
  point: [10, 10],
  hit: null,
  selected: null,
  parts: [tail, old],
  ...over
})

describe('what a click on the cover does', () => {
  it('starts a new part where there is none', () => {
    expect(planClick(click({ point: [700, 700] }))).toEqual({
      kind: 'new',
      strokes: [{ x: 700, y: 700, add: true, size: null }]
    })
  })

  it("clicked again, tries the next size of the part's nearest click", () => {
    expect(planClick(click({ point: [590, 160], hit: 'p1' }))).toEqual({
      kind: 'change',
      id: 'p1',
      strokes: [
        { x: 600, y: 150, add: true, size: 1 },
        { x: 110, y: 230, add: true, size: 1 }
      ],
      base: false
    })
  })

  it('cuts an older part again from the click, as it has no clicks to change', () => {
    expect(planClick(click({ point: [50, 60], hit: 'p2' }))).toEqual({
      kind: 'change',
      id: 'p2',
      strokes: [{ x: 50, y: 60, add: true, size: null }],
      base: false
    })
  })

  it('with Shift, adds a piece to the selected part', () => {
    expect(planClick(click({ point: [400, 500], with: 'add', selected: 'p1' }))).toEqual({
      kind: 'change',
      id: 'p1',
      strokes: [...(tail.strokes ?? []), { x: 400, y: 500, add: true, size: null }],
      base: false
    })
    // An older part keeps its mask, the new piece added to it.
    expect(planClick(click({ point: [400, 500], with: 'add', selected: 'p2' }))).toEqual({
      kind: 'change',
      id: 'p2',
      strokes: [{ x: 400, y: 500, add: true, size: null }],
      base: true
    })
  })

  it('with Shift and nothing selected, adds to the part under it, or starts one', () => {
    expect(planClick(click({ with: 'add', hit: 'p2' }))).toMatchObject({ kind: 'change', id: 'p2' })
    expect(planClick(click({ with: 'add', selected: 'p9' }))).toMatchObject({ kind: 'new' })
  })

  it('with Option, carves a piece out of the part under it', () => {
    expect(planClick(click({ point: [330, 230], with: 'carve', hit: 'p1' }))).toEqual({
      kind: 'change',
      id: 'p1',
      strokes: [...(tail.strokes ?? []), { x: 330, y: 230, add: false, size: null }],
      base: false
    })
    expect(planClick(click({ point: [330, 230], with: 'carve', hit: 'p2' }))).toEqual({
      kind: 'change',
      id: 'p2',
      strokes: [{ x: 330, y: 230, add: false, size: null }],
      base: true
    })
  })

  it('with Option again by a piece it carved, tries that piece at its next size', () => {
    const carved: RecipePart = {
      ...tail,
      strokes: [...(tail.strokes ?? []), { x: 330, y: 230, add: false, size: 0 }]
    }
    // The carved piece isn't in the part any more, so nothing is under the click.
    expect(
      planClick(click({ point: [345, 240], with: 'carve', selected: 'p1', parts: [carved, old] }))
    ).toEqual({
      kind: 'change',
      id: 'p1',
      strokes: [...(tail.strokes ?? []), { x: 330, y: 230, add: false, size: 1 }],
      base: false
    })
  })

  it('with Option on nothing, says how to carve', () => {
    expect(planClick(click({ point: [700, 700], with: 'carve' }))).toEqual({
      kind: 'refuse',
      message: 'Option-click inside a part to cut a piece out of it'
    })
  })

  it('keeps a part to eight clicks', () => {
    const full: RecipePart = {
      ...tail,
      strokes: Array.from({ length: 8 }, (_, i) => ({ x: i * 50, y: 0, add: true, size: 0 }))
    }
    expect(planClick(click({ with: 'add', selected: 'p1', parts: [full] }))).toEqual({
      kind: 'refuse',
      message: 'Eight clicks a part at most'
    })
  })
})
