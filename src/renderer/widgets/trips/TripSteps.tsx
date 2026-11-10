import type { ThemePreset, TripPlan, TripRide } from '../../../main/ipc'
import { presetInfo } from '../../theme/presets'
import { LiveIcon } from './TripIcons'
import { rideStatus, routeLineColor, stepRows, type StepLine, type StepRow } from './tripCardView'
import { chipColors, chipText, clockWords } from './tripView'

/** A ride's chip: its name on the route's own colour, words that read on it. */
export function RouteChip({ ride }: { ride: TripRide }): React.JSX.Element {
  const { bg, fg } = chipColors(ride.color, ride.textColor)
  return (
    <span className="trip-chip" style={{ background: bg, color: fg }}>
      {chipText(ride)}
    </span>
  )
}

/** "live, 1 min late" with its waves, or "scheduled": live is said, not just coloured. */
export function RideStatus({ ride }: { ride: TripRide }): React.JSX.Element {
  const { words, live } = rideStatus(ride)
  return (
    <span className={`trip-status${live ? ' trip-status--live' : ''}`}>
      {live && <LiveIcon className="trip-status__icon" />}
      {words}
    </span>
  )
}

/** The line into or out of a step's dot. */
const lineClass = (where: 'above' | 'below', line: StepLine): string =>
  line ? `trip-step__line trip-step__line--${where} trip-step__line--${line}` : ''

function StepDot({ row }: { row: StepRow }): React.JSX.Element {
  const route = row.ride !== null
  return (
    <span className="trip-step__rail" aria-hidden="true">
      {row.above && <span className={lineClass('above', row.above)} />}
      {row.below && <span className={lineClass('below', row.below)} />}
      <span className={`trip-step__dot${route ? ' trip-step__dot--route' : ''}`} />
    </span>
  )
}

function StepWords({ row }: { row: StepRow }): React.JSX.Element {
  if (row.kind === 'ride' && row.ride) {
    return (
      <span className="trip-step__words">
        <span className="trip-step__ride">
          <RouteChip ride={row.ride} />
          <RideStatus ride={row.ride} />
        </span>
        <span className="trip-step__detail">{row.detail}</span>
      </span>
    )
  }
  return (
    <span className="trip-step__words">
      <span className={`trip-step__title${row.kind === 'end' ? ' trip-step__title--end' : ''}`}>
        {row.title}
      </span>
      {row.detail && <span className="trip-step__detail">{row.detail}</span>}
    </span>
  )
}

/** The theme's card colour, which the line has to show on (the glass is no lighter on a dark theme). */
function themeCard(): string {
  return presetInfo(document.documentElement.dataset.theme as ThemePreset).colors.card
}

/** The route's colour for its line and dots, made to show on the card; none falls back to grey. */
function routeStyle(row: StepRow, ground: string): React.CSSProperties | undefined {
  const line = row.ride && routeLineColor(row.ride.color, ground)
  return line ? ({ '--trip-route': line } as React.CSSProperties) : undefined
}

/**
 * The trip spelled out (results mockup B): each step's time on the left, a line with a dot per
 * step (dotted grey for walks, the route's own colour for a ride), and what to do: walk to the
 * stop, the ride's chip and whether its time is live, where to get off, the place itself.
 */
export function TripSteps({
  plan,
  destination,
  dim = false
}: {
  plan: TripPlan
  destination: string
  /** The plan is being replaced (a new question asked) or has gone (missed). */
  dim?: boolean
}): React.JSX.Element {
  const rows = stepRows(plan, destination)
  const ground = themeCard()
  return (
    <ol
      className={`trip-steps${dim ? ' trip-steps--dim' : ''}`}
      aria-label="The trip, step by step"
    >
      {rows.map((row) => (
        // A ride and its get-off step carry the route's colour: the line between them, and
        // their dots. The walks either side stay grey.
        <li
          key={row.key}
          className={`trip-step trip-step--${row.kind}`}
          style={routeStyle(row, ground)}
        >
          <span className="trip-step__time">{clockWords.time(row.at)}</span>
          <StepDot row={row} />
          <StepWords row={row} />
        </li>
      ))}
    </ol>
  )
}
