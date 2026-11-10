// The handles under a line's romaji, one where each singer's part starts: they sit on spaces
// (a cut in the middle of a romaji word would color a sound wrong), and a dragged one stays
// between its neighbours. Pure.

/** Where each space is in the romaji: the places a handle can sit. */
export function romajiSpaces(romaji: string): number[] {
  const spaces: number[] = []
  for (let at = 0; at < romaji.length; at++) {
    if (/\s/.test(romaji.charAt(at))) spaces.push(at)
  }
  return spaces
}

/**
 * Cuts spread over the romaji's spaces in proportion, for a line nothing sure was found for:
 * a start for the user to drag, never saved until they do. null when there aren't enough spaces.
 */
export function evenCuts(romaji: string, count: number): number[] | null {
  if (count <= 0) return []
  const spaces = romajiSpaces(romaji)
  if (spaces.length < count) return null
  const cuts: number[] = []
  for (let i = 1; i <= count; i++) {
    const target = (romaji.length * i) / (count + 1)
    // The nearest space not already taken and after the cut before it.
    const after = cuts.at(-1) ?? -1
    const free = spaces.filter((at) => at > after)
    // Leave a space for each cut still to come.
    const room = free.slice(0, free.length - (count - i))
    const pick = room.reduce<number | null>(
      (best, at) => (best === null || Math.abs(at - target) < Math.abs(best - target) ? at : best),
      null
    )
    if (pick === null) return null
    cuts.push(pick)
  }
  return cuts
}

/**
 * Handle `index` moved to space `to`: the cuts as they'd be, or null when that's not between
 * the handles either side (two singers' parts can't swap places or share one space).
 */
export function moveCut(cuts: readonly number[], index: number, to: number): number[] | null {
  if (index < 0 || index >= cuts.length) return null
  const before = cuts[index - 1] ?? -1
  const after = cuts[index + 1] ?? Number.POSITIVE_INFINITY
  if (to <= before || to >= after) return null
  return cuts.map((cut, i) => (i === index ? to : cut))
}

/**
 * Handle `index` dragged to `x`: onto the nearest space it may sit on (between the handles either
 * side, so it stops against a neighbour rather than refusing), as the cuts would then be. null
 * when that's where it is already, or there's no space it may take.
 */
export function pointerCut(
  cuts: readonly number[],
  index: number,
  spaces: readonly { at: number; x: number }[],
  x: number
): number[] | null {
  const current = cuts[index]
  if (current === undefined) return null
  const before = cuts[index - 1] ?? -1
  const after = cuts[index + 1] ?? Number.POSITIVE_INFINITY
  let best: { at: number; x: number } | null = null
  for (const space of spaces) {
    if (space.at <= before || space.at >= after) continue
    if (!best || Math.abs(space.x - x) < Math.abs(best.x - x)) best = space
  }
  return best && best.at !== current ? moveCut(cuts, index, best.at) : null
}

/** Handle `index` one space left or right (the arrow keys); null at the end or against a neighbour. */
export function stepCut(
  cuts: readonly number[],
  index: number,
  spaces: readonly number[],
  step: -1 | 1
): number[] | null {
  const current = cuts[index]
  if (current === undefined) return null
  const to =
    step > 0
      ? spaces.find((space) => space > current)
      : [...spaces].reverse().find((space) => space < current)
  return to === undefined ? null : moveCut(cuts, index, to)
}

/** The same cuts (null is "none sure", its own value). */
export function sameCuts(a: readonly number[] | null, b: readonly number[] | null): boolean {
  if (a === null || b === null) return a === b
  return a.length === b.length && a.every((cut, i) => cut === b[i])
}

/** A move saved but not yet back from main: the cuts it was made from, and where it went. */
export interface PendingCuts {
  base: readonly number[] | null
  cuts: number[]
}

/**
 * The pending move after main's cuts are `current`: kept while main still has the cuts it was
 * made from, and gone for good the moment they differ (main has the move, or something else
 * moved them). Kept any longer, an Undo or "Place automatically" back to those same cuts would
 * bring the old move back on screen while the saved split is another.
 */
export function settlePending(
  pending: PendingCuts | null,
  current: readonly number[] | null
): PendingCuts | null {
  return pending && sameCuts(pending.base, current) ? pending : null
}
