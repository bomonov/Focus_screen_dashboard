import { describe, expect, it } from 'vitest'
import { SHUTTLE_STOPS } from './asuShuttle'
import {
  isShuttleStop,
  searchShuttleStops,
  shuttleRoutesAt,
  shuttleTransitStop
} from './shuttleStops'

const ids = (query: string): string[] => searchShuttleStops(query).map((stop) => stop.id)

describe('ASU shuttle stops in Next bus', () => {
  it('finds them by name, campus, route, or “ASU shuttle”', () => {
    expect(ids('forest lemon')).toEqual(['asu:tempe-forest-lemon'])
    expect(ids('poly')).toEqual(['asu:poly-sim', 'asu:poly-lot-37'])
    // The Mercado stop, and the stops the Mercado route calls at.
    expect(ids('mercado')).toEqual([
      'asu:tempe-forest-lemon',
      'asu:downtown-central-polk',
      'asu:downtown-mercado'
    ])
    expect(ids('asu shuttle')).toHaveLength(SHUTTLE_STOPS.length)
    expect(ids('')).toEqual([])
    expect(ids('mill university')).toEqual([])
  })

  it('shows where each route goes from the stop', () => {
    const sim = SHUTTLE_STOPS.find((stop) => stop.id === 'asu:poly-sim')
    if (!sim) throw new Error('missing')
    expect(shuttleTransitStop(sim)).toEqual({
      id: 'asu:poly-sim',
      name: 'SIM Building',
      detail: 'ASU Shuttle · Polytechnic campus',
      code: '',
      source: 'asuShuttle',
      serves: [{ route: 'Gold', headsign: 'Tempe' }]
    })
  })

  it('names its routes for the filter, apart from Valley Metro’s', () => {
    expect(shuttleRoutesAt(['asu:poly-sim', 'asu:poly-lot-37', 'not-asu'])).toEqual([
      { id: 'asu:gold', name: 'Gold', detail: 'ASU Shuttle · Polytechnic–Tempe' }
    ])
    expect(isShuttleStop('asu:poly-sim')).toBe(true)
    expect(isShuttleStop('3102')).toBe(false)
  })
})
