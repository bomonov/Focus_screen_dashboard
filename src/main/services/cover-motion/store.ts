import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { writeJsonFile } from '../jsonFile'
import { parseRecipe, type CoverRecipe } from './recipe'
import { parseCoverReply, type BuiltPart } from './worker'

/** What the worker built for a cover's parts, kept beside its recipe (keyed by part id). */
export interface BuiltScene {
  version: 1
  /** Whether plate.jpg was made (only when a part bobs). */
  plate: boolean
  parts: Record<string, BuiltPart>
}

export interface CoverPaths {
  folder: string
  cover: string
  plate: string
  mask(id: string): string
  weight(id: string): string
  /** The mask a part had before it kept its clicks, which they go on top of. */
  base(id: string): string
  /** A new cut, and the one it replaced, while it's built (the old goes back if that fails). */
  next(id: string): string
  prev(id: string): string
}

export interface CoverStore {
  /** Throws for anything but a real cover key, so nothing outside the library is touched. */
  folder(key: string): string
  paths(key: string): CoverPaths
  readRecipe(key: string): CoverRecipe | null
  writeRecipe(key: string, recipe: CoverRecipe): void
  readBuilt(key: string): BuiltScene | null
  writeBuilt(key: string, built: BuiltScene): void
  remove(key: string): void
  /** The saved cover's 16×16 fingerprint (coverKey's), or null for parts saved before it. */
  readFingerprint(key: string): Uint8Array | null
  writeFingerprint(key: string, fingerprint: Uint8Array): void
  /**
   * The editor works on a copy of the cover's folder, so changes closed without saving never
   * touch the saved parts. Starting one copies what's saved; committing copies it back.
   */
  startDraft(key: string): CoverPaths
  commitDraft(key: string, recipe: CoverRecipe, built: BuiltScene): void
  dropDraft(key: string): void
}

const KEY = /^[0-9a-f]{16}$/

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

/** built.json comes back from disk untrusted: each part is checked as the worker's reply was. */
export function parseBuilt(raw: unknown): BuiltScene | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (record.version !== 1 || typeof record.plate !== 'boolean') return null
  const partsRaw = record.parts
  if (typeof partsRaw !== 'object' || partsRaw === null || Array.isArray(partsRaw)) return null
  const ids = Object.keys(partsRaw)
  const checked = parseCoverReply({
    type: 'reply',
    id: 0,
    ok: true,
    plate: record.plate,
    parts: ids.map((id) => (partsRaw as Record<string, unknown>)[id])
  })
  if (!checked || !checked.ok || !checked.parts) return null
  const parts: Record<string, BuiltPart> = {}
  ids.forEach((id, i) => {
    const part = checked.parts?.[i]
    if (part) parts[id] = part
  })
  return { version: 1, plate: record.plate, parts }
}

function pathsIn(at: string): CoverPaths {
  return {
    folder: at,
    cover: join(at, 'cover.jpg'),
    plate: join(at, 'plate.jpg'),
    mask: (id) => join(at, `${id}.png`),
    weight: (id) => join(at, `${id}-w.png`),
    base: (id) => join(at, `${id}-base.png`),
    next: (id) => join(at, `${id}-next.png`),
    prev: (id) => join(at, `${id}-prev.png`)
  }
}

/** The pictures in one folder (masks, weights, cover, plate), copied into another. */
function copyPictures(from: string, to: string): void {
  if (!existsSync(from)) return
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    if (/\.(png|jpg)$/.test(name)) copyFileSync(join(from, name), join(to, name))
  }
}

export function createCoverStore(dir: string): CoverStore {
  function folder(key: string): string {
    if (!KEY.test(key)) throw new Error('not a cover key')
    return join(dir, key)
  }
  const draftFolder = (key: string): string => join(folder(key), 'draft')

  return {
    folder,
    paths: (key) => pathsIn(folder(key)),
    readRecipe(key) {
      return parseRecipe(readJson(join(folder(key), 'recipe.json')))
    },
    writeRecipe(key, recipe) {
      mkdirSync(folder(key), { recursive: true })
      writeJsonFile(join(folder(key), 'recipe.json'), recipe)
    },
    readBuilt(key) {
      return parseBuilt(readJson(join(folder(key), 'built.json')))
    },
    writeBuilt(key, built) {
      mkdirSync(folder(key), { recursive: true })
      writeJsonFile(join(folder(key), 'built.json'), built)
    },
    remove(key) {
      const at = folder(key)
      if (existsSync(at)) rmSync(at, { recursive: true, force: true })
    },
    readFingerprint(key) {
      try {
        const bytes = readFileSync(join(folder(key), 'fingerprint.bin'))
        return bytes.length === 256 ? new Uint8Array(bytes) : null
      } catch {
        return null
      }
    },
    writeFingerprint(key, fingerprint) {
      mkdirSync(folder(key), { recursive: true })
      writeFileSync(join(folder(key), 'fingerprint.bin'), fingerprint)
    },
    startDraft(key) {
      const draft = draftFolder(key)
      rmSync(draft, { recursive: true, force: true })
      mkdirSync(draft, { recursive: true })
      copyPictures(folder(key), draft)
      return pathsIn(draft)
    },
    commitDraft(key, recipe, built) {
      copyPictures(draftFolder(key), folder(key))
      writeJsonFile(join(folder(key), 'recipe.json'), recipe)
      writeJsonFile(join(folder(key), 'built.json'), built)
      rmSync(draftFolder(key), { recursive: true, force: true })
    },
    dropDraft(key) {
      rmSync(draftFolder(key), { recursive: true, force: true })
    }
  }
}
