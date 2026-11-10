import { useNow } from '../hooks/useNow'
import { dateFormat, timeFormat } from './clockFormat'
import { PillRow } from './nextClass/PillRow'
import './TopBar.css'

interface TopBarProps {
  /** "Display 2" or "Floating window"; null until the main process answers. */
  placementLabel: string | null
  /** The clock and date; off leaves just the Customize button, which always stays. */
  showClock: boolean
  onCustomize: () => void
  /** While the cards are being arranged: Reset and Done instead of the usual buttons. */
  layoutEditing: { custom: boolean; reset: () => void; done: () => void } | null
  /** Next class, beside the date; null while it's off. */
  nextClass: React.ReactNode
  /** Next bus (and ASU shuttle), after Next class; null while it's off. */
  nextBus: React.ReactNode
  /** The weather where this Mac is, after the bus; null while it's off. */
  weather: React.ReactNode
  /** The trip search bubble (or a kept trip's countdown), before Customize; null while it's off. */
  trips: React.ReactNode
}

export function TopBar({
  placementLabel,
  showClock,
  onCustomize,
  layoutEditing,
  nextClass,
  nextBus,
  weather,
  trips
}: TopBarProps): React.JSX.Element {
  return (
    <header className="top-bar">
      <PillRow className="top-bar__left">
        {showClock && <Clock />}
        {nextClass}
        {nextBus}
        {weather}
      </PillRow>
      {layoutEditing ? (
        <LayoutActions {...layoutEditing} />
      ) : (
        <div className="top-bar__actions">
          <span className="top-bar__display">
            {placementLabel ? `${placementLabel} · Focus Screen` : 'Focus Screen'}
          </span>
          {trips}
          {/* A round icon bubble, like the search beside it (the user's idea). */}
          <button
            type="button"
            className="top-bar__customize top-bar__bubble"
            aria-label="Customize"
            title="Customize"
            onClick={onCustomize}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
              <circle cx="15" cy="6" r="2" />
              <circle cx="9" cy="12" r="2" />
              <circle cx="17" cy="18" r="2" />
            </svg>
          </button>
        </div>
      )}
    </header>
  )
}

function LayoutActions({
  custom,
  reset,
  done
}: {
  custom: boolean
  reset: () => void
  done: () => void
}): React.JSX.Element {
  return (
    <div className="top-bar__actions top-bar__actions--editing">
      <span className="top-bar__hint">
        Drag a card to move it, or drop it on another to swap. Drag an edge or corner to resize.
      </span>
      <button type="button" className="top-bar__customize" disabled={!custom} onClick={reset}>
        Reset layout
      </button>
      <button type="button" className="top-bar__customize top-bar__done" onClick={done}>
        Done
      </button>
    </div>
  )
}

function Clock(): React.JSX.Element {
  const now = useNow()
  return (
    <div className="top-bar__clock">
      <time className="top-bar__time" dateTime={now.toISOString()}>
        {timeFormat.format(now)}
      </time>
      <span className="top-bar__date">{dateFormat.format(now)}</span>
    </div>
  )
}
