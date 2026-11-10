import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { writeJsonFile } from '../jsonFile'
import {
  campusMapUrl,
  campusName,
  classPlace,
  displayName,
  parseBuildings,
  type Building
} from './campus'
import type { MapPictureReply, MapPictureRequest } from './mapPicture'
import { appleMapsUrl, campusPlace, type CampusBuilding } from './osmCampus'
import type { SchoolMaps } from './schoolMap'
import { isAsu } from './schools'
import type { ClassMapPicture, ClassPlaceInfo, School } from './types'

/** ASU's list changes when buildings do: rarely. */
const BUILDINGS_MAX_AGE_SEC = 30 * 24 * 3600
/** Apple's map style and labels change now and then; a building doesn't move. */
const PICTURE_MAX_AGE_SEC = 90 * 24 * 3600
/** The picture's size in points: the card's map, at the screen's scale. */
const PICTURE_SIZE = { width: 440, height: 260 }
/** A card that opens before its picture is made waits this long for it, then shows without. */
const WAIT_FOR_PICTURE_MS = 6000

export interface ClassMapOptions {
  /** userData: the building list and the pictures are kept here. */
  directory: string
  /** ASU's facilities list (the GeoJSON body), or null when it can't be had. */
  fetchBuildings(): Promise<unknown>
  /** Makes one picture with the helper; null off macOS, or when it isn't built. */
  makePicture: ((request: MapPictureRequest) => Promise<MapPictureReply | null>) | null
  /** The map matches the theme: dark unless it's the day theme. */
  dark(): boolean
  /** The school picked in Customize: ASU uses its own list, others their OpenStreetMap map. */
  school(): School
  schoolMaps: SchoolMaps
  /** Unix seconds. */
  now?: () => number
}

/** One of the school's buildings, for the trip card's search. */
export interface SchoolBuilding {
  /** ASU's code, or the OpenStreetMap id ("way/123") for another school. */
  key: string
  code: string | null
  /** As the class card names it: "Coor Hall". */
  name: string
  lat: number
  lon: number
}

/** Where a class meets, for planning a trip there. */
export interface ClassPosition {
  name: string
  code: string | null
  room: string | null
  lat: number
  lon: number
}

export interface ClassMapService {
  /** Where a class's location says it meets, with its map; null when that can't be known. */
  place(location: string): Promise<ClassPlaceInfo | null>
  /**
   * The building a class's location names, matched exactly as `place` matches it (never a
   * guess), with no map made; null when it names none for sure.
   */
  position(location: string): Promise<ClassPosition | null>
  /** The school's buildings: ASU's list, or the school's OpenStreetMap map; none without one. */
  buildings(): Promise<SchoolBuilding[]>
  /** Makes the pictures for these locations ahead of time, one after another. */
  prepare(locations: readonly string[]): void
  /**
   * Where "Open in …" goes: ASU's map for a building in its list (or ASU's map page), or Apple
   * Maps at a building in the school's map. Never any other address; null when there's none.
   */
  mapUrl(key: string | null): string | null
}

interface SavedBuildings {
  fetchedAt: number
  buildings: Building[]
}

interface SavedPicture extends MapPictureReply {
  madeAt: number
}

function readJson(path: string): unknown {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  } catch {
    return null
  }
}

function asSavedBuildings(raw: unknown): SavedBuildings | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { fetchedAt, buildings } = raw as Record<string, unknown>
  if (typeof fetchedAt !== 'number' || !Array.isArray(buildings)) return null
  // Saved as the table's own rows; read back through the same checks as ASU's list.
  const table = parseBuildings({
    features: buildings.map((row: unknown) => {
      const b = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>
      return {
        properties: { BLDG_CODE: b.code, BLDG_NAME: b.name, BLDG_CAMPUS_CODE: b.campus },
        geometry: { coordinates: [b.lon, b.lat] }
      }
    })
  })
  return { fetchedAt, buildings: [...table.values()] }
}

function asSavedPicture(raw: unknown): SavedPicture | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { madeAt, image, pinX, pinY } = raw as Record<string, unknown>
  if (typeof madeAt !== 'number' || typeof image !== 'string') return null
  if (typeof pinX !== 'number' || typeof pinY !== 'number') return null
  return { madeAt, image, pinX, pinY }
}

const toPicture = (saved: MapPictureReply): ClassMapPicture => ({
  image: `data:image/jpeg;base64,${saved.image}`,
  pinX: saved.pinX,
  pinY: saved.pinY
})

export function createClassMapService(options: ClassMapOptions): ClassMapService {
  const { directory, makePicture } = options
  const now = options.now ?? ((): number => Date.now() / 1000)
  const buildingsFile = join(directory, 'asu-buildings.json')
  const picturesDir = join(directory, 'class-maps')

  let table: Map<string, Building> | null = null
  let tableAt = 0
  let loading: Promise<Map<string, Building> | null> | null = null
  /** The buildings as `buildings()` lists them, made once per table or map. */
  const listed = new WeakMap<object, SchoolBuilding[]>()
  /** Pictures being made, by file name, so two asks share one run. */
  const making = new Map<string, Promise<SavedPicture | null>>()
  /** One helper at a time: pictures queue up behind each other. */
  let queue: Promise<unknown> = Promise.resolve()

  function load(): Promise<Map<string, Building> | null> {
    if (table && now() - tableAt < BUILDINGS_MAX_AGE_SEC) return Promise.resolve(table)
    loading ??= (async () => {
      const saved = asSavedBuildings(readJson(buildingsFile))
      if (saved && saved.buildings.length > 0 && now() - saved.fetchedAt < BUILDINGS_MAX_AGE_SEC) {
        table = new Map(saved.buildings.map((b) => [b.code, b]))
        tableAt = saved.fetchedAt
        return table
      }
      const fetched = parseBuildings(await options.fetchBuildings().catch(() => null))
      if (fetched.size > 0) {
        table = fetched
        tableAt = now()
        try {
          writeJsonFile(buildingsFile, { fetchedAt: tableAt, buildings: [...fetched.values()] })
        } catch (error) {
          console.warn('[calendar] Could not save ASU’s building list.', error)
        }
        return table
      }
      // Can't reach ASU: an old list is still right about where buildings are.
      if (saved && saved.buildings.length > 0) {
        table = new Map(saved.buildings.map((b) => [b.code, b]))
        tableAt = saved.fetchedAt
        return table
      }
      return null
    })().finally(() => {
      loading = null
    })
    return loading
  }

  /** The map picture for a building: `id` names its file ("COOR", "osm-way-123"). */
  function picture(
    building: { id: string; lat: number; lon: number },
    dark: boolean
  ): Promise<SavedPicture | null> {
    const name = `${building.id}-${dark ? 'dark' : 'light'}.json`
    const file = join(picturesDir, name)
    const saved = asSavedPicture(readJson(file))
    if (saved && now() - saved.madeAt < PICTURE_MAX_AGE_SEC) return Promise.resolve(saved)
    if (!makePicture) return Promise.resolve(saved)
    const running = making.get(name)
    if (running) return running
    const run = queue
      .then(() => makePicture({ lat: building.lat, lon: building.lon, dark, ...PICTURE_SIZE }))
      .then((reply) => {
        if (!reply) return saved
        const made: SavedPicture = { ...reply, madeAt: now() }
        try {
          writeJsonFile(file, made)
        } catch (error) {
          console.warn('[calendar] Could not save a class map.', error)
        }
        return made
      })
      .catch(() => saved)
      .finally(() => making.delete(name))
    making.set(name, run)
    queue = run
    return run
  }

  const pictureFor = (building: CampusBuilding): { id: string; lat: number; lon: number } => ({
    id: `osm-${building.id.replace('/', '-')}`,
    lat: building.lat,
    lon: building.lon
  })

  /** Waits a moment for a picture being made, so the card opens with it when it can. */
  async function waitFor(made: Promise<SavedPicture | null>): Promise<ClassMapPicture | null> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const waited = await Promise.race([
      made,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), WAIT_FOR_PICTURE_MS)
      })
    ]).finally(() => clearTimeout(timer))
    return waited ? toPicture(waited) : null
  }

  async function asuPlace(location: string): Promise<ClassPlaceInfo | null> {
    const buildings = await load()
    if (!buildings) return null
    const found = classPlace(location, buildings)
    if (!found) return null
    if (found.kind === 'unknown') return { kind: 'unknown', school: 'ASU', officialMap: true }
    if (found.kind !== 'building') return found
    const { building, room } = found
    return {
      kind: 'building',
      code: building.code,
      name: displayName(building.name),
      campus: campusName(building.campus),
      room,
      map: await waitFor(
        picture({ id: building.code, lat: building.lat, lon: building.lon }, options.dark())
      ),
      mapKey: building.code,
      mapName: 'ASU Map'
    }
  }

  async function schoolPlace(location: string, school: School): Promise<ClassPlaceInfo | null> {
    const map = options.schoolMaps.read(school)
    if (!map) return null
    const found = campusPlace(location, map.buildings)
    if (!found) return null
    if (found.kind === 'unknown')
      return { kind: 'unknown', school: school.name, officialMap: false }
    if (found.kind !== 'building') return found
    const { building, room } = found
    const code = building.codes[0] ?? ''
    return {
      kind: 'building',
      code,
      name: building.name || code,
      campus: '',
      room,
      map: await waitFor(picture(pictureFor(building), options.dark())),
      mapKey: building.id,
      mapName: 'Apple Maps'
    }
  }

  async function asuPosition(location: string): Promise<ClassPosition | null> {
    const buildings = await load()
    const found = buildings ? classPlace(location, buildings) : null
    if (found?.kind !== 'building') return null
    const { building, room } = found
    const { code, lat, lon } = building
    return { name: displayName(building.name), code, room, lat, lon }
  }

  function schoolPosition(location: string, school: School): ClassPosition | null {
    const map = options.schoolMaps.read(school)
    const found = map ? campusPlace(location, map.buildings) : null
    if (found?.kind !== 'building') return null
    const { building, room } = found
    const code = building.codes[0] ?? null
    return { name: building.name || code || '', code, room, lat: building.lat, lon: building.lon }
  }

  async function asuBuildings(): Promise<SchoolBuilding[]> {
    const buildings = await load()
    if (!buildings) return []
    let list = listed.get(buildings)
    if (!list) {
      list = [...buildings.values()].map(({ code, name, lat, lon }) => ({
        key: code,
        code,
        name: displayName(name),
        lat,
        lon
      }))
      listed.set(buildings, list)
    }
    return list
  }

  function schoolBuildings(school: School): SchoolBuilding[] {
    const buildings = options.schoolMaps.read(school)?.buildings
    if (!buildings) return []
    let list = listed.get(buildings)
    if (!list) {
      list = buildings.map(({ id, name, codes, lat, lon }) => {
        const code = codes[0] ?? null
        return { key: id, code, name: name || code || '', lat, lon }
      })
      listed.set(buildings, list)
    }
    return list
  }

  return {
    place(location) {
      const school = options.school()
      return isAsu(school) ? asuPlace(location) : schoolPlace(location, school)
    },
    async position(location) {
      const school = options.school()
      return isAsu(school) ? asuPosition(location) : schoolPosition(location, school)
    },
    async buildings() {
      const school = options.school()
      return isAsu(school) ? asuBuildings() : schoolBuildings(school)
    },
    prepare(locations) {
      const school = options.school()
      const dark = options.dark()
      if (!isAsu(school)) {
        const map = options.schoolMaps.read(school)
        for (const location of new Set(locations)) {
          const found = map ? campusPlace(location, map.buildings) : null
          if (found?.kind === 'building') void picture(pictureFor(found.building), dark)
        }
        return
      }
      void load().then((buildings) => {
        if (!buildings) return
        for (const location of new Set(locations)) {
          const found = classPlace(location, buildings)
          if (found?.kind === 'building') {
            const { code, lat, lon } = found.building
            void picture({ id: code, lat, lon }, dark)
          }
        }
      })
    },
    mapUrl(key) {
      const school = options.school()
      if (isAsu(school)) return campusMapUrl(key && table?.has(key) ? key : null)
      const building = options.schoolMaps.read(school)?.buildings.find((b) => b.id === key)
      return building ? appleMapsUrl(building) : null
    }
  }
}
