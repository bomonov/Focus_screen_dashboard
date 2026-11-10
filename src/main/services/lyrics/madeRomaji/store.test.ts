import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openLearnedReadings, openMadeRomajiStore } from './store'

let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'made-romaji-'))
})
afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

const KEY = 'singer|song|200'
const LINES = ['空を見る', 'Hello', '龘の歌']

describe('romaji made for a song, saved', () => {
  it('keeps what was made for these lines of this song', () => {
    const store = openMadeRomajiStore(directory)
    expect(store.read(KEY, LINES)).toBeNull()
    store.write(KEY, LINES, ['sora o miru', '', null])
    expect(openMadeRomajiStore(directory).read(KEY, LINES)).toEqual(['sora o miru', '', null])
  })

  it('makes it again for other lines of the same song, like another version of its lyrics', () => {
    const store = openMadeRomajiStore(directory)
    store.write(KEY, LINES, ['sora o miru', '', null])
    expect(store.read(KEY, ['空を見た', 'Hello', '龘の歌'])).toBeNull()
  })

  it('treats a file it did not write, or a broken one, as nothing saved', () => {
    const store = openMadeRomajiStore(directory)
    store.write(KEY, LINES, ['sora o miru', '', null])
    const [file] = readdirSync(directory)
    if (!file) throw new Error('nothing was saved')
    writeFileSync(join(directory, file), '{"version":1,"key":"other","romaji":[1]}')
    expect(store.read(KEY, LINES)).toBeNull()
    writeFileSync(join(directory, file), 'not json')
    expect(store.read(KEY, LINES)).toBeNull()
  })
})

describe('readings learned before, saved', () => {
  it('keeps the readings with the stamp of the romaji they were learned from', () => {
    const file = join(directory, 'learned.json')
    expect(openLearnedReadings(file).read()).toBeNull()
    openLearnedReadings(file).write('3:100', [['明日|名詞副詞可能|ashita', 'asu']])
    expect(openLearnedReadings(file).read()).toEqual({
      stamp: '3:100',
      readings: [['明日|名詞副詞可能|ashita', 'asu']]
    })
  })

  it('treats a broken file as nothing learned', () => {
    const file = join(directory, 'learned.json')
    writeFileSync(file, '{"version":1,"stamp":"3:100","readings":[["only one"]]}')
    expect(openLearnedReadings(file).read()).toBeNull()
    writeFileSync(file, 'not json')
    expect(openLearnedReadings(file).read()).toBeNull()
  })
})
