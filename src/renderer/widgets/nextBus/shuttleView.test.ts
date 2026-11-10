import { describe, expect, it } from 'vitest'
import type { ShuttleService, TransitState } from '../../../main/ipc'
import { shuttleView, shuttleWhen } from './shuttleView'

// A Monday evening in Arizona; the Mac running the tests may be anywhere, so times are built
// from local dates and only compared through the same formatting.
const NOW = new Date(2026, 9, 19, 18, 46)
const at = (date: Date): number => Math.floor(date.getTime() / 1000)
const time = (date: Date): string =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)

function service(change: Partial<ShuttleService>): ShuttleService {
  return {
    stopId: 'asu:tempe-forest-lemon',
    routeId: 'maroon',
    route: 'Maroon',
    toward: 'Downtown Phoenix, West Valley',
    state: 'running',
    everyMinutes: 15,
    until: at(new Date(2026, 9, 19, 22, 30)),
    next: null,
    ...change
  }
}

describe('shuttleWhen', () => {
  it('words the timetable as a timetable', () => {
    const tenThirty = new Date(2026, 9, 19, 22, 30)
    expect(shuttleWhen(service({}), NOW)).toBe(`every ~15 min · until ${time(tenThirty)}`)
    const six = new Date(2026, 9, 20, 6, 0)
    expect(shuttleWhen(service({ state: 'later', next: at(six) }), NOW)).toBe(
      `first at ${time(six)}`
    )
    expect(shuttleWhen(service({ state: 'ended', next: at(six) }), NOW)).toBe(
      `next tomorrow ${time(six)}`
    )
    const thursday = new Date(2026, 9, 22, 6, 50)
    const weekday = thursday.toLocaleDateString(undefined, { weekday: 'short' })
    expect(shuttleWhen(service({ state: 'none', next: at(thursday) }), NOW)).toBe(
      `next ${weekday} ${time(thursday)}`
    )
    expect(shuttleWhen(service({ state: 'none', next: null }), NOW)).toBe('no service for now')
    expect(shuttleWhen(service({ state: 'unknown' }), NOW)).toBe('see ASU’s shuttle schedule')
  })
})

describe('shuttleView', () => {
  it('shows the first route and counts the others running', () => {
    const shuttles = [
      service({}),
      service({ routeId: 'gold', route: 'Gold' }),
      service({ routeId: 'express', route: 'Tempe–West Express', state: 'ended' })
    ]
    const state = { shuttles } as unknown as TransitState
    expect(shuttleView(state)).toEqual({ service: shuttles[0], more: 1 })
    expect(shuttleView({ shuttles: [] } as unknown as TransitState)).toBeNull()
    expect(shuttleView(null)).toBeNull()
  })
})
