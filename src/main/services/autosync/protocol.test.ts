import { describe, expect, it } from 'vitest'
import { parseAudioHelperMessage } from './protocol'

const pcm = (values: number[]): string =>
  Buffer.from(new Int16Array(values).buffer).toString('base64')

describe('parseAudioHelperMessage', () => {
  it('reads access, audio and replies', () => {
    expect(parseAudioHelperMessage({ type: 'access', status: 'granted' })).toEqual({
      type: 'access',
      status: 'granted'
    })
    const audio = parseAudioHelperMessage({ type: 'audio', at: 12.5, pcm: pcm([1, -2, 300]) })
    expect(audio?.type).toBe('audio')
    if (audio?.type === 'audio') {
      expect(audio.at).toBe(12.5)
      expect([...audio.samples]).toEqual([1, -2, 300])
    }
    expect(
      parseAudioHelperMessage({ type: 'reply', id: 3, ok: false, error: 'noProcess' })
    ).toEqual({ type: 'reply', id: 3, ok: false, error: 'noProcess' })
  })

  it('drops anything off-shape', () => {
    expect(parseAudioHelperMessage(null)).toBeNull()
    expect(parseAudioHelperMessage({ type: 'access', status: 'yes' })).toBeNull()
    expect(parseAudioHelperMessage({ type: 'audio', at: 'now', pcm: pcm([1]) })).toBeNull()
    expect(parseAudioHelperMessage({ type: 'audio', at: Infinity, pcm: pcm([1]) })).toBeNull()
    // An odd number of bytes isn't 16-bit audio.
    expect(parseAudioHelperMessage({ type: 'audio', at: 1, pcm: 'AA==' })).toBeNull()
    expect(parseAudioHelperMessage({ type: 'audio', at: 1, pcm: '' })).toBeNull()
    expect(parseAudioHelperMessage({ type: 'reply', id: '1', ok: true })).toBeNull()
    expect(parseAudioHelperMessage({ type: 'mystery' })).toBeNull()
  })

  it('refuses chunks far bigger than the helper sends', () => {
    const huge = pcm(new Array(20_000).fill(1))
    expect(parseAudioHelperMessage({ type: 'audio', at: 1, pcm: huge })).toBeNull()
  })
})
