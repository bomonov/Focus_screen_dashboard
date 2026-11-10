import { describe, expect, it } from 'vitest'
import { cleanChannel, songFromVideo, thumbnailFor, watchVideoId } from './youtubePage'

describe('songFromVideo', () => {
  it('splits "Artist - Song (Official Video)"', () => {
    expect(songFromVideo('The Weeknd - Blinding Lights (Official Video)', 'TheWeekndVEVO')).toEqual(
      {
        artist: 'The Weeknd',
        title: 'Blinding Lights'
      }
    )
  })
  it('falls back to the channel as the artist', () => {
    expect(songFromVideo('Blinding Lights', 'The Weeknd - Topic')).toEqual({
      title: 'Blinding Lights',
      artist: 'The Weeknd'
    })
  })
  it('drops [Lyrics] tags and "| ..." tails', () => {
    expect(songFromVideo('Coldplay – Yellow [Official Lyric Video] | 4K', 'Coldplay')).toEqual({
      artist: 'Coldplay',
      title: 'Yellow'
    })
  })
})

describe('cleanChannel', () => {
  it('strips Topic and VEVO', () => {
    expect(cleanChannel('Drake - Topic')).toBe('Drake')
    expect(cleanChannel('DrakeVEVO')).toBe('Drake')
  })
})

describe('watchVideoId', () => {
  it('reads watch pages only', () => {
    expect(watchVideoId('https://www.youtube.com/watch?v=4NRXx6U8ABQ&list=PL1')).toBe('4NRXx6U8ABQ')
    expect(watchVideoId('https://www.youtube.com/')).toBeNull()
    expect(watchVideoId('https://music.youtube.com/watch?v=4NRXx6U8ABQ')).toBeNull()
  })
  it('makes an i.ytimg.com thumbnail', () => {
    expect(thumbnailFor('abc123def45')).toBe('https://i.ytimg.com/vi/abc123def45/hqdefault.jpg')
  })
})
