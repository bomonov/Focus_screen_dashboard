import { copyFileSync, existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { PlaybackState } from '../music/types'
import { planClick, type ClickWith } from './clicks'
import { sameCover } from './coverKey'
import type { Settings } from '../settings/schema'
import {
  ANALYSIS_PX,
  MAX_PARTS,
  MOTION_KINDS,
  RECIPE_VERSION,
  turned,
  withKind,
  withoutPart,
  withPart,
  withStrokes,
  type CoverRecipe,
  type MotionKind
} from './recipe'
import type { BuiltScene, CoverPaths, CoverStore } from './store'
import type {
  CoverEditorCommand,
  CoverEditorState,
  CoverMotionState,
  CoverScene,
  ScenePart
} from './types'
import { createCoverWorker, type CoverWorker, type StartCoverWorker } from './worker'

/** A click that cuts out less than this, or more, isn't a part anyone meant. */
const MIN_AREA = 0.002
const MAX_AREA = 0.8
const NEW_PART_KIND: MotionKind = 'sway'

const NOT_INSTALLED = 'Moving parts need an add-on that isn’t installed on this Mac'

interface Observable<T> {
  get(): T
  subscribe(listener: (value: T) => void): () => void
}

export interface CoverMotionDeps {
  /** A Mac: the worker is a Mac-only add-on for now. */
  supported: boolean
  store: CoverStore
  /** Null off the Mac, or before `npm run setup:covers`. */
  startWorker: StartCoverWorker | null
  music: Observable<PlaybackState>
  settings: Observable<Settings>
  /**
   * The cover's key, its middle square at the analysis size (JPEG) and its fingerprint; null if
   * it won't decode.
   */
  decode(dataUrl: string): { key: string; square: Uint8Array; fingerprint: Uint8Array } | null
  /** A file in the library as a data URL; null when it isn't there. */
  readDataUrl(path: string): string | null
}

export interface CoverMotionService {
  get(): CoverMotionState
  subscribe(listener: (state: CoverMotionState) => void): () => void
  editor: {
    get(): CoverEditorState
    subscribe(listener: (state: CoverEditorState) => void): () => void
    command(command: CoverEditorCommand): Promise<void>
  }
  dispose(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const PART_ID = /^p[0-9]{1,3}$/

/** What the editor's page sends is untrusted like any renderer message. */
export function parseCoverEditorCommand(raw: unknown): CoverEditorCommand | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'open':
    case 'close':
    case 'save':
    case 'useAutomatic':
      return { kind: raw.kind }
    case 'pick': {
      const { x, y } = raw
      if (typeof x !== 'number' || typeof y !== 'number') return null
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null
      if (raw.with === 'add' || raw.with === 'carve') return { kind: 'pick', x, y, with: raw.with }
      return raw.with === undefined ? { kind: 'pick', x, y } : null
    }
    case 'select':
    case 'turn':
    case 'remove':
      return typeof raw.id === 'string' && PART_ID.test(raw.id)
        ? { kind: raw.kind, id: raw.id }
        : null
    case 'setKind':
      if (typeof raw.id !== 'string' || !PART_ID.test(raw.id)) return null
      if (typeof raw.motion !== 'string') return null
      if (!(MOTION_KINDS as readonly string[]).includes(raw.motion)) return null
      return { kind: 'setKind', id: raw.id, motion: raw.motion as MotionKind }
    default:
      return null
  }
}

/** A part's id as a number, for its spray's seed and the next part's id. */
const partNumber = (id: string): number => Number(id.slice(1))

const CLOSED: CoverEditorState = {
  open: false,
  busy: null,
  cover: null,
  parts: [],
  selected: null,
  preview: null,
  message: null,
  dirty: false
}

interface Draft {
  key: string
  fingerprint: Uint8Array
  paths: CoverPaths
  recipe: CoverRecipe
  built: BuiltScene
}

export function createCoverMotionService(deps: CoverMotionDeps): CoverMotionService {
  const { store, music, settings, decode, readDataUrl } = deps
  const listeners = new Set<(state: CoverMotionState) => void>()
  const editorListeners = new Set<(state: CoverEditorState) => void>()
  let worker: CoverWorker | null = null
  let artwork: string | null = null
  let key: string | null = null
  let fingerprint: Uint8Array | null = null
  let state: CoverMotionState = { available: false, setup: 'unsupported', scene: null }
  let editor: CoverEditorState = CLOSED
  /** The cover the editor opened with, its draft folder, and what's been picked so far. */
  let draft: Draft | null = null

  const available = (): boolean => deps.startWorker !== null && settings.get().music.movingParts

  function sceneFrom(paths: CoverPaths, recipe: CoverRecipe, built: BuiltScene): CoverScene | null {
    const cover = readDataUrl(paths.cover)
    if (!cover) return null
    const parts: ScenePart[] = []
    for (const part of recipe.parts) {
      const numbers = built.parts[part.id]
      const weight = readDataUrl(paths.weight(part.id))
      if (!numbers || !weight) continue
      parts.push({ kind: part.kind, weight, ...numbers, seed: partNumber(part.id) })
    }
    if (parts.length === 0) return null
    return {
      cover,
      plate: built.plate ? readDataUrl(paths.plate) : null,
      strength: settings.get().music.motionStrength,
      parts
    }
  }

  function savedScene(at: string | null): CoverScene | null {
    if (!at) return null
    // Another cover that only shares the key must never get this one's parts (and picture).
    const saved = store.readFingerprint(at)
    if (saved && fingerprint && !sameCover(saved, fingerprint)) return null
    const recipe = store.readRecipe(at)
    const built = store.readBuilt(at)
    return recipe && built ? sceneFrom(store.paths(at), recipe, built) : null
  }

  function publish(): void {
    const setup = !deps.supported ? 'unsupported' : deps.startWorker ? 'ready' : 'missing'
    const next: CoverMotionState = available()
      ? { available: true, setup, scene: savedScene(key) }
      : { available: false, setup, scene: null }
    state = next
    for (const listener of listeners) listener(next)
  }

  function setEditor(change: Partial<CoverEditorState>): void {
    editor = { ...editor, ...change }
    for (const listener of editorListeners) listener(editor)
  }

  /** A new cover playing (or its cover arriving after it): look up its parts. */
  function follow(playback: PlaybackState): void {
    const next = playback.track?.artwork ?? null
    if (next === artwork) return
    artwork = next
    const decoded = next ? decode(next) : null
    key = decoded?.key ?? null
    fingerprint = decoded?.fingerprint ?? null
    publish()
  }

  function editorParts(): CoverEditorState['parts'] {
    if (!draft) return []
    const paths = draft.paths
    return draft.recipe.parts.map((part) => ({
      id: part.id,
      kind: part.kind,
      outline: readDataUrl(paths.mask(part.id)) ?? ''
    }))
  }

  function build(current: Draft, recipe: CoverRecipe): ReturnType<CoverWorker['build']> {
    if (!worker) return Promise.resolve({ ok: false, error: 'not running' })
    return worker.build({
      cover: current.paths.cover,
      parts: recipe.parts.map((part) => ({
        mask: current.paths.mask(part.id),
        kind: part.kind,
        turn: part.turn,
        out: current.paths.weight(part.id)
      })),
      protected: [],
      plate: current.paths.plate
    })
  }

  /**
   * Makes `next` the draft's recipe, but only once it's built: a build that fails leaves the
   * recipe, what the editor shows and what Save would keep exactly as they were. `undo` puts
   * back files the change replaced, before the kept recipe is built again from them.
   */
  async function apply(next: CoverRecipe, undo?: () => void): Promise<boolean> {
    if (!draft) return false
    const current = draft
    if (next.parts.length === 0) {
      current.recipe = next
      current.built = { version: 1, plate: false, parts: {} }
      setEditor({ parts: [], preview: null, dirty: true, busy: null })
      return true
    }
    setEditor({ busy: 'building' })
    const result = await build(current, next)
    if (draft !== current) return false
    if (!result.ok) {
      // The worker writes weight maps part by part, so some may be new already: build the kept
      // recipe again so its files match it.
      undo?.()
      if (current.recipe.parts.length > 0) await build(current, current.recipe)
      if (draft === current)
        setEditor({ busy: null, message: `Couldn’t build that (${result.error})` })
      return false
    }
    const parts: BuiltScene['parts'] = {}
    next.parts.forEach((part, i) => {
      const built = result.parts[i]
      if (built) parts[part.id] = built
    })
    current.recipe = next
    current.built = { version: 1, plate: result.plate, parts }
    setEditor({
      busy: null,
      parts: editorParts(),
      preview: sceneFrom(current.paths, current.recipe, current.built),
      dirty: true
    })
    return true
  }

  /** The mask an older part had, kept once as the base its clicks go on top of. */
  function keepBase(paths: CoverPaths, id: string): string | null {
    if (!existsSync(paths.base(id))) {
      if (!existsSync(paths.mask(id))) return null
      copyFileSync(paths.mask(id), paths.base(id))
    }
    return paths.base(id)
  }

  async function pick(x: number, y: number, how?: ClickWith): Promise<void> {
    if (!draft || !worker) return
    const current = draft
    const paths = current.paths
    // A tenth of a pixel is finer than any click, and keeps the saved clicks tidy.
    const tenth = (v: number): number => Math.round(v * ANALYSIS_PX * 10) / 10
    const point: [number, number] = [tenth(x), tenth(y)]
    setEditor({ busy: 'cutting', message: null })
    // Only parts whose masks are there: one gone missing mustn't stop every click.
    const present = current.recipe.parts.filter((part) => existsSync(paths.mask(part.id)))
    const hit = await worker.hit(
      point,
      present.map((part) => paths.mask(part.id))
    )
    if (draft !== current) return
    if (!hit.ok) {
      setEditor({ busy: null, message: `Couldn’t cut that out (${hit.error})` })
      return
    }
    const plan = planClick({
      point,
      with: how,
      hit: present[hit.index]?.id ?? null,
      selected: editor.selected,
      parts: current.recipe.parts
    })
    if (plan.kind === 'refuse') {
      setEditor({ busy: null, message: plan.message })
      return
    }
    if (plan.kind === 'new' && current.recipe.parts.length >= MAX_PARTS) {
      setEditor({ busy: null, message: 'Six moving parts at most' })
      return
    }
    const id =
      plan.kind === 'new'
        ? `p${Math.max(0, ...current.recipe.parts.map((part) => partNumber(part.id))) + 1}`
        : plan.id
    const base = plan.kind === 'change' && plan.base ? keepBase(paths, id) : null
    const result = await worker.cut({
      cover: paths.cover,
      base,
      strokes: plan.strokes.map((stroke) => ({
        point: [stroke.x, stroke.y],
        add: stroke.add,
        size: stroke.size
      })),
      out: paths.next(id)
    })
    if (draft !== current) return
    const refuse = !result.ok
      ? `Couldn’t cut that out (${result.error})`
      : result.area < MIN_AREA
        ? 'That’s too small to move'
        : result.area > MAX_AREA
          ? 'That’s most of the cover'
          : null
    if (refuse !== null || !result.ok) {
      rmSync(paths.next(id), { force: true })
      setEditor({ busy: null, message: refuse })
      return
    }
    const strokes = plan.strokes.map((stroke, i) => ({ ...stroke, size: result.sizes[i] ?? 0 }))
    const next =
      plan.kind === 'new'
        ? withPart(current.recipe, { id, kind: NEW_PART_KIND, turn: 0, strokes })
        : withStrokes(current.recipe, id, strokes, base !== null)
    // The new cut takes the part's place while it's built; the old one waits beside it.
    if (existsSync(paths.mask(id))) renameSync(paths.mask(id), paths.prev(id))
    renameSync(paths.next(id), paths.mask(id))
    const applied = await apply(next, () => {
      if (existsSync(paths.prev(id))) renameSync(paths.prev(id), paths.mask(id))
      else rmSync(paths.mask(id), { force: true })
    })
    rmSync(paths.prev(id), { force: true })
    if (!applied) return
    // A part cut again from scratch has no base any more.
    if (base === null) rmSync(paths.base(id), { force: true })
    setEditor({ selected: id })
  }

  async function open(): Promise<void> {
    if (!deps.startWorker) {
      setEditor({ ...CLOSED, open: true, message: NOT_INSTALLED })
      return
    }
    const decoded = artwork ? decode(artwork) : null
    if (!decoded) {
      setEditor({ ...CLOSED, open: true, message: 'Play a song with a cover first' })
      return
    }
    worker ??= createCoverWorker(deps.startWorker)
    // The cover goes into the draft only: a look-alike opened here mustn't replace the saved one.
    const paths = store.startDraft(decoded.key)
    writeFileSync(paths.cover, decoded.square)
    const recipe = store.readRecipe(decoded.key) ?? {
      version: RECIPE_VERSION,
      source: 'hand',
      parts: []
    }
    const built = store.readBuilt(decoded.key) ?? { version: 1, plate: false, parts: {} }
    const current: Draft = {
      key: decoded.key,
      fingerprint: decoded.fingerprint,
      paths,
      recipe,
      built
    }
    draft = current
    setEditor({
      ...CLOSED,
      open: true,
      busy: 'loading',
      cover: readDataUrl(paths.cover),
      parts: editorParts(),
      preview: sceneFrom(paths, recipe, built)
    })
    // SAM loads and reads the cover now, while the editor is looked at, not on the first click.
    const result = await worker.prepare(paths.cover)
    if (draft !== current) return
    setEditor({ busy: null, message: result.ok ? null : `Couldn’t load (${result.error})` })
  }

  function close(): void {
    if (draft) store.dropDraft(draft.key)
    draft = null
    setEditor(CLOSED)
  }

  function save(): void {
    if (!draft) return
    store.commitDraft(draft.key, draft.recipe, draft.built)
    store.writeFingerprint(draft.key, draft.fingerprint)
    // Editing goes on in a fresh draft of what's now saved.
    draft.paths = store.startDraft(draft.key)
    setEditor({ dirty: false, message: null })
    if (draft.key === key) publish()
  }

  function backToAutomatic(): void {
    if (!draft) return
    store.remove(draft.key)
    const decoded = artwork ? decode(artwork) : null
    const reopened = draft.key
    draft = null
    if (decoded?.key === reopened) void open()
    else setEditor(CLOSED)
    if (reopened === key) publish()
  }

  const stopMusic = music.subscribe(follow)
  const stopSettings = settings.subscribe(() => publish())
  follow(music.get())
  publish()

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    editor: {
      get: () => editor,
      subscribe(listener) {
        editorListeners.add(listener)
        return () => editorListeners.delete(listener)
      },
      async command(command) {
        // One change at a time: the worker answers in order, and a click mid-build would race it.
        if (editor.busy !== null && command.kind !== 'close') return
        switch (command.kind) {
          case 'open':
            await open()
            return
          case 'close':
            close()
            return
          case 'pick':
            await pick(command.x, command.y, command.with)
            return
          case 'select':
            if (draft?.recipe.parts.some((part) => part.id === command.id))
              setEditor({ selected: command.id })
            return
          case 'setKind':
            if (!draft) return
            await apply(withKind(draft.recipe, command.id, command.motion))
            return
          case 'turn':
            if (!draft) return
            await apply(turned(draft.recipe, command.id))
            return
          case 'remove':
            if (!draft) return
            {
              const paths = draft.paths
              if (await apply(withoutPart(draft.recipe, command.id))) {
                rmSync(paths.mask(command.id), { force: true })
                rmSync(paths.weight(command.id), { force: true })
                rmSync(paths.base(command.id), { force: true })
                if (editor.selected === command.id) setEditor({ selected: null })
              }
            }
            return
          case 'save':
            save()
            return
          case 'useAutomatic':
            backToAutomatic()
            return
        }
      }
    },
    dispose() {
      stopMusic()
      stopSettings()
      if (draft) store.dropDraft(draft.key)
      worker?.dispose()
    }
  }
}
