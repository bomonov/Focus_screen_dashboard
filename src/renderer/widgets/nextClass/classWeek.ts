import type { ClassEvent } from '../../../main/ipc'
import { dayLabel, localDay } from './nextClassView'

/** One class in the week's list. */
export interface ClassWeekRow {
  event: ClassEvent
  /** Over already today: dimmed, kept so the day reads whole. */
  past: boolean
  /** The class the pill shows. */
  lit: boolean
}

/** A day that has classes, under its own heading. */
export interface ClassWeekDay {
  /** Local midnight, epoch ms: a key for the day. */
  day: number
  /** "Today", "Tomorrow", "Thu", "Next Tue": the pill's own words for days. */
  name: string
  /** "Tue, Oct 27" after Today and Tomorrow; "Oct 29" after a weekday, which says it already. */
  date: string
  rows: ClassWeekRow[]
}

const DAY_MS = 24 * 3600 * 1000

/**
 * The classes from today through a week on (what the app reads), by the day they start, for
 * the list a double-click drops from the Next class pill. `events` come sorted by start;
 * days without classes are left out. `lit` is the id of the class on the pill.
 */
export function classWeek(
  events: readonly ClassEvent[],
  now: Date,
  lit: string | null
): ClassWeekDay[] {
  const nowSec = now.getTime() / 1000
  const today = localDay(now)
  const days: ClassWeekDay[] = []
  for (const event of events) {
    const start = new Date(event.start * 1000)
    const day = localDay(start)
    let group = days[days.length - 1]
    if (group?.day !== day) {
      // Rounded: a day a clock change makes 23 or 25 h long is still one day.
      const isToday = Math.round((day - today) / DAY_MS) === 0
      const name = isToday ? 'Today' : dayLabel(start, now)
      const named = isToday || name === 'Tomorrow'
      group = {
        day,
        name,
        date: start.toLocaleDateString(undefined, {
          ...(named ? { weekday: 'short' } : {}),
          month: 'short',
          day: 'numeric'
        }),
        rows: []
      }
      days.push(group)
    }
    group.rows.push({ event, past: event.end <= nowSec, lit: event.id === lit })
  }
  return days
}

/** "75 min" (timetables count classes in minutes), "2 h 50 min" for a long lab. */
export function classLength(minutes: number): string {
  if (minutes < 120) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}
