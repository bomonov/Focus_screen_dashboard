import { useRef } from 'react'
import type { TimerView } from './timerView'
import { useToneSweep } from './useToneSweep'

/** The new color filling the bar from the left, a beat full, then fading away. */
const SWEEP: Keyframe[] = [
  { transform: 'scaleX(0)', opacity: 1, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
  { transform: 'scaleX(1)', opacity: 1, offset: 0.62 },
  { transform: 'scaleX(1)', opacity: 1, offset: 0.72 },
  { transform: 'scaleX(1)', opacity: 0 }
]

export function TimerBar({ view }: { view: TimerView }): React.JSX.Element {
  const sweep = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLDivElement>(null)
  useToneSweep(view.tone, sweep, fill, SWEEP)
  return (
    <div className="timer-bar">
      <div className="timer-bar__top">
        <span className="timer__time" role="timer" aria-label={view.ariaLabel}>
          {view.text}
        </span>
        <span className="timer__caption">{view.caption}</span>
      </div>
      <div className="timer-bar__track" aria-hidden="true">
        <div
          ref={fill}
          className={`timer-bar__fill timer-bar__fill--${view.tone}`}
          style={{ width: `${view.progress * 100}%` }}
        />
        <div ref={sweep} className={`timer-bar__sweep timer-bar__fill--${view.tone}`} />
      </div>
    </div>
  )
}
