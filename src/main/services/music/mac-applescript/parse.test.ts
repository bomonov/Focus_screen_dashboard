import { describe, expect, it } from 'vitest'
import { parseAppleScriptData, parseMacReport, spotifyArtworkUrl } from './parse'

const NOW = 1_800_000_000

describe('parseMacReport', () => {
  it('reads a Spotify line, converting milliseconds and the on/off repeat', () => {
    const report = parseMacReport(
      'spotify',
      {
        kind: 'open',
        at: NOW - 0.2,
        state: 'playing',
        position: 84.5,
        track: {
          id: 'spotify:track:abc',
          name: 'Low Sun Hours',
          artist: 'The Saguaro Set',
          album: 'Night Shift Sessions',
          duration: 213000,
          artworkUrl: 'https://i.scdn.co/image/ab67'
        },
        shuffle: true,
        repeat: true
      },
      NOW
    )
    expect(report).toEqual({
      player: 'spotify',
      at: NOW - 0.2,
      kind: 'open',
      snapshot: {
        status: 'playing',
        track: {
          id: 'spotify:track:abc',
          title: 'Low Sun Hours',
          artist: 'The Saguaro Set',
          album: 'Night Shift Sessions',
          durationSec: 213,
          artworkRef: 'https://i.scdn.co/image/ab67'
        },
        positionSec: 84.5,
        shuffle: true,
        repeat: 'all'
      }
    })
  })

  it('reads an Apple Music line (real output from Music.app)', () => {
    const line = JSON.parse(
      '{"kind":"open","at":1800000000,"state":"paused","position":71.70800018310547,"track":{"id":"6B7B7F973C780D0A","name":"Marino - Devil In Disguise (Official Music Video)","artist":"Marino","album":"","duration":110.04000091552734,"stream":null},"shuffle":false,"repeat":"one"}'
    )
    const report = parseMacReport('appleMusic', line, NOW)
    expect(report).toMatchObject({
      kind: 'open',
      snapshot: {
        status: 'paused',
        track: {
          id: '6B7B7F973C780D0A',
          title: 'Marino - Devil In Disguise (Official Music Video)',
          artist: 'Marino',
          album: '',
          durationSec: 110.04000091552734,
          artworkRef: '6B7B7F973C780D0A'
        },
        repeat: 'one'
      }
    })
  })

  it('shows a radio stream by its song, with the station as the album', () => {
    const report = parseMacReport(
      'appleMusic',
      {
        kind: 'open',
        state: 'playing',
        position: 12,
        track: {
          id: 'AA11',
          name: 'Lofi Radio',
          artist: '',
          album: '',
          duration: 0,
          stream: 'Quiet Library'
        },
        shuffle: false,
        repeat: 'off'
      },
      NOW
    )
    expect(report).toMatchObject({
      snapshot: {
        track: { title: 'Quiet Library', album: 'Lofi Radio', durationSec: 0, artworkRef: null }
      }
    })
  })

  it('counts Music fast-forwarding as playing and drops the song when stopped', () => {
    const seeking = parseMacReport('appleMusic', { kind: 'open', state: 'fast forwarding' }, NOW)
    expect(seeking).toMatchObject({ snapshot: { status: 'playing', track: null } })
    const stopped = parseMacReport(
      'appleMusic',
      { kind: 'open', state: 'stopped', track: { id: 'X', name: 'Old' } },
      NOW
    )
    expect(stopped).toMatchObject({ snapshot: { status: 'stopped', track: null } })
  })

  it('passes closed, denied and failed through', () => {
    expect(parseMacReport('spotify', { kind: 'closed', installed: false, at: NOW }, NOW)).toEqual({
      player: 'spotify',
      at: NOW,
      kind: 'closed',
      installed: false
    })
    expect(parseMacReport('spotify', { kind: 'closed', at: NOW }, NOW)).toEqual({
      player: 'spotify',
      at: NOW,
      kind: 'closed'
    })
    expect(parseMacReport('spotify', { kind: 'denied', at: NOW }, NOW)?.kind).toBe('denied')
    expect(parseMacReport('spotify', { kind: 'failed', code: -1712 }, NOW)?.kind).toBe('failed')
  })

  it('uses our own clock when the stamp is missing or far off', () => {
    expect(parseMacReport('spotify', { kind: 'closed' }, NOW)?.at).toBe(NOW)
    expect(parseMacReport('spotify', { kind: 'closed', at: NOW + 3600 }, NOW)?.at).toBe(NOW)
    expect(parseMacReport('spotify', { kind: 'closed', at: 'soon' }, NOW)?.at).toBe(NOW)
  })

  it('treats malformed output as no data', () => {
    expect(parseMacReport('spotify', null, NOW)).toBeNull()
    expect(parseMacReport('spotify', [1, 2], NOW)).toBeNull()
    expect(parseMacReport('spotify', { kind: 'exploded' }, NOW)).toBeNull()
    expect(parseMacReport('spotify', { kind: 'open', state: 'dancing' }, NOW)).toBeNull()
  })

  it('cleans up odd field values instead of failing', () => {
    const report = parseMacReport(
      'spotify',
      {
        kind: 'open',
        state: 'playing',
        position: -4,
        track: { name: '  Ad  ', artist: 42, duration: Number.NaN },
        shuffle: 'yes',
        repeat: 'one'
      },
      NOW
    )
    expect(report).toMatchObject({
      snapshot: {
        positionSec: 0,
        shuffle: false,
        repeat: 'off',
        track: { title: 'Ad', artist: '', durationSec: 0, artworkRef: null }
      }
    })
    // A song without an id still gets a stable one.
    expect(report?.kind === 'open' && report.snapshot.track?.id).toBe('Ad\n\n')
  })

  it('drops a song with no title', () => {
    const report = parseMacReport(
      'spotify',
      { kind: 'open', state: 'playing', track: { id: 'spotify:ad:1', name: '' } },
      NOW
    )
    expect(report).toMatchObject({ snapshot: { track: null } })
  })
})

describe('spotifyArtworkUrl', () => {
  it('accepts Spotify image URLs and upgrades http to https', () => {
    expect(spotifyArtworkUrl('https://i.scdn.co/image/ab67')).toBe('https://i.scdn.co/image/ab67')
    expect(spotifyArtworkUrl('http://i.scdn.co/image/ab67')).toBe('https://i.scdn.co/image/ab67')
  })

  it('rejects every other host or form', () => {
    expect(spotifyArtworkUrl('https://example.com/image/ab67')).toBeNull()
    expect(spotifyArtworkUrl('https://i.scdn.co.evil.com/x')).toBeNull()
    expect(spotifyArtworkUrl('https://user:pw@i.scdn.co/x')).toBeNull()
    expect(spotifyArtworkUrl('https://i.scdn.co:8443/x')).toBeNull()
    expect(spotifyArtworkUrl('file:///etc/passwd')).toBeNull()
    expect(spotifyArtworkUrl('not a url')).toBeNull()
    expect(spotifyArtworkUrl(null)).toBeNull()
  })
})

describe('parseAppleScriptData', () => {
  it('reads the bytes from osascript’s «data» form', () => {
    expect(Array.from(parseAppleScriptData('«data JPEGFFD8FFE0»\n') ?? [])).toEqual([
      0xff, 0xd8, 0xff, 0xe0
    ])
    expect(parseAppleScriptData('«data PNGf89504E47»')).toHaveLength(4)
  })

  it('returns null for no cover or garbage', () => {
    expect(parseAppleScriptData('')).toBeNull()
    expect(parseAppleScriptData('\n')).toBeNull()
    expect(parseAppleScriptData('«data JPEG»')).toBeNull()
    expect(parseAppleScriptData('«data JPEGFFD»')).toBeNull()
    expect(parseAppleScriptData('«data JPEGZZZZ»')).toBeNull()
    expect(parseAppleScriptData('missing value')).toBeNull()
  })
})
