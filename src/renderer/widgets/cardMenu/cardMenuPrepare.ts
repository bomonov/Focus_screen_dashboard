// What a card's menu gets ready before any dot is pressed, so it starts moving at once.
import { preparePanelGlass } from '../PanelGlass'

/** The panel's corner (concentric with its rows'), rim, glass thickness and frost, in rem. */
export const RADIUS_REM = 1.25
export const BEZEL_REM = 0.7
export const THICKNESS_REM = 1.1
export const BLUR_REM = 0.7

/** The root font size in px, which the menu's sizes follow. */
export function remPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

/**
 * One frame of the screen, in seconds. A menu's first frame has no frame before it to time,
 * and guessing 60 Hz on a 120 Hz screen made that first step twice as long as the rest.
 */
let frame = 1 / 60

export function frameSeconds(): number {
  return frame
}

/** The shortest frame of a run: a dropped frame looks like a slower screen, so it's ignored. */
export function learnFrame(seconds: number): void {
  if (seconds >= 1 / 250 && seconds <= 1 / 30) frame = seconds
}

function measureFrame(): void {
  let last = 0
  let shortest = Infinity
  let frames = 0
  const step = (time: number): void => {
    if (last) shortest = Math.min(shortest, (time - last) / 1000)
    last = time
    if (++frames < 6) requestAnimationFrame(step)
    else learnFrame(shortest)
  }
  requestAnimationFrame(step)
}

/** Makes the menus' glass, at each size they're drawn at, and times the screen's frames. */
export function prepareCardMenu(scales: readonly number[] = [1]): void {
  const rem = remPx()
  for (const scale of scales) {
    // Worked out exactly as CardMenu does, so the glass made here is the glass it asks for.
    const em = rem * scale
    preparePanelGlass(RADIUS_REM * em, BEZEL_REM * em, THICKNESS_REM * em)
  }
  measureFrame()
}
