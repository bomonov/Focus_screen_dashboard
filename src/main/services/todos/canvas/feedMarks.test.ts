import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openFeedMarks } from './feedMarks'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focus-screen-canvas-'))
  file = join(dir, 'canvas-feed-done.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('openFeedMarks', () => {
  it('keeps check-offs across restarts', () => {
    const marks = openFeedMarks(file)
    marks.set('event-assignment-1', 100)
    marks.set('event-assignment-2', 200)
    marks.set('event-assignment-2', null)
    const again = openFeedMarks(file)
    expect(again.get('event-assignment-1')).toBe(100)
    expect(again.get('event-assignment-2')).toBeUndefined()
  })

  it('forgets entries that left the feed, and removes the file when empty', () => {
    const marks = openFeedMarks(file)
    marks.set('a', 1)
    marks.set('b', 2)
    marks.keepOnly(new Set(['b']))
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, done: { b: 2 } })
    marks.clear()
    expect(existsSync(file)).toBe(false)
  })

  it('starts empty from a broken file', () => {
    writeFileSync(file, '{ nope')
    expect(openFeedMarks(file).get('a')).toBeUndefined()
    writeFileSync(file, JSON.stringify({ version: 1, done: { a: 'yesterday', b: 5 } }))
    const marks = openFeedMarks(file)
    expect(marks.get('a')).toBeUndefined()
    expect(marks.get('b')).toBe(5)
  })
})
