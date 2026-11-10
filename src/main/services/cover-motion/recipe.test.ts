import { describe, expect, it } from 'vitest'
import { parseRecipe, turned, withKind, withoutPart, withPart, withStrokes } from './recipe'

describe('parseRecipe', () => {
  const ok = { version: 1, source: 'hand', parts: [{ id: 'p1', kind: 'surge', turn: 0 }] }

  it('reads a good recipe', () => expect(parseRecipe(ok)).toEqual(ok))

  it('drops a future version, unknown kinds, bad ids and too many parts', () => {
    expect(parseRecipe({ ...ok, version: 2 })).toBeNull()
    expect(parseRecipe({ ...ok, parts: [{ id: 'p1', kind: 'spin', turn: 0 }] })).toBeNull()
    expect(parseRecipe({ ...ok, parts: [{ id: '../x', kind: 'surge', turn: 0 }] })).toBeNull()
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, kind: 'bob', turn: 0 }))
    expect(parseRecipe({ ...ok, parts: seven })).toBeNull()
    expect(parseRecipe({ ...ok, parts: [{ id: 'p1', kind: 'surge', turn: 8 }] })).toBeNull()
    expect(parseRecipe('nonsense')).toBeNull()
  })

  it("keeps a part's clicks, and whether it started from a mask saved before them", () => {
    const strokes = [
      { x: 600, y: 150, add: true, size: 0 },
      { x: 330, y: 230, add: false, size: 2 }
    ]
    const part = { id: 'p1', kind: 'sway', turn: 0, strokes, base: true }
    expect(parseRecipe({ ...ok, parts: [part] })?.parts[0]).toEqual(part)
  })

  it('drops clicks that are off-shape, but keeps the part (its mask is still good)', () => {
    const bad = [
      [{ x: -1, y: 150, add: true, size: 0 }],
      [{ x: 600, y: 150, add: 'yes', size: 0 }],
      [{ x: 600, y: 150, add: true, size: 3 }],
      [{ x: 600, y: 150, add: true, size: 0.5 }],
      Array.from({ length: 9 }, () => ({ x: 1, y: 1, add: true, size: 0 })),
      'clicks'
    ]
    for (const strokes of bad) {
      expect(parseRecipe({ ...ok, parts: [{ ...ok.parts[0], strokes }] })?.parts[0]).toEqual(
        ok.parts[0]
      )
    }
    expect(parseRecipe({ ...ok, parts: [{ ...ok.parts[0], base: 'yes' }] })?.parts[0]).toEqual(
      ok.parts[0]
    )
  })
})

it("sets a part's clicks", () => {
  const r = parseRecipe({
    version: 1,
    source: 'hand',
    parts: [{ id: 'p1', kind: 'sway', turn: 0 }]
  })
  if (!r) throw new Error('no recipe')
  const strokes = [{ x: 1, y: 2, add: true, size: 1 }]
  expect(withStrokes(r, 'p1', strokes, true).parts[0]).toEqual({
    id: 'p1',
    kind: 'sway',
    turn: 0,
    strokes,
    base: true
  })
  expect(withStrokes(r, 'p1', strokes, false).parts[0]).toEqual({
    id: 'p1',
    kind: 'sway',
    turn: 0,
    strokes
  })
  expect(r.parts[0]?.strokes).toBeUndefined()
})

it('edits a recipe without mutating it', () => {
  const r = parseRecipe({ version: 1, source: 'hand', parts: [] })
  if (!r) throw new Error('no recipe')
  const one = withPart(r, { id: 'p1', kind: 'sway', turn: 0 })
  expect(r.parts).toHaveLength(0)
  expect(withKind(one, 'p1', 'flutter').parts[0]?.kind).toBe('flutter')
  expect(turned(one, 'p1').parts[0]?.turn).toBe(1)
  let round = one
  for (let i = 0; i < 8; i++) round = turned(round, 'p1')
  expect(round.parts[0]?.turn).toBe(0)
  expect(withoutPart(one, 'p1').parts).toHaveLength(0)
})

it('holds at most six parts', () => {
  let r = parseRecipe({ version: 1, source: 'hand', parts: [] })
  if (!r) throw new Error('no recipe')
  for (let i = 0; i < 7; i++) r = withPart(r, { id: `p${i}`, kind: 'bob', turn: 0 })
  expect(r.parts).toHaveLength(6)
})
