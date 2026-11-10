import { describe, expect, it } from 'vitest'
import type { BusArrival, TransitState } from '../../../main/ipc'
import {
  busIn,
  keyStop,
  mergeOrder,
  minutesUntil,
  nextBusView,
  pageKey,
  STALE_SEC,
  viewChanges,
  type BusPage,
  type NextBusView
} from './nextBusView'

const NOW = 1_792_460_000

const firstPage = (view: NextBusView | null): BusPage | null =>
  view?.kind === 'bus' ? view.pages[0] : null

function arrival(id: string, routeId: string, at: number, stopId = 'A'): BusArrival {
  return {
    id,
    routeId,
    route: routeId === 'VENU' ? 'Orbit Venus' : `Route ${routeId}`,
    headsign: '',
    stopId,
    at,
    hasRoute: false
  }
}

function state(change: Partial<TransitState> = {}): TransitState {
  return {
    schedule: { stops: 8021, downloadedAt: NOW - 86_400 },
    downloading: false,
    scheduleProblem: null,
    stops: [
      {
        id: 'A',
        name: '5th St & Myrtle Av',
        detail: '',
        code: '12654',
        source: 'valleyMetro',
        serves: []
      }
    ],
    routes: [],
    arrivals: [],
    shuttles: [],
    updatedAt: NOW - 20,
    liveProblem: null,
    horizonMinutes: 30,
    demo: false,
    ...change
  }
}

describe('nextBusView', () => {
  it('asks for a stop, and leaves shuttle-only picks to the Shuttle pill', () => {
    expect(nextBusView(state({ schedule: null, stops: [] }), NOW)).toEqual({
      kind: 'setup',
      text: 'Pick a bus stop in Customize'
    })
    expect(nextBusView(state({ schedule: null, stops: [], downloading: true }), NOW)).toBeNull()
    const shuttleStop = {
      id: 'asu:poly-sim',
      name: 'SIM Building',
      detail: 'ASU Shuttle · Polytechnic campus',
      code: '',
      source: 'asuShuttle' as const,
      serves: []
    }
    expect(nextBusView(state({ schedule: null, stops: [shuttleStop] }), NOW)).toBeNull()
  })

  it('shows the soonest bus and its route’s next one, counted down from the last read', () => {
    const arrivals = [
      arrival('1', 'VENU', NOW + 250),
      arrival('2', '66', NOW + 400),
      arrival('3', 'VENU', NOW + 400, 'B'),
      arrival('4', 'VENU', NOW + 1150)
    ]
    expect(firstPage(nextBusView(state({ arrivals }), NOW))).toEqual({
      arrival: arrivals[0],
      minutes: 4,
      then: 19
    })
    // Two minutes on, between reads.
    expect(firstPage(nextBusView(state({ arrivals }), NOW + 120))).toMatchObject({
      minutes: 2,
      then: 17
    })
  })

  it('has a page for every route at every stop, soonest first, for the swipe', () => {
    const venus = arrival('1', 'VENU', NOW + 250)
    const route66 = arrival('2', '66', NOW + 400)
    const venusAcross = arrival('3', 'VENU', NOW + 400, 'B')
    const venusLater = arrival('4', 'VENU', NOW + 1150)
    const arrivals = [venus, route66, venusAcross, venusLater, arrival('5', '66', NOW + 1500)]
    const view = nextBusView(state({ arrivals }), NOW)
    expect(view?.kind === 'bus' && view.pages).toEqual([
      { arrival: venus, minutes: 4, then: 19 },
      { arrival: route66, minutes: 6, then: 25 },
      { arrival: venusAcross, minutes: 6, then: null }
    ])
    expect(pageKey(venusLater)).toBe(pageKey(venus))
    expect(pageKey(venusAcross)).not.toBe(pageKey(venus))
  })

  it('puts the routes in the user’s order, the rest after them soonest first', () => {
    const venus = arrival('1', 'VENU', NOW + 250)
    const route66 = arrival('2', '66', NOW + 400)
    const venusAcross = arrival('3', 'VENU', NOW + 400, 'B')
    const route72 = arrival('4', '72', NOW + 900)
    const arrivals = [venus, route66, venusAcross, route72]
    // A route with nothing coming just now ('50') is skipped, not a blank page.
    const order = [pageKey(route72), '50\nA', pageKey(venusAcross)]
    const view = nextBusView(state({ arrivals }), NOW, order)
    expect(view?.kind === 'bus' && view.pages.map((page) => page.arrival)).toEqual([
      route72,
      venusAcross,
      venus,
      route66
    ])
  })

  it('keeps a bus that just came as "Due" for a moment, then moves on', () => {
    const arrivals = [arrival('1', 'VENU', NOW), arrival('2', '66', NOW + 300)]
    expect(firstPage(nextBusView(state({ arrivals }), NOW + 20))).toMatchObject({
      minutes: 0,
      then: null
    })
    expect(firstPage(nextBusView(state({ arrivals }), NOW + 45))).toMatchObject({ minutes: 4 })
  })

  it('says when nothing is coming, or the times are too old', () => {
    expect(nextBusView(state(), NOW)).toEqual({
      kind: 'quiet',
      text: 'No bus in the next 30 min',
      retry: false
    })
    const old = state({ updatedAt: NOW - STALE_SEC - 1, arrivals: [arrival('1', '66', NOW + 60)] })
    expect(nextBusView(old, NOW)).toBeNull()
    expect(nextBusView({ ...old, liveProblem: 'down' }, NOW)).toEqual({
      kind: 'quiet',
      text: 'No live bus times',
      retry: true
    })
  })
})

describe('mergeOrder', () => {
  it('puts the shown rows in their new order, keeping the others’ places', () => {
    // A has nothing coming, so the list showed B and C, and C was dragged above B.
    expect(mergeOrder(['A', 'B', 'C'], ['C', 'B'])).toEqual(['A', 'C', 'B'])
    expect(mergeOrder(['B', 'A'], ['C', 'B'])).toEqual(['C', 'A', 'B'])
    expect(mergeOrder([], ['C', 'B'])).toEqual(['C', 'B'])
  })

  it('reads the stop out of a key', () => {
    expect(keyStop(pageKey(arrival('1', 'VENU', NOW, '12654')))).toBe('12654')
  })
})

describe('busIn and minutesUntil', () => {
  it('rounds down, so it never says later than the bus comes', () => {
    expect(minutesUntil(NOW + 299, NOW)).toBe(4)
    expect(minutesUntil(NOW - 10, NOW)).toBe(0)
    expect(busIn(0)).toBe('Due')
    expect(busIn(4)).toBe('4 min')
  })
})

describe('viewChanges', () => {
  it('lists when each coming bus’s minutes or the times’ freshness can change', () => {
    expect(viewChanges(null)).toEqual([])
    expect(viewChanges(state({ arrivals: [arrival('1', '66', NOW + 90)] }))).toEqual([
      NOW + 90,
      NOW + 120,
      NOW - 20 + STALE_SEC
    ])
  })
})
