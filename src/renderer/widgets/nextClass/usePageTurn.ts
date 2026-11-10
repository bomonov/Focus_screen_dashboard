import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { MORPH_EASING, MORPH_SEC, morphWidth, reducedMotion, stopMorph } from './pillMorph'
import type { Turn } from './pillSwipe'
import { refit } from './useDropToFit'

/** A page swiped to goes back to the pill's first after this long, so the screen settles. */
export const AWAY_MS = 20_000
/** How far a page's words come in from, the way the swipe went. */
const PAGE_IN_PX = 24

/**
 * A pill's page turn. Call the returned function just before changing the page: once the new
 * page is laid out, the pill eases from its old width to its new one while the new words come
 * in from the side the swipe was headed (from the right for 'next').
 */
export function usePageTurn(pill: RefObject<HTMLElement | null>): (to: Turn) => void {
  const turning = useRef<{ width: number; from: number } | null>(null)
  useLayoutEffect(() => {
    const page = turning.current
    turning.current = null
    const element = pill.current
    if (!page || !element) return
    stopMorph(element)
    refit(element)
    if (reducedMotion.matches) return
    morphWidth(element, page.width, element.offsetWidth)
    for (const child of element.children) {
      child.animate(
        [
          { transform: `translateX(${page.from * PAGE_IN_PX}px)`, opacity: 0 },
          { transform: 'none' }
        ],
        { duration: MORPH_SEC * 1000, easing: MORPH_EASING }
      )
    }
  })
  return (to) => {
    const element = pill.current
    if (element) turning.current = { width: element.offsetWidth, from: to === 'next' ? 1 : -1 }
  }
}

/**
 * While `away` names a page other than the first (null otherwise, or while a card is open),
 * `home` runs after AWAY_MS. Each new page starts the wait again.
 */
export function useReturnHome(away: string | null, home: () => void): void {
  const latest = useRef(home)
  useEffect(() => {
    latest.current = home
  })
  useEffect(() => {
    if (away === null) return
    const timer = setTimeout(() => latest.current(), AWAY_MS)
    return () => clearTimeout(timer)
  }, [away])
}
