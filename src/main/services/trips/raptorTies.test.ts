// End-to-end walking ties exercise both search directions, including paths that only become
// equal after waiting for a common ride and walks at each end of the journey.
import { describe, expect, it } from 'vitest'
import { planTrips } from './raptor'
import { near, testTimetable, type TestSpec } from './testTimetable'
import { serviceDayStart } from './timetable'
import type { LiveTimes, PlanQuery } from './types'

const DAY = serviceDayStart(20261102)
const A = near(0, 0)
const C = near(0, 5000)
const X = near(0, 2500)
const scenarios: { name: string; spec: TestSpec; wanted: string[] }[] = [
  {
    name: 'direct rides with different access walks',
    spec: {
      stops: { A, B: near(60, 0), C },
      routes: [
        {
          id: 'long',
          trips: [
            {
              id: 'long',
              stops: [
                ['B', '10:01'],
                ['C', '10:20']
              ]
            }
          ]
        },
        {
          id: 'short',
          trips: [
            {
              id: 'short',
              stops: [
                ['A', '10:00'],
                ['C', '10:20']
              ]
            }
          ]
        }
      ]
    },
    wanted: ['short']
  },
  {
    name: 'different access walks before a common onward ride',
    spec: {
      stops: { A, B: near(60, 0), X, C },
      routes: [
        {
          id: 'long',
          trips: [
            {
              id: 'long',
              stops: [
                ['B', '10:01'],
                ['X', '10:05']
              ]
            }
          ]
        },
        {
          id: 'short',
          trips: [
            {
              id: 'short',
              stops: [
                ['A', '10:00'],
                ['X', '10:06']
              ]
            }
          ]
        },
        {
          id: 'onward',
          trips: [
            {
              id: 'onward',
              stops: [
                ['X', '10:10'],
                ['C', '10:20']
              ]
            }
          ]
        }
      ]
    },
    wanted: ['short', 'onward']
  },
  {
    name: 'different egress walks after a common first ride',
    spec: {
      stops: { A, X, C, D: near(60, 5000) },
      routes: [
        {
          id: 'first',
          trips: [
            {
              id: 'first',
              stops: [
                ['A', '10:00'],
                ['X', '10:10']
              ]
            }
          ]
        },
        {
          id: 'long',
          trips: [
            {
              id: 'long',
              stops: [
                ['X', '10:12'],
                ['D', '10:19']
              ]
            }
          ]
        },
        {
          id: 'short',
          trips: [
            {
              id: 'short',
              stops: [
                ['X', '10:11'],
                ['C', '10:20']
              ]
            }
          ]
        }
      ]
    },
    wanted: ['first', 'short']
  },
  {
    name: 'a transfer walk that arrives earlier but catches the same ride',
    spec: {
      stops: { A, X, Y: near(0, 2620), C },
      routes: [
        {
          id: 'long',
          trips: [
            {
              id: 'long',
              stops: [
                ['A', '10:00'],
                ['X', '10:05']
              ]
            }
          ]
        },
        {
          id: 'short',
          trips: [
            {
              id: 'short',
              stops: [
                ['A', '10:00'],
                ['Y', '10:08']
              ]
            }
          ]
        },
        {
          id: 'onward',
          trips: [
            {
              id: 'onward',
              stops: [
                ['Y', '10:10'],
                ['C', '10:20']
              ]
            }
          ]
        }
      ]
    },
    wanted: ['short', 'onward']
  },
  {
    name: 'equal origin departures from two positions on one run',
    spec: {
      stops: { A, B: near(60, 0), C },
      routes: [
        {
          id: 'R',
          trips: [
            {
              id: 'same-run',
              stops: [
                ['A', '10:00'],
                ['B', '10:01'],
                ['C', '10:20']
              ]
            }
          ]
        }
      ]
    },
    wanted: ['same-run']
  }
]

for (const { name, spec, wanted } of scenarios) {
  describe(name, () => {
    it.each([
      ['depart', false],
      ['depart', true],
      ['arrive', false],
      ['arrive', true]
    ] as const)(
      'keeps the shorter walk in %s mode (reverse route order: %s)',
      async (mode, reverse) => {
        const tt = await testTimetable({
          ...spec,
          routes: reverse ? [...spec.routes].reverse() : spec.routes
        })
        const query: PlanQuery = {
          from: A,
          to: C,
          mode,
          time: DAY + (mode === 'depart' ? 10 * 3600 : 10 * 3600 + 20 * 60)
        }
        const journeys = planTrips(tt, query, new Map())
        // An all-NaN live entry forces the option-list path without changing any ride times.
        const unchangedLive: LiveTimes = new Map(
          tt.patterns.flatMap((pattern) =>
            pattern.trips.map(
              (trip) =>
                [
                  trip,
                  {
                    canceled: false,
                    arrival: new Float64Array(pattern.stops.length).fill(NaN),
                    departure: new Float64Array(pattern.stops.length).fill(NaN),
                    skipped: new Uint8Array(pattern.stops.length)
                  }
                ] as const
            )
          )
        )
        expect(planTrips(tt, query, unchangedLive)).toEqual(journeys)
        expect(journeys).toHaveLength(1)
        const journey = journeys[0]
        expect(journey?.depart).toBe(DAY + 10 * 3600)
        expect(journey?.arrive).toBe(DAY + 10 * 3600 + 20 * 60)
        expect(journey?.legs.filter((leg) => leg.kind === 'ride').map((leg) => leg.tripId)).toEqual(
          wanted
        )
        expect(journey?.legs.filter((leg) => leg.kind === 'walk')).toEqual([])
      }
    )
  })
}
