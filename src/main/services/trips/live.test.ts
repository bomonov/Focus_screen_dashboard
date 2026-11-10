import { beforeAll, describe, expect, it } from 'vitest'
import type { FeedTrip, StopTimeEvent, StopTimeUpdate } from '../transit/gtfsRealtime'
import { liveTimes, tripIndex } from './live'
import { near, testTimetable } from './testTimetable'
import { serviceDayStart } from './timetable'
import type { Timetable } from './types'

/** Midnight at the start of Mon 2 Nov 2026 in Arizona, which the test timetable's trips count from. */
const DAY = serviceDayStart(20261102)
/** hh:mm:ss on that day, as unix seconds (past 24:00 runs into the next). */
const at = (hours: number, minutes: number, seconds = 0): number =>
  DAY + hours * 3600 + minutes * 60 + seconds

const NaNs = (n: number): number[] => Array.from({ length: n }, () => NaN)

const event = (time: number | null, delay: number | null = null): StopTimeEvent => ({
  time,
  delay
})
const late = (seconds: number): StopTimeEvent => event(null, seconds)

function update(
  stopId: string,
  stopSequence: number | null,
  arrival: StopTimeEvent | null,
  departure: StopTimeEvent | null,
  relationship: StopTimeUpdate['relationship'] = 'scheduled'
): StopTimeUpdate {
  return { stopId, stopSequence, arrival, departure, relationship }
}

function feedTrip(tripId: string, stops: StopTimeUpdate[], canceled = false): FeedTrip {
  return { tripId, routeId: '', directionId: null, canceled, vehicleId: '', stops }
}

let tt: Timetable

beforeAll(async () => {
  tt = await testTimetable({
    stops: {
      A: near(0, 0),
      B: near(0, 500),
      C: near(0, 1000),
      D: near(0, 1500),
      E: near(0, 2000),
      X: near(500, 0)
    },
    routes: [
      {
        id: 'line',
        trips: [
          {
            id: 't1',
            stops: [
              ['A', '08:00'],
              ['B', '08:10'],
              ['C', '08:20'],
              ['D', '08:30'],
              ['E', '08:40']
            ]
          },
          {
            id: 't2',
            stops: [
              ['A', '09:00'],
              ['B', '09:10'],
              ['C', '09:20'],
              ['D', '09:30'],
              ['E', '09:40']
            ]
          }
        ]
      },
      {
        // Makes A twice: positions 0 and 2.
        id: 'loop',
        trips: [
          {
            id: 'l1',
            stops: [
              ['A', '10:00'],
              ['B', '10:10'],
              ['A', '10:20']
            ]
          }
        ]
      },
      {
        // Runs 23:50 to 00:30 across midnight, on the 1st and the 2nd.
        id: 'night',
        trips: [
          {
            id: 'n1',
            dates: [20261101, 20261102],
            stops: [
              ['A', '23:50'],
              ['B', '24:10'],
              ['C', '24:30']
            ]
          }
        ]
      },
      {
        // Stops at B twice running (a layover listed as two stop times): positions 1 and 2.
        id: 'layover',
        trips: [
          {
            id: 'v1',
            stops: [
              ['A', '11:00'],
              ['B', '11:10'],
              ['B', '11:15'],
              ['C', '11:25']
            ]
          }
        ]
      },
      {
        // Leaves just after midnight on the 3rd, so it can be in the feed at 23:30 on the 2nd.
        id: 'tomorrow',
        trips: [
          {
            id: 'tm',
            dates: [20261103],
            stops: [
              ['A', '00:10'],
              ['B', '00:20'],
              ['C', '00:30']
            ]
          }
        ]
      },
      {
        // Only runs on the 10th, which `now` is never near.
        id: 'later',
        trips: [
          {
            id: 'f1',
            dates: [20261110],
            stops: [
              ['A', '08:00'],
              ['B', '08:10'],
              ['C', '08:20']
            ]
          }
        ]
      }
    ]
  })
})

describe('liveTimes', () => {
  it('carries a delay on to the stops after it, and leaves the ones before it alone', () => {
    const live = liveTimes(tt, [feedTrip('t1', [update('C', 3, late(120), late(150))])], at(8, 15))
    const trip = live.get('t1')
    expect(trip?.canceled).toBe(false)
    // The delay at C that goes on is the departure's (150 s), as GTFS-realtime says.
    expect(Array.from(trip?.arrival ?? [])).toEqual([
      NaN,
      NaN,
      at(8, 20) + 120,
      at(8, 30) + 150,
      at(8, 40) + 150
    ])
    expect(Array.from(trip?.departure ?? [])).toEqual([
      NaN,
      NaN,
      at(8, 20) + 150,
      at(8, 30) + 150,
      at(8, 40) + 150
    ])
    expect(Array.from(trip?.skipped ?? [])).toEqual([0, 0, 0, 0, 0])
  })

  it('takes a later update over the delay carried from an earlier one', () => {
    const live = liveTimes(
      tt,
      [feedTrip('t1', [update('B', 2, late(60), late(60)), update('D', 4, late(300), late(300))])],
      at(8, 5)
    )
    expect(Array.from(live.get('t1')?.arrival ?? [])).toEqual([
      NaN,
      at(8, 10) + 60,
      at(8, 20) + 60,
      at(8, 30) + 300,
      at(8, 40) + 300
    ])
  })

  it("uses the timetable of the trip it's for, not the first on its pattern", () => {
    const live = liveTimes(tt, [feedTrip('t2', [update('C', 3, late(60), late(60))])], at(9, 15))
    expect(live.get('t2')?.arrival[2]).toBe(at(9, 20) + 60)
    expect(live.get('t2')?.arrival[4]).toBe(at(9, 40) + 60)
    expect(live.has('t1')).toBe(false)
  })

  it('takes an absolute time over a delay, and carries on from how late that makes the stop', () => {
    const live = liveTimes(
      tt,
      [feedTrip('t1', [update('C', 3, event(at(8, 22), 9999), event(at(8, 23), 5))])],
      at(8, 15)
    )
    const trip = live.get('t1')
    expect(trip?.arrival[2]).toBe(at(8, 22))
    expect(trip?.departure[2]).toBe(at(8, 23))
    // Three minutes late leaving C, so three minutes late at D.
    expect(trip?.arrival[3]).toBe(at(8, 33))
    expect(trip?.departure[3]).toBe(at(8, 33))
  })

  it('reads an absolute time, and carries on how late it is, without knowing which day the trip runs', () => {
    // f1 runs on the 10th, so there's no run to put a delay on; an absolute time needs none.
    const live = liveTimes(
      tt,
      [feedTrip('f1', [update('B', 2, event(at(8, 12)), event(at(8, 13)))])],
      at(8, 5)
    )
    const trip = live.get('f1')
    // Three minutes late leaving B (08:10), so three minutes late at C (08:20); nothing before B.
    expect(Array.from(trip?.arrival ?? [])).toEqual([NaN, at(8, 12), at(8, 23)])
    expect(Array.from(trip?.departure ?? [])).toEqual([NaN, at(8, 13), at(8, 23)])
  })

  it("doesn't believe an absolute time more than 12 hours from now", () => {
    const farOff = [feedTrip('t1', [update('C', 3, event(at(21, 0)), event(at(21, 0)))])]
    // With no delay to fall back on, the update says nothing at all.
    const ignored = liveTimes(tt, farOff, at(8, 5))
    expect(Array.from(ignored.get('t1')?.arrival ?? [])).toEqual(NaNs(5))
    expect(Array.from(ignored.get('t1')?.departure ?? [])).toEqual(NaNs(5))

    // With one, the delay is what counts: the stop is 90 s late, and so are the stops after it.
    const withDelay = liveTimes(
      tt,
      [feedTrip('t1', [update('C', 3, event(at(21, 0), 90), event(at(21, 0), 90))])],
      at(8, 5)
    )
    expect(Array.from(withDelay.get('t1')?.arrival ?? [])).toEqual([
      NaN,
      NaN,
      at(8, 20) + 90,
      at(8, 30) + 90,
      at(8, 40) + 90
    ])

    // Too long ago is as unlikely as too far ahead.
    const past = liveTimes(
      tt,
      [feedTrip('t1', [update('C', 3, event(at(8, 5) - 13 * 3600), null)])],
      at(8, 5)
    )
    expect(Array.from(past.get('t1')?.arrival ?? [])).toEqual(NaNs(5))

    // Twelve hours exactly is still believed.
    const edge = liveTimes(
      tt,
      [feedTrip('t1', [update('C', 3, event(at(8, 5) + 12 * 3600), null)])],
      at(8, 5)
    )
    expect(edge.get('t1')?.arrival[2]).toBe(at(20, 5))
  })

  it('takes the other as the same moment when an update gives only an arrival or a departure, and never leaves before arriving', () => {
    const live = liveTimes(
      tt,
      [
        feedTrip('t1', [
          update('B', 2, event(at(8, 12)), null),
          update('C', 3, null, event(at(8, 25))),
          update('D', 4, event(at(8, 35)), event(at(8, 34)))
        ])
      ],
      at(8, 5)
    )
    const trip = live.get('t1')
    expect(trip?.arrival[1]).toBe(at(8, 12))
    expect(trip?.departure[1]).toBe(at(8, 12))
    expect(trip?.arrival[2]).toBe(at(8, 25))
    expect(trip?.departure[2]).toBe(at(8, 25))
    expect(trip?.arrival[3]).toBe(at(8, 35))
    expect(trip?.departure[3]).toBe(at(8, 35))
  })

  it('marks a skipped stop, takes no time from it, and carries on the delay from before it', () => {
    const live = liveTimes(
      tt,
      [
        feedTrip('t1', [
          update('C', 3, late(120), late(120)),
          // Feeds sometimes still give a time on a stop the bus won't make.
          update('D', 4, event(at(8, 50)), event(at(8, 50)), 'skipped')
        ])
      ],
      at(8, 15)
    )
    const trip = live.get('t1')
    expect(Array.from(trip?.skipped ?? [])).toEqual([0, 0, 0, 1, 0])
    expect(Array.from(trip?.arrival ?? [])).toEqual([
      NaN,
      NaN,
      at(8, 20) + 120,
      at(8, 30) + 120,
      at(8, 40) + 120
    ])
  })

  it('sets nothing for a stop the feed has no data for', () => {
    const live = liveTimes(
      tt,
      [
        feedTrip('t1', [
          update('B', 2, late(600), late(600), 'noData'),
          update('C', 3, late(60), late(60))
        ])
      ],
      at(8, 5)
    )
    const trip = live.get('t1')
    expect(Array.from(trip?.skipped ?? [])).toEqual([0, 0, 0, 0, 0])
    expect(Array.from(trip?.arrival ?? [])).toEqual([
      NaN,
      NaN,
      at(8, 20) + 60,
      at(8, 30) + 60,
      at(8, 40) + 60
    ])
  })

  it('comes back canceled, with nothing predicted', () => {
    // A canceled trip's stops are of no use, whatever they say.
    const live = liveTimes(
      tt,
      [feedTrip('t1', [update('C', 3, late(60), late(60), 'skipped')], true)],
      at(8, 5)
    )
    const trip = live.get('t1')
    expect(trip?.canceled).toBe(true)
    expect(Array.from(trip?.arrival ?? [])).toEqual(NaNs(5))
    expect(Array.from(trip?.departure ?? [])).toEqual(NaNs(5))
    expect(Array.from(trip?.skipped ?? [])).toEqual([0, 0, 0, 0, 0])
  })

  it('leaves out trips the timetable has never heard of', () => {
    const live = liveTimes(
      tt,
      [
        feedTrip('nobody', [update('C', 3, late(60), late(60))]),
        // Frequency trips are stored as id@seconds; the feed's plain id isn't one of them.
        feedTrip('t1@28800', [update('C', 3, late(60), late(60))]),
        feedTrip('t1', [update('C', 3, late(60), late(60))])
      ],
      at(8, 5)
    )
    expect([...live.keys()]).toEqual(['t1'])
  })

  it('gives each visit of a stop the trip makes twice its own position', () => {
    const live = liveTimes(
      tt,
      [
        feedTrip('l1', [
          update('A', 1, late(60), late(60)),
          update('B', 2, late(120), late(120)),
          update('A', 3, late(180), late(180))
        ])
      ],
      at(10, 5)
    )
    expect(Array.from(live.get('l1')?.arrival ?? [])).toEqual([
      at(10, 0) + 60,
      at(10, 10) + 120,
      at(10, 20) + 180
    ])
  })

  it('puts a repeated stop on the next visit after the last stop it matched', () => {
    // The first A is behind the bus, so the feed starts at B; the A after it is the second visit.
    const live = liveTimes(
      tt,
      [
        feedTrip('l1', [update('B', 2, late(120), late(120)), update('A', 3, late(180), late(180))])
      ],
      at(10, 5)
    )
    expect(Array.from(live.get('l1')?.arrival ?? [])).toEqual([
      NaN,
      at(10, 10) + 120,
      at(10, 20) + 180
    ])
  })

  it("puts a loop's last visit where it is when that's all the feed lists, with nothing before it", () => {
    // The bus is mid-loop at 10:05 and the feed has dropped the stops behind it. Its one A is the
    // second, 16 minutes off: the time it says is what tells, not the first A's nearness to now.
    const live = liveTimes(
      tt,
      [feedTrip('l1', [update('A', 3, event(at(10, 21)), event(at(10, 21)))])],
      at(10, 5)
    )
    const trip = live.get('l1')
    expect(Array.from(trip?.arrival ?? [])).toEqual([NaN, NaN, at(10, 21)])
    expect(Array.from(trip?.departure ?? [])).toEqual([NaN, NaN, at(10, 21)])
  })

  it('tells a loop’s visits apart by the delay too: the one whose prediction is nearest now', () => {
    const late60 = [feedTrip('l1', [update('A', 3, late(60), late(60))])]
    // 10:19: the bus is about to finish (10:21), not leaving 10:01.
    const finishing = liveTimes(tt, late60, at(10, 19))
    expect(Array.from(finishing.get('l1')?.arrival ?? [])).toEqual([NaN, NaN, at(10, 20) + 60])
    // 09:55: it hasn't left yet, so the first A (10:01) is the nearer.
    const waiting = liveTimes(tt, late60, at(9, 55))
    expect(Array.from(waiting.get('l1')?.arrival ?? [])).toEqual([
      at(10, 0) + 60,
      at(10, 10) + 60,
      at(10, 20) + 60
    ])
    // 10:12 and 15 minutes late: the first A is only due at 10:15, the second at 10:35.
    const behind = liveTimes(
      tt,
      [feedTrip('l1', [update('A', 3, late(900), late(900))])],
      at(10, 12)
    )
    expect(Array.from(behind.get('l1')?.arrival ?? [])).toEqual([
      at(10, 0) + 900,
      at(10, 10) + 900,
      at(10, 20) + 900
    ])
  })

  it('keeps a visit for each later update of the same stop, even when the clock favours a later one', () => {
    // The feed lists all of the trip, passed stops too. At 10:12 the first A's prediction (10:01)
    // is further from now than the second visit's (10:21), but the A at the end needs a visit.
    const live = liveTimes(
      tt,
      [
        feedTrip('l1', [
          update('A', 1, late(60), late(60)),
          update('B', 2, late(120), late(120)),
          update('A', 3, late(180), late(180))
        ])
      ],
      at(10, 12)
    )
    expect(Array.from(live.get('l1')?.arrival ?? [])).toEqual([
      at(10, 0) + 60,
      at(10, 10) + 120,
      at(10, 20) + 180
    ])
  })

  it('puts two updates for the same stop in a row on the two positions it has there', () => {
    // v1 is at B twice running (10 and 15 minutes past 11). At 11:12 the first B's prediction
    // (11:11) and the second's (11:16) are both near now, so only the order tells them apart.
    const live = liveTimes(
      tt,
      [feedTrip('v1', [update('B', 2, late(60), late(60)), update('B', 3, late(120), late(120))])],
      at(11, 12)
    )
    const trip = live.get('v1')
    expect(Array.from(trip?.arrival ?? [])).toEqual([
      NaN,
      at(11, 10) + 60,
      at(11, 15) + 120,
      at(11, 25) + 120
    ])
    expect(Array.from(trip?.departure ?? [])).toEqual([
      NaN,
      at(11, 10) + 60,
      at(11, 15) + 120,
      at(11, 25) + 120
    ])
  })

  it("ignores an update for a stop the trip doesn't make, without losing its place", () => {
    const live = liveTimes(
      tt,
      [
        feedTrip('t1', [
          update('X', 2, late(900), late(900)), // in the timetable, not on this trip
          update('Nowhere', 3, late(900), late(900)), // not in the timetable at all
          update('C', 4, late(60), late(60)),
          update('Gone', 5, late(900), late(900)),
          update('D', 6, late(90), late(90))
        ])
      ],
      at(8, 5)
    )
    expect(Array.from(live.get('t1')?.arrival ?? [])).toEqual([
      NaN,
      NaN,
      at(8, 20) + 60,
      at(8, 30) + 90,
      at(8, 40) + 90
    ])
  })

  it("walks the updates in stopSequence order, and as given when it isn't there", () => {
    const shuffled = liveTimes(
      tt,
      [feedTrip('t1', [update('D', 4, late(90), late(90)), update('B', 2, late(30), late(30))])],
      at(8, 5)
    )
    expect(Array.from(shuffled.get('t1')?.arrival ?? [])).toEqual([
      NaN,
      at(8, 10) + 30,
      at(8, 20) + 30,
      at(8, 30) + 90,
      at(8, 40) + 90
    ])

    // With no sequences the order given is the order of the trip, so a B after a C can't be matched.
    const given = liveTimes(
      tt,
      [
        feedTrip('t1', [
          update('C', null, late(60), late(60)),
          update('B', null, late(30), late(30))
        ])
      ],
      at(8, 5)
    )
    expect(Array.from(given.get('t1')?.arrival ?? [])).toEqual([
      NaN,
      NaN,
      at(8, 20) + 60,
      at(8, 30) + 60,
      at(8, 40) + 60
    ])
  })

  it("puts a delay on the run that's on now, even when it's the day before's", () => {
    const delayed = [feedTrip('n1', [update('B', 2, late(60), late(60))])]
    // 00:05 on the 2nd: the trip that left at 23:50 on the 1st is under way; B at 24:10 is 00:10.
    const after = liveTimes(tt, delayed, at(0, 5))
    expect(after.get('n1')?.arrival[1]).toBe(at(0, 10) + 60)
    expect(after.get('n1')?.arrival[2]).toBe(at(0, 30) + 60)
    // 23:55 on the 2nd: the 2nd's run is the one under way; B is at 00:10 on the 3rd.
    const before = liveTimes(tt, delayed, at(23, 55))
    expect(before.get('n1')?.arrival[1]).toBe(at(24, 10) + 60)
  })

  it("puts a delay on tomorrow's run when that's the one coming", () => {
    // 23:30 on the 2nd: tm leaves at 00:10 on the 3rd, 40 minutes ahead.
    const live = liveTimes(tt, [feedTrip('tm', [update('B', 2, late(60), late(60))])], at(23, 30))
    expect(Array.from(live.get('tm')?.arrival ?? [])).toEqual([
      NaN,
      at(24, 20) + 60,
      at(24, 30) + 60
    ])
  })

  it('has nothing to put a delay on when the trip runs on none of yesterday, today and tomorrow', () => {
    const live = liveTimes(tt, [feedTrip('f1', [update('B', 2, late(60), late(60))])], at(8, 5))
    expect(Array.from(live.get('f1')?.arrival ?? [])).toEqual(NaNs(3))
    expect(Array.from(live.get('f1')?.departure ?? [])).toEqual(NaNs(3))
  })

  it('has nothing when the feed has nothing', () => {
    expect(liveTimes(tt, [], at(8, 5)).size).toBe(0)
  })
})

describe('tripIndex', () => {
  it('finds every trip by its id, in its pattern at its place', () => {
    const index = tripIndex(tt)
    const ids = tt.patterns.flatMap((pattern) => pattern.trips)
    expect(index.size).toBe(ids.length)
    for (const id of ids) {
      const slot = index.get(id)
      expect(slot).toBeDefined()
      expect(tt.patterns[slot?.pattern ?? -1]?.trips[slot?.trip ?? -1]).toBe(id)
    }
    // t1 and t2 share a pattern, in departure order.
    expect(index.get('t1')?.pattern).toBe(index.get('t2')?.pattern)
    expect(index.get('t2')?.trip).toBe((index.get('t1')?.trip ?? -2) + 1)
  })

  it('is made once for a timetable', () => {
    expect(tripIndex(tt)).toBe(tripIndex(tt))
  })
})
