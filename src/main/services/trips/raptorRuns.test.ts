// Run preparation tests guard the bounds used to skip work without losing delayed runs,
// and make nearest-service-day tie behaviour explicit.
import { describe, expect, it } from 'vitest'
import { nearestRun, searchRuns, timetableIndex } from './raptorRuns'
import { near, testTimetable } from './testTimetable'
import { serviceDayStart } from './timetable'
import type { LiveTimes, LiveTrip, PlanQuery } from './types'

const DAY = serviceDayStart(20261102)
const query = (mode: PlanQuery['mode']): PlanQuery => ({
  from: near(0, 0),
  to: near(0, 5000),
  time: DAY + 10 * 3600,
  mode
})

function feed(arrival: number[], departure = arrival): LiveTrip {
  return {
    canceled: false,
    arrival: Float64Array.from(arrival),
    departure: Float64Array.from(departure),
    skipped: new Uint8Array(arrival.length)
  }
}

describe('nearestRun', () => {
  it('chooses the earlier service day on an exact distance tie', () => {
    const days = [0, 86400, 3 * 86400]
    expect(nearestRun(days, 43200)).toBe(0)
    expect(nearestRun(days, 2 * 86400)).toBe(86400)
    expect(nearestRun(days, 43201)).toBe(86400)
    expect(nearestRun(days, 43199)).toBe(0)
  })

  it('handles exact matches, calendar ends, a single day and an empty calendar', () => {
    expect(nearestRun([], 10)).toBeUndefined()
    expect(nearestRun([20], -100)).toBe(20)
    expect(nearestRun([20], 100)).toBe(20)
    expect(nearestRun([10, 20, 30], 20)).toBe(20)
    expect(nearestRun([10, 20, 30], -1)).toBe(10)
    expect(nearestRun([10, 20, 30], 40)).toBe(30)
  })
})

describe('searchRuns window pruning', () => {
  const made = testTimetable({
    stops: { A: near(0, 0), B: near(0, 2500), C: near(0, 5000) },
    routes: [
      {
        id: 'R',
        trips: [
          {
            id: 'early',
            stops: [
              ['A', '09:00'],
              ['B', '09:05'],
              ['C', '09:10']
            ]
          },
          {
            id: 'edge',
            stops: [
              ['A', '10:00'],
              ['B', '10:00'],
              ['C', '10:00']
            ]
          },
          {
            id: 'late',
            stops: [
              ['A', '11:00'],
              ['B', '11:05'],
              ['C', '11:10']
            ]
          }
        ]
      }
    ]
  })

  it.each(['depart', 'arrive'] as const)(
    'skips strictly outside runs and retains the boundary in %s mode',
    async (mode) => {
      const tt = await made
      const ids = searchRuns(tt, query(mode), new Map()).map(
        (run) => tt.patterns[run.pattern]?.trips[run.trip]
      )
      expect(ids).toEqual(mode === 'depart' ? ['edge', 'late'] : ['early', 'edge'])
    }
  )

  it.each(['arrival', 'departure'] as const)(
    'includes interior live %s predictions when pruning depart runs',
    async (kind) => {
      const tt = await made
      const liveFeed = feed([NaN, NaN, NaN])
      liveFeed[kind][1] = DAY + 10 * 3600
      const live: LiveTimes = new Map([['early', liveFeed]])
      const runs = searchRuns(tt, query('depart'), live)
      expect(runs).toHaveLength(3)
      expect(runs[0]?.feed).toBe(liveFeed)
      liveFeed[kind][1] -= 1
      expect(searchRuns(tt, query('depart'), live)).toHaveLength(2)
    }
  )

  it.each(['arrival', 'departure'] as const)(
    'includes interior live %s predictions when pruning arrive runs',
    async (kind) => {
      const tt = await made
      const liveFeed = feed([NaN, NaN, NaN])
      liveFeed[kind][1] = DAY + 10 * 3600
      const live: LiveTimes = new Map([['late', liveFeed]])
      expect(searchRuns(tt, query('arrive'), live)).toHaveLength(3)
      liveFeed[kind][1] += 1
      expect(searchRuns(tt, query('arrive'), live)).toHaveLength(2)
    }
  )

  it('shares each directed connection between the cached incoming and outgoing indexes', async () => {
    const tt = await testTimetable({
      stops: { A: near(0, 0), B: near(0, 100) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 't',
              stops: [
                ['A', '10:00'],
                ['B', '10:01']
              ]
            }
          ]
        }
      ]
    })
    const index = timetableIndex(tt)
    expect(timetableIndex(tt)).toBe(index)
    expect(index.outgoing[0]).toHaveLength(1)
    expect(index.outgoing[0]?.[0]).toBe(index.incoming[1]?.[0])
    expect(index.outgoing[0]?.[0]).toMatchObject({ from: 0, to: 1 })
  })
})
