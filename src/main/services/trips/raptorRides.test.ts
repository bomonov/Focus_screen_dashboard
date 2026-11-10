// Partial live predictions must never let a ride travel backwards in time, in either search.
import { describe, expect, it } from 'vitest'
import { planTrips } from './raptor'
import { near, testTimetable } from './testTimetable'
import { serviceDayStart } from './timetable'
import type { LiveTrip, PlanQuery, RideLeg } from './types'

const DAY = serviceDayStart(20261102)
const at = (minutes: number): number => DAY + 10 * 3600 + minutes * 60

function feed(arrival: number[], departure = arrival): LiveTrip {
  return {
    canceled: false,
    arrival: Float64Array.from(arrival),
    departure: Float64Array.from(departure),
    skipped: new Uint8Array(arrival.length)
  }
}

const query = (mode: PlanQuery['mode']): PlanQuery => ({
  from: near(0, 0),
  to: near(0, 5000),
  time: at(mode === 'depart' ? -10 : 30),
  mode
})

describe.each(['depart', 'arrive'] as const)('ride chronology in %s mode', (mode) => {
  it.each([-1, 0, 1])(
    'allows an arrival only when it is at least the departure (%s s)',
    async (delta) => {
      const tt = await testTimetable({
        stops: { A: near(0, 0), B: near(0, 5000) },
        routes: [
          {
            id: 'R',
            trips: [
              {
                id: 't',
                stops: [
                  ['A', '10:00'],
                  ['B', '10:20']
                ]
              }
            ]
          }
        ]
      })
      // Boarding has no prediction; the alighting prediction can precede timetable departure.
      const live = new Map([['t', feed([NaN, at(0) + delta], [NaN, NaN])]])
      const journeys = planTrips(tt, query(mode), live)
      expect(journeys).toHaveLength(delta < 0 ? 0 : 1)
      if (delta >= 0) {
        expect(journeys[0]).toMatchObject({ depart: at(0), arrive: at(0) + delta })
      }
    }
  )

  it('retains a feasible boarding option when the preferred one would reverse time', async () => {
    // Forwards, boarding B has the better origin departure but cannot reach C's prediction.
    // Backwards, alighting B has the better destination arrival but cannot follow A's departure.
    const forward = mode === 'depart'
    const tt = await testTimetable({
      stops: {
        A: near(0, 0),
        B: near(0, forward ? 60 : 4940),
        C: near(0, 5000)
      },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 't',
              stops: [
                ['A', '10:00'],
                ['B', '10:10'],
                ['C', '10:20']
              ]
            }
          ]
        }
      ]
    })
    const live = new Map([
      [
        't',
        forward
          ? feed([NaN, NaN, at(5)], [NaN, NaN, NaN])
          : feed([NaN, at(-5), NaN], [NaN, NaN, NaN])
      ]
    ])
    const journeys = planTrips(tt, query(mode), live)
    expect(journeys).toHaveLength(1)
    expect(journeys[0]).toMatchObject({ depart: at(0), arrive: at(forward ? 5 : 20) })
    expect(journeys[0]?.legs).toEqual([
      expect.objectContaining({ kind: 'ride', board: 0, alight: 2 })
    ])
  })

  it('rejects only the invalid position pair, keeping valid rides on the same run', async () => {
    const forward = mode === 'depart'
    const tt = await testTimetable({
      stops: { A: near(0, 0), B: near(0, 2500), C: near(0, 5000) },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 't',
              stops: [
                ['A', '10:00'],
                ['B', '10:10'],
                ['C', '10:20']
              ]
            }
          ]
        }
      ]
    })
    const live = new Map([
      [
        't',
        forward
          ? feed([NaN, at(-5), NaN], [NaN, NaN, NaN])
          : feed([NaN, NaN, NaN], [NaN, at(25), NaN])
      ]
    ])
    const journeys = planTrips(tt, query(mode), live)
    expect(journeys).toHaveLength(1)
    expect(journeys[0]).toMatchObject({ depart: at(0), arrive: at(20) })
    const rides = journeys.flatMap(({ legs }) =>
      legs.filter((leg): leg is RideLeg => leg.kind === 'ride')
    )
    expect(rides.map(({ board, alight }) => [board, alight])).toEqual([[0, 2]])
  })

  it('refuses a negative-duration middle ride after a change in either direction', async () => {
    const tt = await testTimetable({
      stops: { A: near(0, 0), X: near(0, 2500), Y: near(0, 5000), C: near(0, 7500) },
      routes: [
        {
          id: 'first',
          trips: [
            {
              id: 'first',
              stops: [
                ['A', '10:00'],
                ['X', '10:05']
              ]
            }
          ]
        },
        {
          id: 'middle',
          trips: [
            {
              id: 'middle',
              stops: [
                ['X', '10:10'],
                ['Y', '10:20']
              ]
            }
          ]
        },
        {
          id: 'last',
          trips: [
            {
              id: 'last',
              stops: [
                ['Y', '10:15'],
                ['C', '10:25']
              ]
            }
          ]
        }
      ]
    })
    const live = new Map([['middle', feed([NaN, at(9)], [NaN, NaN])]])
    expect(planTrips(tt, { ...query(mode), to: near(0, 7500) }, live)).toEqual([])
    // A zero-duration middle ride remains valid and can connect to both outer rides.
    live.set('middle', feed([NaN, at(10)], [NaN, NaN]))
    const journeys = planTrips(tt, { ...query(mode), to: near(0, 7500) }, live)
    expect(journeys).toHaveLength(1)
    expect(journeys[0]).toMatchObject({ depart: at(0), arrive: at(25) })
  })
})
