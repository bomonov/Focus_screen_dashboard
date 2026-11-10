// Home's row on the trip card, before anything's typed: when to leave for Home and how, from the
// best of a plan main makes in the background (the design's call 9, the "When it opens" panel).
import type { HomePreview, TripPlan, TripRide } from './types'

/** "72" for a numbered route, else its name ("Orbit Venus"): what its chip says on the card. */
function chipName(ride: TripRide): string {
  return /^\d/.test(ride.short) ? ride.short : ride.routeName || ride.short
}

/** The best trip's leaving, arrival and first ride ("walk" when it's only a walk); null for none. */
export function homePreviewOf(plans: readonly TripPlan[] | null): HomePreview | null {
  const best = plans?.[0]
  if (!best) return null
  const ride = best.steps.find((step): step is TripRide => step.kind === 'ride')
  return { leave: best.leave, arrive: best.arrive, first: ride ? chipName(ride) : 'walk' }
}
