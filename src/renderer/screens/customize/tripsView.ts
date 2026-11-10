import { ARRIVE_EARLY_LIMITS } from '../../../main/services/settings/schema'
import type { TripState } from '../../../main/ipc'

/** A saved place's name, as long as the card's rows can hold. */
export const PLACE_NAME_MAX = 60

/** The stepper's value kept whole and inside 0–30 minutes. */
export function clampEarly(min: number): number {
  const { min: low, max } = ARRIVE_EARLY_LIMITS
  if (!Number.isFinite(min)) return low
  return Math.min(Math.max(Math.round(min), low), max)
}

/** "5 min early", "Right on time" at 0. */
export function earlyWords(min: number): string {
  return min === 0 ? 'Right on time' : `${min} min early`
}

/** A renamed place's name: trimmed and cut to length; null when there's nothing to save. */
export function cleanName(raw: string): string | null {
  const name = raw.trim().slice(0, PLACE_NAME_MAX).trim()
  return name === '' ? null : name
}

/** The schedule's row: what it says, and whether the download is offered. */
export function scheduleWords(schedule: TripState['schedule']): {
  text: string
  download: 'offer' | 'busy' | 'none'
} {
  switch (schedule) {
    case 'ready':
      return { text: 'Downloaded', download: 'none' }
    case 'downloading':
      return { text: 'Downloading… this takes a minute.', download: 'busy' }
    case 'missing':
      return { text: 'Not downloaded yet', download: 'offer' }
  }
}

/**
 * Where Location stands, in plain words, for the line under the switch: what the location found
 * while something holds it, else macOS's last word on it (a prompt refused from this switch is
 * answered after the location's let go again).
 */
export function locationWords(
  supported: boolean,
  here: TripState['here'],
  access: TripState['locationAccess']
): { text: string; settings: boolean } | null {
  if (!supported) {
    return {
      text: 'Planning from where you are needs macOS’s Location; pick a start instead.',
      settings: false
    }
  }
  const off = here ? here.status === 'servicesOff' : access === 'off'
  const refused = here ? here.status === 'denied' : access === 'denied' || access === 'restricted'
  if (refused) return { text: 'Location is off for Focus Screen on this Mac.', settings: true }
  if (off) return { text: 'Location Services is off on this Mac.', settings: true }
  return null
}
