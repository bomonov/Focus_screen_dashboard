import { describe, expect, it } from 'vitest'
import type { SongColors } from '../../../main/ipc'
import { CAST } from '../../../main/services/lyrics/singers/cast'
import { nameTaken, singerById, songCast } from './singers'

const extra: SongColors['extra'] = [
  { id: 'extra:guest', name: 'Guest', color: '#123456' },
  // An extra can't take over a character.
  { id: 'miku', name: 'Not Miku', color: '#000000' }
]

describe('singerById', () => {
  it('finds characters first, then the song’s own singers', () => {
    expect(singerById('miku', extra)?.name).toBe('Miku')
    expect(singerById('extra:guest', extra)).toEqual({
      id: 'extra:guest',
      name: 'Guest',
      color: '#123456',
      group: 'extra'
    })
    expect(singerById('nobody', extra)).toBeUndefined()
  })
})

describe('songCast', () => {
  it('keeps the cast’s order and leaves out ids that are nobody', () => {
    const colors: SongColors = {
      version: 1,
      lines: [],
      cast: ['extra:guest', 'nobody', 'ichika'],
      extra
    }
    expect(songCast(colors).map((singer) => singer.id)).toEqual(['extra:guest', 'ichika'])
  })
})

describe('nameTaken', () => {
  it('matches names whatever their case, as addSinger refuses them', () => {
    expect(nameTaken(' ichika ', [], CAST)).toBe(true)
    expect(nameTaken('GUEST', extra, CAST)).toBe(true)
    expect(nameTaken('Someone new', extra, CAST)).toBe(false)
    expect(nameTaken('  ', extra, CAST)).toBe(false)
  })
})
