import { describe, expect, it } from 'vitest'
import { busArrivals, type ArrivalNames } from './arrivals'
import type { FeedTrip, StopTimeUpdate } from './gtfsRealtime'

const NOW = 1_792_460_000

const names: ArrivalNames = {
  route: (id) =>
    id === 'VENU'
      ? { id, name: 'Orbit Venus', detail: '' }
      : id === '72'
        ? { id, name: 'Route 72', detail: 'Scottsdale Rd/Rural Rd' }
        : null,
  headsign: (_stopId, routeId, direction) => (routeId === 'VENU' ? `to ${direction}` : ''),
  hasLine: (_stopId, routeId) => routeId === 'VENU'
}

function stop(
  stopId: string,
  at: number | null,
  extra: Partial<StopTimeUpdate> = {}
): StopTimeUpdate {
  return {
    stopSequence: null,
    stopId,
    arrival: at === null ? null : { time: at, delay: null },
    departure: null,
    relationship: 'scheduled',
    ...extra
  }
}

function trip(
  tripId: string,
  routeId: string,
  stops: StopTimeUpdate[],
  extra: Partial<FeedTrip> = {}
): FeedTrip {
  return { tripId, routeId, directionId: 0, canceled: false, vehicleId: '', stops, ...extra }
}

const options = { stops: new Set(['A']), routes: new Set<string>(), now: NOW, names }

describe('busArrivals', () => {
  it('lists the picked stop’s buses, soonest first, with their names', () => {
    const arrivals = busArrivals(
      [
        trip('t1', '72', [stop('A', NOW + 600), stop('B', NOW + 700)]),
        trip('t2', 'VENU', [stop('Z', NOW + 10), stop('A', NOW + 240)])
      ],
      options
    )
    expect(arrivals).toEqual([
      {
        id: 't2:A:1792460240',
        routeId: 'VENU',
        route: 'Orbit Venus',
        headsign: 'to 0',
        stopId: 'A',
        at: NOW + 240,
        hasRoute: true
      },
      {
        id: 't1:A:1792460600',
        routeId: '72',
        route: 'Route 72',
        headsign: '',
        stopId: 'A',
        at: NOW + 600,
        hasRoute: false
      }
    ])
  })

  it('leaves out canceled trips, skipped stops and buses already gone', () => {
    const arrivals = busArrivals(
      [
        trip('canceled', '72', [stop('A', NOW + 60)], { canceled: true }),
        trip('skipped', '72', [stop('A', NOW + 60, { relationship: 'skipped' })]),
        trip('nodata', '72', [stop('A', NOW + 60, { relationship: 'noData' })]),
        trip('gone', '72', [stop('A', NOW - 120)]),
        trip('here', '72', [stop('A', NOW - 30)]),
        trip('no time', '72', [stop('A', null)])
      ],
      options
    )
    expect(arrivals.map((arrival) => arrival.id)).toEqual([`here:A:${NOW - 30}`])
  })

  it('uses the departure when a first stop gives only that', () => {
    const arrivals = busArrivals(
      [trip('t', '72', [stop('A', null, { departure: { time: NOW + 90, delay: null } })])],
      options
    )
    expect(arrivals[0]?.at).toBe(NOW + 90)
  })

  it('keeps only the picked routes, when some are picked', () => {
    const trips = [
      trip('t1', '72', [stop('A', NOW + 60)]),
      trip('t2', 'VENU', [stop('A', NOW + 120)])
    ]
    const arrivals = busArrivals(trips, { ...options, routes: new Set(['VENU']) })
    expect(arrivals.map((arrival) => arrival.routeId)).toEqual(['VENU'])
  })

  it('counts a loop’s bus once where one trip ends and its next begins', () => {
    const arrivals = busArrivals(
      [
        trip('lap1', 'VENU', [stop('A', NOW + 300)], { vehicleId: 'bus 7' }),
        trip('lap2', 'VENU', [stop('A', NOW + 420), stop('A', NOW + 2400)], { vehicleId: 'bus 7' }),
        trip('other', 'VENU', [stop('A', NOW + 360)], { vehicleId: 'bus 9' })
      ],
      options
    )
    expect(arrivals.map((arrival) => [arrival.id.split(':')[0], arrival.at - NOW])).toEqual([
      ['other', 360],
      ['lap2', 420],
      ['lap2', 2400]
    ])
  })

  it('names a route the stop list doesn’t know by its id', () => {
    const arrivals = busArrivals([trip('t', 'NEW', [stop('A', NOW + 60)])], options)
    expect(arrivals[0]?.route).toBe('NEW')
  })
})
