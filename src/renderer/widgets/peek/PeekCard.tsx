import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import {
  CLOSE,
  GONE,
  menuFrame,
  menuTop,
  OPEN_ACROSS,
  OPEN_DOWN,
  originCss,
  placeMenu,
  type Box,
  type MenuAnchor,
  type MenuPlacement
} from '../cardMenu/cardMenuMotion'
import {
  BEZEL_REM,
  BLUR_REM,
  frameSeconds,
  RADIUS_REM,
  remPx,
  THICKNESS_REM
} from '../cardMenu/cardMenuPrepare'
import type { SwipeHandlers } from '../nextClass/usePillSwipe'
import { usePanelGlass } from '../PanelGlass'
import { atRest, stepSpring, type Spring } from '../tabBarMotion'
import '../cardMenu/CardMenu.css'
import './PeekCard.css'

/** Between the pill and the card, and between the card and the window's edge, in rem. */
const GAP_REM = 0.5
const MARGIN_REM = 1

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** What the card's content can do to it: close it (after its button did its thing, say). */
export interface PeekCardHandle {
  close(): void
  /** What a swipe slides while the card's open (the Bus pill's pages). */
  content(): HTMLElement | null
}

interface PeekCardProps {
  handle?: React.Ref<PeekCardHandle>
  /** The panel's own class: its width and look ("class-map", "bus-route"). */
  className: string
  label: string
  /** The pill's box: the card grows out of it and shrinks back into it. */
  from: Box
  /**
   * How it hangs from the pill: from its left edge, or leftward when there's no room ('pointer',
   * the pills'), or lined up with its right edge ('dot': a bubble at the bar's right end).
   */
  anchor?: MenuAnchor
  /** Opened with the keyboard: `focus` (or the card itself) gets the focus. */
  keyboard: boolean
  focus?: React.RefObject<HTMLElement | null>
  returnFocus: HTMLElement | null
  /** The card is in place and about to grow: time to start its own animations. */
  onPlaced?(): (() => void) | void
  /** A press outside the card, before it closes: where it landed may matter (a bubble). */
  onPressOutside?(x: number, y: number): void
  /**
   * Esc, before it closes the card: true when the card stepped back inside itself instead (the
   * class list's map, back to the list).
   */
  onEscape?(): boolean
  /**
   * The pill's swipe, while the card covers it: a trackpad swipe anywhere (over the pill too),
   * and a drag or the arrow keys on the card.
   */
  gestures?: SwipeHandlers
  onClosed(): void
  children: React.ReactNode
}

/**
 * A glass card that grows out of a top-bar pill like the glass menus (the same springs and
 * glass), stays until clicked away, Esc, or the window losing the focus or changing size, then
 * shrinks back into the pill. Next class's map and Next bus's route are both one.
 */
export function PeekCard({
  handle,
  className,
  label,
  from,
  anchor = 'pointer',
  keyboard,
  focus,
  returnFocus,
  onPlaced,
  onPressOutside,
  onEscape,
  gestures,
  onClosed,
  children
}: PeekCardProps): React.JSX.Element {
  const [rem] = useState(remPx)
  const [placement, setPlacement] = useState<MenuPlacement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const placeRef = useRef<MenuPlacement | null>(null)
  const glass = usePanelGlass(
    RADIUS_REM * rem,
    BEZEL_REM * rem,
    THICKNESS_REM * rem,
    BLUR_REM * rem
  )
  const glassRef = useRef(glass)
  const closedRef = useRef(onClosed)
  const placedRef = useRef(onPlaced)
  const escapeRef = useRef(onEscape)
  useLayoutEffect(() => {
    glassRef.current = glass
    closedRef.current = onClosed
    placedRef.current = onPlaced
    escapeRef.current = onEscape
  })

  const motion = useRef({
    across: { value: 0, velocity: 0 } as Spring,
    down: { value: 0, velocity: 0 } as Spring,
    closing: false,
    frame: 0,
    lastTime: 0
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
    content.style.filter = frame.contentBlur > 0.005 ? `blur(${frame.contentBlur * rem}px)` : ''
    if (scrimRef.current) scrimRef.current.style.opacity = String(frame.scrim)
    const place = placeRef.current
    if (place) {
      const top = menuTop(place, panel.offsetHeight, window.innerHeight, MARGIN_REM * rem)
      panel.style.top = `${top}px`
      panel.style.transformOrigin = originCss(place, top)
    }
    glassRef.current?.setSize(panel.offsetWidth, panel.offsetHeight)
  }, [rem])

  const tick = useRef<(now: number) => void>(() => undefined)
  useLayoutEffect(() => {
    tick.current = (now) => {
      const m = motion.current
      const dt = m.lastTime ? (now - m.lastTime) / 1000 : frameSeconds()
      m.lastTime = now
      const target = m.closing ? 0 : 1
      if (reducedMotion.matches) {
        m.across = { value: target, velocity: 0 }
        m.down = { value: target, velocity: 0 }
      } else {
        m.across = stepSpring(m.across, target, m.closing ? CLOSE : OPEN_ACROSS, dt)
        m.down = stepSpring(m.down, target, m.closing ? CLOSE : OPEN_DOWN, dt)
      }
      draw()
      if (m.closing && Math.max(m.across.value, m.down.value) < GONE) {
        m.frame = 0
        closedRef.current()
        return
      }
      if (!m.closing && atRest(m.across, 1, 0.001) && atRest(m.down, 1, 0.001)) {
        m.across = { value: 1, velocity: 0 }
        m.down = { value: 1, velocity: 0 }
        draw()
        m.frame = 0
        m.lastTime = 0
        return
      }
      m.frame = requestAnimationFrame((time) => tick.current(time))
    }
  })

  const animate = useCallback((): void => {
    const m = motion.current
    if (!m.frame) m.frame = requestAnimationFrame((time) => tick.current(time))
  }, [])

  const close = useCallback((): void => {
    const m = motion.current
    if (m.closing) return
    m.closing = true
    panelRef.current?.parentElement?.classList.add('card-menu-layer--closing')
    if (panelRef.current?.contains(document.activeElement)) {
      returnFocus?.focus({ preventScroll: true })
    }
    animate()
  }, [animate, returnFocus])

  useImperativeHandle(handle, () => ({ close, content: () => contentRef.current }), [close])

  // Measured once at full size, hidden, then hung under the pill.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel || placement) return
    setPlacement(
      placeMenu(
        from,
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        GAP_REM * rem,
        MARGIN_REM * rem,
        anchor
      )
    )
  }, [from, anchor, placement, rem])

  // Placed: grow out of the pill, and let the card start its own animations.
  useLayoutEffect(() => {
    placeRef.current = placement
    if (!placement) return
    draw()
    animate()
    if (keyboard) (focus?.current ?? panelRef.current)?.focus({ preventScroll: true })
    return placedRef.current?.() ?? undefined
  }, [placement, draw, animate, keyboard, focus])

  // Content that changes size once the card is open (rows that come after "Looking…", a
  // search's results): the glass is sized for the panel each frame it moves, so a panel that
  // grows at rest would keep its old rim and leave its new part unfrosted.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const observer = new ResizeObserver(() => draw())
    observer.observe(panel)
    return () => observer.disconnect()
  }, [draw])

  // Like the menus: it goes when the window loses the focus or changes size, or on Esc.
  useEffect(() => {
    const away = (): void => close()
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (!motion.current.closing && escapeRef.current?.()) return
      close()
    }
    window.addEventListener('blur', away)
    window.addEventListener('resize', away)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('blur', away)
      window.removeEventListener('resize', away)
      window.removeEventListener('keydown', key, true)
    }
  }, [close])

  useEffect(() => {
    const m = motion.current
    return () => cancelAnimationFrame(m.frame)
  }, [])

  const style: React.CSSProperties = placement
    ? {
        left: placement.left,
        backdropFilter: glass ? `url(#${glass.id})` : undefined
      }
    : { left: 0, top: 0, visibility: 'hidden' }

  return createPortal(
    <div className="card-menu-layer">
      <div
        ref={scrimRef}
        className="card-menu-scrim"
        onPointerDown={(event) => {
          event.preventDefault()
          onPressOutside?.(event.clientX, event.clientY)
          close()
        }}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={gestures?.onWheel}
      />
      {glass?.filter}
      <div
        ref={panelRef}
        className={`peek-card ${className}${glass ? '' : ' card-menu--frosted'}`}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        style={style}
        onContextMenu={(event) => event.preventDefault()}
        {...gestures}
      >
        <div ref={contentRef} className="peek-card__content">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
