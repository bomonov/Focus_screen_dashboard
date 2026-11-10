import { dialog, nativeImage, type BrowserWindow } from 'electron'
import { readFileSync, statSync } from 'fs'
import { isMac } from '../../platform'
import { writeFileAtomic } from '../jsonFile'
import type { PhotoResult } from './types'

/** Anything bigger is not a photo anyone means as a wallpaper, and decoding it would stall. */
export const MAX_SOURCE_BYTES = 60 * 1024 * 1024
/** Sharp on a 4K screen, and a few MB at most as a JPEG. */
const MAX_SIDE_PX = 3840
const JPEG_QUALITY = 85

// macOS decodes through NSImage, which reads far more formats than Windows does.
export const PHOTO_EXTENSIONS = isMac
  ? ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tif', 'tiff', 'gif']
  : ['jpg', 'jpeg', 'png', 'bmp']

export interface BackgroundPhotoStore {
  /** The saved copy as a JPEG data URL, or null when none was chosen. */
  get(): string | null
  subscribe(listener: (photo: string | null) => void): () => void
  /** Asks for a picture, then decodes, shrinks and keeps a copy of it. */
  choose(win: BrowserWindow | null): Promise<PhotoResult>
}

/** The longer side shrunk to `max`, keeping the shape. */
export function fitWithin(
  width: number,
  height: number,
  max: number
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  // Never down to nothing: a 1-pixel-tall strip shrunk by a lot would round to no height at all.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

/**
 * The user's own photo behind the cards. Only the copy we re-encoded is ever read back, so
 * the renderer never sees the original file or where it was.
 */
export function openBackgroundPhoto(filePath: string): BackgroundPhotoStore {
  const listeners = new Set<(photo: string | null) => void>()
  let cached: string | null | undefined

  function load(): string | null {
    try {
      return `data:image/jpeg;base64,${readFileSync(filePath).toString('base64')}`
    } catch {
      return null
    }
  }

  function save(source: string): PhotoResult {
    try {
      if (statSync(source).size > MAX_SOURCE_BYTES) {
        return { ok: false, message: 'That picture is too big. Choose one under 60 MB.' }
      }
    } catch {
      return { ok: false, message: 'Couldn’t open that picture.' }
    }
    const image = nativeImage.createFromPath(source)
    if (image.isEmpty()) {
      return { ok: false, message: 'Couldn’t read that picture. Try a JPEG or PNG.' }
    }
    const size = image.getSize()
    const fitted = fitWithin(size.width, size.height, MAX_SIDE_PX)
    const scaled =
      fitted.width === size.width ? image : image.resize({ ...fitted, quality: 'good' })
    try {
      writeFileAtomic(filePath, scaled.toJPEG(JPEG_QUALITY))
    } catch (error) {
      console.warn('[display] Could not save the background photo.', error)
      return { ok: false, message: 'Couldn’t save the picture.' }
    }
    cached = load()
    for (const listener of listeners) listener(cached)
    return { ok: true }
  }

  return {
    get() {
      if (cached === undefined) cached = load()
      return cached
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async choose(win) {
      const options = {
        title: 'Choose a background photo',
        properties: ['openFile' as const],
        filters: [{ name: 'Pictures', extensions: PHOTO_EXTENSIONS }]
      }
      const picked = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      const source = picked.filePaths[0]
      if (picked.canceled || !source) return { ok: false, message: null }
      return save(source)
    }
  }
}
