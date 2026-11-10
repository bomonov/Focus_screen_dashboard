import { springEasing } from '../tabBarMotion'
import { refit } from './useDropToFit'

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** The same spring as the glass menus' grow: quick, with a soft landing. */
export const MORPH_SEC = 0.5
export const MORPH_EASING = springEasing({ response: 0.38, damping: 0.86 }, MORPH_SEC)

/** Stops a pill's width morph, so it can be measured as laid out. */
export function stopMorph(pill: HTMLElement): void {
  for (const animation of pill.getAnimations()) {
    if (animation.id === 'pill-morph') animation.cancel()
  }
  delete pill.dataset.morphing
}

/**
 * Eases a pill from `from` px wide to `to`, its laid-out width (FLIP on width only, so nothing
 * moves up or down). Its parts keep their size meanwhile and its edge clips them, so they
 * unroll; they're fitted to the room once it lands.
 */
export function morphWidth(pill: HTMLElement, from: number, to: number): void {
  if (Math.abs(from - to) < 0.5) return
  pill.dataset.morphing = ''
  const animation = pill.animate([{ width: `${from}px` }, { width: `${to}px` }], {
    duration: MORPH_SEC * 1000,
    easing: MORPH_EASING
  })
  animation.id = 'pill-morph'
  animation.finished.then(
    () => {
      delete pill.dataset.morphing
      refit(pill)
    },
    // Cancelled by the next morph, which takes over.
    () => undefined
  )
}
