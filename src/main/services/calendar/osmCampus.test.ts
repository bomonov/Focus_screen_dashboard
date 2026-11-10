import { describe, expect, it } from 'vitest'
import {
  appleMapsUrl,
  campusPatternQuery,
  campusPlace,
  campusQuery,
  parseCampusBuildings,
  type CampusBuilding
} from './osmCampus'

const way = (id: number, tags: Record<string, unknown>): Record<string, unknown> => ({
  type: 'way',
  id,
  center: { lat: 40 + id, lon: -86.9 },
  tags
})

describe('a school’s buildings from OpenStreetMap', () => {
  it('asks for the campus by its exact name, its quotes escaped', () => {
    const query = campusQuery({ name: 'Saint "Joe" University', country: 'US' })
    expect(query).toContain('area["amenity"="university"]["name"="Saint \\"Joe\\" University"]')
    expect(query).toContain('nwr["building"](area.grounds);')
  })

  it('falls back to any campus in the country named like it, punctuation aside', () => {
    const query = campusPatternQuery({
      name: 'University of California, Los Angeles',
      country: 'US'
    })
    expect(query).toContain('area["ISO3166-1"="US"]')
    expect(query).toContain(
      '"^University[^A-Za-z0-9]+of[^A-Za-z0-9]+California[^A-Za-z0-9]+Los[^A-Za-z0-9]+Angeles",i'
    )
  })

  it('keeps named or coded buildings, a code in brackets taken as a code', () => {
    const buildings = parseCampusBuildings({
      elements: [
        way(1, { building: 'university', name: 'Physics Building (PHYS)' }),
        way(2, { building: 'yes', name: 'Old Main', ref: 'om' }),
        way(3, { building: 'yes' }),
        { type: 'node', id: 4, lat: 0, lon: 999, tags: { name: 'Off the map' } },
        way(1, { name: 'Again' }),
        'junk'
      ]
    })
    expect(buildings).toEqual([
      { id: 'way/1', name: 'Physics Building', codes: ['PHYS'], lat: 41, lon: -86.9 },
      { id: 'way/2', name: 'Old Main', codes: ['OM'], lat: 42, lon: -86.9 }
    ])
  })
})

describe('campusPlace', () => {
  const at = (id: string, name: string, codes: string[] = []): CampusBuilding => ({
    id,
    name,
    codes,
    lat: 40,
    lon: -86
  })
  const buildings = [
    at('way/1', 'Physics Building', ['PHYS']),
    at('way/2', 'Old Main'),
    at('way/3', 'Lawson Computer Science Building', ['LWSN']),
    at('way/4', 'Science Hall'),
    at('way/5', 'Science Hall'),
    at('way/6', 'Hall')
  ]
  const place = (location: string): string | null => {
    const found = campusPlace(location, buildings)
    return found?.kind === 'building'
      ? `${found.building.id} ${found.room ?? '-'}`
      : (found?.kind ?? null)
  }

  it('reads a code and room, with or without a space, and a campus before a dash', () => {
    expect(place('PHYS 112')).toBe('way/1 112')
    expect(place('lwsnb151')).toBe('way/3 B151')
    expect(place('West Lafayette - PHYS 112')).toBe('way/1 112')
  })

  it('reads a building’s whole name and the room after it', () => {
    expect(place('Physics Building 203')).toBe('way/1 203')
    expect(place('Old Main Room 101')).toBe('way/2 101')
    expect(place('Lawson Computer Science Building B151')).toBe('way/3 B151')
  })

  it('never guesses: a name two buildings share, a short name, or a non-room leftover', () => {
    expect(place('Science Hall 204')).toBe('unknown')
    expect(place('Hall 1')).toBe('unknown')
    expect(place('Old Main lobby by the stairs')).toBe('unknown')
    expect(place('ZZZ 101')).toBe('unknown')
  })

  it('says online for online classes, and nothing for no location', () => {
    expect(place('Online')).toBe('online')
    expect(place('https://purdue.zoom.us/j/1')).toBe('online')
    expect(place('  ')).toBeNull()
  })

  it('opens Apple Maps at the building', () => {
    expect(appleMapsUrl(at('way/1', 'Physics Building'))).toBe(
      'https://maps.apple.com/?ll=40.000000%2C-86.000000&q=Physics+Building'
    )
  })
})
