import { describe, expect, it } from 'vitest'
import {
  campusMapUrl,
  campusName,
  classPlace,
  displayName,
  parseBuildings,
  type Building
} from './campus'

const feature = (
  code: string,
  name: string,
  campus: string,
  number: string,
  at: number[]
): Record<string, unknown> => ({
  type: 'Feature',
  properties: { BLDG_CODE: code, BLDG_NAME: name, BLDG_CAMPUS_CODE: campus, BLDG_NUMBER: number },
  geometry: { type: 'Point', coordinates: at }
})

// Positions as ASU's facilities list gives them (checked 2026-10-18).
const RAW = {
  type: 'FeatureCollection',
  features: [
    feature('COOR', 'COOR HALL', 'MC', '065', [-111.937294, 33.419352]),
    feature('ECG', 'ENGINEERING CENTER G', 'MC', '044G', [-111.932088, 33.420014]),
    feature('EC', 'EXAMPLE CODE THAT IS A PREFIX', 'MC', '999', [-111.93, 33.42]),
    feature('DH', 'DURHAM HALL', 'MC', '012', [-111.934531, 33.42092]),
    feature('LSE', 'LIFE SCIENCES TOWER E-WING', 'MC', '056E', [-111.933815, 33.419514]),
    feature('PSH', 'BATEMAN PHYSICAL SCIENCES CENTER H', 'MC', '057H', [-111.931663, 33.421644]),
    feature('CRONK', 'CRONKITE/ARIZONA PBS', 'DT', '701', [-112.073201, 33.453783]),
    feature('WCPH', 'WALTON CENTER FOR PLANETARY HEALTH', 'MC', '079', [-111.927187, 33.421411]),
    // A code that starts like a campus's name, which must still be found as a building.
    feature('WESTB', 'A BUILDING CALLED WEST B', 'MC', '998', [-111.92, 33.42]),
    // An outdoor room repeating a building's code, a record at 0,0, and a duplicate code.
    feature('SCOB', 'SCHOOL OF BUSINESS PATIO', 'MC', 'X123', [-111.9, 33.4]),
    feature('MIX', 'SOMEWHERE OFF CAMPUS', 'OC', '900', [0, 0]),
    feature('COOR', 'SECOND COOR RECORD', 'MC', '066', [-111.0, 33.0]),
    { type: 'Feature', properties: { BLDG_CODE: 'BAD' }, geometry: null }
  ]
}

const buildings = parseBuildings(RAW)
const place = (location: string): ReturnType<typeof classPlace> => classPlace(location, buildings)
const at = (location: string): string | null => {
  const found = place(location)
  return found?.kind === 'building' ? `${found.building.code} ${found.room ?? '-'}` : null
}

describe('parseBuildings', () => {
  it('keeps real buildings with their positions', () => {
    expect(buildings.get('COOR')).toEqual<Building>({
      code: 'COOR',
      name: 'COOR HALL',
      campus: 'MC',
      lat: 33.419352,
      lon: -111.937294
    })
    expect(buildings.get('CRONK')?.campus).toBe('DT')
  })

  it('drops outdoor rooms, unplaced records and broken ones, and keeps a code’s first record', () => {
    expect(buildings.has('SCOB')).toBe(false)
    expect(buildings.has('MIX')).toBe(false)
    expect(buildings.has('BAD')).toBe(false)
    expect(buildings.get('COOR')?.name).toBe('COOR HALL')
  })

  it('gives an empty table for anything that isn’t the list', () => {
    expect(parseBuildings(null).size).toBe(0)
    expect(parseBuildings({ features: 'no' }).size).toBe(0)
  })
})

describe('classPlace', () => {
  it('reads the class schedule’s format: campus, then the code and room run together', () => {
    expect(at('Tempe - COOR195')).toBe('COOR 195')
    expect(at('Tempe - DHL1-07')).toBe('DH L1-07')
    expect(at('Dtphx - CRONK447')).toBe('CRONK 447')
  })

  it('reads a campus written without the dash, as some calendars do', () => {
    expect(at('Tempe WCPH 107')).toBe('WCPH 107')
    expect(at('tempe  wcph107')).toBe('WCPH 107')
    expect(at('Downtown Phoenix CRONK 447')).toBe('CRONK 447')
    expect(place('Downtown Phoenix COOR 170')).toEqual({ kind: 'unknown' })
  })

  it('still finds a building whose code starts like a campus name', () => {
    expect(at('WESTB 120')).toBe('WESTB 120')
  })

  it('takes the longest code that leaves a room, so ECG G320 isn’t EC GG320', () => {
    expect(at('Tempe - ECGG320')).toBe('ECG G320')
  })

  it('reads typed locations, with or without a space, and a building alone', () => {
    expect(at('COOR 170')).toBe('COOR 170')
    expect(at('lse104')).toBe('LSE 104')
    expect(at('ECG G237')).toBe('ECG G237')
    expect(at('PSH')).toBe('PSH -')
  })

  it('says online for online classes, so there’s no map to offer', () => {
    for (const location of [
      'iCourse',
      'ASU Online',
      'Internet - Hybrid',
      'https://asu.zoom.us/j/1'
    ]) {
      expect(place(location)).toEqual({ kind: 'online' })
    }
  })

  it('never guesses: an unknown code, a campus that doesn’t match, or a non-room leftover', () => {
    expect(place('Tempe - ZZZQ101')).toEqual({ kind: 'unknown' })
    expect(place('Dtphx - COOR195')).toEqual({ kind: 'unknown' })
    expect(place('Coordinator office')).toEqual({ kind: 'unknown' })
  })

  it('has nothing to say about an empty location', () => {
    expect(place('')).toBeNull()
    expect(place('   ')).toBeNull()
  })
})

describe('names and links', () => {
  it('puts ASU’s capitals into title case, keeping wing letters and numbers', () => {
    expect(displayName('COOR HALL')).toBe('Coor Hall')
    expect(displayName('BATEMAN PHYSICAL SCIENCES CENTER H')).toBe(
      'Bateman Physical Sciences Center H'
    )
    expect(displayName('LIFE SCIENCES TOWER E-WING')).toBe('Life Sciences Tower E-Wing')
    expect(displayName('MCCLINTOCK HALL')).toBe('McClintock Hall')
    expect(displayName('COLLEGE OF HEALTH AND THE ARTS')).toBe('College of Health and the Arts')
    expect(displayName('ISTB4')).toBe('ISTB4')
    expect(displayName('CRONKITE/ARIZONA PBS')).toBe('Cronkite/Arizona PBS')
    expect(displayName('HAV- VERBENA HALL (G WING)')).toBe('Hav- Verbena Hall (G Wing)')
    expect(displayName('SCHWADA CLASSROOM OFFICE BLDG.')).toBe('Schwada Classroom Office Bldg.')
  })

  it('links to ASU’s map, on the building when there is one', () => {
    expect(campusMapUrl('COOR')).toBe('https://www.asu.edu/about/map?psCode=COOR')
    expect(campusMapUrl(null)).toBe('https://www.asu.edu/about/map')
  })

  it('names the campuses', () => {
    expect(campusName('MC')).toBe('Tempe')
    expect(campusName('DT')).toBe('Downtown Phoenix')
    expect(campusName('RP')).toBe('')
  })
})
