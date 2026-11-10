// Schools' building maps from OpenStreetMap, one file each in userData/school-maps: downloaded
// when the user says so in Customize, and kept until they remove it or download it again.
import { createHash } from 'crypto'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { writeJsonFile } from '../jsonFile'
import {
  campusPatternQuery,
  campusQuery,
  parseCampusBuildings,
  type CampusBuilding
} from './osmCampus'
import type { School } from './types'

/** Overpass's answer, or an error to say why there's none. */
export type FetchCampus = (query: string) => Promise<{ status: number; body: unknown }>

export interface SchoolMap {
  buildings: CampusBuilding[]
  /** Unix seconds. */
  downloadedAt: number
}

export interface SchoolMaps {
  read(school: School): SchoolMap | null
  downloading(school: School): boolean
  /** Why the last download for `school` didn't work; null when it did, or none was tried. */
  problem(school: School): string | null
  /** Downloads the school's buildings; its outcome shows through `read` and `problem`. */
  download(school: School): Promise<void>
  remove(school: School): void
  subscribe(listener: () => void): () => void
}

export interface SchoolMapsOptions {
  /** userData: maps go in its school-maps folder. */
  directory: string
  fetchCampus: FetchCampus
  now?: () => number
  /** Waits between tries; instant in tests. */
  wait?: (ms: number) => Promise<void>
}

/** OpenStreetMap's public server is often busy for a moment: try again after these waits. */
const BUSY_RETRIES_MS = [5000, 15000]
const BUSY = new Set([429, 502, 503, 504])

const key = (school: School): string => `${school.name}\n${school.country}`

/** The school's file name: a hash, so no school's name can reach outside the folder. */
function fileName(school: School): string {
  return `${createHash('sha256').update(key(school)).digest('hex').slice(0, 24)}.json`
}

/** A saved map, read back through the same checks as Overpass's answer. */
function asSchoolMap(raw: unknown, school: School): SchoolMap | null {
  if (typeof raw !== 'object' || raw === null) return null
  const saved = raw as Record<string, unknown>
  const savedSchool = saved.school as Record<string, unknown> | undefined
  if (savedSchool?.name !== school.name || savedSchool?.country !== school.country) return null
  if (typeof saved.downloadedAt !== 'number' || !Array.isArray(saved.buildings)) return null
  const buildings = parseCampusBuildings({
    elements: saved.buildings.map((row: unknown) => {
      const b = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>
      const [type, id] = typeof b.id === 'string' ? b.id.split('/') : []
      const codes = Array.isArray(b.codes) ? b.codes : []
      return {
        type,
        id: Number(id),
        lat: b.lat,
        lon: b.lon,
        tags: { name: b.name, ref: codes[0], 'building:ref': codes[1], short_name: codes[2] }
      }
    })
  })
  return { buildings, downloadedAt: saved.downloadedAt }
}

function readJson(path: string): unknown {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  } catch {
    return null
  }
}

export function createSchoolMaps(options: SchoolMapsOptions): SchoolMaps {
  const folder = join(options.directory, 'school-maps')
  const now = options.now ?? ((): number => Date.now() / 1000)
  const wait =
    options.wait ??
    ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)))
  const loaded = new Map<string, SchoolMap | null>()
  const running = new Set<string>()
  const problems = new Map<string, string>()
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  /** One query's buildings; throws a message to show when Overpass couldn't answer. */
  async function ask(query: string): Promise<CampusBuilding[]> {
    for (let attempt = 0; ; attempt++) {
      let reply: { status: number; body: unknown }
      try {
        reply = await options.fetchCampus(query)
      } catch {
        throw new Error('Couldn’t reach OpenStreetMap. Try again in a little while.')
      }
      if (reply.status === 200) return parseCampusBuildings(reply.body)
      const delay = BUSY_RETRIES_MS[attempt]
      if (!BUSY.has(reply.status)) throw new Error(`OpenStreetMap said no (error ${reply.status}).`)
      if (delay === undefined) {
        throw new Error('OpenStreetMap is busy right now. Try again in a few minutes.')
      }
      await wait(delay)
    }
  }

  return {
    read(school) {
      const id = key(school)
      if (!loaded.has(id))
        loaded.set(id, asSchoolMap(readJson(join(folder, fileName(school))), school))
      return loaded.get(id) ?? null
    },
    downloading: (school) => running.has(key(school)),
    problem: (school) => problems.get(key(school)) ?? null,

    async download(school) {
      const id = key(school)
      if (running.has(id)) return
      running.add(id)
      problems.delete(id)
      notify()
      try {
        let buildings = await ask(campusQuery(school))
        // Named a little differently on the map: the slower search by the name's words.
        if (buildings.length === 0) buildings = await ask(campusPatternQuery(school))
        if (buildings.length === 0) {
          throw new Error(`OpenStreetMap doesn’t have ${school.name}’s buildings mapped.`)
        }
        const map: SchoolMap = { buildings, downloadedAt: Math.floor(now()) }
        writeJsonFile(join(folder, fileName(school)), { version: 1, school, ...map })
        loaded.set(id, map)
      } catch (error) {
        problems.set(id, error instanceof Error ? error.message : 'The map couldn’t be downloaded.')
      } finally {
        running.delete(id)
        notify()
      }
    },

    remove(school) {
      const id = key(school)
      rmSync(join(folder, fileName(school)), { force: true })
      loaded.set(id, null)
      problems.delete(id)
      notify()
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
