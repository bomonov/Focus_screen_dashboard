// What a click on the cover in the moving parts editor does. A plain click starts a part, or,
// on a part, tries the next size of SAM's cut there (the user's habit was to delete a part and
// click again); Shift adds a piece to the selected part; Option carves one out. Pure: main asks
// the worker which part is under the click first, then cuts what this plans.
import { MAX_STROKES, type RecipePart, type Stroke } from './recipe'

export type ClickWith = 'add' | 'carve'

/** A click as the worker will cut it: a new one has no size yet (the worker picks its start). */
export interface PlannedStroke {
  x: number
  y: number
  add: boolean
  size: number | null
}

export type ClickPlan =
  | { kind: 'new'; strokes: PlannedStroke[] }
  /** `base`: the part's clicks go on top of the mask it had before it kept them. */
  | { kind: 'change'; id: string; strokes: PlannedStroke[]; base: boolean }
  | { kind: 'refuse'; message: string }

export interface Click {
  /** In the analysis square. */
  point: [number, number]
  with?: ClickWith
  /** The part under the click (the one drawn on top), from the worker. */
  hit: string | null
  selected: string | null
  parts: RecipePart[]
}

/** An Option-click this close to an earlier one tries that cut-out's next size. */
export const NEAR_PX = 40

const distance = (stroke: Stroke, [x, y]: [number, number]): number =>
  Math.hypot(stroke.x - x, stroke.y - y)

/** The index of the part's click of that kind nearest the point, or -1. */
function nearest(strokes: Stroke[], point: [number, number], add: boolean): number {
  let best = -1
  strokes.forEach((stroke, i) => {
    if (stroke.add !== add) return
    const current = strokes[best]
    if (!current || distance(stroke, point) < distance(current, point)) best = i
  })
  return best
}

function stepped(part: RecipePart, strokes: Stroke[], index: number): ClickPlan {
  return {
    kind: 'change',
    id: part.id,
    strokes: strokes.map((stroke, i) =>
      i === index ? { ...stroke, size: stroke.size + 1 } : stroke
    ),
    base: part.base === true
  }
}

/** Another click on a part: on top of its clicks, or of the mask it had before it kept any. */
function extended(part: RecipePart, point: [number, number], add: boolean): ClickPlan {
  const strokes = part.strokes ?? []
  if (strokes.length >= MAX_STROKES)
    return { kind: 'refuse', message: 'Eight clicks a part at most' }
  return {
    kind: 'change',
    id: part.id,
    strokes: [...strokes, { x: point[0], y: point[1], add, size: null }],
    base: part.base === true || strokes.length === 0
  }
}

export function planClick({ point, with: how, hit, selected, parts }: Click): ClickPlan {
  const find = (id: string | null): RecipePart | undefined =>
    id === null ? undefined : parts.find((part) => part.id === id)
  const fresh: PlannedStroke[] = [{ x: point[0], y: point[1], add: true, size: null }]
  const under = find(hit)

  if (how === 'add') {
    const target = find(selected) ?? under
    return target ? extended(target, point, true) : { kind: 'new', strokes: fresh }
  }

  if (how === 'carve') {
    // A piece just carved isn't in the part any more: an Option-click by it means another size.
    const chosen = find(selected)
    for (const part of chosen ? [chosen, ...parts.filter((p) => p !== chosen)] : parts) {
      const strokes = part.strokes ?? []
      const index = nearest(strokes, point, false)
      const near = strokes[index]
      if (near && distance(near, point) <= NEAR_PX) return stepped(part, strokes, index)
    }
    return under
      ? extended(under, point, false)
      : { kind: 'refuse', message: 'Option-click inside a part to cut a piece out of it' }
  }

  if (!under) return { kind: 'new', strokes: fresh }
  const strokes = under.strokes ?? []
  const index = nearest(strokes, point, true)
  if (index >= 0) return stepped(under, strokes, index)
  return { kind: 'change', id: under.id, strokes: fresh, base: false }
}
