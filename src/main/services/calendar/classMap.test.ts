import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createClassMapService, type ClassMapOptions, type ClassMapService } from './classMap'
import type { MapPictureReply, MapPictureRequest } from './mapPicture'
import type { CampusBuilding } from './osmCampus'
import type { SchoolMap, SchoolMaps } from './schoolMap'
import { ASU as ASU_SCHOOL } from './schools'
import type { School } from './types'

/** Schools' maps held in memory: what a download would have saved. */
function memorySchoolMaps(maps: Record<string, SchoolMap> = {}): SchoolMaps {
  return {
    read: (school) => maps[school.name] ?? null,
    downloading: () => false,
    problem: () => null,
    download: async () => undefined,
    remove: () => undefined,
    subscribe: () => () => undefined
  }
}

const ASU = {
  features: [
    {
      properties: {
        BLDG_CODE: 'COOR',
        BLDG_NAME: 'COOR HALL',
        BLDG_CAMPUS_CODE: 'MC',
        BLDG_NUMBER: '065'
      },
      geometry: { coordinates: [-111.937294, 33.419352] }
    },
    {
      properties: {
        BLDG_CODE: 'LSE',
        BLDG_NAME: 'LIFE SCIENCES TOWER E-WING',
        BLDG_CAMPUS_CODE: 'MC',
        BLDG_NUMBER: '056E'
      },
      geometry: { coordinates: [-111.933815, 33.419514] }
    }
  ]
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Setup {
  service: ClassMapService
  options: ClassMapOptions
  fetchBuildings: Mock<() => Promise<unknown>>
  makePicture: Mock<(request: MapPictureRequest) => Promise<MapPictureReply>>
  directory: string
  later(seconds: number): number
}

function setup(changes: Partial<ClassMapOptions> = {}): Setup {
  const directory = mkdtempSync(join(tmpdir(), 'class-map-'))
  dirs.push(directory)
  const fetchBuildings = vi.fn(async (): Promise<unknown> => ASU)
  const makePicture = vi.fn(async (request: MapPictureRequest) => ({
    image: request.dark ? 'ZGFyaw==' : 'bGlnaHQ=',
    pinX: 0.5,
    pinY: 0.5
  }))
  let clock = 1_800_000_000
  const options: ClassMapOptions = {
    directory,
    fetchBuildings,
    makePicture,
    dark: () => true,
    school: () => ASU_SCHOOL,
    schoolMaps: memorySchoolMaps(),
    now: () => clock,
    ...changes
  }
  return {
    service: createClassMapService(options),
    options,
    fetchBuildings,
    makePicture,
    directory,
    later: (seconds: number) => (clock += seconds)
  }
}

describe('place', () => {
  it('finds the building, names it, and brings its picture', async () => {
    const { service, makePicture } = setup()
    expect(await service.place('Tempe - COOR195')).toEqual({
      kind: 'building',
      code: 'COOR',
      name: 'Coor Hall',
      campus: 'Tempe',
      room: '195',
      map: { image: 'data:image/jpeg;base64,ZGFyaw==', pinX: 0.5, pinY: 0.5 },
      mapKey: 'COOR',
      mapName: 'ASU Map'
    })
    expect(makePicture).toHaveBeenCalledWith({
      lat: 33.419352,
      lon: -111.937294,
      width: 440,
      height: 260,
      dark: true
    })
  })

  it('says online and unknown without making any picture', async () => {
    const { service, makePicture } = setup()
    expect(await service.place('iCourse')).toEqual({ kind: 'online' })
    expect(await service.place('Tempe - ZZZQ101')).toEqual({
      kind: 'unknown',
      school: 'ASU',
      officialMap: true
    })
    expect(await service.place('')).toBeNull()
    expect(makePicture).not.toHaveBeenCalled()
  })

  it('knows nothing when ASU’s list can’t be had and none was kept', async () => {
    const { service } = setup({ fetchBuildings: async () => null })
    expect(await service.place('Tempe - COOR195')).toBeNull()
  })

  it('still names the building when its picture can’t be made', async () => {
    const { service } = setup({ makePicture: async () => null })
    const place = await service.place('COOR 170')
    expect(place?.kind === 'building' && place.map).toBeNull()
    expect(place?.kind === 'building' && place.name).toBe('Coor Hall')
  })
})

describe('keeping things', () => {
  it('fetches ASU’s list once, keeps it on disk, and fetches again after a month', async () => {
    const first = setup()
    await first.service.place('COOR 170')
    expect(first.fetchBuildings).toHaveBeenCalledTimes(1)
    // A new start reads the kept list instead of asking ASU again.
    const again = createClassMapService({ ...first.options, fetchBuildings: first.fetchBuildings })
    await again.place('LSE 104')
    expect(first.fetchBuildings).toHaveBeenCalledTimes(1)
    first.later(31 * 24 * 3600)
    await again.place('LSE 104')
    expect(first.fetchBuildings).toHaveBeenCalledTimes(2)
  })

  it('keeps an old list when ASU can’t be reached for a new one', async () => {
    const first = setup()
    await first.service.place('COOR 170')
    first.later(31 * 24 * 3600)
    const offline = createClassMapService({ ...first.options, fetchBuildings: async () => null })
    expect((await offline.place('COOR 170'))?.kind).toBe('building')
  })

  it('makes each picture once per theme, kept on disk', async () => {
    const { service, options, makePicture, directory } = setup()
    await service.place('COOR 170')
    await service.place('Tempe - COOR195')
    expect(makePicture).toHaveBeenCalledTimes(1)
    const light = createClassMapService({ ...options, dark: () => false })
    const place = await light.place('COOR 170')
    expect(place?.kind === 'building' && place.map?.image).toBe('data:image/jpeg;base64,bGlnaHQ=')
    expect(makePicture).toHaveBeenCalledTimes(2)
    expect(readdirSync(join(directory, 'class-maps')).sort()).toEqual([
      'COOR-dark.json',
      'COOR-light.json'
    ])
  })

  it('makes pictures ahead, one building at a time and each only once', async () => {
    const { service, makePicture } = setup()
    service.prepare(['Tempe - COOR195', 'COOR 170', 'Tempe - LSE104', 'iCourse', ''])
    await vi.waitFor(() => expect(makePicture).toHaveBeenCalledTimes(2))
    expect(makePicture.mock.calls.map(([request]) => request.lat)).toEqual([33.419352, 33.419514])
  })
})

describe('position', () => {
  it('gives the building a class meets in, with no picture made', async () => {
    const { service, makePicture } = setup()
    expect(await service.position('Tempe - COOR195')).toEqual({
      name: 'Coor Hall',
      code: 'COOR',
      room: '195',
      lat: 33.419352,
      lon: -111.937294
    })
    expect(makePicture).not.toHaveBeenCalled()
  })

  it('gives nothing for a room it doesn’t know, online, or nothing', async () => {
    const { service } = setup()
    expect(await service.position('Tempe - ZZZQ101')).toBeNull()
    // On another campus than the one named: as unsure as place() is.
    expect(await service.position('Downtown - COOR195')).toBeNull()
    expect(await service.position('iCourse')).toBeNull()
    expect(await service.position('')).toBeNull()
  })

  it('gives nothing when ASU’s list can’t be had', async () => {
    const { service } = setup({ fetchBuildings: async () => null })
    expect(await service.position('Tempe - COOR195')).toBeNull()
  })
})

describe('buildings', () => {
  it('lists ASU’s buildings by code, named as the card names them', async () => {
    const { service } = setup()
    expect(await service.buildings()).toEqual([
      { key: 'COOR', code: 'COOR', name: 'Coor Hall', lat: 33.419352, lon: -111.937294 },
      {
        key: 'LSE',
        code: 'LSE',
        name: 'Life Sciences Tower E-Wing',
        lat: 33.419514,
        lon: -111.933815
      }
    ])
  })

  it('lists none when ASU’s list can’t be had', async () => {
    const { service } = setup({ fetchBuildings: async () => null })
    expect(await service.buildings()).toEqual([])
  })
})

describe('mapUrl', () => {
  it('links only to ASU’s map, on a building it knows', async () => {
    const { service } = setup()
    await service.place('COOR 170')
    expect(service.mapUrl('COOR')).toBe('https://www.asu.edu/about/map?psCode=COOR')
    expect(service.mapUrl('NOPE')).toBe('https://www.asu.edu/about/map')
    expect(service.mapUrl('"><script>')).toBe('https://www.asu.edu/about/map')
    expect(service.mapUrl(null)).toBe('https://www.asu.edu/about/map')
  })
})

describe('another school, mapped from OpenStreetMap', () => {
  const PURDUE: School = { name: 'Purdue University', country: 'US' }
  const PHYSICS: CampusBuilding = {
    id: 'way/1',
    name: 'Physics Building',
    codes: ['PHYS'],
    lat: 40.43,
    lon: -86.91
  }
  const mapped = memorySchoolMaps({
    'Purdue University': { buildings: [PHYSICS], downloadedAt: 1_800_000_000 }
  })

  it('finds the building in the school’s map, and opens it in Apple Maps', async () => {
    const { service, makePicture, fetchBuildings } = setup({
      school: () => PURDUE,
      schoolMaps: mapped
    })
    expect(await service.place('PHYS 112')).toMatchObject({
      kind: 'building',
      code: 'PHYS',
      name: 'Physics Building',
      room: '112',
      mapKey: 'way/1',
      mapName: 'Apple Maps'
    })
    expect(makePicture).toHaveBeenCalledWith(expect.objectContaining({ lat: 40.43, lon: -86.91 }))
    // ASU's list isn't asked for: it isn't this school's.
    expect(fetchBuildings).not.toHaveBeenCalled()
    expect(service.mapUrl('way/1')).toBe(
      'https://maps.apple.com/?ll=40.430000%2C-86.910000&q=Physics+Building'
    )
    expect(service.mapUrl('way/2')).toBeNull()
    expect(service.mapUrl(null)).toBeNull()
  })

  it('lists the school’s mapped buildings and gives a class’s position from them', async () => {
    const { service, fetchBuildings } = setup({ school: () => PURDUE, schoolMaps: mapped })
    expect(await service.buildings()).toEqual([
      { key: 'way/1', code: 'PHYS', name: 'Physics Building', lat: 40.43, lon: -86.91 }
    ])
    expect(await service.position('PHYS 112')).toEqual({
      name: 'Physics Building',
      code: 'PHYS',
      room: '112',
      lat: 40.43,
      lon: -86.91
    })
    expect(await service.position('ZZZ 101')).toBeNull()
    expect(fetchBuildings).not.toHaveBeenCalled()
    const unmapped = setup({ school: () => PURDUE }).service
    expect(await unmapped.buildings()).toEqual([])
    expect(await unmapped.position('PHYS 112')).toBeNull()
  })

  it('says unknown for a room it hasn’t mapped, and nothing without a map', async () => {
    const { service } = setup({ school: () => PURDUE, schoolMaps: mapped })
    expect(await service.place('ZZZ 101')).toEqual({
      kind: 'unknown',
      school: 'Purdue University',
      officialMap: false
    })
    const unmapped = setup({ school: () => PURDUE }).service
    expect(await unmapped.place('PHYS 112')).toBeNull()
  })
})
