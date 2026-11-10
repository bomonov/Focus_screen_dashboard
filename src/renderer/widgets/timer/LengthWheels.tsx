import { joinLength, splitLength, type LengthParts } from '../../../main/services/timer/lengths'
import { LengthWheel, type WheelSize } from './LengthWheel'
import './LengthWheels.css'

const words = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * A length as three wheels, hours : minutes : seconds. On the Timer card (`card`) each wheel
 * shows its neighbours above and below; in a settings row (`row`) only the numbers, in a box.
 */
export function LengthWheels({
  valueSec,
  onChange,
  size,
  label,
  onZero
}: {
  valueSec: number
  onChange: (sec: number) => void
  /** A wheel landed on 0 (`fast`: quickly). */
  onZero?: (fast: boolean) => void
  size: WheelSize
  /** What the length is for ("Focus"), in each wheel's name. */
  label: string
}): React.JSX.Element {
  const parts = splitLength(valueSec)
  const set = (change: Partial<LengthParts>): void => onChange(joinLength({ ...parts, ...change }))

  return (
    <div
      className={`length-wheels length-wheels--${size}`}
      role="group"
      aria-label={`${label} length`}
    >
      <LengthWheel
        value={parts.hours}
        max={23}
        unit={size === 'card' ? 'hours' : 'h'}
        name={`${label} hours`}
        valueText={words(parts.hours, 'hour')}
        pad={false}
        size={size}
        onZero={onZero}
        onChange={(hours) => set({ hours })}
      />
      <span className="length-wheels__colon" aria-hidden="true">
        :
      </span>
      <LengthWheel
        value={parts.minutes}
        max={59}
        unit={size === 'card' ? 'min' : 'm'}
        name={`${label} minutes`}
        valueText={words(parts.minutes, 'minute')}
        pad
        size={size}
        onZero={onZero}
        onChange={(minutes) => set({ minutes })}
      />
      <span className="length-wheels__colon" aria-hidden="true">
        :
      </span>
      <LengthWheel
        value={parts.seconds}
        max={59}
        unit={size === 'card' ? 'sec' : 's'}
        name={`${label} seconds`}
        valueText={words(parts.seconds, 'second')}
        pad
        size={size}
        onZero={onZero}
        onChange={(seconds) => set({ seconds })}
      />
    </div>
  )
}
