import { describe, expect, it } from 'vitest'
import { parseRouteMapReply } from './routePicture'

const OK = { ok: true, image: 'aGVsbG8=', northWest: [0, 0], southEast: [1, 1] }

describe('parseRouteMapReply', () => {
  it('takes the picture and where the box’s corners landed', () => {
    expect(parseRouteMapReply(OK)).toEqual({
      image: 'aGVsbG8=',
      northWest: [0, 0],
      southEast: [1, 1]
    })
  })

  it('refuses failures, odd pictures and corners that can’t be the box asked for', () => {
    expect(parseRouteMapReply({ ok: false, error: 'noMap' })).toBeNull()
    expect(parseRouteMapReply({ ...OK, image: 'not base64!' })).toBeNull()
    expect(parseRouteMapReply({ ...OK, northWest: [0] })).toBeNull()
    // Upside down: north at the bottom.
    expect(parseRouteMapReply({ ...OK, northWest: [0, 1], southEast: [1, 0] })).toBeNull()
    expect(parseRouteMapReply({ ...OK, southEast: [1, Infinity] })).toBeNull()
    expect(parseRouteMapReply('nope')).toBeNull()
  })
})
