import { describe, expect, it } from 'vitest'
import { pageReport } from './adapter'
import type { PageState } from './protocol'

const T0 = 1_800_000_000

const page: PageState = {
  videoId: 'abcdefghijk',
  playlistId: 'PLx7Gk2mQ9vR4tYb_Lw-8sNc3dHfJ0aZpE',
  title: 'Quiet Library',
  artist: 'Lofi Desk Club',
  album: 'Study Hall',
  durationSec: 187,
  positionSec: 30,
  playing: true,
  shuffle: null,
  repeat: 'one',
  artworkUrl: 'https://lh3.googleusercontent.com/x',
  ad: false
}

describe('pageReport', () => {
  it('turns a page into a player reading, counting on while playing', () => {
    expect(pageReport('ytmChrome', page, T0, T0 + 2.5)).toEqual({
      player: 'ytmChrome',
      at: T0 + 2.5,
      kind: 'open',
      snapshot: {
        status: 'playing',
        track: {
          id: 'ytm:abcdefghijk',
          title: 'Quiet Library',
          artist: 'Lofi Desk Club',
          album: 'Study Hall',
          durationSec: 187,
          artworkRef: 'https://lh3.googleusercontent.com/x'
        },
        positionSec: 32.5,
        shuffle: false,
        repeat: 'one',
        playlistId: 'PLx7Gk2mQ9vR4tYb_Lw-8sNc3dHfJ0aZpE',
        next: null
      }
    })
  })

  it('passes on the song up next, with its cover for the extension to fetch', () => {
    const next = {
      title: 'Monsoon Drive',
      artist: 'Mesa Lights',
      durationSec: 241,
      artworkUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg'
    }
    const report = pageReport('ytmChrome', { ...page, next }, T0, T0)
    expect(report.kind === 'open' && report.snapshot.next).toEqual({
      title: 'Monsoon Drive',
      artist: 'Mesa Lights',
      durationSec: 241,
      artworkRef: 'https://i.ytimg.com/vi/x/hqdefault.jpg'
    })
    // Nothing is up next while an ad plays.
    const ad = pageReport('ytmChrome', { ...page, ad: true, next }, T0, T0)
    expect(ad.kind === 'open' && ad.snapshot.next).toBeNull()
  })

  it('reports no playlist when an older extension sends none', () => {
    const older: PageState = { ...page }
    delete older.playlistId
    const report = pageReport('ytmChrome', older, T0, T0)
    expect(report.kind === 'open' && report.snapshot.playlistId).toBeNull()
  })

  it('holds still while paused and never runs past the end', () => {
    const paused = pageReport('ytmSafari', { ...page, playing: false }, T0, T0 + 60)
    expect(paused.kind === 'open' && paused.snapshot.positionSec).toBe(30)
    const late = pageReport('ytmSafari', page, T0, T0 + 600)
    expect(late.kind === 'open' && late.snapshot.positionSec).toBe(187)
  })

  it('reports no tab as closed', () => {
    expect(pageReport('ytmChrome', null, T0, T0 + 1)).toEqual({
      player: 'ytmChrome',
      at: T0 + 1,
      kind: 'closed'
    })
  })

  it('shows ads as an ad, without the song’s cover', () => {
    const ad = pageReport('ytmChrome', { ...page, ad: true }, T0, T0)
    expect(ad.kind === 'open' && ad.snapshot.track).toMatchObject({
      id: 'ytm:ad',
      title: 'Ad',
      artworkRef: null
    })
  })

  it('makes an id from the title when the URL has none', () => {
    const report = pageReport('ytmChrome', { ...page, videoId: null }, T0, T0)
    expect(report.kind === 'open' && report.snapshot.track?.id).toBe(
      'ytm:Quiet Library\nLofi Desk Club'
    )
  })
})
