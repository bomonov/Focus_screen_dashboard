import { useCallback, useEffect, useRef, useState } from 'react'
import type { CardMenu, QuickMenuTarget } from '../../main/ipc'
import type { CardId } from '../../main/services/settings/layout'
import type { OpenCardMenu } from '../widgets/cardMenu/CardMenu'
import { prepareCardMenu } from '../widgets/cardMenu/cardMenuPrepare'

export type OpenGlassMenu = OpenCardMenu & {
  /** The card whose dot opened it; null for the right-click menu. */
  card: CardId | null
}

export interface GlassMenus {
  open: OpenGlassMenu | null
  /** A status dot was pressed (or Enter on it, `keyboard`). */
  openCard(card: CardId, name: string, dot: HTMLElement, keyboard: boolean): void
  /** The menu has shrunk away. */
  closed(): void
}

/** Text fields keep the native Cut/Copy/Paste menu, which main shows for them. */
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

/** A right-click on one of the user's own homeworks or exams puts its Edit… and Delete on top. */
function targetOf(element: EventTarget | null): QuickMenuTarget | null {
  const marked =
    element instanceof Element ? element.closest<HTMLElement>('[data-homework-id]') : null
  const id = marked?.dataset.homeworkId
  return id ? { kind: 'homework', id } : null
}

/**
 * The Focus Screen's glass menu: a card's, out of its status dot, or the quick menu, out of a
 * right-click anywhere else. One at a time, and when two answers cross only the latest opens.
 * `hidden`: the cards are away (idle dim), and the menu goes with them. `quickScale`: the
 * right-click menu's size from Customize.
 */
export function useGlassMenus(editing: boolean, hidden: boolean, quickScale: number): GlassMenus {
  const [open, setOpen] = useState<OpenGlassMenu | null>(null)
  const [wasEditing, setWasEditing] = useState(editing)
  if (editing !== wasEditing) {
    setWasEditing(editing)
    // The dots go while cards are arranged, and their menus with them. The quick menu stays: it
    // may be shrinking away after its own "Edit Layout".
    if (open?.card) setOpen(null)
  }
  if (hidden && open) setOpen(null)

  const request = useRef(0)
  const show = useCallback(
    (ask: Promise<CardMenu | null>, build: (menu: CardMenu) => OpenGlassMenu): void => {
      const mine = ++request.current
      void ask.then((menu) => {
        if (menu && mine === request.current) setOpen(build(menu))
      })
    },
    []
  )

  const openCard = useCallback(
    (card: CardId, name: string, dot: HTMLElement, keyboard: boolean): void => {
      const box = dot.getBoundingClientRect()
      show(window.focusScreen.getCardMenu(card), (menu) => ({
        card,
        name,
        menu,
        anchor: 'dot',
        scale: 1,
        dot: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        keyboard,
        returnFocus: dot
      }))
    },
    [show]
  )

  useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      // Inside an open menu (it cancels its own), or a text field's.
      if (event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest(EDITABLE)) return
      event.preventDefault()
      // The keyboard's menu key has no pointer to open at: high in the middle instead.
      const keyboard = event.clientX === 0 && event.clientY === 0
      const x = keyboard ? window.innerWidth / 2 : event.clientX
      const y = keyboard ? window.innerHeight / 3 : event.clientY
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
      show(window.focusScreen.getQuickMenu(targetOf(event.target)), (menu) => ({
        card: null,
        name: 'Focus Screen',
        menu,
        anchor: 'pointer',
        scale: quickScale,
        dot: { left: x, top: y, right: x, bottom: y },
        keyboard,
        returnFocus: focused
      }))
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }, [show, quickScale])

  // The menus' glass is made while the page is idle (and again at a new size), not on a click.
  useEffect(() => {
    const prepare = (): void => prepareCardMenu([1, quickScale])
    let idle = requestIdleCallback(prepare, { timeout: 2000 })
    const resized = (): void => {
      cancelIdleCallback(idle)
      idle = requestIdleCallback(prepare, { timeout: 2000 })
    }
    window.addEventListener('resize', resized)
    return () => {
      cancelIdleCallback(idle)
      window.removeEventListener('resize', resized)
    }
  }, [quickScale])

  const closed = useCallback(() => setOpen(null), [])
  return { open, openCard, closed }
}
