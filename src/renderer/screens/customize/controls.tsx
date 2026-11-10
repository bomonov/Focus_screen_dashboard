import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { pickLabel } from '../../../main/services/timer/lengths'
import { LengthWheels } from '../../widgets/timer/LengthWheels'

/** A length turned in the box is saved once it settles, not on every step. */
const SAVE_AFTER_MS = 300

export function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section aria-label={title} className="customize__section">
      <h2 className="customize__section-title">{title}</h2>
      {children}
    </section>
  )
}

export interface PillOption<T> {
  value: T
  label: string
  disabled?: boolean
}

/** A labelled row of choice buttons; the chosen one is filled in the accent. */
export function PillGroup<T extends string | number>({
  label,
  options,
  value,
  onPick,
  children
}: {
  label: string
  options: readonly PillOption<T>[]
  value: T | null
  onPick: (value: T) => void
  /** Extra controls after the pills, e.g. a minutes field. */
  children?: React.ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="customize__group">
      <span className="customize__group-label" id={id}>
        {label}
      </span>
      <div className="customize__pills" role="group" aria-labelledby={id}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className="customize__pill"
            aria-pressed={option.value === value}
            disabled={option.disabled}
            onClick={() => onPick(option.value)}
          >
            {option.label}
          </button>
        ))}
        {children}
      </div>
    </div>
  )
}

/** The mockup's switch rows: label, optional hint, and a track with a knob. */
export function ToggleRow({
  label,
  hint,
  on,
  onToggle,
  disabled = false,
  detail
}: {
  label: string
  hint?: string
  on: boolean
  onToggle: (on: boolean) => void
  /** Can't be turned on here (its add-on isn't installed). */
  disabled?: boolean
  /** A tooltip with more, such as the setup command. */
  detail?: string | null
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="customize__toggle"
      disabled={disabled}
      title={detail ?? undefined}
      onClick={() => onToggle(!on)}
    >
      <span className="customize__toggle-text">
        <span>{label}</span>
        {hint && <span className="customize__hint">{hint}</span>}
      </span>
      <span className="customize__switch" aria-hidden="true">
        <span className="customize__knob" />
      </span>
    </button>
  )
}

/**
 * A timer length: its quick picks, then an hours · minutes · seconds box. Turning the box saves
 * once it settles; 0:00:00 isn't a length, so it goes back to the saved one when left there.
 */
export function LengthGroup({
  label,
  name,
  picks,
  valueSec,
  onChange
}: {
  label: string
  /** What the length is for, in the box's names ("Focus hours"). */
  name: string
  picks: readonly number[]
  valueSec: number
  onChange: (sec: number) => void
}): React.JSX.Element {
  const [shown, setShown] = useState(valueSec)
  const [seen, setSeen] = useState(valueSec)
  const [pending, setPending] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef(valueSec)
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  })

  // A length set elsewhere (the Timer card, a menu) shows here, unless it's being turned.
  if (valueSec !== seen) {
    setSeen(valueSec)
    if (!pending) setShown(valueSec)
  }

  function turn(sec: number): void {
    setShown(sec)
    latest.current = sec
    setPending(true)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = undefined
      if (latest.current >= 1) onChangeRef.current(latest.current)
      setPending(false)
    }, SAVE_AFTER_MS)
  }

  // Leaving the page while it's still settling saves it all the same.
  useEffect(
    () => () => {
      if (saveTimer.current === undefined) return
      clearTimeout(saveTimer.current)
      if (latest.current >= 1) onChangeRef.current(latest.current)
    },
    []
  )

  return (
    <PillGroup
      label={label}
      options={picks.map((pick) => ({ value: pick, label: pickLabel(pick) }))}
      value={picks.includes(shown) ? shown : null}
      onPick={(pick) => {
        clearTimeout(saveTimer.current)
        saveTimer.current = undefined
        setPending(false)
        setShown(pick)
        onChange(pick)
      }}
    >
      <span
        className="customize__length"
        title="Scroll, drag or type on a number to change it"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget) && shown < 1) setShown(valueSec)
        }}
      >
        <LengthWheels valueSec={shown} onChange={turn} size="row" label={name} />
      </span>
    </PillGroup>
  )
}
