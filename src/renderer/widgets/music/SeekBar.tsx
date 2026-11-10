import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import type { Track } from '../../../main/ipc'
import { canSeek, seekEnd } from '../../../main/services/music/types'
import { useCapsuleGlass, type CapsuleGlass } from '../GlassFilter'
import { atRest, LIFT, stepSpring, type Spring } from '../tabBarMotion'
import { formatSongTime } from './musicView'
import { fractionAt, keySeek } from './seekView'
import './SeekBar.css'

/** The knob's size resting on the bar, as a share of its size held (kube.io's slider: 0.6). */
const RESTING_SCALE = 0.6
/** The knob glass's bezel and thickness, in rem: enough to bend the bar it's held over. */
const KNOB_BEZEL_REM = 0.55
const KNOB_THICKNESS_REM = 0.7
/** A jump the player hasn't shown yet stays on screen this long at most. */
const LANDING_MS = 1500
/** Close enough to where the jump went to count as there (the player reports in whole steps). */
const LANDED_SEC = 1.5

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

interface SeekBarProps {
  track: Track
  /** Seconds into the song, counted on while it plays. */
  positionSec: number
}

/**
 * The song's progress, after kube.io's liquid-glass slider: a white pill rests on the bar where
 * the song is. Press anywhere and it lifts into glass that bends the bar under it; drag it and
 * let go to jump there. Ads and streams without a length get the bar alone.
 */
export function SeekBar({ track, positionSec }: SeekBarProps): React.JSX.Element {
  const seekable = canSeek(track)
  const duration = track.durationSec
  const bar = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  /** Where the knob is held (0–1) while pressed; mirrored in a ref for the pointer handlers. */
  const [held, setHeld] = useState<number | null>(null)
  const holding = useRef(false)
  /** A jump just made, shown until the player's position gets there. */
  const [landing, setLanding] = useState<number | null>(null)
  /** The knob's size when held (its layout size; resting is a scale), for its glass. */
  const [size, setSize] = useState<{ width: number; height: number; rem: number } | null>(null)

  const glass = useCapsuleGlass(
    size?.height ?? 0,
    KNOB_BEZEL_REM * (size?.rem ?? 16),
    KNOB_THICKNESS_REM * (size?.rem ?? 16)
  )
  const glassRef = useRef<CapsuleGlass | null>(null)
  useLayoutEffect(() => {
    glassRef.current = glass
    if (glass && size) glass.setWidth(size.width)
  })

  useLayoutEffect(() => {
    const element = knob.current
    if (!element) return
    const measure = (): void => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      setSize({ width: element.offsetWidth, height: element.offsetHeight, rem })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [seekable])

  // The lift: 0 resting (a small white pill), 1 held (full-size glass), with a little bounce.
  const lift = useRef<{ spring: Spring; target: number; frame: number | null; last: number }>({
    spring: { value: 0, velocity: 0 },
    target: 0,
    frame: null,
    last: 0
  })
  const draw = useCallback((value: number): void => {
    const element = knob.current
    if (!element) return
    const amount = Math.max(0, value)
    element.style.transform = `scale(${RESTING_SCALE + (1 - RESTING_SCALE) * amount})`
    element.style.setProperty('--lift', String(Math.min(amount, 1)))
    glassRef.current?.setStrength(Math.min(amount, 1.15))
  }, [])
  const step = useRef<(time: number) => void>(() => undefined)
  useLayoutEffect(() => {
    step.current = (time) => {
      const m = lift.current
      const dt = m.last ? (time - m.last) / 1000 : 1 / 60
      m.last = time
      m.spring = reducedMotion.matches
        ? { value: m.target, velocity: 0 }
        : stepSpring(m.spring, m.target, LIFT, dt)
      draw(m.spring.value)
      if (atRest(m.spring, m.target, 0.002)) {
        m.frame = null
        m.last = 0
        return
      }
      m.frame = requestAnimationFrame((next) => step.current(next))
    }
  })
  const liftTo = useCallback((target: number): void => {
    const m = lift.current
    m.target = target
    if (m.frame === null) m.frame = requestAnimationFrame((time) => step.current(time))
  }, [])
  useEffect(
    () => () => {
      const frame = lift.current.frame
      if (frame !== null) cancelAnimationFrame(frame)
    },
    []
  )

  // A jump that never shows up (the player refused it) stops being shown after a moment.
  useEffect(() => {
    if (landing === null) return
    const timer = setTimeout(() => setLanding(null), LANDING_MS)
    return () => clearTimeout(timer)
  }, [landing])
  if (landing !== null && Math.abs(positionSec - landing) <= LANDED_SEC) setLanding(null)

  const shownSec = held !== null ? held * duration : (landing ?? positionSec)
  const fraction = duration > 0 ? Math.min(1, Math.max(0, shownSec / duration)) : 0

  const pointed = (clientX: number): number => {
    const box = bar.current?.getBoundingClientRect()
    if (!box) return 0
    return fractionAt(clientX, box.left, box.width, (size?.width ?? 0) * RESTING_SCALE)
  }
  const seek = (sec: number): void => {
    const to = Math.min(Math.max(sec, 0), seekEnd(track))
    window.focusScreen.sendMusicCommand({ kind: 'seek', positionSec: to })
    setLanding(to)
  }
  const letGo = (): void => {
    holding.current = false
    setHeld(null)
    liftTo(0)
  }

  const handlers = seekable
    ? {
        onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          holding.current = true
          setHeld(pointed(event.clientX))
          liftTo(1)
        },
        onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
          if (holding.current) setHeld(pointed(event.clientX))
        },
        onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
          if (!holding.current) return
          seek(pointed(event.clientX) * duration)
          letGo()
        },
        // The window lost the pointer (another app, a menu): no jump.
        onPointerCancel: letGo,
        onLostPointerCapture() {
          if (holding.current) letGo()
        },
        onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
          const to = keySeek(event.key, shownSec, duration)
          if (to === null) return
          event.preventDefault()
          seek(to)
        }
      }
    : {}

  const classes = ['seek__bar']
  if (seekable) classes.push('seek__bar--seekable')
  if (held !== null) classes.push('seek__bar--held')

  return (
    <div className="seek">
      <div
        ref={bar}
        className={classes.join(' ')}
        role={seekable ? 'slider' : 'progressbar'}
        aria-label="Song position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(shownSec)}
        aria-valuetext={
          duration > 0
            ? `${formatSongTime(shownSec)} of ${formatSongTime(duration)}`
            : formatSongTime(shownSec)
        }
        tabIndex={seekable ? 0 : undefined}
        style={{ '--fraction': fraction } as CSSProperties}
        {...handlers}
      >
        {seekable && glass?.filter}
        <div className="seek__track">
          <div className="seek__fill" />
        </div>
        {seekable && (
          <div
            ref={knob}
            className="seek__knob"
            style={{ backdropFilter: glass ? `url(#${glass.id})` : undefined }}
          />
        )}
      </div>
      <div className="now-playing__times">
        <span>{formatSongTime(shownSec)}</span>
        <span>{duration > 0 ? formatSongTime(duration) : ''}</span>
      </div>
    </div>
  )
}
