// ASU's intercampus shuttles from their published timetables, until ASU shares live data. ASU
// gives each route's frequency and each stop's first and last times (cfo.asu.edu/shuttles,
// read 2026-10-19), not exact departures, so this says "every ~15 min until 10:30 PM", never
// "next at 7:15". Which timetable runs on a day comes from ASU's academic calendar.
// Keep this file free of imports: the renderer may use it too.

/** What runs on a day: the school-day timetable, the weekend one, the break one, or none. */
export type ShuttleDay = 'school' | 'weekend' | 'break' | 'none'

export type ShuttleCampus = 'Tempe' | 'Downtown Phoenix' | 'West Valley' | 'Polytechnic'

export interface ShuttleStop {
  /** "asu:tempe-forest-lemon": apart from Valley Metro's stop ids. */
  id: string
  /** "Forest Ave & Lemon St" */
  name: string
  campus: ShuttleCampus
}

export const SHUTTLE_STOPS: readonly ShuttleStop[] = [
  { id: 'asu:tempe-forest-lemon', name: 'Forest Ave & Lemon St', campus: 'Tempe' },
  {
    id: 'asu:tempe-light-rail',
    name: 'Light Rail Station, Rural Rd & University Dr',
    campus: 'Tempe'
  },
  {
    id: 'asu:downtown-central-polk',
    name: 'Central Ave, north of Polk St',
    campus: 'Downtown Phoenix'
  },
  { id: 'asu:downtown-mercado', name: 'Fifth St at Mercado', campus: 'Downtown Phoenix' },
  { id: 'asu:west-university-way', name: 'University Way North', campus: 'West Valley' },
  { id: 'asu:poly-sim', name: 'SIM Building', campus: 'Polytechnic' },
  { id: 'asu:poly-lot-37', name: 'Lot 37, Innovation Way South', campus: 'Polytechnic' }
]

/** One stop's service on one timetable: its first and last time there ("HH:MM", Arizona time). */
type StopHours = [stopId: string, first: string, last: string]

interface Timetable {
  /** "Departs approximately every 15 minutes." */
  everyMinutes: number
  stops: StopHours[]
}

export interface ShuttleRoute {
  id: 'maroon' | 'gold' | 'mercado' | 'express'
  /** "Maroon": ASU's own name for it, as riders say it. */
  name: string
  /** "Tempe–Downtown Phoenix–West Valley" */
  long: string
  campuses: ShuttleCampus[]
  timetables: Partial<Record<Exclude<ShuttleDay, 'none'>, Timetable>>
}

const TEMPE = 'asu:tempe-forest-lemon'
const LIGHT_RAIL = 'asu:tempe-light-rail'
const CENTRAL = 'asu:downtown-central-polk'
const MERCADO = 'asu:downtown-mercado'
const WEST = 'asu:west-university-way'
const SIM = 'asu:poly-sim'
const LOT_37 = 'asu:poly-lot-37'

export const SHUTTLE_ROUTES: readonly ShuttleRoute[] = [
  {
    id: 'maroon',
    name: 'Maroon',
    long: 'Tempe–Downtown Phoenix–West Valley',
    campuses: ['Tempe', 'Downtown Phoenix', 'West Valley'],
    timetables: {
      school: {
        everyMinutes: 15,
        stops: [
          [WEST, '06:00', '22:30'],
          [CENTRAL, '06:30', '23:00'],
          [TEMPE, '06:00', '22:30']
        ]
      },
      weekend: {
        everyMinutes: 120,
        stops: [
          [WEST, '08:00', '18:00'],
          [CENTRAL, '08:30', '19:30'],
          [TEMPE, '09:00', '19:00']
        ]
      },
      break: {
        everyMinutes: 60,
        stops: [
          [WEST, '06:00', '17:10'],
          [CENTRAL, '06:30', '17:30'],
          [TEMPE, '06:00', '17:10']
        ]
      }
    }
  },
  {
    id: 'gold',
    name: 'Gold',
    long: 'Polytechnic–Tempe',
    campuses: ['Tempe', 'Polytechnic'],
    timetables: {
      school: {
        everyMinutes: 15,
        stops: [
          [TEMPE, '06:00', '22:30'],
          [LIGHT_RAIL, '06:10', '22:40'],
          [SIM, '06:00', '22:30'],
          [LOT_37, '06:10', '22:40']
        ]
      },
      weekend: {
        everyMinutes: 120,
        stops: [
          [TEMPE, '09:00', '19:00'],
          [LIGHT_RAIL, '09:10', '19:10'],
          [SIM, '08:00', '18:00'],
          [LOT_37, '08:10', '18:10']
        ]
      },
      break: {
        everyMinutes: 60,
        stops: [
          [TEMPE, '06:00', '17:10'],
          [LIGHT_RAIL, '06:10', '17:10'],
          [SIM, '06:00', '17:00'],
          [LOT_37, '06:10', '17:10']
        ]
      }
    }
  },
  {
    id: 'mercado',
    name: 'Mercado',
    long: 'Tempe–Downtown Phoenix (Mercado)',
    campuses: ['Tempe', 'Downtown Phoenix'],
    // School weekdays only: no weekend or break service (the Maroon route stops at Mercado then).
    timetables: {
      school: {
        everyMinutes: 60,
        stops: [
          [TEMPE, '06:30', '19:35'],
          [MERCADO, '07:00', '20:08'],
          [CENTRAL, '07:04', '20:04']
        ]
      }
    }
  },
  {
    id: 'express',
    name: 'Tempe–West Express',
    long: 'Tempe–West Valley Express',
    campuses: ['Tempe', 'West Valley'],
    timetables: {
      school: {
        everyMinutes: 60,
        stops: [
          [WEST, '06:50', '16:50'],
          [TEMPE, '06:50', '16:50']
        ]
      }
    }
  }
]

/**
 * ASU's academic calendar as the shuttles follow it (registrar.asu.edu/academic-calendar, read
 * 2026-10-19): school-day service from the first day of classes through commencement, the
 * break timetable on weekdays of class breaks inside a semester and between semesters, weekend
 * service only within a semester, and none on university holidays.
 */
interface Semester {
  first: string
  /** Commencement. */
  last: string
  /** Class breaks' weekdays (university open, break timetable). */
  breaks: [from: string, to: string][]
}

const SEMESTERS: readonly Semester[] = [
  // Fall 2026: classes from Aug 20, fall break Oct 10–13, commencement Dec 14.
  { first: '2026-08-20', last: '2026-12-14', breaks: [['2026-10-12', '2026-10-13']] },
  // Spring 2027: classes from Jan 11, spring break Mar 7–14, commencement May 10.
  { first: '2027-01-11', last: '2027-05-10', breaks: [['2027-03-08', '2027-03-12']] },
  // Fall 2027: classes from Aug 19, fall break Oct 9–12, commencement Dec 13.
  { first: '2027-08-19', last: '2027-12-13', breaks: [['2027-10-11', '2027-10-12']] }
]

/** University-observed holidays (university closed): no shuttles. */
const HOLIDAYS: ReadonlySet<string> = new Set([
  '2026-09-07', // Labor Day
  '2026-11-11', // Veterans Day
  '2026-11-26',
  '2026-11-27', // Thanksgiving
  '2026-12-24',
  '2026-12-25', // Holiday break
  '2027-01-01', // New Year's Day
  '2027-01-18', // Martin Luther King Jr. Day
  '2027-05-31', // Memorial Day
  '2027-07-05', // Independence Day observed
  '2027-09-06', // Labor Day
  '2027-11-11', // Veterans Day
  '2027-11-25',
  '2027-11-26', // Thanksgiving
  '2027-12-24',
  '2027-12-27' // Holiday break
])

/** The calendar above covers these days; past them, the app doesn't know (ASU publishes ahead). */
const KNOWN_FROM = '2026-08-01'
const KNOWN_TO = '2027-12-31'

/** Arizona doesn't change its clocks: always UTC−7. */
const ARIZONA_OFFSET_SEC = 7 * 3600

/** A day in Arizona: its date ("2026-10-19"), weekday (0 Sunday) and midnight (Unix seconds). */
interface ArizonaDay {
  date: string
  weekday: number
  midnight: number
}

function arizonaDay(unixSec: number): ArizonaDay {
  const local = new Date((unixSec - ARIZONA_OFFSET_SEC) * 1000)
  const date = local.toISOString().slice(0, 10)
  return {
    date,
    weekday: local.getUTCDay(),
    midnight: Date.parse(`${date}T00:00:00Z`) / 1000 + ARIZONA_OFFSET_SEC
  }
}

/** Which timetable runs on an Arizona date; null outside the calendar the app knows. */
export function shuttleDay(date: string, weekday: number): ShuttleDay | null {
  if (date < KNOWN_FROM || date > KNOWN_TO) return null
  if (HOLIDAYS.has(date)) return 'none'
  const semester = SEMESTERS.find((term) => term.first <= date && date <= term.last)
  if (weekday === 0 || weekday === 6) return semester ? 'weekend' : 'none'
  if (!semester) return 'break'
  return semester.breaks.some(([from, to]) => from <= date && date <= to) ? 'break' : 'school'
}

const minutesOf = (clock: string): number => {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number)
  return hours * 60 + minutes
}

/** One route at one picked stop, now. Times are Unix seconds; the screen formats them. */
export interface ShuttleService {
  stopId: string
  routeId: ShuttleRoute['id']
  /** "Maroon" */
  route: string
  /** The campuses it goes on to from here: "Downtown Phoenix, West Valley". */
  toward: string
  /**
   * running: shuttles leave about every `everyMinutes` until `until`.
   * later: today's first is at `next`. ended or none: the next service day's first is at
   * `next` (null when it isn't within the calendar). unknown: the day is past the calendar.
   */
  state: 'running' | 'later' | 'ended' | 'none' | 'unknown'
  everyMinutes: number | null
  until: number | null
  next: number | null
}

/** A route's hours at a stop on a day; null when it doesn't run there then. */
function hoursOn(route: ShuttleRoute, stopId: string, day: ShuttleDay | null): StopHours | null {
  if (!day || day === 'none') return null
  return route.timetables[day]?.stops.find(([id]) => id === stopId) ?? null
}

/** The first shuttle after today, within three weeks: no gap in ASU's calendar is longer. */
function nextServiceDay(route: ShuttleRoute, stopId: string, from: ArizonaDay): number | null {
  for (let ahead = 1; ahead <= 21; ahead++) {
    const day = arizonaDay(from.midnight + ahead * 86400 + 3600)
    const hours = hoursOn(route, stopId, shuttleDay(day.date, day.weekday))
    if (hours) return day.midnight + minutesOf(hours[1]) * 60
  }
  return null
}

/**
 * Every route at the picked shuttle stops, now: running ones first, then by when the next one
 * comes. Stops that aren't ASU shuttle stops are left out.
 */
export function shuttleServices(stopIds: readonly string[], nowSec: number): ShuttleService[] {
  const today = arizonaDay(nowSec)
  const day = shuttleDay(today.date, today.weekday)
  const services: ShuttleService[] = []
  for (const stopId of stopIds) {
    const stop = SHUTTLE_STOPS.find((candidate) => candidate.id === stopId)
    if (!stop) continue
    for (const route of SHUTTLE_ROUTES) {
      const servesStop = Object.values(route.timetables).some((table) =>
        table.stops.some(([id]) => id === stopId)
      )
      if (!servesStop) continue
      const base = {
        stopId,
        routeId: route.id,
        route: route.name,
        toward: route.campuses.filter((campus) => campus !== stop.campus).join(', ')
      }
      if (day === null) {
        services.push({ ...base, state: 'unknown', everyMinutes: null, until: null, next: null })
        continue
      }
      const hours = hoursOn(route, stopId, day)
      const timetable = day === 'none' ? undefined : route.timetables[day]
      if (!hours || !timetable) {
        const next = nextServiceDay(route, stopId, today)
        services.push({ ...base, state: 'none', everyMinutes: null, until: null, next })
        continue
      }
      const first = today.midnight + minutesOf(hours[1]) * 60
      const last = today.midnight + minutesOf(hours[2]) * 60
      const every = timetable.everyMinutes
      if (nowSec < first) {
        services.push({ ...base, state: 'later', everyMinutes: every, until: last, next: first })
      } else if (nowSec <= last) {
        services.push({ ...base, state: 'running', everyMinutes: every, until: last, next: null })
      } else {
        const next = nextServiceDay(route, stopId, today)
        services.push({ ...base, state: 'ended', everyMinutes: null, until: null, next })
      }
    }
  }
  const order: Record<ShuttleService['state'], number> = {
    running: 0,
    later: 1,
    ended: 2,
    none: 2,
    unknown: 3
  }
  return services.sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      (a.next ?? Infinity) - (b.next ?? Infinity) ||
      (a.everyMinutes ?? Infinity) - (b.everyMinutes ?? Infinity)
  )
}
