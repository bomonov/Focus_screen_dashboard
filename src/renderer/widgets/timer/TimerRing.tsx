import { useRef } from 'react'
import type { TimerView } from './timerView'
import { useToneSweep } from './useToneSweep'

// The mockup's 220px ring: radius 95 with a 10px stroke.
const SIZE = 220
const RADIUS = 95
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** The new color drawn once around the ring from the top, clockwise, then faded away. */
const SWEEP: Keyframe[] = [
  { strokeDashoffset: CIRCUMFERENCE, opacity: 1, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
  { strokeDashoffset: 0, opacity: 1, offset: 0.62 },
  { strokeDashoffset: 0, opacity: 1, offset: 0.72 },
  { strokeDashoffset: 0, opacity: 0 }
]

export function TimerRing({ view }: { view: TimerView }): React.JSX.Element {
  const center = SIZE / 2
  const sweep = useRef<SVGCircleElement>(null)
  const progress = useRef<SVGCircleElement>(null)
  useToneSweep(view.tone, sweep, progress, SWEEP)
  return (
    <div className="timer-ring">
      <svg className="timer-ring__svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle className="timer-ring__track" cx={center} cy={center} r={RADIUS} />
        {/* A round cap draws a dot even at zero length, so an empty ring skips the arc. */}
        {view.progress > 0 && (
          <circle
            ref={progress}
            className={`timer-ring__progress timer-ring__progress--${view.tone}`}
            cx={center}
            cy={center}
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - view.progress)}
            transform={`rotate(-90 ${center} ${center})`}
          />
        )}
        {/* Hidden until a session ends; then the next session's color sweeps around. */}
        <circle
          ref={sweep}
          className={`timer-ring__sweep timer-ring__progress--${view.tone}`}
          cx={center}
          cy={center}
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={0}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <div className="timer-ring__readout">
        <span
          className={`timer__time${view.text.length > 5 ? ' timer__time--long' : ''}`}
          role="timer"
          aria-label={view.ariaLabel}
        >
          {view.text}
        </span>
        <span className="timer__caption">{view.caption}</span>
      </div>
    </div>
  )
}
