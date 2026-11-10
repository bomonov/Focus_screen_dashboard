import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { SettingsPatch } from '../../../main/ipc'
import { QUICK_MENU_SCALE } from '../../../main/services/settings/schema'
import { CheckIcon, ChevronIcon } from '../../widgets/cardMenu/CardMenu'
import { frameSeconds } from '../../widgets/cardMenu/cardMenuPrepare'
import { atRest, stepSpring, type Spring, type SpringConfig } from '../../widgets/tabBarMotion'
import { menuScaleFromSlider } from './customizeView'

/** A drag sends a value per step; save once it settles, as the accent picker does. */
const SAVE_DELAY_MS = 200
/** The preview follows the slider on this spring, so a jump (a click on the track) glides too. */
const FOLLOW: SpringConfig = { response: 0.32, damping: 0.86 }

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

function Row({
  label,
  checked = false,
  sub = false,
  disabled = false
}: {
  label: string
  checked?: boolean
  sub?: boolean
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div
      className={`card-menu__item${sub ? ' card-menu__item--sub' : ''}`}
      aria-disabled={disabled || undefined}
    >
      <span className="card-menu__check">{checked && <CheckIcon />}</span>
      <span className="card-menu__label">{label}</span>
      {sub && (
        <span className="card-menu__chevron">
          <ChevronIcon />
        </span>
      )}
    </div>
  )
}

/**
 * Customize › Theme: how big the right-click menu is, with a preview of it that resizes as the
 * slider moves. The preview is the real menu's rows and glass, drawn smaller than on the Focus
 * Screen (it has to fit here at 120%), under a pointer like a right-click.
 */
export function QuickMenuSize({
  scale,
  update
}: {
  /** The saved size. */
  scale: number
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const id = useId()
  /** Where the slider is while it moves; null shows the saved size. */
  const [draft, setDraft] = useState<number | null>(null)
  // Saved (and sent back by main): the slider shows the setting again.
  const [saved, setSaved] = useState(scale)
  if (scale !== saved) {
    setSaved(scale)
    if (draft === scale) setDraft(null)
  }
  const shown = draft ?? scale
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const panel = useRef<HTMLDivElement>(null)
  const follow = useRef({ spring: { value: shown, velocity: 0 } as Spring, frame: 0, last: 0 })

  useEffect(() => () => clearTimeout(saveTimer.current), [])

  function slide(percent: number): void {
    const next = menuScaleFromSlider(percent, QUICK_MENU_SCALE)
    setDraft(next)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => update({ theme: { quickMenuScale: next } }), SAVE_DELAY_MS)
  }

  // The preview's size is written straight onto it every frame, not rendered: a spring that
  // follows the slider, and only moves while it's catching up.
  useLayoutEffect(() => {
    panel.current?.style.setProperty('--menu-scale', String(follow.current.spring.value))
  }, [])
  useEffect(() => {
    const f = follow.current
    const draw = (): void =>
      panel.current?.style.setProperty('--menu-scale', String(f.spring.value))
    if (reducedMotion.matches) {
      f.spring = { value: shown, velocity: 0 }
      draw()
      return
    }
    const tick = (now: number): void => {
      const dt = f.last ? (now - f.last) / 1000 : frameSeconds()
      f.last = now
      f.spring = stepSpring(f.spring, shown, FOLLOW, dt)
      if (atRest(f.spring, shown, 0.0005)) {
        f.spring = { value: shown, velocity: 0 }
        draw()
        f.frame = 0
        f.last = 0
        return
      }
      draw()
      f.frame = requestAnimationFrame(tick)
    }
    f.frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(f.frame)
      f.frame = 0
      f.last = 0
    }
  }, [shown])

  const percent = Math.round(shown * 100)
  const { min, max } = QUICK_MENU_SCALE
  // How much of the track is filled in the accent, up to the knob.
  const fill = ((shown - min) / (max - min)) * 100
  return (
    <div className="customize__group menu-size">
      <div className="menu-size__heading">
        <label className="customize__group-label" htmlFor={id}>
          Right-click menu size
        </label>
        <output className="menu-size__value" htmlFor={id}>
          {percent}%
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="menu-size__slider"
        min={min * 100}
        max={max * 100}
        step={1}
        value={percent}
        aria-valuetext={`${percent}%`}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(event) => slide(Number(event.target.value))}
      />
      <div className="menu-size__stage" aria-hidden="true">
        <div className="menu-size__card" />
        <div className="menu-size__card menu-size__card--small" />
        <svg className="menu-size__pointer" viewBox="0 0 12 18">
          <path d="M1 1v14l3.6-3.4 2.6 5.6 2.3-1-2.6-5.5H12z" />
        </svg>
        <div ref={panel} className="card-menu card-menu--frosted card-menu--preview">
          <div className="card-menu__content">
            <div className="card-menu__list card-menu__list--checks">
              <Row label="Customize…" />
              <Row label="Edit Layout" />
              <div className="card-menu__separator" />
              <Row label="Show Focus Screen on" disabled />
              <Row label="Automatic (second screen when connected)" checked />
              <Row label="Floating window" />
              <div className="card-menu__separator" />
              <Row label="Timer" sub />
              <Row label="Music" sub />
              <Row label="To-do" sub />
              <div className="card-menu__separator" />
              <Row label="Quit Focus Screen" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
