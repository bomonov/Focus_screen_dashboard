import { describe, expect, it } from 'vitest'
import { contrast } from '../../theme/color'
import { albumInks, inkAt, inkSlice, lineInk, showsAlbumInk, wordInk } from './albumInk'

const INKS = ['#FF0000', '#00FF00', '#0000FF']

describe('albumInks', () => {
  it('fits each cover color to read on the card', () => {
    const inks = albumInks(['#2B3FA8', '#D94C8A', '#7B4FC9'], '#191919')
    expect(inks).toHaveLength(3)
    for (const ink of inks) expect(contrast(ink, '#191919')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('inkAt', () => {
  it('runs from the first color to the last, the middle one halfway', () => {
    expect(inkAt(INKS, 0)).toBe('#FF0000')
    expect(inkAt(INKS, 0.5)).toBe('#00FF00')
    expect(inkAt(INKS, 1)).toBe('#0000FF')
    expect(inkAt(INKS, 0.25)).toBe('#808000')
  })

  it('holds the ends past them, and one color everywhere', () => {
    expect(inkAt(INKS, -1)).toBe('#FF0000')
    expect(inkAt(INKS, 2)).toBe('#0000FF')
    expect(inkAt(['#123456'], 0.7)).toBe('#123456')
  })
})

describe('inkSlice', () => {
  it('is the stretch of the line’s colors a box covers, with the stops inside it', () => {
    expect(inkSlice(INKS, 0.25, 0.75)).toEqual([
      { color: '#808000', at: 0 },
      { color: '#00FF00', at: 0.5 },
      { color: '#008080', at: 1 }
    ])
  })

  it('is the whole line for a box as wide as it', () => {
    expect(inkSlice(INKS, 0, 1)).toEqual([
      { color: '#FF0000', at: 0 },
      { color: '#00FF00', at: 0.5 },
      { color: '#0000FF', at: 1 }
    ])
  })

  it('is one color for a box with no width', () => {
    expect(inkSlice(INKS, 0.5, 0.5)).toEqual([{ color: '#00FF00', at: 0 }])
  })
})

describe('wordInk', () => {
  it('lays the box’s colors on its lit half, the unsung color on the other', () => {
    expect(wordInk(INKS, 0, 0.5)).toBe(
      'linear-gradient(90deg, #FF0000 calc((50% - 0.3em) * 0), #00FF00 calc((50% - 0.3em) * 1), ' +
        'var(--glide-unsung) calc(50% + 0.3em))'
    )
  })
})

describe('lineInk', () => {
  it('runs the colors across the whole line', () => {
    expect(lineInk(INKS)).toBe('linear-gradient(90deg, #FF0000 0%, #00FF00 50%, #0000FF 100%)')
  })

  it('is quieter for romaji', () => {
    expect(lineInk(['#FF0000'], true)).toBe(
      'linear-gradient(90deg, color-mix(in srgb, #FF0000 75%, var(--text-secondary)) 0%, ' +
        'color-mix(in srgb, #FF0000 75%, var(--text-secondary)) 100%)'
    )
  })
})

describe('showsAlbumInk', () => {
  it('colors timed lyrics the user hasn’t colored by singer', () => {
    expect(showsAlbumInk('synced', false)).toBe(true)
  })

  it('leaves untimed lyrics and singer-colored songs as they are', () => {
    expect(showsAlbumInk('plain', false)).toBe(false)
    expect(showsAlbumInk('synced', true)).toBe(false)
    expect(showsAlbumInk(null, false)).toBe(false)
  })
})
