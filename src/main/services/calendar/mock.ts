// Dev builds only: a made-up week of classes, so the top bar can be worked on without a
// calendar (or on Windows, which has no EventKit). Never shipped to users.
import type { CalendarInfo, ClassEvent } from './types'

const CLASSES = 'demo:classes'

export function demoCalendars(): CalendarInfo[] {
  return [
    { id: CLASSES, title: 'Classes', source: 'Demo', color: '#FFC627' },
    { id: 'demo:personal', title: 'Personal', source: 'Demo', color: '#00A3E0' }
  ]
}

/** [title, room, start hour, start minute, minutes long] for each day. */
// Rooms written the way ASU's class schedule writes them, in real Tempe buildings, so the
// Next class map can be worked on too.
const DAY: readonly (readonly [string, string, number, number, number])[] = [
  ['BIO 181', 'Tempe - LSE104', 9, 0, 75],
  ['CHM 113', 'Tempe - PSH151', 10, 30, 75],
  ['MAT 265', 'Tempe - ECGG237', 13, 30, 50],
  ['ENG 101', 'Tempe - COOR195', 15, 0, 75]
]

/** The days the app reads (eventWindow): today and the week after it. */
const DAYS_AHEAD = 7

/**
 * Classes on every weekday from today through a week on, around `now`. None at the weekend,
 * so a Friday evening's swipe has a gap to cross, the way a real timetable does.
 */
export function demoEvents(now: Date): ClassEvent[] {
  const events: ClassEvent[] = []
  for (let dayOffset = 0; dayOffset <= DAYS_AHEAD; dayOffset++) {
    const weekday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset).getDay()
    if (weekday === 0 || weekday === 6) continue
    for (const [title, location, hour, minute, minutes] of DAY) {
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + dayOffset,
        hour,
        minute
      )
      const startSec = start.getTime() / 1000
      events.push({
        id: `${CLASSES}:${title}:${startSec}`,
        calendar: CLASSES,
        title,
        location,
        start: startSec,
        end: startSec + minutes * 60
      })
    }
  }
  return events
}
