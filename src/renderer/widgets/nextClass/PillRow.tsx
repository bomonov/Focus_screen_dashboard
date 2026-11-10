import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { morphWidth, reducedMotion, stopMorph } from './pillMorph'
import { boxOf, PillStageContext, type PillId, type PillStage } from './pillStage'
import { refit } from './useDropToFit'

/**
 * A pill's box as laid out, without the sink a held pill eases out of (a scale about its
 * middle, which getBoundingClientRect would count): the morph and the card need its real size.
 */
function layoutBox(pill: HTMLElement): DOMRect {
  const rect = pill.getBoundingClientRect()
  const x = rect.left + rect.width / 2 - pill.offsetWidth / 2
  const y = rect.top + rect.height / 2 - pill.offsetHeight / 2
  return new DOMRect(x, y, pill.offsetWidth, pill.offsetHeight)
}

/**
 * The top bar's row of clock and pills. Holding a pill opens its card: the pill stretches to
 * show all of itself and the others shrink into round bubbles with their icon (the user's
 * idea), each animated from where it was (FLIP on width only, so nothing moves up or down).
 */
export function PillRow({
  className,
  children
}: {
  className: string
  children: React.ReactNode
}): React.JSX.Element {
  const row = useRef<HTMLDivElement>(null)
  const [open, setOpenState] = useState<PillId | null>(null)
  const openRef = useRef<PillId | null>(null)
  const before = useRef<Map<HTMLElement, DOMRect> | null>(null)
  const finals = useRef(new WeakMap<HTMLElement, DOMRect>())
  const openers = useRef(new Map<PillId, () => void>())
  const next = useRef<PillId | null>(null)

  const pills = useCallback(
    (): HTMLElement[] => [
      ...(row.current?.querySelectorAll<HTMLElement>(':scope > .next-class') ?? [])
    ],
    []
  )

  const setOpen = useCallback(
    (id: PillId | null): void => {
      if (id === openRef.current) return
      openRef.current = id
      before.current = new Map(pills().map((pill) => [pill, layoutBox(pill)]))
      setOpenState(id)
    },
    [pills]
  )

  // After the classes change, before the paint: size the bubbles, refit, measure, animate.
  useLayoutEffect(() => {
    const first = before.current
    before.current = null
    if (!first) return
    const all = pills()
    for (const pill of all) {
      stopMorph(pill)
      const was = first.get(pill)
      // A bubble is a circle as tall as its pill was: the row never changes height.
      if (was && pill.classList.contains('next-class--bubble')) {
        pill.style.setProperty('--bubble-size', `${was.height}px`)
      }
      refit(pill)
    }
    for (const pill of all) finals.current.set(pill, layoutBox(pill))
    if (reducedMotion.matches) return
    for (const pill of all) {
      const from = first.get(pill)
      const to = finals.current.get(pill)
      if (from && to) morphWidth(pill, from.width, to.width)
    }
  }, [open, pills])

  const stage = useMemo<PillStage>(
    () => ({
      open,
      setOpen,
      finalBox: (pill) => boxOf(finals.current.get(pill) ?? layoutBox(pill)),
      register(id, opener) {
        openers.current.set(id, opener)
        return () => {
          if (openers.current.get(id) === opener) openers.current.delete(id)
        }
      },
      pressAt(x, y) {
        const bubble = document
          .elementsFromPoint(x, y)
          .find((element) => element.classList.contains('next-class--bubble'))
        const id = bubble instanceof HTMLElement ? bubble.dataset.pill : undefined
        next.current =
          id === 'class' || id === 'bus' || id === 'shuttle' || id === 'weather' ? id : null
      },
      closed(id) {
        const target = next.current
        next.current = null
        const opener = target && target !== id ? openers.current.get(target) : undefined
        // The tapped bubble's pill opens its card; the row morphs straight over to it.
        if (opener) opener()
        else setOpen(null)
      }
    }),
    [open, setOpen]
  )

  return (
    <PillStageContext.Provider value={stage}>
      <div ref={row} className={className}>
        {children}
      </div>
    </PillStageContext.Provider>
  )
}
