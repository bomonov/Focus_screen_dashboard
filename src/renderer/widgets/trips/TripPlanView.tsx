import { useLayoutEffect, useRef } from 'react'
import type { Place, TripPlan, TripState, TripWhen } from '../../../main/ipc'
import { CloseIcon } from '../icons'
import { PlaceIcon, WalkIcon } from './TripIcons'
import {
  arrivalWords,
  otherLabel,
  otherLegs,
  otherWords,
  planKey,
  planLeave,
  shownIndex,
  walkFromNow
} from './tripCardView'
import { RouteChip, TripSteps } from './TripSteps'
import { countdownParts } from './tripView'

/** The place as a trip's last step and its arrival name it: "Home", "Trader Joe’s". */
const placeName = (place: Place): string => (place.kind === 'home' ? 'Home' : place.name)

/** An other way on one line: its first walk and its rides' chips, then when to leave and arrive. */
function OtherWay({
  to,
  plan,
  now,
  button,
  disabled,
  onShow
}: {
  to: Place
  plan: TripPlan
  now: number
  button?: React.Ref<HTMLButtonElement>
  /** A new answer is on its way: what's swapped in now may not be in it. */
  disabled: boolean
  onShow(): void
}): React.JSX.Element {
  const { walkMin, rides } = otherLegs(plan)
  return (
    <li>
      <button
        ref={button}
        type="button"
        className="trip-other"
        aria-label={otherLabel(to, plan, now)}
        title="Show this way"
        disabled={disabled}
        onClick={onShow}
      >
        <span className="trip-other__legs" aria-hidden="true">
          {rides.length === 0 ? (
            <span className="trip-other__walk">
              <WalkIcon className="trip-other__walk-icon" />
              walk
            </span>
          ) : (
            <>
              {walkMin !== null && (
                <>
                  <span className="trip-other__walk">
                    <WalkIcon className="trip-other__walk-icon" />
                    {walkMin}
                  </span>
                  <span className="trip-other__then">›</span>
                </>
              )}
              {rides.map((ride, index) => (
                <span key={`${ride.tripId}:${index}`} className="trip-other__ride">
                  {index > 0 && <span className="trip-other__then">›</span>}
                  <RouteChip ride={ride} />
                </span>
              ))}
            </>
          )}
        </span>
        <span className="trip-other__when" aria-hidden="true">
          {otherWords(to, plan, now)}
        </span>
      </button>
    </li>
  )
}

interface PlanViewProps {
  to: Place
  /** When main asked for these: a walk timed to arrive by a time isn't moved to now. */
  asked: TripWhen
  plans: TripPlan[]
  /** The plan swapped in by the user (its key), or null for the best. */
  shownKey: string | null
  /** Unix seconds. */
  now: number
  /** A new question's being asked: these are the last answer's, dimmed until it's in. */
  planning: boolean
  /** The shown plan is the one kept on screen already. */
  keptKey: string | null
  onShow(key: string): void
  onKeep(index: number): void
}

/**
 * The best trip spelled out (results mockup B, the user's pick): "Leave in 6 min" large in the
 * accent with the arrival beside it, the steps, then the two other ways a line each (a click
 * swaps one in) and "Keep on screen".
 */
export function PlanView({
  to,
  asked,
  plans: given,
  shownKey,
  now,
  planning,
  keptKey,
  onShow,
  onKeep
}: PlanViewProps): React.JSX.Element | null {
  // In main's order, so an index here is the one `keep` names.
  const plans = given.map((plan) => walkFromNow(plan, now, asked))
  const index = shownIndex(plans, shownKey)
  const plan = plans[index]
  const firstOther = useRef<HTMLButtonElement>(null)
  const swapped = useRef(false)
  // A swapped-in way's button is gone from the list: the keys go to the ways left to pick.
  useLayoutEffect(() => {
    if (!swapped.current) return
    swapped.current = false
    firstOther.current?.focus({ preventScroll: true })
  })
  if (!plan) return null
  const leave = planLeave(plan, now)
  const others = plans.filter((_, at) => at !== index)
  const key = planKey(plan)
  const kept = keptKey === key
  return (
    <div className={`trip-plan${planning ? ' trip-plan--planning' : ''}`} aria-busy={planning}>
      <div className="trip-plan__head">
        <p className={`trip-plan__leave${leave.stale ? ' trip-plan__leave--stale' : ''}`}>
          {leave.words}
        </p>
        <p className="trip-plan__arrive">{arrivalWords(to, plan, now)}</p>
      </div>
      <TripSteps plan={plan} destination={placeName(to)} />
      {others.length > 0 && (
        <ul className="trip-others" aria-label="Other ways">
          {others.map((other, at) => (
            <OtherWay
              key={planKey(other)}
              to={to}
              plan={other}
              now={now}
              button={at === 0 ? firstOther : undefined}
              disabled={planning}
              onShow={() => {
                swapped.current = true
                onShow(planKey(other))
              }}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        className="peek-card__button trip-keep"
        // Kept already; or a new answer's on its way, and the index may not be this plan's in it.
        disabled={kept || planning}
        onClick={() => onKeep(index)}
      >
        {kept ? 'On screen' : 'Keep on screen'}
      </button>
    </div>
  )
}

/**
 * The kept trip, from its countdown: where it's going (with an × that takes it off the screen),
 * the countdown's own words, and its steps. A missed trip with no next way yet shows its old
 * steps dimmed.
 */
export function KeptView({
  kept,
  now,
  onUnkeep
}: {
  kept: NonNullable<TripState['kept']>
  now: number
  onUnkeep(): void
}): React.JSX.Element | null {
  const parts = countdownParts(kept, now)
  if (!parts) return null
  const gone = kept.missed && !kept.nextWay
  return (
    <div className="trip-plan trip-plan--kept">
      <div className="trip-kept__top">
        <PlaceIcon kind={kept.to.kind} className="trip-kept__icon" />
        <span className="trip-kept__to">On screen: to {placeName(kept.to)}</span>
        <button
          type="button"
          className="trip-kept__close"
          aria-label="Take this trip off the screen"
          title="Take this trip off the screen"
          onClick={onUnkeep}
        >
          <CloseIcon />
        </button>
      </div>
      <div className="trip-plan__head">
        <p className={`trip-plan__leave${kept.missed ? ' trip-plan__leave--stale' : ''}`}>
          {parts.lead}
          {parts.tail && kept.missed && <span className="trip-plan__next"> · {parts.tail}</span>}
        </p>
        {!gone && <p className="trip-plan__arrive">{arrivalWords(kept.to, kept.plan, now)}</p>}
      </div>
      <TripSteps plan={kept.plan} destination={placeName(kept.to)} dim={gone} />
    </div>
  )
}
