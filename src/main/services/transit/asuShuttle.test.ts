import { describe, expect, it } from 'vitest'
import {
  shuttleDay,
  shuttleServices,
  SHUTTLE_ROUTES,
  SHUTTLE_STOPS,
  type ShuttleService
} from './asuShuttle'

/** Unix seconds for an Arizona clock time, "2026-10-19T18:46". */
const az = (local: string): number => Date.parse(`${local}:00Z`) / 1000 + 7 * 3600
const weekdayOf = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay()
const day = (date: string): ReturnType<typeof shuttleDay> => shuttleDay(date, weekdayOf(date))

const TEMPE = 'asu:tempe-forest-lemon'
const byRoute = (services: ShuttleService[]): Record<string, ShuttleService> =>
  Object.fromEntries(services.map((service) => [service.routeId, service]))

describe('which timetable runs', () => {
  it('follows ASU’s academic calendar', () => {
    expect(day('2026-10-19')).toBe('school') // a Monday in the fall semester
    expect(day('2026-10-12')).toBe('break') // fall break
    expect(day('2026-10-10')).toBe('weekend') // fall break's Saturday: still the semester
    expect(day('2026-11-26')).toBe('none') // Thanksgiving
    expect(day('2026-12-14')).toBe('school') // commencement: school days run through it
    expect(day('2026-12-21')).toBe('break') // winter break, a weekday
    expect(day('2026-12-20')).toBe('none') // winter break, a Sunday: weekend service is semesters only
    expect(day('2027-01-01')).toBe('none') // New Year's Day
    expect(day('2027-03-09')).toBe('break') // spring break
    expect(day('2027-03-13')).toBe('weekend')
    expect(day('2027-06-15')).toBe('break') // summer
    expect(day('2027-07-05')).toBe('none') // Independence Day observed
    expect(day('2028-03-01')).toBeNull() // past the calendar the app knows
  })
})

describe('the shuttles at a stop', () => {
  it('says which are running, until when, and how often, on a school evening', () => {
    const services = byRoute(shuttleServices([TEMPE], az('2026-10-19T18:46')))
    expect(services.maroon).toMatchObject({
      state: 'running',
      everyMinutes: 15,
      until: az('2026-10-19T22:30'),
      toward: 'Downtown Phoenix, West Valley'
    })
    expect(services.gold).toMatchObject({ state: 'running', toward: 'Polytechnic' })
    expect(services.mercado).toMatchObject({ state: 'running', everyMinutes: 60 })
    // The express's last left at 4:50; the next is tomorrow's first.
    expect(services.express).toMatchObject({ state: 'ended', next: az('2026-10-20T06:50') })
  })

  it('lists running routes first', () => {
    const states = shuttleServices([TEMPE], az('2026-10-19T18:46')).map((service) => service.state)
    expect(states).toEqual(['running', 'running', 'running', 'ended'])
  })

  it('says when the first one comes, before service starts', () => {
    const services = byRoute(shuttleServices([TEMPE], az('2026-10-19T05:30')))
    expect(services.maroon).toMatchObject({ state: 'later', next: az('2026-10-19T06:00') })
  })

  it('runs the weekend timetable on a semester weekend, and finds the next weekday for the rest', () => {
    const services = byRoute(shuttleServices([TEMPE], az('2026-10-17T10:00')))
    expect(services.maroon).toMatchObject({ state: 'running', everyMinutes: 120 })
    // No weekend Mercado: the next is Monday's first.
    expect(services.mercado).toMatchObject({ state: 'none', next: az('2026-10-19T06:30') })
  })

  it('runs the break timetable over a break, and skips holidays', () => {
    const fallBreak = byRoute(shuttleServices([TEMPE], az('2026-10-12T09:00')))
    expect(fallBreak.maroon).toMatchObject({ state: 'running', everyMinutes: 60 })
    expect(fallBreak.express).toMatchObject({ state: 'none', next: az('2026-10-14T06:50') })
    const thanksgiving = byRoute(shuttleServices([TEMPE], az('2026-11-26T12:00')))
    // Thursday and Friday off, then a weekend in the semester: Saturday's weekend timetable.
    expect(thanksgiving.maroon).toMatchObject({ state: 'none', next: az('2026-11-28T09:00') })
  })

  it('knows each stop’s own hours, and leaves out stops that aren’t shuttle stops', () => {
    const services = shuttleServices(['asu:poly-sim', 'valley-metro:123'], az('2026-10-19T22:35'))
    expect(services).toHaveLength(1)
    // SIM's last is 10:30, so at 10:35 it's over for the day.
    expect(services[0]).toMatchObject({
      routeId: 'gold',
      state: 'ended',
      next: az('2026-10-20T06:00')
    })
  })

  it('says it doesn’t know, past the calendar', () => {
    expect(shuttleServices([TEMPE], az('2028-03-01T12:00'))[0]?.state).toBe('unknown')
  })

  it('has every route’s stops among the shuttle stops', () => {
    const ids = new Set(SHUTTLE_STOPS.map((stop) => stop.id))
    for (const route of SHUTTLE_ROUTES) {
      for (const table of Object.values(route.timetables)) {
        for (const [stopId, first, last] of table.stops) {
          expect(ids.has(stopId)).toBe(true)
          expect(first < last).toBe(true)
        }
      }
    }
  })
})
