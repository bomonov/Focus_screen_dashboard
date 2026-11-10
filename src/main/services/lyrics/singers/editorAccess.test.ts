import { describe, expect, it, vi } from 'vitest'
import { NO_LYRICS, type LyricsState } from '../types'
import type { ColorEditorCommand } from './editorTypes'

// The photo extensions come from a file that also asks Electron for its dialogs.
vi.mock('electron', () => ({ dialog: {}, nativeImage: {} }))

import { canColorCode, mayRunFromEditor } from './editorAccess'

const found = (lyrics: NonNullable<LyricsState['lyrics']>): LyricsState => ({
  ...NO_LYRICS,
  trackId: 'song-1',
  status: 'found',
  lyrics
})

describe('canColorCode', () => {
  it('is on for synced and plain lyrics', () => {
    expect(
      canColorCode(found({ kind: 'synced', lines: [{ timeSec: 1, text: 'a' }], source: 'lrclib' }))
    ).toBe(true)
    expect(canColorCode(found({ kind: 'plain', lines: ['a'], source: 'vocadb' }))).toBe(true)
  })

  it('is off for an instrumental, and while nothing is found', () => {
    expect(canColorCode(found({ kind: 'instrumental', source: 'lrclib' }))).toBe(false)
    expect(canColorCode(NO_LYRICS)).toBe(false)
    expect(canColorCode({ ...NO_LYRICS, trackId: 'song-1', status: 'loading' })).toBe(false)
    expect(canColorCode({ ...NO_LYRICS, trackId: 'song-1', status: 'notFound' })).toBe(false)
  })

  it('is off when "found" came with no lyrics', () => {
    expect(canColorCode({ ...NO_LYRICS, trackId: 'song-1', status: 'found' })).toBe(false)
  })
})

describe('mayRunFromEditor', () => {
  const fromPath = (path: string): ColorEditorCommand => ({
    kind: 'pictureFromPath',
    singer: 'miku',
    path
  })

  it('lets a dropped picture through while a session is open', () => {
    expect(mayRunFromEditor(fromPath('/Users/me/Pictures/miku.png'), true)).toBe(true)
    expect(mayRunFromEditor(fromPath('/Users/me/Pictures/MIKU.JPG'), true)).toBe(true)
  })

  it('drops a dropped file without a session', () => {
    expect(mayRunFromEditor(fromPath('/Users/me/Pictures/miku.png'), false)).toBe(false)
  })

  it('drops a dropped file that isn’t a picture', () => {
    expect(mayRunFromEditor(fromPath('/Users/me/notes.txt'), true)).toBe(false)
    expect(mayRunFromEditor(fromPath('/Users/me/secrets'), true)).toBe(false)
    expect(mayRunFromEditor(fromPath('/Users/me/png'), true)).toBe(false)
  })

  it('leaves every other command to the editor', () => {
    expect(mayRunFromEditor({ kind: 'undo' }, true)).toBe(true)
    expect(mayRunFromEditor({ kind: 'begin', colors: null }, false)).toBe(true)
  })
})
