import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSchoolMaps, type FetchCampus } from './schoolMap'

const PURDUE = { name: 'Purdue University', country: 'US' }
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function maps(replies: ({ status: number; body: unknown } | Error)[]): {
  maps: ReturnType<typeof createSchoolMaps>
  queries: string[]
  directory: string
} {
  const directory = mkdtempSync(join(tmpdir(), 'school-maps-'))
  dirs.push(directory)
  const queries: string[] = []
  const fetchCampus: FetchCampus = async (query) => {
    queries.push(query)
    const reply = replies.shift()
    if (!reply || reply instanceof Error) throw reply ?? new Error('no reply')
    return reply
  }
  return {
    maps: createSchoolMaps({
      directory,
      fetchCampus,
      now: () => 1_800_000_000,
      wait: async () => {}
    }),
    queries,
    directory
  }
}

const BUILDINGS = {
  elements: [
    {
      type: 'way',
      id: 1,
      center: { lat: 40.4, lon: -86.9 },
      tags: { name: 'Physics Building', ref: 'PHYS' }
    }
  ]
}

describe('school maps', () => {
  it('downloads a school’s buildings once asked, and keeps them on disk', async () => {
    const { maps: first, directory } = maps([{ status: 200, body: BUILDINGS }])
    expect(first.read(PURDUE)).toBeNull()
    await first.download(PURDUE)
    expect(first.read(PURDUE)?.buildings.map((b) => b.name)).toEqual(['Physics Building'])
    // Another run reads the same file, through the same checks.
    const again = createSchoolMaps({
      directory,
      fetchCampus: async () => ({ status: 500, body: null })
    })
    expect(again.read(PURDUE)).toEqual({
      downloadedAt: 1_800_000_000,
      buildings: [{ id: 'way/1', name: 'Physics Building', codes: ['PHYS'], lat: 40.4, lon: -86.9 }]
    })
    again.remove(PURDUE)
    expect(again.read(PURDUE)).toBeNull()
  })

  it('tries the slower search by name when the exact name finds no campus', async () => {
    const { maps: schoolMaps, queries } = maps([
      { status: 200, body: { elements: [] } },
      { status: 200, body: BUILDINGS }
    ])
    await schoolMaps.download(PURDUE)
    expect(queries).toHaveLength(2)
    expect(queries[1]).toContain('ISO3166-1')
    expect(schoolMaps.read(PURDUE)?.buildings).toHaveLength(1)
  })

  it('tries again when OpenStreetMap is busy for a moment', async () => {
    const { maps: schoolMaps, queries } = maps([
      { status: 502, body: null },
      { status: 200, body: BUILDINGS }
    ])
    await schoolMaps.download(PURDUE)
    expect(queries).toHaveLength(2)
    expect(schoolMaps.read(PURDUE)?.buildings).toHaveLength(1)
  })

  it('says why when there’s no map', async () => {
    const cases: [({ status: number; body: unknown } | Error)[], string][] = [
      [
        [
          { status: 200, body: { elements: [] } },
          { status: 200, body: { elements: [] } }
        ],
        'OpenStreetMap doesn’t have Purdue University’s buildings mapped.'
      ],
      [
        // Busy, and still busy after both tries again.
        [
          { status: 502, body: null },
          { status: 429, body: null },
          { status: 504, body: null }
        ],
        'OpenStreetMap is busy right now. Try again in a few minutes.'
      ],
      [[{ status: 400, body: null }], 'OpenStreetMap said no (error 400).'],
      [[new Error('offline')], 'Couldn’t reach OpenStreetMap. Try again in a little while.']
    ]
    for (const [replies, message] of cases) {
      const { maps: schoolMaps } = maps(replies)
      await schoolMaps.download(PURDUE)
      expect(schoolMaps.problem(PURDUE)).toBe(message)
      expect(schoolMaps.read(PURDUE)).toBeNull()
      expect(schoolMaps.downloading(PURDUE)).toBe(false)
    }
  })
})
