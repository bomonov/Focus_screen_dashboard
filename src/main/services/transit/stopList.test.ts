import { describe, expect, it } from 'vitest'
import {
  buildStopList,
  parseStopList,
  routeName,
  searchStops,
  STOP_LIST_REVISION,
  stopLine,
  stopsAlong,
  toTransitStop
} from './stopList'
import { decodeLine, lineDistances } from './routeLine'
import { zipOf } from './testFixtures'
import { ZipError } from './zip'

const SCHEDULE = {
  'routes.txt':
    'route_id,agency_id,route_short_name,route_long_name\n' +
    '72,1,72,"Scottsdale Rd/Rural Rd"\n' +
    'VENU,1,VENU,"Orbit Venus"\n',
  'trips.txt':
    'route_id,service_id,trip_id,trip_headsign,direction_id\n' +
    '72,wk,t1,"Chandler Fashion Center",1\n' +
    '72,wk,t2,"Chandler Fashion Center",1\n' +
    '72,wk,t3,"Tempe Marketplace",1\n' +
    'VENU,wk,v1,"Rural/Apache",0\n',
  'stops.txt':
    'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,location_type,parent_station\n' +
    '3102,10234,"Mill Ave & University Dr","NB Mill Av & NS University Dr",  33.42,-111.94,0,\n' +
    '3103,10235,"Rural Rd & Terrace Rd","SB Rural Rd & NS Terrace Rd",  33.41,-111.93,,\n' +
    'place_TTC,,"Tempe Transportation Center","",33.4,-111.9,1,\n' +
    '9999,19999,"Unused Stop","",33,-111,0,\n' +
    '30369,11706,"Tempe TC","Tempe TC (Bay 6 middle)",33.4,-111.9,0,place_TTC\n',
  'stop_times.txt':
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
    't1,06:01:00,06:01:00,3103,1\n' +
    't2,06:31:00,06:31:00,3103,1\n' +
    't3,07:01:00,07:01:00,3103,1\n' +
    'v1,06:05:00,06:05:00,3102,1\n' +
    'v1,06:10:00,06:10:00,3103,2\n' +
    'v1,06:20:00,06:20:00,30369,3\n' +
    'ghost,06:10:00,06:10:00,3102,2\n',
  'feed_info.txt': 'feed_publisher_name,feed_version\nCity of Phoenix,GTFS_v4.5_20260914\n'
}

describe('buildStopList', () => {
  it('keeps the stops buses stop at, with the routes there and where they head', async () => {
    const list = await buildStopList(zipOf(SCHEDULE), 1000)
    expect(list.version).toBe('GTFS_v4.5_20260914')
    expect(list.downloadedAt).toBe(1000)
    expect(list.routes).toEqual({
      '72': { short: '72', long: 'Scottsdale Rd/Rural Rd' },
      VENU: { short: 'VENU', long: 'Orbit Venus' }
    })
    expect(list.stops).toEqual([
      {
        id: '3102',
        code: '10234',
        name: 'Mill Ave & University Dr',
        detail: 'NB Mill Av & NS University Dr',
        station: '',
        serves: [['VENU', 0, 'Rural/Apache']],
        position: [33.42, -111.94]
      },
      {
        id: '3103',
        code: '10235',
        name: 'Rural Rd & Terrace Rd',
        detail: 'SB Rural Rd & NS Terrace Rd',
        station: '',
        // Two of 72's three trips here go to Chandler: that's its headsign.
        serves: [
          ['72', 1, 'Chandler Fashion Center'],
          ['VENU', 0, 'Rural/Apache']
        ],
        position: [33.41, -111.93]
      },
      {
        id: '30369',
        code: '11706',
        name: 'Tempe TC',
        detail: 'Tempe TC (Bay 6 middle)',
        station: 'Tempe Transportation Center',
        serves: [['VENU', 0, 'Rural/Apache']],
        position: [33.4, -111.9]
      }
    ])
    // This schedule has no shapes.txt: no paths, and nothing breaks.
    expect(list.lines).toEqual({})
  })

  it('keeps the path most of a route’s trips take past each stop, simplified', async () => {
    const withShapes = {
      ...SCHEDULE,
      'trips.txt':
        'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n' +
        '72,wk,t1,"Chandler Fashion Center",1,s72\n' +
        '72,wk,t2,"Chandler Fashion Center",1,s72\n' +
        '72,wk,t3,"Tempe Marketplace",1,s72short\n' +
        'VENU,wk,v1,"Rural/Apache",0,\n',
      // Out of order, as shapes.txt may be; the middle point is on the straight line.
      'shapes.txt':
        'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n' +
        's72,33.43,-111.93,3\n' +
        's72,33.41,-111.93,1\n' +
        's72,33.42,-111.93,2\n' +
        's72short,33.41,-111.93,1\n' +
        's72short,33.415,-111.93,2\n'
    }
    const list = await buildStopList(zipOf(withShapes), 1000)
    expect(list.lines).toEqual({ s72: [33.41, -111.93, 33.43, -111.93] })
    const rural = list.stops.find((stop) => stop.id === '3103')
    expect(rural?.serves).toEqual([
      // At the start of the path.
      ['72', 1, 'Chandler Fashion Center', 's72', 0],
      ['VENU', 0, 'Rural/Apache']
    ])
    if (!rural) throw new Error('no stop')
    expect(stopLine(list, rural, '72', 1, null)).toEqual({
      id: 's72',
      line: [
        [33.41, -111.93],
        [33.43, -111.93]
      ],
      along: 0
    })
    expect(stopLine(list, rural, 'VENU', 0, null)).toBeNull()
    // Saved and read back the same.
    expect(parseStopList(JSON.parse(JSON.stringify(list)))).toEqual(list)
  })

  it('places each stop along its path in the order trips make them', async () => {
    const schedule = {
      'routes.txt':
        'route_id,route_short_name,route_long_name\n35,35,7th St\nVENU,VENU,Orbit Venus\n',
      'trips.txt':
        'route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n' +
        '35,wk,a1,"Down Mill",0,m35\n' +
        '35,wk,a2,"Down Mill",0,m35\n' +
        'VENU,wk,v1,"Venus",0,loop\n',
      // Up Mill Ave, round a block, and back down Mill past stops on its other side.
      'shapes.txt':
        'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n' +
        'm35,33.41,-111.94,1\nm35,33.43,-111.94,2\nm35,33.43,-111.935,3\n' +
        'm35,33.431,-111.935,4\nm35,33.431,-111.94,5\nm35,33.4,-111.94,6\n' +
        'loop,33.42,-111.92,1\nloop,33.425,-111.92,2\nloop,33.425,-111.915,3\n' +
        'loop,33.42,-111.915,4\nloop,33.42,-111.92,5\n',
      'stops.txt':
        'stop_id,stop_name,stop_lat,stop_lon\n' +
        'up,"Mill Ave & 5th St NB",33.42,-111.9399\n' +
        'round,"Round the block",33.4305,-111.9375\n' +
        'down,"Mill Ave & 5th St SB",33.42,-111.9401\n' +
        'south,"Mill Ave & 13th St SB",33.405,-111.9401\n' +
        'first,"Orbit first stop",33.42,-111.92\n' +
        'far,"Orbit far side",33.425,-111.9175\n',
      // Rows out of order, as a file may have them; the loop ends at its first stop again.
      'stop_times.txt':
        'trip_id,stop_id,stop_sequence\n' +
        'a1,down,3\na1,up,1\na1,south,4\na1,round,2\n' +
        'a2,up,1\na2,round,2\na2,down,3\na2,south,4\n' +
        'v1,first,1\nv1,far,2\nv1,first,3\n'
    }
    const list = await buildStopList(zipOf(schedule), 1000)
    const along = (id: string): number | undefined =>
      list.stops.find((stop) => stop.id === id)?.serves[0]?.[4]
    expect(along('up')).toBeCloseTo(1106, -1)
    expect(along('round')).toBeCloseTo(2444, -1)
    // On the way back down Mill, not the way up it passes first.
    expect(along('down')).toBeCloseTo(4467, -1)
    expect(along('south')).toBeCloseTo(6126, -1)
    // The loop's first stop is at its start, though the trip ends there too.
    expect(along('first')).toBe(0)
    expect(along('far')).toBeGreaterThan(0)
    // Its end is kept too: an arrival there as the trip ends (stop_sequence 3) is the loop's end.
    const loopEnd = Math.round(lineDistances(decodeLine(list.lines?.loop) ?? []).at(-1) ?? 0)
    const first = list.stops.find((stop) => stop.id === 'first')
    if (!first) throw new Error('no stop')
    expect(first.serves).toEqual([['VENU', 0, 'Venus', 'loop', 0, [1, 0, 3, loopEnd]]])
    expect(stopLine(list, first, 'VENU', 0, 3)?.along).toBe(loopEnd)
    expect(stopLine(list, first, 'VENU', 0, 1)?.along).toBe(0)
    expect(stopLine(list, first, 'VENU', 0, null)?.along).toBe(0)
    // A bus heading there is placed by its first visit, like any stop.
    expect(stopsAlong(list, 'loop').get('first')).toBe(0)
    // By path, for placing a bus by the stop it's heading to.
    expect([...stopsAlong(list, 'm35').keys()].sort()).toEqual(['down', 'round', 'south', 'up'])
    expect(stopsAlong(list, 'm35').get('down')).toBe(along('down'))
    expect(stopsAlong(list, 'nowhere').size).toBe(0)
    expect(list.revision).toBe(STOP_LIST_REVISION)
    expect(parseStopList(JSON.parse(JSON.stringify(list)))).toEqual(list)
  })

  it('refuses a zip that isn’t a schedule', async () => {
    await expect(buildStopList(zipOf({ 'readme.txt': 'hi' }), 0)).rejects.toThrow(ZipError)
    const noTimes = { ...SCHEDULE, 'stop_times.txt': 'trip_id,stop_id\n' }
    await expect(buildStopList(zipOf(noTimes), 0)).rejects.toThrow(ZipError)
  })
})

describe('routeName', () => {
  it('says "Route 72" for numbered routes and the name for the rest', () => {
    expect(routeName('72', { short: '72', long: 'Scottsdale Rd/Rural Rd' })).toEqual({
      id: '72',
      name: 'Route 72',
      detail: 'Scottsdale Rd/Rural Rd'
    })
    expect(routeName('VENU', { short: 'VENU', long: 'Orbit Venus' }).name).toBe('Orbit Venus')
    expect(routeName('I10E', { short: 'I10E', long: '' }).name).toBe('I10E')
    expect(routeName('X', undefined).name).toBe('X')
  })
})

describe('parseStopList', () => {
  it('reads back what was saved, and nothing that isn’t a stop list', async () => {
    const list = await buildStopList(zipOf(SCHEDULE), 1000)
    expect(parseStopList(JSON.parse(JSON.stringify(list)))).toEqual(list)
    expect(parseStopList(null)).toBeNull()
    expect(parseStopList({ downloadedAt: 1, routes: {}, stops: [] })).toBeNull()
    const messy = parseStopList({
      downloadedAt: 1,
      routes: { '72': { short: 72 } },
      revision: 'new',
      stops: [
        {
          id: '1',
          name: 'A',
          serves: [
            ['72', 0, 'X'],
            ['bad'],
            ['72', 1, 'Y', 'p', -5],
            ['72', 1, 'Y', 'p', 120],
            ['72', 1, 'Y', 'p', 0, [1, 0, 26, 9600]],
            ['72', 1, 'Y', 'p', 0, [1, 0, 26]]
          ]
        },
        { id: 2 }
      ]
    })
    expect(messy).toEqual({
      downloadedAt: 1,
      version: '',
      routes: {},
      stops: [
        {
          id: '1',
          code: '',
          name: 'A',
          detail: '',
          station: '',
          serves: [
            ['72', 0, 'X'],
            ['72', 1, 'Y', 'p', 120],
            ['72', 1, 'Y', 'p', 0, [1, 0, 26, 9600]]
          ]
        }
      ]
    })
  })
})

describe('searchStops', () => {
  it('finds stops by the start of each word, its sign number or its corner', async () => {
    const list = await buildStopList(zipOf(SCHEDULE), 1000)
    const ids = (query: string): string[] => searchStops(list, query).map((stop) => stop.id)
    expect(ids('mill univ')).toEqual(['3102'])
    expect(ids('Mill Avenue and University')).toEqual(['3102'])
    expect(ids('10235')).toEqual(['3103'])
    expect(ids('nb mill')).toEqual(['3102'])
    expect(ids('rd')).toEqual(['3103'])
    expect(ids('tempe transportation')).toEqual(['30369'])
    expect(ids('')).toEqual([])
    expect(ids('nowhere')).toEqual([])
  })

  it('names each route and headsign at a stop once, for the picker', async () => {
    const list = await buildStopList(zipOf(SCHEDULE), 1000)
    const stop = list.stops[1]
    if (!stop) throw new Error('missing')
    expect(toTransitStop(list, stop).serves).toEqual([
      { route: 'Route 72', headsign: 'Chandler Fashion Center' },
      { route: 'Orbit Venus', headsign: 'Rural/Apache' }
    ])
    const loop = {
      ...stop,
      serves: [
        ['VENU', 0, 'Downtown'],
        ['VENU', 1, 'Downtown']
      ] as typeof stop.serves
    }
    expect(toTransitStop(list, loop).serves).toEqual([
      { route: 'Orbit Venus', headsign: 'Downtown' }
    ])
  })
})
