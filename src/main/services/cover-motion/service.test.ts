import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlaybackState } from '../music/types'
import { defaultSettings, type Settings } from '../settings/schema'
import {
  createCoverMotionService,
  parseCoverEditorCommand,
  type CoverMotionService
} from './service'
import { createCoverStore, type CoverStore } from './store'
import type { StartCoverWorker } from './worker'

const KEYS: Record<string, string> = {
  'art-1': '1111111111111111',
  'art-2': '2222222222222222',
  // A different cover that happens to hash to art-1's key.
  'art-1-lookalike': '1111111111111111'
}
const FINGERPRINTS: Record<string, Uint8Array> = {
  'art-1': new Uint8Array(256).fill(40),
  'art-2': new Uint8Array(256).fill(120),
  'art-1-lookalike': new Uint8Array(256).fill(220)
}

function subject<T>(value: T): {
  get(): T
  set(next: T): void
  subscribe(fn: (v: T) => void): () => void
} {
  const listeners = new Set<(v: T) => void>()
  return {
    get: () => value,
    set(next) {
      value = next
      for (const fn of listeners) fn(next)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
  }
}

function playing(artwork: string | null): PlaybackState {
  return {
    player: { id: 'demo', name: 'Demo' },
    track: {
      id: `t:${artwork}`,
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      durationSec: 200,
      artwork
    },
    playing: true,
    positionSec: 0,
    positionAt: 0,
    shuffle: false,
    repeat: 'off',
    repeatModes: ['off'],
    problem: null,
    supportedPlayers: ['demo']
  }
}

interface Script {
  /** Each cut's area, in turn (0.2 once they run out). */
  areas?: number[]
  /** Which part each click lands on, in turn (none once they run out). */
  hits?: number[]
  /** Builds (counted from 1) that fail. */
  failBuilds?: number[]
  /** Every request the worker was sent. */
  sent?: Record<string, unknown>[]
}

/** A worker that does what the Python one would: writes the files it's told to, and answers. */
function scriptedWorker({
  areas = [],
  hits = [],
  failBuilds = [],
  sent = []
}: Script = {}): StartCoverWorker {
  let builds = 0
  let cuts = 0
  return ({ onMessage }) => ({
    send(raw) {
      const message = raw as Record<string, unknown>
      // A build also notes each part's mask as it was sent, to check what it was built from.
      sent.push(
        message.op === 'build'
          ? {
              ...message,
              masksAtSend: (message.parts as { mask: string }[]).map((part) =>
                existsSync(part.mask) ? readFileSync(part.mask, 'utf8') : null
              )
            }
          : message
      )
      queueMicrotask(() => {
        if (message.op === 'prepare') {
          onMessage({ type: 'reply', id: message.id, ok: true })
        } else if (message.op === 'hit') {
          onMessage({ type: 'reply', id: message.id, ok: true, index: hits.shift() ?? -1 })
        } else if (message.op === 'cut') {
          cuts++
          writeFileSync(message.out as string, `mask ${cuts}`)
          const strokes = message.strokes as { size: number | null }[]
          onMessage({
            type: 'reply',
            id: message.id,
            ok: true,
            area: areas.shift() ?? 0.2,
            sizes: strokes.map((stroke) => (stroke.size === null ? 0 : stroke.size % 3))
          })
        } else if (message.op === 'build') {
          builds++
          if (failBuilds.includes(builds)) {
            onMessage({ type: 'reply', id: message.id, ok: false, error: 'stopped' })
            return
          }
          const parts = message.parts as { out: string }[]
          for (const part of parts) writeFileSync(part.out, 'weights')
          onMessage({
            type: 'reply',
            id: message.id,
            ok: true,
            plate: false,
            parts: parts.map(() => ({
              move: [0, -1],
              center: [384, 384],
              emitters: [],
              color: [250, 250, 250]
            }))
          })
        }
      })
      return true
    },
    stop: () => undefined
  })
}

describe('the moving parts service', () => {
  let dir: string
  let store: CoverStore
  let music: ReturnType<typeof subject<PlaybackState>>
  let settings: ReturnType<typeof subject<Settings>>
  let service: CoverMotionService

  function start(worker: StartCoverWorker | null = scriptedWorker(), supported = true): void {
    service = createCoverMotionService({
      supported,
      store,
      startWorker: worker,
      music,
      settings,
      decode: (url) =>
        KEYS[url]
          ? {
              key: KEYS[url] as string,
              square: new Uint8Array([1]),
              fingerprint: FINGERPRINTS[url] as Uint8Array
            }
          : null,
      readDataUrl: (path) => (existsSync(path) ? `data:${basename(path)}` : null)
    })
  }

  function saveParts(key: string): void {
    const paths = store.paths(key)
    store.writeRecipe(key, {
      version: 1,
      source: 'hand',
      parts: [{ id: 'p1', kind: 'surge', turn: 0 }]
    })
    store.writeBuilt(key, {
      version: 1,
      plate: false,
      parts: { p1: { move: [0, -1], center: [384, 384], emitters: [], color: [1, 2, 3] } }
    })
    writeFileSync(paths.cover, 'cover')
    writeFileSync(paths.weight('p1'), 'weights')
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cover-service-'))
    store = createCoverStore(dir)
    music = subject(playing('art-1'))
    settings = subject(defaultSettings())
  })
  afterEach(() => {
    service.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it("draws a cover's saved parts while it plays, and nothing for another cover", () => {
    saveParts(KEYS['art-1'] as string)
    start()
    expect(service.get().available).toBe(true)
    expect(service.get().scene?.parts).toHaveLength(1)
    expect(service.get().scene?.parts[0]?.kind).toBe('surge')
    music.set(playing('art-2'))
    expect(service.get().scene).toBeNull()
  })

  it('finds the parts when the cover arrives after the song', () => {
    saveParts(KEYS['art-1'] as string)
    music.set(playing(null))
    start()
    expect(service.get().scene).toBeNull()
    music.set(playing('art-1'))
    expect(service.get().scene?.parts).toHaveLength(1)
  })

  it('saves to the cover the editor opened with, even after the song changed', async () => {
    start()
    await service.editor.command({ kind: 'open' })
    await service.editor.command({ kind: 'pick', x: 0.5, y: 0.4 })
    music.set(playing('art-2'))
    await service.editor.command({ kind: 'save' })
    expect(store.readRecipe(KEYS['art-1'] as string)?.parts).toHaveLength(1)
    expect(store.readRecipe(KEYS['art-2'] as string)).toBeNull()
  })

  it('refuses a part that is nearly nothing or nearly everything', async () => {
    start(scriptedWorker({ areas: [0.001, 0.9] }))
    await service.editor.command({ kind: 'open' })
    await service.editor.command({ kind: 'pick', x: 0.1, y: 0.1 })
    expect(service.editor.get().message).toBe('That’s too small to move')
    expect(service.editor.get().parts).toHaveLength(0)
    await service.editor.command({ kind: 'pick', x: 0.5, y: 0.5 })
    expect(service.editor.get().message).toBe('That’s most of the cover')
    expect(service.editor.get().parts).toHaveLength(0)
  })

  it('holds six parts at most', async () => {
    start()
    await service.editor.command({ kind: 'open' })
    for (let i = 0; i < 7; i++)
      await service.editor.command({ kind: 'pick', x: 0.1 * i + 0.1, y: 0.5 })
    expect(service.editor.get().parts).toHaveLength(6)
    expect(service.editor.get().message).toBe('Six moving parts at most')
  })

  it('is off when moving parts are turned off', () => {
    saveParts(KEYS['art-1'] as string)
    start()
    settings.set({
      ...defaultSettings(),
      music: { ...defaultSettings().music, movingParts: false }
    })
    expect(service.get()).toEqual({ available: false, setup: 'ready', scene: null })
  })

  it("says how to install it when the worker isn't there", async () => {
    start(null)
    expect(service.get().available).toBe(false)
    expect(service.get().setup).toBe('missing')
    await service.editor.command({ kind: 'open' })
    expect(service.editor.get().message).toBe(
      'Moving parts need an add-on that isn’t installed on this Mac'
    )
  })

  it('says the moving parts are a Mac thing elsewhere', () => {
    start(null, false)
    expect(service.get()).toEqual({ available: false, setup: 'unsupported', scene: null })
  })

  it('keeps what it shows and what it saves the same when a build fails', async () => {
    // Builds: 1 the first pick (ok), 2 the change to Drift (fails), 3 the restore, 4 the second
    // pick (fails), 5 its restore.
    start(scriptedWorker({ failBuilds: [2, 4] }))
    await service.editor.command({ kind: 'open' })
    await service.editor.command({ kind: 'pick', x: 0.5, y: 0.4 })
    await service.editor.command({ kind: 'setKind', id: 'p1', motion: 'drift' })
    expect(service.editor.get().parts.map((part) => part.kind)).toEqual(['sway'])
    await service.editor.command({ kind: 'pick', x: 0.2, y: 0.2 })
    expect(service.editor.get().parts).toHaveLength(1)
    await service.editor.command({ kind: 'save' })
    expect(store.readRecipe(KEYS['art-1'] as string)?.parts).toEqual([
      { id: 'p1', kind: 'sway', turn: 0, strokes: [{ x: 384, y: 307.2, add: true, size: 0 }] }
    ])
  })

  it("never shows a cover's parts over a different cover that shares its key", async () => {
    start()
    await service.editor.command({ kind: 'open' })
    await service.editor.command({ kind: 'pick', x: 0.5, y: 0.4 })
    await service.editor.command({ kind: 'save' })
    await service.editor.command({ kind: 'close' })
    expect(service.get().scene?.parts).toHaveLength(1)
    music.set(playing('art-1-lookalike'))
    expect(service.get().scene).toBeNull()
    music.set(playing('art-1'))
    expect(service.get().scene?.parts).toHaveLength(1)
  })

  describe('clicking parts', () => {
    const key = KEYS['art-1'] as string
    const cuts = (sent: Record<string, unknown>[]): Record<string, unknown>[] =>
      sent.filter((message) => message.op === 'cut')
    const draftMask = (id: string): string => join(store.folder(key), 'draft', `${id}.png`)

    it('reads the cover as the editor opens, so the first click is quick', async () => {
      const sent: Record<string, unknown>[] = []
      start(scriptedWorker({ sent }))
      await service.editor.command({ kind: 'open' })
      expect(sent[0]).toMatchObject({ op: 'prepare' })
      expect(service.editor.get().busy).toBeNull()
    })

    it('starts a part, and clicked again tries the next size of it instead of a new part', async () => {
      const sent: Record<string, unknown>[] = []
      start(scriptedWorker({ sent, hits: [-1, 0] }))
      await service.editor.command({ kind: 'open' })
      await service.editor.command({ kind: 'pick', x: 0.5, y: 0.25 })
      expect(service.editor.get().selected).toBe('p1')
      await service.editor.command({ kind: 'pick', x: 0.5, y: 0.25 })
      expect(service.editor.get().parts).toHaveLength(1)
      expect(cuts(sent)[1]).toMatchObject({
        strokes: [{ point: [384, 192], add: true, size: 1 }]
      })
      await service.editor.command({ kind: 'save' })
      expect(store.readRecipe(key)?.parts[0]?.strokes).toEqual([
        { x: 384, y: 192, add: true, size: 1 }
      ])
    })

    it('with Shift adds a piece to the selected part, with Option carves one out', async () => {
      const sent: Record<string, unknown>[] = []
      start(scriptedWorker({ sent, hits: [-1, -1, 0] }))
      await service.editor.command({ kind: 'open' })
      await service.editor.command({ kind: 'pick', x: 0.5, y: 0.25 })
      await service.editor.command({ kind: 'pick', x: 0.1, y: 0.3, with: 'add' })
      await service.editor.command({ kind: 'pick', x: 0.4, y: 0.3, with: 'carve' })
      expect(service.editor.get().parts).toHaveLength(1)
      expect(cuts(sent)[2]).toMatchObject({
        base: null,
        strokes: [
          { point: [384, 192], add: true, size: 0 },
          { point: [76.8, 230.4], add: true, size: 0 },
          { point: [307.2, 230.4], add: false, size: null }
        ]
      })
    })

    it('carves an older part on top of the mask it already had', async () => {
      saveParts(key)
      writeFileSync(store.paths(key).mask('p1'), 'old mask')
      const sent: Record<string, unknown>[] = []
      start(scriptedWorker({ sent, hits: [0] }))
      await service.editor.command({ kind: 'open' })
      await service.editor.command({ kind: 'pick', x: 0.4, y: 0.3, with: 'carve' })
      const base = cuts(sent)[0]?.base as string
      expect(basename(base)).toBe('p1-base.png')
      expect(readFileSync(base, 'utf8')).toBe('old mask')
      await service.editor.command({ kind: 'save' })
      expect(store.readRecipe(key)?.parts[0]).toMatchObject({ base: true })
    })

    it('says how to carve when Option-clicking where there is no part', async () => {
      start(scriptedWorker())
      await service.editor.command({ kind: 'open' })
      await service.editor.command({ kind: 'pick', x: 0.9, y: 0.9, with: 'carve' })
      expect(service.editor.get().message).toBe(
        'Option-click inside a part to cut a piece out of it'
      )
    })

    it('keeps a part as it was when its next size is refused', async () => {
      start(scriptedWorker({ hits: [-1, 0], areas: [0.2, 0.9] }))
      await service.editor.command({ kind: 'open' })
      await service.editor.command({ kind: 'pick', x: 0.5, y: 0.25 })
      await service.editor.command({ kind: 'pick', x: 0.5, y: 0.25 })
      expect(service.editor.get().message).toBe('That’s most of the cover')
      expect(readFileSync(draftMask('p1'), 'utf8')).toBe('mask 1')
      await service.editor.command({ kind: 'save' })
      expect(store.readRecipe(key)?.parts[0]?.strokes?.[0]?.size).toBe(0)
    })

    it('puts the old cut back before rebuilding when the new one fails to build', async () => {
      // Builds: 1 the first click (ok), 2 the next size (fails), 3 the old recipe again.
      const sent: Record<string, unknown>[] = []
      start(scriptedWorker({ sent, hits: [-1, 0], failBuilds: [2] }))
      await service.editor.command({ kind: 'open' })
      await service.editor.command({ kind: 'pick', x: 0.5, y: 0.25 })
      await service.editor.command({ kind: 'pick', x: 0.5, y: 0.25 })
      const builds = sent.filter((message) => message.op === 'build')
      expect(builds.map((build) => build.masksAtSend)).toEqual([['mask 1'], ['mask 2'], ['mask 1']])
      expect(readFileSync(draftMask('p1'), 'utf8')).toBe('mask 1')
      expect(service.editor.get().message).toBe('Couldn’t build that (stopped)')
      await service.editor.command({ kind: 'save' })
      expect(store.readRecipe(key)?.parts[0]?.strokes?.[0]?.size).toBe(0)
    })

    it('selects a part from the list, and forgets it once removed', async () => {
      start(scriptedWorker())
      await service.editor.command({ kind: 'open' })
      await service.editor.command({ kind: 'pick', x: 0.5, y: 0.25 })
      await service.editor.command({ kind: 'pick', x: 0.1, y: 0.1 })
      expect(service.editor.get().selected).toBe('p2')
      await service.editor.command({ kind: 'select', id: 'p1' })
      expect(service.editor.get().selected).toBe('p1')
      await service.editor.command({ kind: 'remove', id: 'p1' })
      expect(service.editor.get().selected).toBeNull()
    })
  })
})

describe('parseCoverEditorCommand', () => {
  it('reads a click with Shift or Option, and a part picked in the list', () => {
    expect(parseCoverEditorCommand({ kind: 'pick', x: 0.5, y: 0.5, with: 'carve' })).toEqual({
      kind: 'pick',
      x: 0.5,
      y: 0.5,
      with: 'carve'
    })
    expect(parseCoverEditorCommand({ kind: 'pick', x: 0.5, y: 0.5 })).toEqual({
      kind: 'pick',
      x: 0.5,
      y: 0.5
    })
    expect(parseCoverEditorCommand({ kind: 'select', id: 'p2' })).toEqual({
      kind: 'select',
      id: 'p2'
    })
  })

  it('refuses anything else', () => {
    expect(parseCoverEditorCommand({ kind: 'pick', x: 0.5, y: 0.5, with: 'paint' })).toBeNull()
    expect(parseCoverEditorCommand({ kind: 'select', id: '../p2' })).toBeNull()
    expect(parseCoverEditorCommand({ kind: 'pick', x: 2, y: 0.5 })).toBeNull()
  })
})
