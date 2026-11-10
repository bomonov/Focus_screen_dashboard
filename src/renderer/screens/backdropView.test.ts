import { describe, expect, it } from 'vitest'
import { backdropFor } from './backdropView'

const song = { artwork: 'data:cover', artist: 'A', album: 'B', title: 'C' }
const coverless = { ...song, artwork: null }

describe('backdropFor', () => {
  it('shows the cover or the photo when the setting asks for it', () => {
    expect(backdropFor('art', song, 'data:photo')).toEqual({ kind: 'art', image: 'data:cover' })
    expect(backdropFor('photo', song, 'data:photo')).toEqual({ kind: 'photo', image: 'data:photo' })
  })

  it('gives living colors for any song, from the stand-in label when there’s no cover', () => {
    const living = backdropFor('living', song, null)
    expect(living?.kind === 'living' && living.artwork).toBe('data:cover')
    const fallback = backdropFor('living', coverless, null)
    expect(fallback?.kind === 'living' && fallback.artwork).toBeNull()
    expect(fallback?.kind === 'living' && fallback.fallback).toHaveLength(3)
  })

  it('falls back to solid without a picture or a song', () => {
    expect(backdropFor('art', coverless, 'data:photo')).toBeNull()
    expect(backdropFor('photo', song, null)).toBeNull()
    expect(backdropFor('living', null, null)).toBeNull()
    expect(backdropFor('solid', song, 'data:photo')).toBeNull()
    expect(backdropFor(undefined, song, null)).toBeNull()
  })
})
