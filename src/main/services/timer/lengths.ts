// Timer lengths as people set and read them: quick picks, hours/minutes/seconds, labels.
// Keep this file free of imports: the renderer compiles it too.

/** The longest length that can be set: 23:59:59. */
export const MAX_LENGTH_SEC = 23 * 3600 + 59 * 60 + 59

/** The lengths that used to be the only choices, kept as quick picks beside the wheels. */
export const FOCUS_PICKS: readonly number[] = [25 * 60, 45 * 60, 50 * 60]
export const BREAK_PICKS: readonly number[] = [5 * 60, 10 * 60, 15 * 60]
export const COUNTDOWN_PICKS: readonly number[] = [5 * 60, 10 * 60, 15 * 60, 30 * 60, 60 * 60]

export interface LengthParts {
  hours: number
  minutes: number
  seconds: number
}

export function splitLength(totalSec: number): LengthParts {
  const whole = Math.max(0, Math.floor(totalSec))
  return {
    hours: Math.floor(whole / 3600),
    minutes: Math.floor((whole % 3600) / 60),
    seconds: whole % 60
  }
}

export function joinLength({ hours, minutes, seconds }: LengthParts): number {
  return hours * 3600 + minutes * 60 + seconds
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** As the face writes it: "1:05:30", "25:00", "0:05". */
export function clockLabel(totalSec: number): string {
  const { hours, minutes, seconds } = splitLength(totalSec)
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/** A quick pick's label: "25 min", "1 hour"; a length that isn't whole minutes as the clock. */
export function pickLabel(totalSec: number): string {
  if (totalSec > 0 && totalSec % 3600 === 0) {
    const hours = totalSec / 3600
    return hours === 1 ? '1 hour' : `${hours} hours`
  }
  if (totalSec < 3600 && totalSec % 60 === 0) return `${totalSec / 60} min`
  return clockLabel(totalSec)
}

const unit = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** In words, for screen readers: "1 hour 5 minutes 30 seconds", "25 minutes". */
export function spokenLength(totalSec: number): string {
  const { hours, minutes, seconds } = splitLength(totalSec)
  const parts = [
    hours > 0 ? unit(hours, 'hour') : '',
    minutes > 0 ? unit(minutes, 'minute') : '',
    seconds > 0 ? unit(seconds, 'second') : ''
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : '0 seconds'
}
