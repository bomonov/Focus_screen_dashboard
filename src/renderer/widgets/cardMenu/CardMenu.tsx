import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CardMenu as CardMenuData, CardMenuEntry } from '../../../main/ipc'
import { usePanelGlass } from '../PanelGlass'
import { atRest, stepSpring, type Spring } from '../tabBarMotion'
import {
  BEZEL_REM,
  BLUR_REM,
  frameSeconds,
  learnFrame,
  RADIUS_REM,
  remPx,
  THICKNESS_REM
} from './cardMenuPrepare'
import {
  CLOSE,
  GONE,
  menuFrame,
  menuTop,
  OPEN_ACROSS,
  OPEN_DOWN,
  originCss,
  placeMenu,
  UNFOLD,
  unfoldFrame,
  type Box,
  type MenuAnchor,
  type MenuPlacement
} from './cardMenuMotion'
import { chosenLabel, isSubOpen, parentSub, toggleSub } from './cardMenuView'
import './CardMenu.css'

export interface OpenCardMenu {
  /** "To-do" */
  name: string
  menu: CardMenuData
  /** A status dot, or a right-click's pointer. */
  anchor: MenuAnchor
  /** Its size against the usual (the right-click menu's can be set in Customize). */
  scale: number
  /** What it opened from, in the window (a pointer is a box of no size): it grows out of it. */
  dot: Box
  /** Opened from the keyboard: the first item gets the focus. */
  keyboard: boolean
  /** The dot, to give the focus back to. */
  returnFocus: HTMLElement | null
}

interface CardMenuProps {
  open: OpenCardMenu
  /** It has shrunk back into the dot. */
  onClosed(): void
}

/** Between a dot and its menu, and between the menu and the window's edge, in rem. */
const GAP_REM = 0.375
const MARGIN_REM = 1

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

export function CheckIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 8.5 6.5 12 13 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ChevronIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6 3.5 10.5 8 6 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** The rows that take the focus now: enabled, and not inside a folded submenu. */
function rowsIn(panel: HTMLElement): HTMLButtonElement[] {
  return [...panel.querySelectorAll<HTMLButtonElement>('[data-row]')].filter(
    (row) => !row.disabled && !row.closest('[inert]')
  )
}

interface EntriesProps {
  entries: CardMenuEntry[]
  expanded: string | null
  onToggle(id: string): void
  onPick(id: string): void
}

function Entries({ entries, expanded, onToggle, onPick }: EntriesProps): React.JSX.Element {
  // A list keeps a column for checkmarks only if something in it can be checked.
  const checks = entries.some((entry) => entry.kind === 'item' && entry.checked !== null)
  return (
    <div className={`card-menu__list${checks ? ' card-menu__list--checks' : ''}`}>
      {entries.map((entry, index) => {
        if (entry.kind === 'separator') {
          return <div key={`sep${index}`} className="card-menu__separator" role="separator" />
        }
        if (entry.kind === 'item') {
          return (
            <button
              key={entry.id}
              type="button"
              data-row=""
              tabIndex={-1}
              role={entry.checked === null ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={entry.checked ?? undefined}
              className="card-menu__item"
              disabled={!entry.enabled}
              onClick={() => onPick(entry.id)}
            >
              <span className="card-menu__check">{entry.checked && <CheckIcon />}</span>
              <span className="card-menu__label">{entry.label}</span>
              {entry.shortcut && <kbd className="card-menu__shortcut">{entry.shortcut}</kbd>}
            </button>
          )
        }
        const open = isSubOpen(entry.id, expanded)
        const chosen = chosenLabel(entry.entries)
        return (
          <div key={entry.id} className="card-menu__group">
            <button
              type="button"
              data-row=""
              data-sub-header={entry.id}
              tabIndex={-1}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open}
              className="card-menu__item card-menu__item--sub"
              disabled={!entry.enabled}
              onClick={() => onToggle(entry.id)}
            >
              <span className="card-menu__check" />
              <span className="card-menu__label">{entry.label}</span>
              {chosen && <span className="card-menu__value">{chosen}</span>}
              <span className="card-menu__chevron">
                <ChevronIcon />
              </span>
            </button>
            {/* Its rows unfold underneath; folded, they can't be reached (inert). */}
            <div className="card-menu__sub" data-sub={entry.id} inert={!open}>
              <div className="card-menu__sub-rows" role="group" aria-label={entry.label}>
                <Entries
                  entries={entry.entries}
                  expanded={expanded}
                  onToggle={onToggle}
                  onPick={onPick}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * A card's menu on liquid glass, opened from its status dot. It grows out of the dot like an
 * iOS context menu and shrinks back into it when closed; submenus unfold in place. Every frame
 * is drawn from springs straight onto the elements, so nothing re-renders while it moves.
 */
export function CardMenu({ open, onClosed }: CardMenuProps): React.JSX.Element {
  const { menu, dot } = open
  const [rem] = useState(remPx)
  /** The panel's own em: what its sizes, glass and blur are measured in. */
  const em = rem * open.scale
  const [placement, setPlacement] = useState<MenuPlacement | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const placeRef = useRef<MenuPlacement | null>(null)
  const glass = usePanelGlass(RADIUS_REM * em, BEZEL_REM * em, THICKNESS_REM * em, BLUR_REM * em)
  const glassRef = useRef(glass)
  const closedRef = useRef(onClosed)
  useLayoutEffect(() => {
    glassRef.current = glass
    closedRef.current = onClosed
  })

  const motion = useRef({
    across: { value: 0, velocity: 0 } as Spring,
    down: { value: 0, velocity: 0 } as Spring,
    closing: false,
    /** Each submenu's unfolding, and where it's heading (1 open, 0 folded). */
    subs: new Map<string, { spring: Spring; target: number }>(),
    frame: null as number | null,
    lastTime: 0,
    /** This run's shortest frame, which is the screen's. */
    shortest: Infinity
  })

  const draw = useCallback((): void => {
    const m = motion.current
    const panel = panelRef.current
    const content = contentRef.current
    if (!panel || !content) return
    const frame = menuFrame(m.across.value, m.down.value)
    panel.style.transform = `scale(${frame.scaleX}, ${frame.scaleY})`
    panel.style.opacity = String(frame.opacity)
    content.style.opacity = String(frame.contentOpacity)
    content.style.filter = frame.contentBlur > 0.005 ? `blur(${frame.contentBlur * em}px)` : ''
    if (scrimRef.current) scrimRef.current.style.opacity = String(frame.scrim)

    for (const sub of panel.querySelectorAll<HTMLElement>('[data-sub]')) {
      const state = m.subs.get(sub.dataset.sub ?? '')
      const progress = state?.spring.value ?? 0
      const rows = sub.firstElementChild
      if (!(rows instanceof HTMLElement)) continue
      // Open and still, it's its own height, so nothing inside can ever be cut off.
      const settled = state?.target === 1 && atRest(state.spring, 1, 0.001)
      sub.style.height = settled ? 'auto' : `${Math.max(0, rows.offsetHeight * progress)}px`
      const unfold = unfoldFrame(progress)
      rows.style.opacity = String(unfold.opacity)
      rows.style.transform = unfold.shift ? `translateY(${unfold.shift}em)` : ''
      // Unfolding at the bottom of a menu that's as tall as it can be: keep it in view.
      const scroller = scrollRef.current
      if (state?.target === 1 && scroller && scroller.scrollHeight > scroller.clientHeight) {
        const bottom = sub.offsetTop + sub.offsetHeight
        if (bottom > scroller.scrollTop + scroller.clientHeight) {
          scroller.scrollTop = bottom - scroller.clientHeight
        }
      }
    }
    const height = panel.offsetHeight
    const place = placeRef.current
    if (place) {
      const top = menuTop(place, height, window.innerHeight, MARGIN_REM * rem)
      panel.style.top = `${top}px`
      panel.style.transformOrigin = originCss(place, top)
    }
    glassRef.current?.setSize(panel.offsetWidth, height)
  }, [rem, em])

  /** One animation frame: steps the springs and draws; schedules the next while still moving. */
  const tick = useRef<(now: number) => void>(() => undefined)
  useLayoutEffect(() => {
    tick.current = (now) => {
      const m = motion.current
      // The first frame has nothing before it to time: it's one of the screen's frames.
      const dt = m.lastTime ? (now - m.lastTime) / 1000 : frameSeconds()
      if (m.lastTime) m.shortest = Math.min(m.shortest, dt)
      m.lastTime = now
      const stop = (): void => {
        m.frame = null
        m.lastTime = 0
        if (m.shortest !== Infinity) learnFrame(m.shortest)
        m.shortest = Infinity
      }
      const target = m.closing ? 0 : 1
      if (reducedMotion.matches) {
        m.across = { value: target, velocity: 0 }
        m.down = { value: target, velocity: 0 }
        for (const sub of m.subs.values()) sub.spring = { value: sub.target, velocity: 0 }
      } else {
        m.across = stepSpring(m.across, target, m.closing ? CLOSE : OPEN_ACROSS, dt)
        m.down = stepSpring(m.down, target, m.closing ? CLOSE : OPEN_DOWN, dt)
        for (const sub of m.subs.values())
          sub.spring = stepSpring(sub.spring, sub.target, UNFOLD, dt)
      }
      draw()
      if (m.closing && Math.max(m.across.value, m.down.value) < GONE) {
        stop()
        closedRef.current()
        return
      }
      const still =
        !m.closing &&
        atRest(m.across, 1, 0.001) &&
        atRest(m.down, 1, 0.001) &&
        [...m.subs.values()].every((sub) => atRest(sub.spring, sub.target, 0.001))
      if (still) {
        m.across = { value: 1, velocity: 0 }
        m.down = { value: 1, velocity: 0 }
        for (const sub of m.subs.values()) sub.spring = { value: sub.target, velocity: 0 }
        draw()
        stop()
        return
      }
      m.frame = requestAnimationFrame((time) => tick.current(time))
    }
  })

  const animate = useCallback((): void => {
    const m = motion.current
    if (m.frame === null) m.frame = requestAnimationFrame((time) => tick.current(time))
  }, [])

  const close = useCallback(
    (refocus: boolean): void => {
      const m = motion.current
      if (m.closing) return
      m.closing = true
      panelRef.current?.parentElement?.classList.add('card-menu-layer--closing')
      // The focus mustn't be left on rows that are about to go.
      if (refocus || panelRef.current?.contains(document.activeElement)) {
        open.returnFocus?.focus({ preventScroll: true })
      }
      animate()
    },
    [animate, open.returnFocus]
  )

  const pick = useCallback(
    (id: string): void => {
      if (motion.current.closing) return
      window.focusScreen.pickCardMenu(menu.token, id)
      close(false)
    },
    [close, menu.token]
  )

  const toggle = useCallback((id: string): void => {
    setExpanded((current) => toggleSub(id, current))
  }, [])

  // Measured once at its full size, hidden, then put by the dot.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel || placement) return
    setPlacement(
      placeMenu(
        dot,
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        // A context menu opens right at the pointer.
        open.anchor === 'dot' ? GAP_REM * rem : 0,
        MARGIN_REM * rem,
        open.anchor
      )
    )
  }, [dot, placement, rem, open.anchor])

  // Placed: start growing out of the dot.
  useLayoutEffect(() => {
    placeRef.current = placement
    if (!placement) return
    draw()
    animate()
    const panel = panelRef.current
    if (!panel) return
    if (open.keyboard) rowsIn(panel)[0]?.focus({ preventScroll: true })
    else panel.focus({ preventScroll: true })
  }, [placement, draw, animate, open.keyboard])

  // A submenu unfolds and the one that was open folds away.
  useLayoutEffect(() => {
    const m = motion.current
    const panel = panelRef.current
    if (!panel) return
    for (const sub of panel.querySelectorAll<HTMLElement>('[data-sub]')) {
      const id = sub.dataset.sub ?? ''
      const target = isSubOpen(id, expanded) ? 1 : 0
      const state = m.subs.get(id)
      if (state) state.target = target
      else m.subs.set(id, { spring: { value: 0, velocity: 0 }, target })
    }
    if (placement) animate()
  }, [expanded, placement, animate])

  // Like a native menu, it goes when the window loses the focus or changes size.
  useEffect(() => {
    const away = (): void => close(false)
    window.addEventListener('blur', away)
    window.addEventListener('resize', away)
    return () => {
      window.removeEventListener('blur', away)
      window.removeEventListener('resize', away)
    }
  }, [close])

  useEffect(() => {
    const m = motion.current
    return () => {
      if (m.frame !== null) cancelAnimationFrame(m.frame)
    }
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const panel = panelRef.current
    if (!panel) return
    const rows = rowsIn(panel)
    const active = document.activeElement
    const at = rows.findIndex((row) => row === active)
    const focus = (index: number): void => {
      const count = rows.length
      if (count > 0) rows[((index % count) + count) % count]?.focus({ preventScroll: false })
    }
    const header = active instanceof HTMLElement ? active.dataset.subHeader : undefined
    switch (event.key) {
      case 'ArrowDown':
        focus(at + 1)
        break
      case 'ArrowUp':
        focus(at < 0 ? -1 : at - 1)
        break
      case 'Tab':
        focus(event.shiftKey ? (at < 0 ? -1 : at - 1) : at + 1)
        break
      case 'Home':
        focus(0)
        break
      case 'End':
        focus(-1)
        break
      case 'Enter':
      case ' ':
        // Space is a menu key here, not play/pause.
        rows[at]?.click()
        break
      case 'ArrowRight':
        if (header && !isSubOpen(header, expanded)) setExpanded(header)
        break
      case 'ArrowLeft': {
        const group = active instanceof HTMLElement ? active.closest('[data-sub]') : null
        const parent = group instanceof HTMLElement ? group.dataset.sub : header
        if (parent && isSubOpen(parent, expanded)) {
          setExpanded(parentSub(parent))
          panel.querySelector<HTMLElement>(`[data-sub-header="${parent}"]`)?.focus()
        }
        break
      }
      case 'Escape':
        close(true)
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  // Its top and transform-origin follow its height, so they're set as it's drawn.
  const scale = { '--menu-scale': open.scale } as React.CSSProperties
  const style: React.CSSProperties = placement
    ? {
        ...scale,
        left: placement.left,
        maxHeight: placement.maxHeight,
        backdropFilter: glass ? `url(#${glass.id})` : undefined
      }
    : { ...scale, left: 0, top: 0, visibility: 'hidden' }

  return createPortal(
    <div className="card-menu-layer">
      <div
        ref={scrimRef}
        className="card-menu-scrim"
        onPointerDown={(event) => {
          // Like a native menu, a click outside only closes it.
          event.preventDefault()
          close(false)
        }}
        onContextMenu={(event) => event.preventDefault()}
      />
      {glass?.filter}
      <div
        ref={panelRef}
        className={`card-menu${glass ? '' : ' card-menu--frosted'}`}
        role="menu"
        aria-label={`${open.name} menu`}
        tabIndex={-1}
        style={style}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        onPointerMove={(event) => {
          // The pointer and the arrow keys move the same highlight, as in a native menu.
          const target = event.target
          const row =
            target instanceof Element ? target.closest<HTMLButtonElement>('[data-row]') : null
          if (row && !row.disabled && row !== document.activeElement && !row.closest('[inert]')) {
            row.focus({ preventScroll: true })
          }
        }}
        onPointerLeave={() => {
          if (!motion.current.closing) panelRef.current?.focus({ preventScroll: true })
        }}
      >
        <div ref={scrollRef} className="card-menu__scroll">
          <div ref={contentRef} className="card-menu__content">
            {menu.lines.length > 0 && (
              <div className="card-menu__status">
                {menu.lines.map((line) => (
                  <p key={line} className="card-menu__line">
                    {line}
                  </p>
                ))}
              </div>
            )}
            {menu.lines.length > 0 && menu.entries.length > 0 && (
              <div className="card-menu__separator" role="separator" />
            )}
            <Entries entries={menu.entries} expanded={expanded} onToggle={toggle} onPick={pick} />
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
