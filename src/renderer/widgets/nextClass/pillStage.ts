import { createContext, useContext } from 'react'
import type { Box } from '../cardMenu/cardMenuMotion'

/** The top bar's pills that can hold a card or step aside for one. */
export type PillId = 'class' | 'bus' | 'shuttle' | 'weather'

export interface PillStage {
  /** The pill whose card is open: it stretches, and the others shrink to icon bubbles. */
  open: PillId | null
  /** A pill's card opens (or closes, null): the row morphs. */
  setOpen(id: PillId | null): void
  /** Where a pill lands once the row has morphed: its card grows out of that. */
  finalBox(pill: HTMLElement): Box
  /** A pill that can open its card says how, so a tap on its bubble can switch to it. */
  register(id: PillId, open: () => void): () => void
  /** A press outside the open card: on a bubble, that pill's card opens once this one closes. */
  pressAt(x: number, y: number): void
  /** The open card has closed: the row goes back, or on to the bubble that was tapped. */
  closed(id: PillId): void
}

export const boxOf = (rect: DOMRect): Box => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom
})

const alone: PillStage = {
  open: null,
  setOpen: () => undefined,
  finalBox: (pill) => boxOf(pill.getBoundingClientRect()),
  register: () => () => undefined,
  pressAt: () => undefined,
  closed: () => undefined
}

export const PillStageContext = createContext<PillStage>(alone)

/** The stage the pill is on (or one where it stands alone, outside the top bar). */
export const usePillStage = (): PillStage => useContext(PillStageContext)

/** A pill's classes on the stage: stretched while its card is open, a bubble while another's is. */
export function stageClasses(stage: PillStage, id: PillId): string[] {
  if (stage.open === null) return []
  return [stage.open === id ? 'next-class--held' : 'next-class--bubble']
}
