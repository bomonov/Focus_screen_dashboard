import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useCapsuleGlass, type CapsuleGlass } from './GlassFilter'
import { atRest, FOLLOW, LIFT, SETTLE, stepSpring, stretchFor, type Spring } from './tabBarMotion'
import { lensTarget, type TabBox } from './tabBarView'
import './TabBar.css'

export interface TabOption<T> {
  value: T
  label: string
  icon: React.ReactNode
}

/** Pointer travel (px) that turns a press into a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4
/** How much bigger the lens grows when lifted off the bar by a press. */
const LIFTED_SCALE = 1.25
/** The glass's bezel and thickness, in rem: enough to bend the icons it slides over. */
const LENS_BEZEL_REM = 0.6
const LENS_THICKNESS_REM = 0.8
/** A pick the app never confirms (refused) stops being shown after this long. */
const PENDING_TIMEOUT_MS = 1500
/** Matches the CSS fold and unfold (0.36 s), plus a frame or two to land. */
const UNFOLD_MS = 420
/** The gap between a tab's icon and its name, in rem (as in TabBar.css). */
const NAME_GAP_REM = 0.5

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** The lens's springs and where they're headed. Mutated every frame, outside React. */
interface Motion {
  /** Center and width of the lens as drawn, and how far it's lifted (0 resting, 1 held). */
  center: Spring
  width: Spring
  lift: Spring
  target: { center: number; width: number; lift: number }
  /** True while dragging: the lens chases the pointer instead of settling with a bounce. */
  following: boolean
  /** The lens's height (it's never narrower), kept here so drawing never has to measure. */
  height: number
  /** Jumped to its first spot yet (the first placement isn't animated). */
  placed: boolean
  frame: number | null
  lastTime: number
}

function newMotion(): Motion {
  const still = (): Spring => ({ value: 0, velocity: 0 })
  return {
    center: still(),
    width: still(),
    lift: still(),
    target: { center: 0, width: 0, lift: 0 },
    following: false,
    height: 0,
    placed: false,
    frame: null,
    lastTime: 0
  }
}

/**
 * Tabs after the iOS Liquid Glass tab bar: a dark track of icons, the chosen one named, under a
 * glass pill. Press and the pill lifts into a lens that bends what's under it; drag it and every
 * tab shrinks to its icon (so they're even and easy to aim at) while the lens follows the pointer
 * on a spring, stretching with its speed. Let go and the tab under the pointer is picked, named,
 * and the lens springs onto it and sinks back into the bar.
 */
export function TabBar<T extends string>({
  label,
  options,
  value,
  onPick,
  className
}: {
  label: string
  options: readonly TabOption<T>[]
  value: T | null
  onPick: (value: T) => void
  className?: string
}): React.JSX.Element {
  const track = useRef<HTMLDivElement>(null)
  const lensRef = useRef<HTMLSpanElement>(null)
  const motion = useRef<Motion>(newMotion())
  const glassRef = useRef<CapsuleGlass | null>(null)
  const press = useRef<{ pointerId: number; startX: number; moved: boolean } | null>(null)
  const underRef = useRef<number | null>(null)
  /** A drag ends in a pointerup over some tab, whose click mustn't count as a second pick. */
  const dragged = useRef(false)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const [dragging, setDragging] = useState(false)
  /**
   * While dragging: the bar's width when the drag began, kept so nothing moves under the pointer,
   * and the even slot each tab widens to as the names fold away. Just after: the width it'll end
   * up at once the picked name has unfolded, which it glides to (no slot by then).
   */
  const [held, setHeld] = useState<{ width: number; slot: number | null } | null>(null)
  const unfoldTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [under, setUnder] = useState<number | null>(null)
  /** Picked here, not yet confirmed (the timer's mode goes through the main process). */
  const [pending, setPending] = useState<T | null>(null)
  const [seenValue, setSeenValue] = useState(value)
  if (value !== seenValue) {
    setSeenValue(value)
    setPending(null)
  }
  /** The lens's height and place: its glass maps are made for the height; the width is live. */
  const [size, setSize] = useState<{ height: number; top: number } | null>(null)
  const [rem, setRem] = useState(16)

  /** The tab that's named and under the lens when nothing is being dragged. */
  const shown = pending ?? value

  const glass = useCapsuleGlass(size?.height ?? 0, LENS_BEZEL_REM * rem, LENS_THICKNESS_REM * rem)
  useLayoutEffect(() => {
    glassRef.current = glass
  })

  /**
   * Draws the lens where its springs are. Its width is real (not a stretch), so its ends stay
   * round at any width; scale is only for the lift, and for the stretch while it's dragged.
   */
  const draw = useCallback((): void => {
    const m = motion.current
    const lens = lensRef.current
    if (!lens || m.width.value <= 0) return
    const width = Math.max(m.width.value, m.height)
    const lift = Math.max(0, m.lift.value)
    const grow = 1 + (LIFTED_SCALE - 1) * lift
    const stretch = m.following ? stretchFor(m.center.velocity) : { x: 1, y: 1 }
    lens.style.width = `${width}px`
    lens.style.transform = `translateX(${m.center.value - width / 2}px) scale(${stretch.x * grow}, ${stretch.y * grow})`
    glassRef.current?.setWidth(width)
    lens.style.setProperty('--lift', String(Math.min(lift, 1)))
    // It only bends what's under it while lifted; resting, the name inside stays sharp.
    glassRef.current?.setStrength(Math.min(lift, 1.15))
  }, [])

  /** One animation frame: steps the springs and draws; schedules the next while still moving. */
  const tick = useRef<(now: number) => void>(() => undefined)
  useLayoutEffect(() => {
    tick.current = (now) => {
      const m = motion.current
      const dt = m.lastTime ? (now - m.lastTime) / 1000 : 1 / 60
      m.lastTime = now
      if (reducedMotion.matches) {
        m.center = { value: m.target.center, velocity: 0 }
        m.width = { value: m.target.width, velocity: 0 }
        m.lift = { value: m.target.lift, velocity: 0 }
      } else {
        const move = m.following ? FOLLOW : SETTLE
        m.center = stepSpring(m.center, m.target.center, move, dt)
        m.width = stepSpring(m.width, m.target.width, move, dt)
        m.lift = stepSpring(m.lift, m.target.lift, LIFT, dt)
      }
      draw()
      const still =
        atRest(m.center, m.target.center, 0.25) &&
        atRest(m.width, m.target.width, 0.25) &&
        atRest(m.lift, m.target.lift, 0.002)
      if (still && !m.following) {
        m.frame = null
        m.lastTime = 0
        return
      }
      m.frame = requestAnimationFrame((time) => tick.current(time))
    }
  })

  const animate = useCallback((): void => {
    const m = motion.current
    if (m.frame === null) m.frame = requestAnimationFrame((time) => tick.current(time))
  }, [])

  useEffect(() => {
    const m = motion.current
    return () => {
      if (m.frame !== null) cancelAnimationFrame(m.frame)
      clearTimeout(pendingTimer.current)
      clearTimeout(unfoldTimer.current)
    }
  }, [])

  // Where the lens should sit: on the named tab, or, mid-drag, an icon's width at the pointer.
  // Measured, not computed: names change the tabs' widths, and cards resize on their own.
  useLayoutEffect(() => {
    const box = track.current
    if (!box) return
    const measure = (): void => {
      const m = motion.current
      const tabs = [...box.querySelectorAll<HTMLElement>('.tab-bar__tab')]
      // Each name's own width, so it unfolds to exactly that (it's measured even while folded).
      for (const tab of tabs) {
        const name = tab.querySelector<HTMLElement>('.tab-bar__label')
        name?.style.setProperty('--label-width', `${name.scrollWidth}px`)
      }
      const named = tabs.find((tab) => tab.dataset.shown === 'true')
      const reference = named ?? tabs[0]
      if (!reference) return
      if (m.following && held?.slot) {
        m.target.width = held.slot
      } else if (named) {
        m.target.center = named.offsetLeft + named.offsetWidth / 2
        m.target.width = named.offsetWidth
      } else {
        return
      }
      const next = { height: reference.offsetHeight, top: reference.offsetTop }
      m.height = next.height
      setSize((current) =>
        current && current.height === next.height && current.top === next.top ? current : next
      )
      setRem(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
      if (!m.placed) {
        m.center = { value: m.target.center, velocity: 0 }
        m.width = { value: m.target.width, velocity: 0 }
        m.placed = true
      }
      draw()
      animate()
    }
    measure()
    // The tabs too: as names fold and unfold, each frame of it moves the lens's target.
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    for (const tab of box.querySelectorAll('.tab-bar__tab')) observer.observe(tab)
    return () => observer.disconnect()
  }, [shown, dragging, held, options.length, draw, animate])

  // A new height means new maps, drawn at their starting width: draw the live one again.
  useLayoutEffect(() => draw(), [size, glass, draw])

  function tabBoxes(): TabBox[] {
    const tabs = track.current?.querySelectorAll<HTMLElement>('.tab-bar__tab') ?? []
    return [...tabs].map((tab) => ({ left: tab.offsetLeft, width: tab.offsetWidth }))
  }

  function trackX(event: React.PointerEvent): number {
    return event.clientX - (track.current?.getBoundingClientRect().left ?? 0)
  }

  function pick(next: T): void {
    if (next === value) return
    setPending(next)
    clearTimeout(pendingTimer.current)
    pendingTimer.current = setTimeout(() => setPending(null), PENDING_TIMEOUT_MS)
    onPick(next)
  }

  /**
   * The bar's width once `namedIndex`'s name has unfolded and every other tab is back to its icon:
   * worked out ahead, so the bar can glide straight there instead of dipping on the way.
   */
  function settledWidth(namedIndex: number): number | null {
    const box = track.current
    if (!box) return null
    const style = getComputedStyle(box)
    const tabs = [...box.querySelectorAll<HTMLElement>('.tab-bar__tab')]
    const hit = Math.max(44, 2.75 * rem)
    const widths = tabs.map((tab, index) => {
      const tabStyle = getComputedStyle(tab)
      const icon = tab.querySelector<HTMLElement>('.tab-bar__icon')?.offsetWidth ?? 0
      const name = tab.querySelector<HTMLElement>('.tab-bar__label')?.scrollWidth ?? 0
      const base = icon + parseFloat(tabStyle.paddingLeft) + parseFloat(tabStyle.paddingRight)
      return Math.max(hit, index === namedIndex ? base + name + NAME_GAP_REM * rem : base)
    })
    const gaps = (parseFloat(style.columnGap) || 0) * Math.max(tabs.length - 1, 0)
    return (
      parseFloat(style.paddingLeft) +
      parseFloat(style.paddingRight) +
      gaps +
      widths.reduce((sum, width) => sum + width, 0)
    )
  }

  function endDrag(pickAt: number | null): void {
    const m = motion.current
    m.target.lift = 0
    m.following = false
    underRef.current = null
    setUnder(null)
    setDragging(false)
    let named = options.findIndex((option) => option.value === shown)
    if (pickAt !== null) {
      const index = lensTarget(tabBoxes(), pickAt)
      const picked = options[index]
      if (picked) {
        named = index
        pick(picked.value)
      }
    }
    // Glide from the held width to where it'll settle, then let it size itself again.
    const width = settledWidth(named)
    setHeld(width === null ? null : { width, slot: null })
    clearTimeout(unfoldTimer.current)
    unfoldTimer.current = setTimeout(() => setHeld(null), UNFOLD_MS)
    animate()
  }

  return (
    <div
      ref={track}
      className={`tab-bar${dragging ? ' tab-bar--dragging' : ''}${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={label}
      style={
        held === null
          ? undefined
          : ({
              width: held.width,
              ...(held.slot === null ? {} : { '--tab-min': `${held.slot}px` })
            } as React.CSSProperties)
      }
      onPointerDown={(event) => {
        if (event.button !== 0) return
        dragged.current = false
        press.current = { pointerId: event.pointerId, startX: trackX(event), moved: false }
        // Pressed: the pill lifts off the bar, as on iOS, even before it moves.
        motion.current.target.lift = 1
        animate()
      }}
      onPointerMove={(event) => {
        const held = press.current
        const box = track.current
        if (!held || held.pointerId !== event.pointerId || !box) return
        const x = trackX(event)
        if (!held.moved && Math.abs(x - held.startX) < DRAG_THRESHOLD_PX) return
        const m = motion.current
        if (!held.moved) {
          held.moved = true
          box.setPointerCapture(event.pointerId)
          m.following = true
          // The names fold away, but the bar keeps its width: the icons spread into even slots.
          const style = getComputedStyle(box)
          const inner =
            box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
          const gaps = (parseFloat(style.columnGap) || 0) * Math.max(options.length - 1, 0)
          clearTimeout(unfoldTimer.current)
          setHeld({ width: box.offsetWidth, slot: (inner - gaps) / Math.max(options.length, 1) })
          setDragging(true)
        }
        const half = m.target.width / 2
        m.target.center = Math.min(Math.max(x, half), Math.max(box.clientWidth - half, half))
        const index = lensTarget(tabBoxes(), x)
        if (index !== underRef.current) {
          underRef.current = index
          setUnder(index)
        }
        animate()
      }}
      onPointerUp={(event) => {
        const held = press.current
        press.current = null
        if (!held) return
        if (held.moved) {
          dragged.current = true
          endDrag(trackX(event))
        } else {
          motion.current.target.lift = 0
          animate()
        }
      }}
      onPointerCancel={() => {
        const held = press.current
        press.current = null
        if (held?.moved) endDrag(null)
        else {
          motion.current.target.lift = 0
          animate()
        }
      }}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        if (!step) return
        const index = options.findIndex((option) => option.value === shown)
        const next = options[Math.min(Math.max(index + step, 0), options.length - 1)]
        if (next) pick(next.value)
        event.preventDefault()
      }}
    >
      {glass?.filter}
      {size && (
        <span
          ref={lensRef}
          className="tab-bar__lens"
          style={{
            height: size.height,
            top: size.top,
            borderRadius: size.height / 2,
            // Bends and lights the tabs under it (Chromium reads SVG filters here).
            backdropFilter: glass ? `url(#${glass.id})` : undefined
          }}
          aria-hidden="true"
        />
      )}
      {options.map((option, index) => {
        const named = !dragging && option.value === shown
        return (
          <button
            key={option.value}
            type="button"
            className={`tab-bar__tab${under === index ? ' tab-bar__tab--under' : ''}`}
            aria-pressed={option.value === value}
            aria-label={option.label}
            title={option.label}
            data-shown={named}
            onClick={() => {
              if (dragged.current) {
                dragged.current = false
                return
              }
              pick(option.value)
            }}
          >
            <span className="tab-bar__icon" aria-hidden="true">
              {option.icon}
            </span>
            {/* Always there, folded to nothing unless named, so it can fold and unfold. */}
            <span className="tab-bar__label" aria-hidden="true">
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
