import { describe, expect, it } from 'vitest'
import { distanceM, type LatLon } from '../transit/routeLine'
import { near, testTimetable } from './testTimetable'
import type { Timetable } from './types'
import { stopsNear, walkOnly, walkSeconds } from './walk'

const NOON = 1_793_620_800

/** Stop i's walkable neighbours as [id, metres], for reading `transfers` in a test. */
function neighbours(tt: Timetable, stop: number): [string, number][] {
  const { start, to, metres } = tt.transfers
  const out: [string, number][] = []
  for (let k = start[stop] as number; k < (start[stop + 1] as number); k++) {
    out.push([tt.stops.ids[to[k] as number] as string, metres[k] as number])
  }
  return out
}

describe('near', () => {
  it('is Tempe with no offset, and as far as asked otherwise', () => {
    expect(near(0, 0)).toEqual([33.4242, -111.9281])
    expect(distanceM(near(0, 0), near(300, 400))).toBeCloseTo(500, 3)
    expect(distanceM(near(0, 0), near(-250, 0))).toBeCloseTo(250, 3)
    expect(distanceM(near(0, 0), near(0, -250))).toBeCloseTo(250, 3)
  })
})

describe('walkSeconds', () => {
  it('walks a straight-line metre in a second (a 1.3 detour at 1.3 m/s)', () => {
    expect(walkSeconds(1000)).toBe(1000)
    expect(walkSeconds(0)).toBe(0)
  })

  it('rounds to whole seconds', () => {
    expect(walkSeconds(1000.4)).toBe(1000)
    expect(walkSeconds(1000.6)).toBe(1001)
  })
})

describe('stopsNear', () => {
  const made = testTimetable({
    stops: {
      far: near(900, 0),
      beyond: near(1500, 0),
      close: near(0, 200),
      mid: near(-500, 0)
    },
    routes: []
  })

  it('returns only the stops within the limit, nearest first', async () => {
    const tt = await made
    const found = stopsNear(tt, near(0, 0), 1000)
    expect(found.map((f) => tt.stops.ids[f.stop])).toEqual(['close', 'mid', 'far'])
    expect(found.map((f) => Math.round(f.metres))).toEqual([200, 500, 900])
  })

  it('finds nothing when no stop is that near', async () => {
    expect(stopsNear(await made, near(5000, 5000), 1000)).toEqual([])
  })
})

describe('walkOnly', () => {
  const from = near(0, 0)
  const to = near(0, 650)
  const secs = walkSeconds(distanceM(from, to))

  it('leaves at the time asked for, in depart mode', () => {
    const journey = walkOnly(from, to, { from, to, time: NOON, mode: 'depart' })
    expect(journey.depart).toBe(NOON)
    expect(journey.arrive).toBe(NOON + secs)
    expect(journey.legs).toEqual([
      {
        kind: 'walk',
        from: { kind: 'origin' },
        to: { kind: 'destination' },
        start: NOON,
        end: NOON + secs,
        metres: distanceM(from, to)
      }
    ])
  })

  it('arrives at the time asked for, in arrive mode', () => {
    const journey = walkOnly(from, to, { from, to, time: NOON, mode: 'arrive' })
    expect(journey.arrive).toBe(NOON)
    expect(journey.depart).toBe(NOON - secs)
    expect(journey.legs).toHaveLength(1)
    expect(journey.legs[0]).toMatchObject({ kind: 'walk', start: NOON - secs, end: NOON })
  })
})

describe('testTimetable', () => {
  const A = near(0, 0)
  const B = near(300, 0)
  const C = near(0, 500)
  const stops: Record<string, LatLon> = { A, B, C }

  it('puts trips with the same stops in one pattern, ordered by first departure', async () => {
    const tt = await testTimetable({
      stops,
      routes: [
        {
          id: 'R1',
          trips: [
            {
              id: 'late',
              stops: [
                ['A', '09:10'],
                ['B', '09:20']
              ]
            },
            {
              id: 'early',
              stops: [
                ['A', '09:00'],
                ['B', '09:11:30']
              ]
            },
            {
              id: 'other',
              stops: [
                ['B', '09:00'],
                ['A', '09:10']
              ]
            }
          ]
        }
      ]
    })
    expect(tt.routes).toEqual([
      { id: 'R1', short: 'R1', long: '', color: '', textColor: '', type: 3 }
    ])
    expect(tt.patterns).toHaveLength(2)
    const pattern = tt.patterns[0]!
    expect(pattern.route).toBe(0)
    expect(Array.from(pattern.stops)).toEqual([0, 1])
    expect(pattern.trips).toEqual(['early', 'late'])
    // [arrival, departure] per trip per position: the test spec gives one time a stop.
    expect(Array.from(pattern.times)).toEqual([
      32400, 32400, 33090, 33090, 33000, 33000, 33600, 33600
    ])
    expect(tt.patterns[1]!.trips).toEqual(['other'])
    expect(Array.from(tt.patterns[1]!.stops)).toEqual([1, 0])
  })

  it('keeps a trip’s times past midnight as seconds after the service day’s', async () => {
    const tt = await testTimetable({
      stops,
      routes: [
        {
          id: 'N',
          trips: [
            {
              id: 'owl',
              stops: [
                ['A', '23:50'],
                ['B', '24:10']
              ]
            }
          ]
        }
      ]
    })
    expect(Array.from(tt.patterns[0]!.times)).toEqual([85800, 85800, 87000, 87000])
  })

  it('runs trips on 20261102 unless told, one service for each set of dates', async () => {
    const trip = (
      id: string,
      dates?: number[]
    ): { id: string; dates?: number[]; stops: [string, string][] } => ({
      id,
      ...(dates ? { dates } : {}),
      stops: [
        ['A', '09:00'],
        ['B', '09:05']
      ]
    })
    const tt = await testTimetable({
      stops,
      routes: [
        {
          id: 'R1',
          trips: [
            trip('a'),
            trip('b', [20261103, 20261102]),
            trip('c', [20261102]),
            trip('d', [20261102, 20261103])
          ]
        }
      ]
    })
    expect(tt.services.map((s) => Array.from(s))).toEqual([[20261102], [20261102, 20261103]])
    expect(Array.from(tt.patterns[0]!.service)).toEqual([0, 1, 0, 1])
  })

  it('fills transfers for stops 300 m apart, not 500 m apart, and never to itself', async () => {
    const tt = await testTimetable({ stops, routes: [] })
    expect(tt.transfers.start).toHaveLength(4)
    expect(neighbours(tt, 0)).toEqual([['B', 300]])
    expect(neighbours(tt, 1)).toEqual([['A', 300]])
    // C is 500 m from A and 583 m from B.
    expect(neighbours(tt, 2)).toEqual([])
  })

  it('splits off a trip that overtakes another on the same stops, as the builder does', async () => {
    const tt = await testTimetable({
      stops,
      routes: [
        {
          id: 'R1',
          trips: [
            {
              id: 'slow',
              stops: [
                ['A', '09:00'],
                ['B', '09:30']
              ]
            },
            {
              id: 'fast',
              stops: [
                ['A', '09:05'],
                ['B', '09:10']
              ]
            }
          ]
        }
      ]
    })
    expect(tt.patterns.map((p) => [p.trips, Array.from(p.stops)])).toEqual([
      [['slow'], [0, 1]],
      [['fast'], [0, 1]]
    ])
  })

  it('refuses a stop or a time it can’t read', async () => {
    const one = (stop: string, time: string): Promise<Timetable> =>
      testTimetable({
        stops,
        routes: [{ id: 'R1', trips: [{ id: 't', stops: [[stop, time]] }] }]
      })
    await expect(one('nowhere', '09:00')).rejects.toThrow(/nowhere/)
    await expect(one('A', '9am')).rejects.toThrow(/9am/)
  })
})
