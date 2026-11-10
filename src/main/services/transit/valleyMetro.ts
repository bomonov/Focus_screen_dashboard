// Valley Metro's data, as the City of Phoenix publishes it on its Open Data portal (CKAN): the
// live feed's address (which carries a key the city publishes for apps) and the schedule's zip.
// Both are read from the portal each run, never written into the app, so a new key or a new
// schedule is followed. Never log the feed's address: it has the key in it.
import { buildTimetable } from '../trips/timetable'
import type { Timetable } from '../trips/types'
import {
  readTripUpdates,
  readVehiclePositions,
  type TripUpdatesFeed,
  type VehiclePositionsFeed
} from './gtfsRealtime'
import { ProtobufError } from './protobuf'
import { buildStopList, type StopList } from './stopList'
import { ZipError } from './zip'

const PACKAGE_SHOW = 'https://phoenixopendata.com/api/3/action/package_show?id='
/** "Valley Metro general-transit-feed-specification (GTFS-RT)", Creative Commons Attribution. */
const REALTIME_DATASET = 'general-transit-feed-specification'
/** "Valley Metro Bus Schedule", Open Data Commons Attribution. */
const SCHEDULE_DATASET = '3eae9a4a-98b9-40c8-8df7-8c00c1756235'
/** The only hosts approved for Next bus (2026-10-19); the portal's zip then redirects to S3. */
const FEED_HOST = 'mna.mecatran.com'
const PORTAL_HOSTS: ReadonlySet<string> = new Set([
  'phoenixopendata.com',
  'www.phoenixopendata.com'
])

export type FetchJson = (url: string) => Promise<{ status: number; body: unknown }>
export type FetchBinary = (url: string) => Promise<{ status: number; bytes: Uint8Array | null }>

export type FeedRead = { ok: true; feed: TripUpdatesFeed } | { ok: false; problem: string }

/** Where coming buses come from: Valley Metro's live feed, or the demo's made-up buses. */
export interface ArrivalFeed {
  read(): Promise<FeedRead>
}

export type VehicleRead = { ok: true; feed: VehiclePositionsFeed } | { ok: false; problem: string }

/** Where the buses are, for the route card: Valley Metro's Vehicle Locations, or the demo's. */
export interface VehicleFeed {
  read(): Promise<VehicleRead>
}

interface Resource {
  name: string
  format: string
  url: string
}

/** A package_show answer's files. Empty when it isn't one. */
export function packageResources(body: unknown): Resource[] {
  if (typeof body !== 'object' || body === null) return []
  const answer = body as Record<string, unknown>
  const result = answer.result as Record<string, unknown> | null | undefined
  if (answer.success !== true || typeof result !== 'object' || result === null) return []
  if (!Array.isArray(result.resources)) return []
  return result.resources.flatMap((value: unknown) => {
    if (typeof value !== 'object' || value === null) return []
    const resource = value as Record<string, unknown>
    if (typeof resource.url !== 'string') return []
    return [
      {
        name: typeof resource.name === 'string' ? resource.name : '',
        format: typeof resource.format === 'string' ? resource.format : '',
        url: resource.url
      }
    ]
  })
}

function httpsUrl(raw: string, hosts: ReadonlySet<string>): URL | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && hosts.has(url.hostname) && !url.username ? url : null
  } catch {
    return null
  }
}

/**
 * The Trip Updates feed's address, as binary protobuf (the portal lists it as JSON, ~8 times
 * bigger). null when the portal doesn't list it on the approved host.
 */
export function tripUpdatesUrl(body: unknown): string | null {
  return feedUrl(body, 'trip updates', '/gtfsfeed/realtime/')
}

/** The Vehicle Locations feed's address, as binary protobuf, like the Trip Updates one. */
export function vehiclePositionsUrl(body: unknown): string | null {
  return feedUrl(body, 'vehicle locations', '/gtfsfeed/vehicles/')
}

function feedUrl(body: unknown, name: string, path: string): string | null {
  const resources = packageResources(body)
  const resource =
    resources.find((r) => r.name.trim().toLowerCase() === name) ??
    resources.find((r) => r.url.includes(path))
  const url = resource && httpsUrl(resource.url, new Set([FEED_HOST]))
  if (!url) return null
  url.searchParams.delete('asJson')
  return url.toString()
}

/** The schedule zip's address on the portal; null when it isn't there. */
export function scheduleZipUrl(body: unknown): string | null {
  const zip = packageResources(body).find(
    (r) => r.format.toUpperCase() === 'ZIP' || /\.zip$/i.test(r.url)
  )
  return zip ? (httpsUrl(zip.url, PORTAL_HOSTS)?.toString() ?? null) : null
}

const FEED_UNREACHABLE = 'Can’t reach Valley Metro’s live feed.'
const FEED_NOT_LISTED = 'City of Phoenix Open Data doesn’t list Valley Metro’s live feed right now.'

export function createValleyMetroFeed(fetchJson: FetchJson, fetchBinary: FetchBinary): ArrivalFeed {
  /** The feed's address, looked up once per run, and again when the feed turns it away. */
  let feedUrl: string | null = null

  async function lookUp(): Promise<string | null> {
    const response = await fetchJson(`${PACKAGE_SHOW}${REALTIME_DATASET}`)
    return response.status === 200 ? tripUpdatesUrl(response.body) : null
  }

  return {
    async read() {
      try {
        feedUrl ??= await lookUp()
        if (!feedUrl) return { ok: false, problem: FEED_NOT_LISTED }
        const response = await fetchBinary(feedUrl)
        // A new key: look the address up again next time.
        if ([401, 403, 404, 410].includes(response.status)) feedUrl = null
        if (response.status !== 200 || !response.bytes) {
          console.warn(`[transit] The live feed answered ${response.status}.`)
          return {
            ok: false,
            problem: `Valley Metro’s live feed isn’t answering (${response.status}).`
          }
        }
        return { ok: true, feed: readTripUpdates(response.bytes) }
      } catch (error) {
        if (error instanceof ProtobufError) {
          return { ok: false, problem: 'Valley Metro’s live feed sent something unreadable.' }
        }
        return { ok: false, problem: FEED_UNREACHABLE }
      }
    }
  }
}

/**
 * Valley Metro's Vehicle Locations: read only while a route card is open (the service asks).
 * Its address carries the same published key as the Trip Updates feed: never logged.
 */
export function createValleyMetroVehicles(
  fetchJson: FetchJson,
  fetchBinary: FetchBinary
): VehicleFeed {
  let feedUrl: string | null = null
  return {
    async read() {
      try {
        if (!feedUrl) {
          const response = await fetchJson(`${PACKAGE_SHOW}${REALTIME_DATASET}`)
          feedUrl = response.status === 200 ? vehiclePositionsUrl(response.body) : null
        }
        if (!feedUrl) return { ok: false, problem: 'Bus positions aren’t listed right now.' }
        const response = await fetchBinary(feedUrl)
        if ([401, 403, 404, 410].includes(response.status)) feedUrl = null
        if (response.status !== 200 || !response.bytes) {
          return { ok: false, problem: `Bus positions aren’t answering (${response.status}).` }
        }
        return { ok: true, feed: readVehiclePositions(response.bytes) }
      } catch {
        return { ok: false, problem: 'Bus positions couldn’t be read.' }
      }
    }
  }
}

/** Why the stop list couldn't be downloaded, in words for Customize. */
export class ScheduleError extends Error {}

/** What one download of the schedule makes: Next bus's stop list and the trip planner's timetable. */
export interface DownloadedSchedule {
  stopList: StopList
  timetable: Timetable
}

/** Downloads Valley Metro's schedule from the portal and makes the stop list and timetable of it. */
export async function downloadSchedule(
  fetchJson: FetchJson,
  fetchBinary: FetchBinary,
  now: number
): Promise<DownloadedSchedule> {
  let zip: Uint8Array
  try {
    const listing = await fetchJson(`${PACKAGE_SHOW}${SCHEDULE_DATASET}`)
    const url = listing.status === 200 ? scheduleZipUrl(listing.body) : null
    if (!url) {
      throw new ScheduleError('City of Phoenix Open Data doesn’t list Valley Metro’s schedule.')
    }
    const response = await fetchBinary(url)
    if (response.status !== 200 || !response.bytes) {
      throw new ScheduleError(`The schedule didn’t download (${response.status}). Try again later.`)
    }
    zip = response.bytes
  } catch (error) {
    if (error instanceof ScheduleError) throw error
    throw new ScheduleError('Couldn’t reach City of Phoenix Open Data. Try again later.')
  }
  try {
    // One after the other, from the one zip: each reads it a file at a time.
    const stopList = await buildStopList(zip, now)
    return { stopList, timetable: await buildTimetable(zip) }
  } catch (error) {
    if (error instanceof ZipError)
      throw new ScheduleError(`The schedule couldn’t be read: ${error.message}`)
    throw error
  }
}
