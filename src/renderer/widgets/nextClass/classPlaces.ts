import type { ClassPlaceInfo } from '../../../main/ipc'
import { PIN_DROP, PIN_DROP_TIMING, PULSE, PULSE_TIMING } from '../peek/pinMotion'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

export type ShownPlace = Extract<ClassPlaceInfo, { kind: 'building' | 'unknown' }>

/** A building (or a room ASU's list doesn't know) has a card to show; online classes don't. */
export function shownPlace(place: ClassPlaceInfo | null): ShownPlace | null {
  return place?.kind === 'building' || place?.kind === 'unknown' ? place : null
}

/** Where each location says its class meets (null: online, or nowhere to show), from main. */
export async function askPlaces(
  locations: readonly string[]
): Promise<Map<string, ShownPlace | null>> {
  const distinct = [...new Set(locations.filter(Boolean))]
  const pairs = await Promise.all(
    distinct.map(async (location) => {
      const place = shownPlace(await window.focusScreen.getClassPlace(location))
      return [location, place] as const
    })
  )
  return new Map(pairs)
}

/** The card's name for screen readers. */
export function placeLabel(place: ShownPlace, heading: string): string {
  return place.kind === 'building' ? `Where ${heading} is: ${place.name}` : `Where ${heading} is`
}

/** The pin drops onto the building and the spot pulses once; the returned stop ends the pulse. */
export function dropPin(
  pin: HTMLElement | null,
  pulse: HTMLElement | null
): (() => void) | undefined {
  if (reducedMotion.matches) return
  pin?.animate(PIN_DROP, PIN_DROP_TIMING)
  const animation = pulse?.animate(PULSE, PULSE_TIMING)
  return () => animation?.cancel()
}
