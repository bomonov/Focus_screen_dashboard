import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openOffsetStore } from './offsets'

describe('lyrics timing fixes', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'offsets-'))
    file = join(dir, 'lyrics-offsets.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('finds a fix saved when the player said the song was a second longer or shorter', () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, offsets: { 'nightcord at 25 00|irony|251': -0.5 } })
    )
    const offsets = openOffsetStore(file)
    expect(offsets.get('nightcord at 25 00|irony|250')).toBe(-0.5)
    expect(offsets.get('nightcord at 25 00|irony|252')).toBe(-0.5)
    expect(offsets.get('nightcord at 25 00|irony|253')).toBe(0)
  })

  it('reset clears the song at every length it came as, so the fix never comes back', () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, offsets: { 'nightcord at 25 00|irony|251': -0.5 } })
    )
    const offsets = openOffsetStore(file)
    offsets.set('nightcord at 25 00|irony|250', 0)
    expect(offsets.get('nightcord at 25 00|irony|251')).toBe(0)
    expect(openOffsetStore(file).get('nightcord at 25 00|irony|251')).toBe(0)
    expect(JSON.parse(readFileSync(file, 'utf8')).offsets).toEqual({})
  })

  it('a new fix replaces the one saved a second away rather than adding a second one', () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, offsets: { 'nightcord at 25 00|irony|251': -0.5 } })
    )
    const offsets = openOffsetStore(file)
    offsets.set('nightcord at 25 00|irony|250', 1)
    expect(offsets.get('nightcord at 25 00|irony|251')).toBe(1)
    expect(JSON.parse(readFileSync(file, 'utf8')).offsets).toEqual({
      'nightcord at 25 00|irony|250': 1
    })
  })

  it("leaves other songs' fixes alone", () => {
    writeFileSync(
      file,
      JSON.stringify({ version: 1, offsets: { 'a|song|200': 1, 'a|other|201': 2 } })
    )
    const offsets = openOffsetStore(file)
    offsets.set('a|song|200', 0)
    expect(offsets.get('a|other|201')).toBe(2)
    expect(offsets.get('a|other|200')).toBe(2)
  })
})
