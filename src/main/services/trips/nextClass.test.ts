import { describe, expect, it } from 'vitest'
import type { ClassPosition } from '../calendar/classMap'
import type { ClassEvent } from '../calendar/types'
import { nextClassPlace } from './nextClass'

const event = (id: string, start: number, location: string): ClassEvent => ({
  id,
  calendar: 'c',
  title: `Class ${id}`,
  location,
  start,
  end: start + 3000
})

const known = async (location: string): Promise<ClassPosition | null> =>
  location === 'COOR 195'
    ? { name: 'Coor Hall', code: 'COOR', room: '195', lat: 33.42, lon: -111.93 }
    : null

describe('nextClassPlace', () => {
  it('takes the soonest class still to start that a building is known for', async () => {
    const events = [
      event('late', 5000, 'COOR 195'),
      event('past', 100, 'COOR 195'),
      event('online', 2000, 'Online'),
      event('empty', 3000, '')
    ]
    expect(await nextClassPlace(events, 1000, known)).toEqual({
      id: 'class:late',
      kind: 'class',
      name: 'Coor Hall',
      detail: '195',
      lat: 33.42,
      lon: -111.93,
      title: 'Class late',
      start: 5000
    })
  })

  it('is null when no class has a known place', async () => {
    expect(await nextClassPlace([event('a', 2000, 'Online')], 1000, known)).toBeNull()
    expect(await nextClassPlace([], 1000, known)).toBeNull()
  })
})
