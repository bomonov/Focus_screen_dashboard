import { useState } from 'react'
import type { TripWhen } from '../../../main/ipc'
import { dayChoices, pickFor, whenOf, type WhenPick } from './whenPick'

const PASSED = 'That time has gone by: pick a later one.'

interface ChipProps {
  on: boolean
  onPick(): void
  children: React.ReactNode
}

function Chip({ on, onPick, children }: ChipProps): React.JSX.Element {
  return (
    <button type="button" className="trip-chip-button" aria-pressed={on} onClick={onPick}>
      {children}
    </button>
  )
}

interface WhenPickerProps {
  id: string
  when: TripWhen
  /** Unix seconds. */
  now: number
  onChange(when: TripWhen): void
}

/**
 * When the trip leaves or gets there (call 1): Leave now, Leave at… or Arrive by…, a day from
 * today to six days on and a time of day. Every change that names a time still to come is asked
 * at once; one that's gone by says so and waits.
 */
export function WhenPicker({ id, when, now, onChange }: WhenPickerProps): React.JSX.Element {
  // A pick that couldn't be asked (gone by) is kept here, so the user sees what they set.
  const [draft, setDraft] = useState<WhenPick | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const today = new Date(now * 1000)
  const shown: WhenPick | null =
    draft ?? (when.kind === 'now' ? null : pickFor(when, when.kind, today))
  const mode = shown?.kind ?? 'now'

  function ask(pick: WhenPick): void {
    const asked = whenOf(pick, now)
    if (asked) {
      setDraft(null)
      setProblem(null)
      onChange(asked)
      return
    }
    // A time field being cleared to type a new one isn't a mistake yet.
    setDraft(pick)
    setProblem(pick.time === '' ? null : PASSED)
  }

  const kind = (next: WhenPick['kind']): void => {
    if (shown) ask({ ...shown, kind: next })
    else ask(pickFor(when, next, today))
  }

  return (
    <div id={id} className="trip-when" role="group" aria-label="When">
      <div className="trip-when__row">
        <Chip
          on={mode === 'now'}
          onPick={() => {
            setDraft(null)
            setProblem(null)
            onChange({ kind: 'now' })
          }}
        >
          Leave now
        </Chip>
        <Chip on={mode === 'depart'} onPick={() => kind('depart')}>
          Leave at…
        </Chip>
        <Chip on={mode === 'arrive'} onPick={() => kind('arrive')}>
          Arrive by…
        </Chip>
      </div>
      {shown && (
        <>
          <div className="trip-when__row trip-when__days" role="group" aria-label="Day">
            {dayChoices(today).map((choice) => (
              <Chip
                key={choice.day}
                on={shown.day === choice.day}
                onPick={() => ask({ ...shown, day: choice.day })}
              >
                {choice.label}
              </Chip>
            ))}
          </div>
          <div className="trip-when__row">
            <input
              className="trip-when__time"
              type="time"
              aria-label={mode === 'arrive' ? 'Arrive by' : 'Leave at'}
              value={shown.time}
              onChange={(event) => ask({ ...shown, time: event.target.value })}
            />
            {problem && (
              <p className="trip-when__problem" role="status">
                {problem}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
