import { describe, expect, it } from 'vitest'
import { tripUpdatesMessage, vehiclePositionsMessage, zipOf } from './testFixtures'
import {
  createValleyMetroFeed,
  createValleyMetroVehicles,
  downloadSchedule,
  ScheduleError,
  scheduleZipUrl,
  tripUpdatesUrl,
  vehiclePositionsUrl,
  type FetchBinary,
  type FetchJson
} from './valleyMetro'

const FEED = 'https://mna.mecatran.com/utw/ws/gtfsfeed/realtime/valleymetro?apiKey=TESTKEY'

function listing(resources: unknown[]): unknown {
  return { success: true, result: { resources } }
}

const REALTIME = listing([
  {
    name: 'Vehicle Locations',
    format: 'JSON',
    url: `${FEED.replace('realtime', 'vehicles')}&asJson=true`
  },
  { name: 'Trip Updates', format: 'JSON', url: `${FEED}&asJson=true` }
])

describe('tripUpdatesUrl', () => {
  it('takes Trip Updates from the listing, as binary protobuf', () => {
    expect(tripUpdatesUrl(REALTIME)).toBe(FEED)
  })

  it('refuses a feed listed anywhere but the approved host, or over http', () => {
    for (const url of [
      'https://example.com/utw/ws/gtfsfeed/realtime/valleymetro?apiKey=x',
      'http://mna.mecatran.com/utw/ws/gtfsfeed/realtime/valleymetro?apiKey=x',
      'https://mna.mecatran.com.evil.test/realtime'
    ]) {
      expect(tripUpdatesUrl(listing([{ name: 'Trip Updates', url }]))).toBeNull()
    }
    expect(tripUpdatesUrl({ success: false })).toBeNull()
    expect(tripUpdatesUrl('nope')).toBeNull()
  })
})

describe('vehiclePositionsUrl', () => {
  it('takes Vehicle Locations from the same listing, as binary protobuf, on the same host', () => {
    expect(vehiclePositionsUrl(REALTIME)).toBe(FEED.replace('realtime', 'vehicles'))
    const elsewhere = listing([
      { name: 'Vehicle Locations', url: 'https://example.com/gtfsfeed/vehicles/valleymetro' }
    ])
    expect(vehiclePositionsUrl(elsewhere)).toBeNull()
  })
})

describe('createValleyMetroVehicles', () => {
  it('reads where the buses are, looking the address up once', async () => {
    let lookups = 0
    const fetched: string[] = []
    const vehicles = createValleyMetroVehicles(
      async () => {
        lookups += 1
        return { status: 200, body: REALTIME }
      },
      async (url) => {
        fetched.push(url)
        const bytes = vehiclePositionsMessage(100, [{ vehicleId: 'b1', lat: 33.4, lon: -111.9 }])
        return { status: 200, bytes }
      }
    )
    const first = await vehicles.read()
    await vehicles.read()
    expect(first.ok && first.feed.vehicles.map((v) => v.vehicleId)).toEqual(['b1'])
    expect(lookups).toBe(1)
    expect(fetched).toEqual([
      FEED.replace('realtime', 'vehicles'),
      FEED.replace('realtime', 'vehicles')
    ])
  })

  it('says so, never throws, when the feed can’t be read', async () => {
    const vehicles = createValleyMetroVehicles(
      async () => ({ status: 200, body: REALTIME }),
      async () => ({ status: 200, bytes: Uint8Array.from([0xff]) })
    )
    expect((await vehicles.read()).ok).toBe(false)
  })
})

describe('scheduleZipUrl', () => {
  it('takes the zip from the portal only', () => {
    const url = 'https://www.phoenixopendata.com/dataset/x/resource/y/download/googletransit.zip'
    expect(scheduleZipUrl(listing([{ name: 'Bus', format: 'ZIP', url }]))).toBe(url)
    expect(
      scheduleZipUrl(listing([{ name: 'Bus', format: 'ZIP', url: 'https://evil.test/a.zip' }]))
    ).toBeNull()
  })
})

describe('createValleyMetroFeed', () => {
  it('looks the address up once, and again when the feed turns the key away', async () => {
    const lookups: string[] = []
    const fetchJson: FetchJson = async (url) => {
      lookups.push(url)
      return { status: 200, body: REALTIME }
    }
    const statuses = [200, 403, 200]
    const fetchBinary: FetchBinary = async () => ({
      status: statuses.shift() ?? 200,
      bytes: tripUpdatesMessage(100, [])
    })
    const feed = createValleyMetroFeed(fetchJson, fetchBinary)
    expect(await feed.read()).toEqual({ ok: true, feed: { timestamp: 100, trips: [] } })
    expect(await feed.read()).toEqual({
      ok: false,
      problem: 'Valley Metro’s live feed isn’t answering (403).'
    })
    expect(await feed.read()).toMatchObject({ ok: true })
    expect(lookups).toEqual([
      'https://phoenixopendata.com/api/3/action/package_show?id=general-transit-feed-specification',
      'https://phoenixopendata.com/api/3/action/package_show?id=general-transit-feed-specification'
    ])
  })

  it('says what went wrong without throwing', async () => {
    const unreachable = createValleyMetroFeed(
      () => Promise.reject(new Error('offline')),
      () => Promise.reject(new Error('offline'))
    )
    expect(await unreachable.read()).toEqual({
      ok: false,
      problem: 'Can’t reach Valley Metro’s live feed.'
    })
    const garbled = createValleyMetroFeed(
      async () => ({ status: 200, body: REALTIME }),
      async () => ({ status: 200, bytes: new TextEncoder().encode('<html>') })
    )
    expect(await garbled.read()).toEqual({
      ok: false,
      problem: 'Valley Metro’s live feed sent something unreadable.'
    })
  })
})

describe('downloadSchedule', () => {
  const ZIP_URL = 'https://www.phoenixopendata.com/dataset/x/download/googletransit.zip'
  const SCHEDULE = listing([{ name: 'Valley Metro Bus Schedule', format: 'ZIP', url: ZIP_URL }])
  const FILES = {
    'routes.txt': 'route_id,route_short_name,route_long_name\nVENU,VENU,Orbit Venus\n',
    'trips.txt':
      'route_id,service_id,trip_id,trip_headsign,direction_id\nVENU,wk,v1,Rural/Apache,0\n',
    'stops.txt':
      'stop_id,stop_name,stop_lat,stop_lon\n' +
      '1,Mill Ave & University Dr,33.4222,-111.9400\n2,Rural Rd & Apache Blvd,33.4146,-111.9264\n',
    'stop_times.txt':
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
      'v1,08:00:00,08:00:00,1,1\nv1,08:09:00,08:09:00,2,2\n',
    'calendar_dates.txt': 'service_id,date,exception_type\nwk,20261102,1\n'
  }

  it('downloads the zip the portal lists once and makes the stop list and timetable', async () => {
    const zip = zipOf(FILES)
    const asked: string[] = []
    const { stopList, timetable } = await downloadSchedule(
      async () => ({ status: 200, body: SCHEDULE }),
      async (url) => {
        asked.push(url)
        return { status: 200, bytes: zip }
      },
      500
    )
    expect(asked).toEqual([ZIP_URL])
    expect(stopList.downloadedAt).toBe(500)
    expect(stopList.stops.map((stop) => stop.name)).toEqual([
      'Mill Ave & University Dr',
      'Rural Rd & Apache Blvd'
    ])
    expect(timetable.patterns.map((pattern) => pattern.trips)).toEqual([['v1']])
    expect(timetable.stops.names).toEqual(['Mill Ave & University Dr', 'Rural Rd & Apache Blvd'])
  })

  it('explains failures in words', async () => {
    const offline = downloadSchedule(
      () => Promise.reject(new Error('offline')),
      () => Promise.reject(new Error('offline')),
      0
    )
    await expect(offline).rejects.toThrow(ScheduleError)
    const notZip = downloadSchedule(
      async () => ({ status: 200, body: SCHEDULE }),
      async () => ({ status: 200, bytes: new Uint8Array(40) }),
      0
    )
    await expect(notZip).rejects.toThrow('The schedule couldn’t be read: Not a zip file.')
    const missing = downloadSchedule(
      async () => ({ status: 404, body: null }),
      async () => ({ status: 200, bytes: null }),
      0
    )
    await expect(missing).rejects.toThrow('doesn’t list Valley Metro’s schedule')
    // The timetable's own needs count too: a schedule with no calendar runs no buses.
    const noCalendar = Object.fromEntries(
      Object.entries(FILES).filter(([name]) => name !== 'calendar_dates.txt')
    )
    const undated = downloadSchedule(
      async () => ({ status: 200, body: SCHEDULE }),
      async () => ({ status: 200, bytes: zipOf(noCalendar) }),
      0
    )
    await expect(undated).rejects.toThrow(
      new ScheduleError('The schedule couldn’t be read: The schedule has no calendar.')
    )
  })
})
