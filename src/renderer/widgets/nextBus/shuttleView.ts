import type { ShuttleService, TransitState } from '../../../main/ipc'
import { timeFormat } from '../clockFormat'

export interface ShuttleView {
  /** The route to show: running ones first, then the soonest to start. */
  service: ShuttleService
  /** Other routes running at the picked stops right now. */
  more: number
}

/** The Shuttle pill: null when no ASU shuttle stop is picked. */
export function shuttleView(state: TransitState | null): ShuttleView | null {
  const [service, ...rest] = state?.shuttles ?? []
  if (!service) return null
  return { service, more: rest.filter((other) => other.state === 'running').length }
}

const timeAt = (sec: number): string => timeFormat.format(new Date(sec * 1000))

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "tomorrow", or the weekday for a day further off: "Tue". */
function dayName(sec: number, now: Date): string {
  const day = new Date(sec * 1000)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (dayStart(day) === dayStart(tomorrow)) return 'tomorrow'
  return day.toLocaleDateString(undefined, { weekday: 'short' })
}

/**
 * What ASU's timetable says, never more: it gives how often and first and last times, not
 * departures. ["every ~15 min", "until 10:30 PM"], ["first at 6:00 AM"], ["next Tue 6:50 AM"].
 * The pill shows each as a part, so a short top bar can let the later ones go first.
 */
export function shuttleParts(service: ShuttleService, now: Date): string[] {
  switch (service.state) {
    case 'running':
      return [
        service.everyMinutes !== null ? `every ~${service.everyMinutes} min` : null,
        service.until !== null ? `until ${timeAt(service.until)}` : null
      ].filter((part) => part !== null)
    case 'later':
      return [service.next !== null ? `first at ${timeAt(service.next)}` : 'later today']
    case 'ended':
    case 'none':
      return [
        service.next !== null
          ? `next ${dayName(service.next, now)} ${timeAt(service.next)}`
          : 'no service for now'
      ]
    case 'unknown':
      return ['see ASU’s shuttle schedule']
  }
}

/** The same in one line, for the hover text: "every ~15 min · until 10:30 PM". */
export function shuttleWhen(service: ShuttleService, now: Date): string {
  return shuttleParts(service, now).join(' · ')
}
