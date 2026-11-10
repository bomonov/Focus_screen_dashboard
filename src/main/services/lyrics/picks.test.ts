import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openPickStore, parsePicks } from './picks'

describe('lyrics picks', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'picks-'))
    file = join(dir, 'lyrics-picks.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps each kind of pick across restarts, and forgets one set to automatic', () => {
    const picks = openPickStore(file)
    picks.set('nightcord at 25 00|irony|251', { kind: 'version', id: 10604292 })
    picks.set('a|song|200', { kind: 'listen' })
    picks.set('b|song|200', { kind: 'none' })
    const again = openPickStore(file)
    expect(again.get('nightcord at 25 00|irony|251')).toEqual({ kind: 'version', id: 10604292 })
    expect(again.get('a|song|200')).toEqual({ kind: 'listen' })
    expect(again.get('b|song|200')).toEqual({ kind: 'none' })
    again.set('a|song|200', null)
    expect(openPickStore(file).get('a|song|200')).toBeNull()
  })

  it('finds a pick made when the song came a second longer or shorter, and replaces it', () => {
    const picks = openPickStore(file)
    picks.set('nightcord at 25 00|irony|251', { kind: 'version', id: 10604292 })
    expect(picks.get('nightcord at 25 00|irony|250')).toEqual({ kind: 'version', id: 10604292 })
    picks.set('nightcord at 25 00|irony|250', { kind: 'none' })
    expect(picks.get('nightcord at 25 00|irony|251')).toEqual({ kind: 'none' })
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).picks)).toEqual([
      'nightcord at 25 00|irony|250'
    ])
  })

  it('reads a damaged or hand-edited file as no picks for what does not fit', () => {
    const many = Object.fromEntries(
      Array.from({ length: 5001 }, (_, i) => [`a|s${i}|1`, { kind: 'none' }])
    )
    expect(parsePicks({ version: 1, picks: many }).size).toBe(5000)
    const raw = {
      version: 1,
      picks: {
        'a|good|1': { kind: 'version', id: 7 },
        'a|zero|1': { kind: 'version', id: 0 },
        'a|negative|1': { kind: 'version', id: -1 },
        'a|half|1': { kind: 'version', id: 1.5 },
        'a|odd|1': { kind: 'everything' },
        [`${'x'.repeat(501)}|1`]: { kind: 'none' }
      }
    }
    expect([...parsePicks(raw).keys()]).toEqual(['a|good|1'])
    expect(parsePicks('nonsense').size).toBe(0)
    writeFileSync(file, '{broken')
    expect(openPickStore(file).get('a|good|1')).toBeNull()
  })
})
