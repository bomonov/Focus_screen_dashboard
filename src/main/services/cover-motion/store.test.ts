import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createCoverStore, type CoverStore } from './store'

const KEY = '0123456789abcdef'
let dir: string
let store: CoverStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cover-store-'))
  store = createCoverStore(dir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('keeps a recipe and what was built for it', () => {
  const recipe = {
    version: 1 as const,
    source: 'hand' as const,
    parts: [{ id: 'p1', kind: 'surge' as const, turn: 2 }]
  }
  store.writeRecipe(KEY, recipe)
  expect(store.readRecipe(KEY)).toEqual(recipe)
  const built = {
    version: 1 as const,
    plate: false,
    parts: {
      p1: {
        move: [0, -1] as [number, number],
        center: [1, 2] as [number, number],
        emitters: [],
        color: [1, 2, 3] as [number, number, number]
      }
    }
  }
  store.writeBuilt(KEY, built)
  expect(store.readBuilt(KEY)).toEqual(built)
  store.remove(KEY)
  expect(store.readRecipe(KEY)).toBeNull()
})

it('treats a damaged or future recipe as none', () => {
  store.writeRecipe(KEY, { version: 1, source: 'hand', parts: [] })
  writeFileSync(join(store.folder(KEY), 'recipe.json'), '{"version":2}')
  expect(store.readRecipe(KEY)).toBeNull()
  writeFileSync(join(store.folder(KEY), 'recipe.json'), 'not json')
  expect(store.readRecipe(KEY)).toBeNull()
  expect(store.readBuilt('fedcba9876543210')).toBeNull()
})

it('only keeps covers under real keys', () => {
  expect(() => store.folder('../etc')).toThrow()
  expect(() => store.folder('0123')).toThrow()
})

it('edits in a draft, so closing without saving leaves the saved parts alone', () => {
  const saved = store.paths(KEY)
  store.writeRecipe(KEY, {
    version: 1,
    source: 'hand',
    parts: [{ id: 'p1', kind: 'surge', turn: 0 }]
  })
  writeFileSync(saved.mask('p1'), 'saved mask')
  writeFileSync(saved.weight('p1'), 'saved weights')
  writeFileSync(saved.cover, 'cover')

  const draft = store.startDraft(KEY)
  expect(readFileSync(draft.mask('p1'), 'utf8')).toBe('saved mask')
  expect(readFileSync(draft.cover, 'utf8')).toBe('cover')
  writeFileSync(draft.weight('p1'), 'draft weights')
  store.dropDraft(KEY)
  expect(readFileSync(saved.weight('p1'), 'utf8')).toBe('saved weights')
  expect(existsSync(draft.folder)).toBe(false)

  const again = store.startDraft(KEY)
  writeFileSync(again.weight('p1'), 'new weights')
  const built = { version: 1 as const, plate: false, parts: {} }
  store.commitDraft(KEY, { version: 1, source: 'hand', parts: [] }, built)
  expect(readFileSync(saved.weight('p1'), 'utf8')).toBe('new weights')
  expect(store.readRecipe(KEY)?.parts).toEqual([])
  expect(existsSync(again.folder)).toBe(false)
})
