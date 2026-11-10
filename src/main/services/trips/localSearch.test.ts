import { describe, expect, it } from 'vitest'
import type { StopList } from '../transit/stopList'
import { buildingPlaces, searchLocal, stopPlaces } from './localSearch'
import type { Place } from './types'

const at = (
  kind: Place['kind'],
  id: string,
  name: string,
  detail = '',
  lat = 33.42,
  lon = -111.93
): Place => ({ id, kind, name, detail, lat, lon })

const HOME = at('home', 'home', 'Home')
const COOR = at('building', 'building:COOR', 'Coor Hall', 'COOR')
const BUILDINGS = [
  at('building', 'building:CCB', 'Coordinated Care Building', 'CCB'),
  COOR,
  at('building', 'building:LSE', 'Life Sciences Tower E-Wing', 'LSE'),
  at('building', 'building:LSA', 'Life Sciences A Wing', 'LSA'),
  at('building', 'building:PSH', 'LS Hall', 'PSH')
]
const STOPS = [
  at('stop', 'stop:3103', 'Rural Rd & Terrace Rd', 'Orbit Venus · Route 72'),
  at('stop', 'stop:3104', 'Mill Ave & University Dr', 'Route 72'),
  at('stop', 'stop:3105', 'Coor Hall', 'Route 30')
]

const none = {
  home: null,
  saved: [],
  recents: [],
  nextClass: null,
  buildings: [],
  stops: []
}

const ids = (places: Place[]): string[] => places.map((p) => p.id)

describe('searchLocal', () => {
  it('finds a building by its code, first', () => {
    const found = searchLocal('coor', { ...none, buildings: BUILDINGS, stops: STOPS })
    expect(found[0]).toEqual(COOR)
    // Then other buildings by name, then stops.
    expect(ids(found)).toEqual(['building:COOR', 'building:CCB', 'stop:3105'])
  })

  it('puts buildings matched by code before those matched by name, each in order', () => {
    expect(ids(searchLocal('ls', { ...none, buildings: BUILDINGS }))).toEqual([
      'building:LSA',
      'building:LSE',
      'building:PSH'
    ])
  })

  it('finds a stop by a word of its name', () => {
    expect(ids(searchLocal('rural', { ...none, stops: STOPS }))).toEqual(['stop:3103'])
    expect(ids(searchLocal('terr rural', { ...none, stops: STOPS }))).toEqual(['stop:3103'])
    expect(searchLocal('rural mill', { ...none, stops: STOPS })).toEqual([])
  })

  it('doesn’t match a stop by its routes', () => {
    expect(searchLocal('venus', { ...none, stops: STOPS })).toEqual([])
  })

  it('spells streets alike: Avenue and Ave, Drive and Dr, & and and', () => {
    expect(ids(searchLocal('mill avenue', { ...none, stops: STOPS }))).toEqual(['stop:3104'])
    expect(ids(searchLocal('university drive', { ...none, stops: STOPS }))).toEqual(['stop:3104'])
    expect(ids(searchLocal('rural and terrace', { ...none, stops: STOPS }))).toEqual(['stop:3103'])
    // Valley Metro writes "Av".
    const av = [at('stop', 'stop:9', 'Mill Av & 3rd St')]
    expect(ids(searchLocal('mill ave', { ...none, stops: av }))).toEqual(['stop:9'])
    expect(ids(searchLocal('mill avenue', { ...none, stops: av }))).toEqual(['stop:9'])
  })

  it('keeps a street word found while it’s typed, letter by letter', () => {
    const stops = { ...none, stops: STOPS }
    for (const typed of ['mill a', 'mill av', 'mill ave', 'mill aven', 'mill avenu']) {
      expect(ids(searchLocal(typed, stops))).toEqual(['stop:3104'])
    }
    for (const typed of ['university d', 'university dr', 'university dri', 'university driv']) {
      expect(ids(searchLocal(typed, stops))).toEqual(['stop:3104'])
    }
    const main = { ...none, stops: [at('stop', 'stop:7', 'Main St & 5th Pl')] }
    for (const typed of ['main s', 'main st', 'main stre', 'main stree', 'main street']) {
      expect(ids(searchLocal(typed, main))).toEqual(['stop:7'])
    }
  })

  it('takes a street word typed as typed: “street” isn’t “Stadium”', () => {
    const stops = {
      ...none,
      stops: [at('stop', 'stop:1', 'Sun Devil Stadium'), at('stop', 'stop:2', '5th Street')]
    }
    expect(ids(searchLocal('street', stops))).toEqual(['stop:2'])
    expect(ids(searchLocal('st', stops))).toEqual(['stop:2', 'stop:1'])
  })

  it('finds Home', () => {
    expect(searchLocal('home', { ...none, home: HOME })).toEqual([HOME])
    expect(searchLocal('HO', { ...none, home: HOME })).toEqual([HOME])
  })

  it('matches the start of a word only, ignoring case and accents', () => {
    const cafe = at('saved', 'saved:1', 'Café Allégro', 'Mill Ave, Tempe')
    const sources = { ...none, saved: [cafe], buildings: BUILDINGS }
    expect(searchLocal('CAFE', sources)).toEqual([cafe])
    expect(searchLocal('allegro', sources)).toEqual([cafe])
    expect(searchLocal('oor', sources)).toEqual([])
    // A saved place's street counts too.
    expect(searchLocal('mill', sources)).toEqual([cafe])
  })

  it('lets an apostrophe go: "joes" finds Trader Joe’s', () => {
    const joes = at('recent', 'apple:1', 'Trader Joe’s')
    expect(searchLocal('joes', { ...none, recents: [joes] })).toEqual([joes])
    expect(searchLocal('joe', { ...none, recents: [joes] })).toEqual([joes])
  })

  it('lists Home, the next class, saved, recents, buildings, then stops', () => {
    const sources = {
      home: HOME,
      nextClass: at('class', 'class:next', 'Homer Hall', 'ENG 101'),
      saved: [at('saved', 'saved:1', 'Home Depot')],
      recents: [at('recent', 'apple:2', 'Homewood Suites')],
      buildings: [at('building', 'building:HEH', 'Home Economics Hall', 'HEH')],
      stops: [at('stop', 'stop:9', 'Homestead Rd & Main St')]
    }
    expect(ids(searchLocal('home', sources))).toEqual([
      'home',
      'class:next',
      'saved:1',
      'apple:2',
      'building:HEH',
      'stop:9'
    ])
  })

  it('lists a place once: a recent building is shown as the recent', () => {
    const recent = { ...COOR, kind: 'recent' as const }
    const found = searchLocal('coor', { ...none, recents: [recent], buildings: BUILDINGS })
    expect(found.filter((p) => p.id === 'building:COOR')).toEqual([recent])
  })

  it('keeps at most 12', () => {
    const many = Array.from({ length: 30 }, (_, i) => at('stop', `stop:${i}`, `Main St & ${i}th`))
    expect(searchLocal('main', { ...none, stops: many })).toHaveLength(12)
  })

  it('finds nothing for nothing typed', () => {
    expect(searchLocal('  ', { ...none, home: HOME, stops: STOPS })).toEqual([])
    expect(searchLocal('&', { ...none, home: HOME, stops: STOPS })).toEqual([])
  })
})

describe('buildingPlaces', () => {
  it('makes places from the school’s buildings, the code as the second line', () => {
    expect(
      buildingPlaces([
        { key: 'COOR', code: 'COOR', name: 'Coor Hall', lat: 33.419352, lon: -111.937294 },
        { key: 'way/1', code: null, name: 'Physics Building', lat: 40.43, lon: -86.91 }
      ])
    ).toEqual([
      {
        id: 'building:COOR',
        kind: 'building',
        name: 'Coor Hall',
        detail: 'COOR',
        lat: 33.419352,
        lon: -111.937294
      },
      {
        id: 'building:way/1',
        kind: 'building',
        name: 'Physics Building',
        detail: '',
        lat: 40.43,
        lon: -86.91
      }
    ])
  })
})

describe('stopPlaces', () => {
  const list: StopList = {
    downloadedAt: 0,
    version: '',
    routes: {
      '72': { short: '72', long: 'Scottsdale Rd/Rural Rd' },
      VENU: { short: 'VENU', long: 'Orbit Venus' }
    },
    stops: [
      {
        id: '3103',
        code: '10235',
        name: 'Rural Rd & Terrace Rd',
        detail: 'SB Rural Rd & NS Terrace Rd',
        station: '',
        serves: [
          ['VENU', 0, 'Counterclockwise'],
          ['72', 0, 'Chandler'],
          ['VENU', 1, 'Clockwise']
        ],
        position: [33.41, -111.93]
      },
      // Without a position there's nowhere to plan to.
      { id: '3104', code: '', name: 'Nowhere', detail: '', station: '', serves: [] },
      {
        id: '3105',
        code: '10236',
        name: 'Mill Ave & 3rd St',
        detail: '',
        station: '',
        serves: [],
        position: [33.43, -111.94]
      }
    ]
  }

  it('makes places from the stop list, its routes as the second line', () => {
    expect(stopPlaces(list)).toEqual([
      {
        id: 'stop:3103',
        kind: 'stop',
        name: 'Rural Rd & Terrace Rd',
        detail: 'Orbit Venus · Route 72',
        lat: 33.41,
        lon: -111.93
      },
      {
        id: 'stop:3105',
        kind: 'stop',
        name: 'Mill Ave & 3rd St',
        detail: 'Stop 10236',
        lat: 33.43,
        lon: -111.94
      }
    ])
  })

  it('makes them once per stop list', () => {
    expect(stopPlaces(list)).toBe(stopPlaces(list))
  })
})
