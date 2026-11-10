import { describe, expect, it } from 'vitest'
import { parseMapReply } from './mapPicture'

describe('parseMapReply', () => {
  it('takes the helper’s picture and pin', () => {
    expect(parseMapReply({ ok: true, image: 'aGVsbG8=', pinX: 0.5, pinY: 0.48 })).toEqual({
      image: 'aGVsbG8=',
      pinX: 0.5,
      pinY: 0.48
    })
  })

  it('treats failures and odd output as no picture', () => {
    expect(parseMapReply({ ok: false, error: 'noMap' })).toBeNull()
    expect(parseMapReply({ ok: true, image: 'not base64!', pinX: 0.5, pinY: 0.5 })).toBeNull()
    expect(parseMapReply({ ok: true, image: 'aGVsbG8=', pinX: 1.4, pinY: 0.5 })).toBeNull()
    expect(parseMapReply({ ok: true, image: '', pinX: 0.5, pinY: 0.5 })).toBeNull()
    expect(parseMapReply('hello')).toBeNull()
    expect(parseMapReply(null)).toBeNull()
  })
})
