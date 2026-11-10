import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { openAutoSyncedStore } from './store'

let dir = ''
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'focus-autosync-'))
  return dir
}

const plain = ['first line', '', 'second line']
const lines = [
  { timeSec: 12.5, text: 'first line' },
  { timeSec: 20, text: 'second line' }
]

describe('openAutoSyncedStore', () => {
  it('reads back timings for the same song and lyrics', () => {
    const store = openAutoSyncedStore(tempDir())
    store.write('artist\nsong', plain, lines)
    expect(openAutoSyncedStore(dir).read('artist\nsong', plain)).toEqual(lines)
    // Stanza breaks and spacing don't change which lyrics these are.
    expect(store.read('artist\nsong', ['first line ', 'second line'])).toEqual(lines)
  })

  it('ignores timings made for other lyrics or another song', () => {
    const store = openAutoSyncedStore(tempDir())
    store.write('artist\nsong', plain, lines)
    expect(store.read('artist\nsong', ['first line', 'a new second line'])).toBeNull()
    expect(store.read('artist\nother song', plain)).toBeNull()
  })

  it('treats a damaged file as no timings', () => {
    const store = openAutoSyncedStore(tempDir())
    store.write('artist\nsong', plain, lines)
    const [file] = readdirSync(dir)
    if (!file) throw new Error('nothing written')
    writeFileSync(join(dir, file), '{"version":1,"key":"artist\\nsong","lines":[{"timeSec":-1}]}')
    expect(store.read('artist\nsong', plain)).toBeNull()
    writeFileSync(join(dir, file), 'not json')
    expect(store.read('artist\nsong', plain)).toBeNull()
  })
})

describe('word timings', () => {
  it('keeps each line’s words, and reads older files that have none', () => {
    const store = openAutoSyncedStore(tempDir())
    const timed = [
      {
        timeSec: 12.5,
        text: 'first line',
        words: [
          { text: 'first', start: 12.5, end: 13 },
          { text: ' line', start: 13.1, end: 14 }
        ]
      },
      { timeSec: 20, text: 'second line' }
    ]
    store.write('artist\nsong', plain, timed)
    expect(openAutoSyncedStore(dir).read('artist\nsong', plain)).toEqual(timed)
  })
})
