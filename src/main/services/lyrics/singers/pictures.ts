import { createHash } from 'crypto'
import { dialog, nativeImage } from 'electron'
import { readFileSync, rmSync, statSync } from 'fs'
import { isAbsolute, join } from 'path'
import { fitWithin, MAX_SOURCE_BYTES, PHOTO_EXTENSIONS } from '../../display/backgroundPhoto'
import { writeFileAtomic, writeJsonFile } from '../../jsonFile'
import { CAST, castSinger } from './cast'
import type { SingerPictures } from './editorDeps'

// The user's own pictures for the singers' badges (a chibi for a character, anything for an
// extra singer). Like the background photo, only the copy we re-encoded is ever read back, so
// the original file and where it was never reach the window.

/** A badge is small; this is sharp on a big monitor and a few tens of KB as a PNG. */
const MAX_SIDE_PX = 256
/** Far above what 256 px needs: a bigger file in the folder isn't one of ours. */
const MAX_PICTURE_BYTES = 2 * 1024 * 1024
/** The ids of extra singers who have one: a file name is a hash, which can't be turned back. */
const INDEX_FILE = 'index.json'

const EXTRA_ID = /^extra:[a-z0-9-]+$/

const COULDNT_OPEN = 'Couldn’t open that picture.'

type Result = { ok: true } | { ok: false; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A built-in character, or an extra singer's id. Whether an extra is on a coding somewhere is
 * too much to check from here; the shape is what keeps the id safe to hash and to list.
 */
function isPictureId(id: unknown): id is string {
  return typeof id === 'string' && (castSinger(id) !== undefined || EXTRA_ID.test(id))
}

/** Only the system's error code: the rest of an error's text can carry paths. */
function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown'
}

/** `dir/pictures` holds a PNG per singer, named by a hash of the id, and a short index of extras. */
export function openSingerPictures(dir: string): SingerPictures {
  const folder = join(dir, 'pictures')
  const indexPath = join(folder, INDEX_FILE)
  const listeners = new Set<() => void>()
  /** id → data URL, read from disk the first time it's asked for. */
  let urls: Map<string, string> | undefined
  /** The extra singers' ids with a picture, as the index says. */
  let extras = new Set<string>()

  const pathFor = (id: string): string =>
    join(folder, `${createHash('sha1').update(id).digest('hex')}.png`)

  function readExtras(): Set<string> {
    try {
      const raw: unknown = JSON.parse(readFileSync(indexPath, 'utf8'))
      if (!isRecord(raw) || !Array.isArray(raw.ids)) return new Set()
      return new Set((raw.ids as unknown[]).filter((id): id is string => isPictureId(id)))
    } catch {
      // No index yet, or one we can't read: only the characters' pictures are found.
      return new Set()
    }
  }

  function readPicture(id: string): string | null {
    try {
      const path = pathFor(id)
      if (statSync(path).size > MAX_PICTURE_BYTES) return null
      return `data:image/png;base64,${readFileSync(path).toString('base64')}`
    } catch {
      return null
    }
  }

  function load(): Map<string, string> {
    if (urls) return urls
    extras = readExtras()
    urls = new Map()
    // The characters are found without the index, so a lost index only loses extras' pictures.
    for (const id of [...CAST.map((singer) => singer.id), ...extras]) {
      const url = readPicture(id)
      if (url) urls.set(id, url)
    }
    return urls
  }

  function writeIndex(): void {
    writeJsonFile(indexPath, { ids: [...extras] })
  }

  function notify(): void {
    // A copy, so a listener that stops listening as it's told doesn't skip the next one.
    for (const listener of [...listeners]) listener()
  }

  function save(id: string, source: string): Result {
    if (!isAbsolute(source)) return { ok: false, message: COULDNT_OPEN }
    try {
      const info = statSync(source)
      // The path came from the window: only an ordinary file is opened, never a device or a pipe.
      if (!info.isFile()) return { ok: false, message: COULDNT_OPEN }
      if (info.size > MAX_SOURCE_BYTES) {
        return { ok: false, message: 'That picture is too big. Choose one under 60 MB.' }
      }
    } catch {
      return { ok: false, message: COULDNT_OPEN }
    }
    const image = nativeImage.createFromPath(source)
    if (image.isEmpty()) {
      return { ok: false, message: 'Couldn’t read that picture. Try a JPEG or PNG.' }
    }
    const size = image.getSize()
    const fitted = fitWithin(size.width, size.height, MAX_SIDE_PX)
    const scaled =
      fitted.width === size.width ? image : image.resize({ ...fitted, quality: 'good' })
    const png = scaled.toPNG()
    const known = load()
    const newExtra = EXTRA_ID.test(id) && !extras.has(id)
    try {
      // The index first: one that names a picture that never got written is skipped when read.
      if (newExtra) {
        extras.add(id)
        writeIndex()
      }
      writeFileAtomic(pathFor(id), png)
    } catch (error) {
      if (newExtra) extras.delete(id)
      console.warn(`[lyrics] Could not save a singer's picture (${errorCode(error)}).`)
      return { ok: false, message: 'Couldn’t save the picture.' }
    }
    known.set(id, `data:image/png;base64,${png.toString('base64')}`)
    notify()
    return { ok: true }
  }

  const unknown = (): Result => ({ ok: false, message: 'Focus Screen doesn’t know that singer.' })

  return {
    all: () => Object.fromEntries(load()),
    async choose(win, id) {
      if (!isPictureId(id)) return unknown()
      const options = {
        title: 'Choose a picture for this singer',
        properties: ['openFile' as const],
        filters: [{ name: 'Pictures', extensions: PHOTO_EXTENSIONS }]
      }
      const picked = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      const source = picked.filePaths[0]
      // Not choosing isn't a refusal: nothing changes and nothing needs saying.
      if (picked.canceled || !source) return { ok: true }
      return save(id, source)
    },
    fromPath(id, path) {
      return isPictureId(id) ? save(id, path) : unknown()
    },
    remove(id) {
      if (!isPictureId(id)) return
      const known = load()
      const had = known.delete(id)
      try {
        rmSync(pathFor(id), { force: true })
        if (extras.delete(id)) writeIndex()
      } catch (error) {
        console.warn(`[lyrics] Could not remove a singer's picture (${errorCode(error)}).`)
      }
      if (had) notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
