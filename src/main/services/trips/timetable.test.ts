import { describe, expect, it } from 'vitest'
import { zipOf } from '../transit/testFixtures'
import { ZipError } from '../transit/zip'
import { near } from './testTimetable'
import { buildTimetable, serviceDayStart } from './timetable'
import type { Pattern, Timetable } from './types'

const A = near(0, 0)
const B = near(350, 0)
const C = near(0, 450)

const ROUTES =
  'route_id,agency_id,route_short_name,route_long_name,route_type,route_color,route_text_color\n' +
  '72,1,72,"Scottsdale Rd/Rural Rd",3,591769,FFFFFF\n' +
  'VMR,1,VMR,"Valley Metro Rail",0,,\n' +
  'ODD,1,ODD,"Odd colours",,red,#FFFFFF\n'

const STOPS =
  'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n' +
  `A,"Rural Rd & Terrace Rd",  ${A[0]},${A[1]},0,\n` +
  `B,"Rural Rd & University Dr",${B[0]},${B[1]},,\n` +
  `TTC,"Tempe Transportation Center",${A[0]},${A[1]},1,\n` +
  `C,"Apache Blvd & Rural Rd",${C[0]},${C[1]},0,TTC\n` +
  'X,"Nowhere",,,0,\n'

const TRIPS_HEADER = 'route_id,service_id,trip_id,trip_headsign,direction_id\n'
// A row that stops short of the last two columns lets riders on and off.
const TIMES_HEADER =
  'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n'
const DATES_HEADER = 'service_id,date,exception_type\n'
const CALENDAR_HEADER =
  'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n'
const FREQUENCIES_HEADER = 'trip_id,start_time,end_time,headway_secs\n'

/** A schedule on stops A, B, C (and a station and a stop without a place, neither kept). */
function schedule(files: {
  trips: string[]
  times: string[]
  dates?: string[]
  calendar?: string[]
  frequencies?: string[]
}): Uint8Array {
  return zipOf({
    'routes.txt': ROUTES,
    'stops.txt': STOPS,
    'trips.txt': TRIPS_HEADER + files.trips.map((row) => `${row}\n`).join(''),
    'stop_times.txt': TIMES_HEADER + files.times.map((row) => `${row}\n`).join(''),
    'calendar_dates.txt':
      DATES_HEADER + (files.dates ?? ['wk,20261102,1']).map((row) => `${row}\n`).join(''),
    ...(files.calendar
      ? { 'calendar.txt': CALENDAR_HEADER + files.calendar.map((row) => `${row}\n`).join('') }
      : {}),
    ...(files.frequencies
      ? {
          'frequencies.txt':
            FREQUENCIES_HEADER + files.frequencies.map((row) => `${row}\n`).join('')
        }
      : {}),
    'feed_info.txt': 'feed_publisher_name,feed_version\nCity of Phoenix,GTFS_v4.5_20260914\n'
  })
}

/** stop_times rows for a trip making these stops at these times (arrives and leaves then). */
function run(trip: string, ...stops: [stop: string, time: string][]): string[] {
  return stops.map(([stop, time], i) => `${trip},${time},${time},${stop},${i + 1}`)
}

/** A pattern as plain values, to compare whole. */
function plain(pattern: Pattern | undefined): unknown {
  if (!pattern) return undefined
  return {
    ...pattern,
    stops: Array.from(pattern.stops),
    service: Array.from(pattern.service),
    times: Array.from(pattern.times)
  }
}

function neighbours(tt: Timetable, stop: number): [string, number][] {
  const { start, to, metres } = tt.transfers
  const out: [string, number][] = []
  for (let k = start[stop] as number; k < (start[stop + 1] as number); k++) {
    out.push([tt.stops.ids[to[k] as number] as string, metres[k] as number])
  }
  return out
}

describe('buildTimetable', () => {
  it('groups trips by route, direction, headsign and stops, in stop_sequence order', async () => {
    const tt = await buildTimetable(
      schedule({
        trips: [
          '72,wk,t2,"Chandler",1',
          '72,wk,t1,"Chandler",1',
          '72,wk,t3,,1',
          'VMR,wk,r1,"Downtown",'
        ],
        times: [
          // t1's rows out of order, as nothing in GTFS promises they come in order.
          't1,06:20:00,06:20:00,C,3',
          't1,06:00:00,06:00:30,A,1',
          't1,06:10:00,06:10:00,B,2',
          ...run('t2', ['A', '06:30:00'], ['B', '06:40:00'], ['C', '06:50:00']),
          // Sequence numbers only have to go up.
          't3,07:00:00,07:00:00,A,5',
          't3,07:10:00,07:10:00,B,9',
          // A stop that isn't kept (no place) is left out of the trip.
          't3,07:15:00,07:15:00,X,10',
          ...run('r1', ['C', '08:00:00'], ['A', '08:05:00'])
        ]
      })
    )
    expect(tt.version).toBe('GTFS_v4.5_20260914')
    expect(tt.stops.ids).toEqual(['A', 'B', 'C'])
    expect(tt.stops.names).toEqual([
      'Rural Rd & Terrace Rd',
      'Rural Rd & University Dr',
      'Apache Blvd & Rural Rd'
    ])
    expect(Array.from(tt.stops.lat)).toEqual([A[0], B[0], C[0]])
    expect(Array.from(tt.stops.lon)).toEqual([A[1], B[1], C[1]])
    expect(tt.services.map((dates) => Array.from(dates))).toEqual([[20261102]])
    expect(tt.patterns.map(plain)).toEqual([
      {
        route: 0,
        direction: 1,
        headsign: 'Chandler',
        stops: [0, 1, 2],
        trips: ['t1', 't2'],
        service: [0, 0],
        times: [21600, 21630, 22200, 22200, 22800, 22800, 23400, 23400, 24000, 24000, 24600, 24600]
      },
      {
        route: 0,
        direction: 1,
        // No headsign: the last stop's name says where it's going.
        headsign: 'Rural Rd & University Dr',
        stops: [0, 1],
        trips: ['t3'],
        service: [0],
        times: [25200, 25200, 25800, 25800]
      },
      {
        route: 1,
        direction: -1,
        headsign: 'Downtown',
        stops: [2, 0],
        trips: ['r1'],
        service: [0],
        times: [28800, 28800, 29100, 29100]
      }
    ])
  })

  it('keeps trips apart that differ in route, direction or headsign', async () => {
    const tt = await buildTimetable(
      schedule({
        trips: [
          '72,wk,base,"Chandler",1',
          '72,wk,back,"Chandler",0',
          '72,wk,mesa,"Mesa",1',
          'VMR,wk,rail,"Chandler",1',
          '72,wk,again,"Chandler",1'
        ],
        times: [
          ...run('base', ['A', '06:10:00'], ['B', '06:15:00']),
          ...run('back', ['A', '06:20:00'], ['B', '06:25:00']),
          ...run('mesa', ['A', '06:30:00'], ['B', '06:35:00']),
          ...run('rail', ['A', '06:40:00'], ['B', '06:45:00']),
          ...run('again', ['A', '06:50:00'], ['B', '06:55:00'])
        ]
      })
    )
    expect(tt.patterns.map((p) => p.trips)).toEqual([
      ['base', 'again'],
      ['back'],
      ['mesa'],
      ['rail']
    ])
  })

  it('reads the service days from calendar_dates alone when there’s no calendar.txt', async () => {
    const tt = await buildTimetable(
      schedule({
        trips: ['72,wk,t1,"Chandler",1', '72,sat,t2,"Chandler",1', '72,gone,t3,"Chandler",1'],
        times: [
          ...run('t1', ['A', '06:00:00'], ['B', '06:10:00']),
          ...run('t2', ['A', '06:30:00'], ['B', '06:40:00']),
          ...run('t3', ['A', '07:00:00'], ['B', '07:10:00'])
        ],
        dates: [
          'wk,20261103,1',
          'wk,20261102,1',
          'sat,20261107,1',
          // Removing a day from a service with none runs it on none: its trips are left out.
          'gone,20261102,2'
        ]
      })
    )
    expect(tt.services.map((dates) => Array.from(dates))).toEqual([
      [20261102, 20261103],
      [20261107]
    ])
    expect(tt.patterns.map(plain)).toEqual([
      expect.objectContaining({ trips: ['t1', 't2'], service: [0, 1] })
    ])
  })

  it('runs calendar.txt’s weekdays between its dates, with calendar_dates’ changes', async () => {
    const tt = await buildTimetable(
      schedule({
        trips: ['72,wk,t1,"Chandler",1', '72,sat,t2,"Chandler",1', '72,same,t3,"Chandler",1'],
        times: [
          ...run('t1', ['A', '06:00:00'], ['B', '06:10:00']),
          ...run('t2', ['A', '06:30:00'], ['B', '06:40:00']),
          ...run('t3', ['A', '07:00:00'], ['B', '07:10:00'])
        ],
        // Mon 2 Nov to Sun 15 Nov 2026, weekdays.
        calendar: ['wk,1,1,1,1,1,0,0,20261102,20261115'],
        dates: [
          // Veterans Day off, a Saturday on.
          'wk,20261111,2',
          'wk,20261114,1',
          'sat,20261107,1',
          // A service on the same days as another is the same service.
          'same,20261107,1'
        ]
      })
    )
    expect(tt.services.map((dates) => Array.from(dates))).toEqual([
      [
        20261102, 20261103, 20261104, 20261105, 20261106, 20261109, 20261110, 20261112, 20261113,
        20261114
      ],
      [20261107]
    ])
    expect(Array.from(tt.patterns[0]?.service ?? [])).toEqual([0, 1, 1])
  })

  it('reads times past midnight and hours of one digit', async () => {
    const tt = await buildTimetable(
      schedule({
        trips: ['72,wk,owl,"Chandler",1', '72,wk,early,"Chandler",1'],
        times: [
          ...run('owl', ['A', '24:50:00'], ['B', '25:10:00']),
          ...run('early', ['A', '5:05:00'], ['B', '5:15:00'])
        ]
      })
    )
    expect(tt.patterns[0]?.trips).toEqual(['early', 'owl'])
    expect(Array.from(tt.patterns[0]?.times ?? [])).toEqual([
      18300, 18300, 18900, 18900, 89400, 89400, 90600, 90600
    ])
  })

  it('puts a trip that would overtake another at a middle stop in a pattern of its own', async () => {
    const tt = await buildTimetable(
      schedule({
        trips: ['72,wk,slow,"Chandler",1', '72,wk,fast,"Chandler",1', '72,wk,later,"Chandler",1'],
        times: [
          ...run('slow', ['A', '06:00:00'], ['B', '06:10:00'], ['C', '06:20:00']),
          // Leaves A after slow but reaches B before it.
          ...run('fast', ['A', '06:05:00'], ['B', '06:08:00'], ['C', '06:30:00']),
          ...run('later', ['A', '06:30:00'], ['B', '06:40:00'], ['C', '06:50:00'])
        ]
      })
    )
    expect(tt.patterns.map((p) => [p.trips, Array.from(p.stops)])).toEqual([
      [
        ['slow', 'later'],
        [0, 1, 2]
      ],
      [['fast'], [0, 1, 2]]
    ])
  })

  it('orders trips leaving together by their later times, then by id, whatever the listing', async () => {
    const trips = ['72,wk,b,"Chandler",1', '72,wk,a,"Chandler",1', '72,wk,quick,"Chandler",1']
    const times = [
      ...run('b', ['A', '06:00:00'], ['B', '06:12:00']),
      ...run('a', ['A', '06:00:00'], ['B', '06:12:00']),
      ...run('quick', ['A', '06:00:00'], ['B', '06:10:00'])
    ]
    const forwards = await buildTimetable(schedule({ trips, times }))
    const backwards = await buildTimetable(
      schedule({ trips: [...trips].reverse(), times: [...times].reverse() })
    )
    for (const tt of [forwards, backwards]) {
      expect(tt.patterns.map((p) => p.trips)).toEqual([['quick', 'a', 'b']])
    }
  })

  it('leaves out trips it can’t ride: one stop, or times that run backwards', async () => {
    const tt = await buildTimetable(
      schedule({
        trips: ['72,wk,one,"Chandler",1', '72,wk,back,"Chandler",1', '72,wk,ok,"Chandler",1'],
        times: [
          ...run('one', ['A', '06:00:00']),
          ...run('back', ['A', '06:00:00'], ['B', '05:50:00']),
          ...run('ok', ['A', '07:00:00'], ['B', '07:10:00'])
        ]
      })
    )
    expect(tt.patterns.map((p) => p.trips)).toEqual([['ok']])
  })

  it('leaves out the stops a trip doesn’t let riders on or off at', async () => {
    const tt = await buildTimetable(
      schedule({
        trips: [
          '72,wk,ends,"Chandler",1',
          '72,wk,starts,"Chandler",1',
          '72,wk,middle,"Chandler",1',
          '72,wk,middle2,"Chandler",1',
          '72,wk,gone,"Chandler",1',
          '72,wk,ask,"Chandler",1'
        ],
        times: [
          // Its last stop is for staying on (drop_off_type 1, as at the end of light rail's
          // inbound trips): no ride can end there, so the trip ends a stop sooner.
          'ends,06:00:00,06:00:00,A,1,0,0',
          'ends,06:10:00,06:10:00,B,2,0,0',
          'ends,06:20:00,06:20:00,C,3,0,1',
          // No one gets on at its first stop: it starts at the next.
          'starts,07:00:00,07:00:00,A,1,1,0',
          'starts,07:10:00,07:10:00,B,2,0,0',
          'starts,07:20:00,07:20:00,C,3,0,0',
          // A stop along the way that's only one of on or off is left out: a ride may be
          // missed there, but never one the bus wouldn't give.
          'middle,08:00:00,08:00:00,A,1',
          'middle,08:10:00,08:10:00,B,2,1,0',
          'middle,08:20:00,08:20:00,C,3',
          'middle2,08:30:00,08:30:00,A,1',
          'middle2,08:40:00,08:40:00,B,2,0,1',
          'middle2,08:50:00,08:50:00,C,3',
          // Nothing left to ride once both ends are cut.
          'gone,09:00:00,09:00:00,A,1,1,0',
          'gone,09:10:00,09:10:00,B,2,0,0',
          'gone,09:20:00,09:20:00,C,3,0,1',
          // 2 (phone ahead) and 3 (ask the driver) still stop.
          'ask,10:00:00,10:00:00,A,1,2,3',
          'ask,10:10:00,10:10:00,B,2,3,2',
          'ask,10:20:00,10:20:00,C,3,,'
        ]
      })
    )
    const named = (stops: Uint32Array): string[] => Array.from(stops, (s) => tt.stops.ids[s] ?? '')
    expect(tt.patterns.map((p) => [p.trips, named(p.stops)])).toEqual([
      [['ends'], ['A', 'B']],
      [['starts'], ['B', 'C']],
      [
        ['middle', 'middle2'],
        ['A', 'C']
      ],
      [['ask'], ['A', 'B', 'C']]
    ])
    expect(Array.from(tt.patterns[1]?.times ?? [])).toEqual([25800, 25800, 26400, 26400])
  })

  it('runs a frequencies.txt trip every headway between its times, each run a trip', async () => {
    const tt = await buildTimetable(
      schedule({
        trips: ['VMR,wk,sky,"Terminal 4",1', '72,wk,bus,"Chandler",1'],
        times: [
          // The template's own times only say how long each stop is from its start.
          ...run('sky', ['A', '06:00:00'], ['B', '06:03:00']),
          ...run('bus', ['A', '06:00:00'], ['B', '06:10:00'])
        ],
        frequencies: [
          'sky,05:00:00,05:10:00,270',
          'sky,22:00:00,22:05:00,510',
          // Not a headway: the trip runs as listed.
          'bus,05:00:00,05:10:00,0'
        ]
      })
    )
    expect(tt.patterns.map(plain)).toEqual([
      expect.objectContaining({
        route: 1,
        trips: ['sky@18000', 'sky@18270', 'sky@18540', 'sky@79200'],
        service: [0, 0, 0, 0],
        times: [
          18000, 18000, 18180, 18180, 18270, 18270, 18450, 18450, 18540, 18540, 18720, 18720, 79200,
          79200, 79380, 79380
        ]
      }),
      expect.objectContaining({ trips: ['bus'], times: [21600, 21600, 22200, 22200] })
    ])
  })

  it('makes stops 350 m apart each other’s change, and not 450 m apart', async () => {
    const tt = await buildTimetable(schedule({ trips: [], times: [] }))
    expect(Array.from(tt.transfers.start)).toEqual([0, 1, 2, 2])
    expect(neighbours(tt, 0)).toEqual([['B', 350]])
    expect(neighbours(tt, 1)).toEqual([['A', 350]])
    // C is 450 m from A and 570 m from B.
    expect(neighbours(tt, 2)).toEqual([])
  })

  it('keeps each route’s names, type and colours', async () => {
    const tt = await buildTimetable(schedule({ trips: [], times: [] }))
    expect(tt.routes).toEqual([
      {
        id: '72',
        short: '72',
        long: 'Scottsdale Rd/Rural Rd',
        color: '591769',
        textColor: 'FFFFFF',
        type: 3
      },
      { id: 'VMR', short: 'VMR', long: 'Valley Metro Rail', color: '', textColor: '', type: 0 },
      // No type reads as a bus, not a colour as none, and a "#" (GTFS writes none) is dropped.
      { id: 'ODD', short: 'ODD', long: 'Odd colours', color: '', textColor: 'FFFFFF', type: 3 }
    ])
  })

  it('refuses a zip that isn’t a schedule, or has no service days', async () => {
    await expect(buildTimetable(zipOf({ 'readme.txt': 'hi' }))).rejects.toThrow(ZipError)
    const noCalendar = zipOf({
      'routes.txt': ROUTES,
      'stops.txt': STOPS,
      'trips.txt': TRIPS_HEADER,
      'stop_times.txt': TIMES_HEADER
    })
    await expect(buildTimetable(noCalendar)).rejects.toThrow(ZipError)
  })
})

describe('serviceDayStart', () => {
  it('is Arizona’s midnight of the day, which never moves for summer time', () => {
    expect(serviceDayStart(20261102)).toBe(1793602800)
    expect(serviceDayStart(20260701) - serviceDayStart(20260630)).toBe(86400)
  })
})
