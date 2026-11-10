/** A tab's place in its bar, in pixels from the bar's left edge. */
export interface TabBox {
  left: number
  width: number
}

/** The tab a dragged lens settles on: the one under the pointer at `x`, else the nearest one. */
export function lensTarget(tabs: readonly TabBox[], x: number): number {
  const center = x
  let best = 0
  let bestDistance = Infinity
  tabs.forEach((tab, index) => {
    const distance =
      center < tab.left
        ? tab.left - center
        : center > tab.left + tab.width
          ? center - tab.left - tab.width
          : 0
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}
