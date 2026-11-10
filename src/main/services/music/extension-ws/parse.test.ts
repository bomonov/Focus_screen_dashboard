import { describe, expect, it } from 'vitest'
import { browserForOrigin, isLoopbackHost, parseExtensionMessage } from './parse'
import { CHROME_EXTENSION_ID, isArtworkUrl } from './protocol'

const page = {
  videoId: 'dQw4w9WgXcQ',
  playlistId: 'PLx7Gk2mQ9vR4tYb_Lw-8sNc3dHfJ0aZpE',
  title: 'Monsoon Drive',
  artist: 'Mesa Lights',
  album: 'Late Summer',
  durationSec: 241,
  positionSec: 12.5,
  playing: true,
  shuffle: null,
  repeat: 'all',
  artworkUrl: 'https://lh3.googleusercontent.com/abc=w544-h544',
  ad: false,
  next: null
}

describe('browserForOrigin', () => {
  it('knows our Chrome extension and any Safari extension', () => {
    expect(browserForOrigin(`chrome-extension://${CHROME_EXTENSION_ID}`)).toBe('chrome')
    expect(browserForOrigin('safari-web-extension://3F2504E0-4F89-11D3-9A0C-0305E82C3301')).toBe(
      'safari'
    )
  })

  it('refuses websites, other extensions and missing origins', () => {
    expect(browserForOrigin('https://music.youtube.com')).toBeNull()
    expect(browserForOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBeNull()
    expect(browserForOrigin('safari-web-extension://evil')).toBeNull()
    expect(browserForOrigin('null')).toBeNull()
    expect(browserForOrigin(undefined)).toBeNull()
  })
})

describe('isLoopbackHost', () => {
  it('accepts only our own address and port', () => {
    expect(isLoopbackHost('127.0.0.1:47833', 47833)).toBe(true)
    expect(isLoopbackHost('localhost:47833', 47833)).toBe(true)
    expect(isLoopbackHost('evil.example:47833', 47833)).toBe(false)
    expect(isLoopbackHost('127.0.0.1:80', 47833)).toBe(false)
    expect(isLoopbackHost(undefined, 47833)).toBe(false)
  })
})

describe('isArtworkUrl', () => {
  it('allows only YouTube Music cover hosts over https', () => {
    expect(isArtworkUrl('https://lh3.googleusercontent.com/x=w544')).toBe(true)
    expect(isArtworkUrl('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBe(true)
    expect(isArtworkUrl('https://yt3.ggpht.com/x')).toBe(true)
    expect(isArtworkUrl('http://lh3.googleusercontent.com/x')).toBe(false)
    expect(isArtworkUrl('https://googleusercontent.com.evil.io/x')).toBe(false)
    expect(isArtworkUrl('https://example.com/x.jpg')).toBe(false)
    expect(isArtworkUrl('not a url')).toBe(false)
  })
})

describe('parseExtensionMessage', () => {
  it('reads the lyrics a page saw, within limits, and nothing off-shape', () => {
    const lyrics = {
      videoId: 'STmgdRrgpjk',
      title: 'Light in Doubt',
      artist: 'imase',
      text: 'one   \ntwo\n\nthree',
      source: 'Musixmatch'
    }
    expect(parseExtensionMessage({ type: 'lyrics', lyrics })).toEqual({
      type: 'lyrics',
      lyrics: { ...lyrics, text: 'one\ntwo\n\nthree' }
    })
    const long = parseExtensionMessage({
      type: 'lyrics',
      lyrics: { ...lyrics, text: 'line\n'.repeat(5000), source: 'x'.repeat(500) }
    })
    expect(long?.type === 'lyrics' && long.lyrics.text.split('\n')).toHaveLength(600)
    expect(long?.type === 'lyrics' && long.lyrics.source).toHaveLength(60)
    expect(parseExtensionMessage({ type: 'lyrics', lyrics: { ...lyrics, text: '  ' } })).toBeNull()
    expect(parseExtensionMessage({ type: 'lyrics', lyrics: { ...lyrics, title: '' } })).toBeNull()
    expect(parseExtensionMessage({ type: 'lyrics', lyrics: { ...lyrics, text: 7 } })).toBeNull()
    expect(
      parseExtensionMessage({ type: 'lyrics', lyrics: { ...lyrics, videoId: '<bad id>' } })
    ).toMatchObject({ lyrics: { videoId: null } })
  })

  it('reads hello and pair', () => {
    expect(parseExtensionMessage({ type: 'hello', version: 1, token: 'abc' })).toEqual({
      type: 'hello',
      version: 1,
      token: 'abc'
    })
    expect(parseExtensionMessage({ type: 'pair', version: 1, code: '482 913' })).toEqual({
      type: 'pair',
      version: 1,
      code: '482913'
    })
  })

  it('reads a page state', () => {
    expect(parseExtensionMessage({ type: 'state', state: page })).toEqual({
      type: 'state',
      state: page
    })
    expect(parseExtensionMessage({ type: 'state', state: null })).toEqual({
      type: 'state',
      state: null
    })
  })

  it('cleans a page state field by field', () => {
    const message = parseExtensionMessage({
      type: 'state',
      state: {
        ...page,
        videoId: '../../etc',
        playlistId: 'PL../../etc',
        durationSec: 1e12,
        positionSec: -3,
        playing: 'yes',
        shuffle: 1,
        repeat: 'twice',
        artworkUrl: 'https://tracker.example/pixel.gif',
        extra: 'dropped'
      }
    })
    expect(message).toEqual({
      type: 'state',
      state: {
        ...page,
        videoId: null,
        playlistId: null,
        durationSec: 86400,
        positionSec: 0,
        playing: false,
        shuffle: null,
        repeat: 'off',
        artworkUrl: null
      }
    })
  })

  it('reads the song up next, cleaning it like the song playing', () => {
    const next = {
      title: ' Monsoon Drive ',
      artist: 'Mesa Lights',
      durationSec: 241,
      artworkUrl: 'https://tracker.example/pixel.gif',
      extra: 'dropped'
    }
    const message = parseExtensionMessage({ type: 'state', state: { ...page, next } })
    expect(message?.type === 'state' && message.state?.next).toEqual({
      title: 'Monsoon Drive',
      artist: 'Mesa Lights',
      durationSec: 241,
      artworkUrl: null
    })
    for (const bad of [{ title: '' }, 'Monsoon Drive', 42]) {
      const read = parseExtensionMessage({ type: 'state', state: { ...page, next: bad } })
      expect(read?.type === 'state' && read.state?.next).toBeNull()
    }
  })

  it('reads a state from an older extension that sends no playlist', () => {
    const older: Record<string, unknown> = { ...page }
    delete older.playlistId
    expect(parseExtensionMessage({ type: 'state', state: older })).toEqual({
      type: 'state',
      state: { ...page, playlistId: null }
    })
  })

  it('keeps only playlist ids made of URL-safe letters, up to 200', () => {
    const playlistOf = (playlistId: unknown): unknown => {
      const message = parseExtensionMessage({ type: 'state', state: { ...page, playlistId } })
      return message?.type === 'state' ? message.state?.playlistId : 'dropped'
    }
    // Autoplay's radio and album lists look like this.
    expect(playlistOf('RDAMVMdQw4w9WgXcQ')).toBe('RDAMVMdQw4w9WgXcQ')
    expect(playlistOf('OLAK5uy_kN3x-9QzT')).toBe('OLAK5uy_kN3x-9QzT')
    expect(playlistOf('a'.repeat(200))).toBe('a'.repeat(200))
    for (const junk of [
      'a'.repeat(201),
      '',
      ' PLabc',
      'PL abc',
      'PL<script>',
      'PL%20abc',
      'PLabc&v=1',
      'PLábc',
      123,
      true,
      ['PLabc'],
      { id: 'PLabc' }
    ]) {
      expect(playlistOf(junk)).toBeNull()
    }
  })

  it('drops a state with no title, and junk', () => {
    expect(parseExtensionMessage({ type: 'state', state: { ...page, title: ' ' } })).toBeNull()
    expect(parseExtensionMessage({ type: 'state' })).toBeNull()
    expect(parseExtensionMessage({ type: 'hello', version: 1 })).toBeNull()
    expect(parseExtensionMessage({ type: 'reboot' })).toBeNull()
    expect(parseExtensionMessage('hello')).toBeNull()
  })

  it('checks artwork replies', () => {
    expect(parseExtensionMessage({ type: 'artwork', requestId: 3, base64: 'AAEC' })).toEqual({
      type: 'artwork',
      requestId: 3,
      base64: 'AAEC'
    })
    expect(parseExtensionMessage({ type: 'artwork', requestId: 3, base64: '<script>' })).toBeNull()
    expect(parseExtensionMessage({ type: 'artwork', requestId: -1, base64: 'AA' })).toBeNull()
    expect(parseExtensionMessage({ type: 'artworkFailed', requestId: 4 })).toEqual({
      type: 'artworkFailed',
      requestId: 4
    })
  })
})
