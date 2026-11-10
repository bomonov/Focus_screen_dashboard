import { usePlayOnMount } from '../../hooks/usePlayOnMount'
import type { TimerView } from './timerView'

export function TimerFlip({ view }: { view: TimerView }): React.JSX.Element {
  return (
    <div className="timer-flip">
      <div className="timer-flip__digits" role="timer" aria-label={view.ariaLabel}>
        {[...view.text].map((char, index) =>
          char === ':' ? (
            <span key={`colon-${index}`} className="timer-flip__colon" aria-hidden="true">
              :
            </span>
          ) : (
            // Keyed by value, so a tile remounts (and plays its flip) only when its digit changes.
            <FlipTile key={`${index}-${char}`} digit={char} />
          )
        )}
      </div>
      <span className="timer__caption">{view.caption}</span>
    </div>
  )
}

const FLIP_IN: Keyframe[] = [
  { transform: 'rotateX(-80deg)', opacity: 0.3 },
  { transform: 'none', opacity: 1 }
]
const FLIP_IN_TIMING: KeyframeAnimationOptions = { duration: 260, easing: 'ease-out' }

function FlipTile({ digit }: { digit: string }): React.JSX.Element {
  const ref = usePlayOnMount<HTMLSpanElement>(FLIP_IN, FLIP_IN_TIMING)
  return (
    <span ref={ref} className="timer-flip__tile" aria-hidden="true">
      {digit}
    </span>
  )
}
