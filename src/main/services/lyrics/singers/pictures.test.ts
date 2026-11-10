import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Electron decodes the pictures; here a fake image stands in, the way the background photo's
// tests keep Electron out.
const electron = vi.hoisted(() => ({
  createFromPath: vi.fn(),
  showOpenDialog: vi.fn()
}))
vi.mock('electron', () => ({
  dialog: { showOpenDialog: electron.showOpenDialog },
  nativeImage: { createFromPath: electron.createFromPath }
}))
vi.mock('../../../platform', () => ({ isMac: true }))

const { openSingerPictures } = await import('./pictures')

const PNG_BYTES = Buffer.from('fake png bytes')

interface FakeImage {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize: ReturnType<typeof vi.fn>
  toPNG(): Buffer
}

function fakeImage(width: number, height: number, empty = false): FakeImage {
  const image: FakeImage = {
    isEmpty: () => empty,
    getSize: () => ({ width, height }),
    resize: vi.fn((to: { width: number; height: number }) => fakeImage(to.width, to.height)),
    toPNG: () => PNG_BYTES
  }
  return image
}

let dir: string
let source: string
let warn: ReturnType<typeof vi.spyOn>

const hashed = (id: string): string => createHash('sha1').update(id).digest('hex')
const pictureFile = (id: string): string => join(dir, 'pictures', `${hashed(id)}.png`)
const dataUrl = `data:image/png;base64,${PNG_BYTES.toString('base64')}`

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'focus-screen-pictures-'))
  source = join(dir, 'chibi.jpg')
  writeFileSync(source, 'not really a jpeg')
  electron.createFromPath.mockReset()
  electron.createFromPath.mockReturnValue(fakeImage(1024, 512))
  electron.showOpenDialog.mockReset()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('openSingerPictures', () => {
  it('refuses an unknown singer', () => {
    const pictures = openSingerPictures(join(dir, 'lyrics-singers'))
    for (const id of ['nobody', 'constructor', 'extra:', 'extra:Has Space', 'extra:../up', '']) {
      const result = pictures.fromPath(id, source)
      expect(result.ok).toBe(false)
    }
    expect(electron.createFromPath).not.toHaveBeenCalled()
    expect(pictures.all()).toEqual({})
  })

  it('refuses a picture that won’t decode', () => {
    electron.createFromPath.mockReturnValue(fakeImage(0, 0, true))
    const listener = vi.fn()
    const pictures = openSingerPictures(dir)
    pictures.subscribe(listener)
    const result = pictures.fromPath('ichika', source)
    expect(result).toEqual({ ok: false, message: 'Couldn’t read that picture. Try a JPEG or PNG.' })
    expect(existsSync(pictureFile('ichika'))).toBe(false)
    expect(pictures.all()).toEqual({})
    expect(listener).not.toHaveBeenCalled()
  })

  it('refuses a source over 60 MB without reading it', () => {
    truncateSync(source, 61 * 1024 * 1024)
    const pictures = openSingerPictures(dir)
    expect(pictures.fromPath('ichika', source)).toEqual({
      ok: false,
      message: 'That picture is too big. Choose one under 60 MB.'
    })
    expect(electron.createFromPath).not.toHaveBeenCalled()
  })

  it('only reads a real file at an absolute path', () => {
    const pictures = openSingerPictures(dir)
    // The path came from the page: nothing but an ordinary file is ever opened.
    for (const path of [dir, join(dir, 'missing.png'), 'chibi.jpg', '', '../chibi.jpg']) {
      expect(pictures.fromPath('ichika', path)).toEqual({
        ok: false,
        message: 'Couldn’t open that picture.'
      })
    }
    expect(electron.createFromPath).not.toHaveBeenCalled()
  })

  it('keeps a re-encoded copy and lists it', () => {
    const listener = vi.fn()
    const pictures = openSingerPictures(dir)
    pictures.subscribe(listener)

    expect(pictures.fromPath('ichika', source)).toEqual({ ok: true })

    // Longer side 256, same shape, as a PNG named by the id's hash, never the original.
    const image = electron.createFromPath.mock.results[0]?.value as FakeImage
    expect(image.resize).toHaveBeenCalledWith({ width: 256, height: 128, quality: 'good' })
    expect(readFileSync(pictureFile('ichika'))).toEqual(PNG_BYTES)
    expect(readdirSync(join(dir, 'pictures')).filter((name) => name.endsWith('.png'))).toEqual([
      `${hashed('ichika')}.png`
    ])
    expect(pictures.all()).toEqual({ ichika: dataUrl })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('doesn’t enlarge a small picture', () => {
    const small = fakeImage(100, 80)
    electron.createFromPath.mockReturnValue(small)
    const pictures = openSingerPictures(dir)
    expect(pictures.fromPath('saki', source)).toEqual({ ok: true })
    expect(small.resize).not.toHaveBeenCalled()
  })

  it('finds its pictures again, extra singers’ too', () => {
    const first = openSingerPictures(dir)
    first.fromPath('miku', source)
    first.fromPath('extra:my-friend', source)

    const second = openSingerPictures(dir)
    expect(second.all()).toEqual({ miku: dataUrl, 'extra:my-friend': dataUrl })
  })

  it('remove deletes it', () => {
    const listener = vi.fn()
    const pictures = openSingerPictures(dir)
    pictures.fromPath('ichika', source)
    pictures.fromPath('extra:my-friend', source)
    pictures.subscribe(listener)

    pictures.remove('ichika')
    expect(existsSync(pictureFile('ichika'))).toBe(false)
    expect(pictures.all()).toEqual({ 'extra:my-friend': dataUrl })
    expect(listener).toHaveBeenCalledTimes(1)

    pictures.remove('extra:my-friend')
    expect(existsSync(pictureFile('extra:my-friend'))).toBe(false)
    expect(openSingerPictures(dir).all()).toEqual({})
    expect(listener).toHaveBeenCalledTimes(2)

    // Nothing to remove, nothing to tell.
    pictures.remove('ichika')
    pictures.remove('nobody')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('replaces the picture it had', () => {
    const pictures = openSingerPictures(dir)
    pictures.fromPath('ichika', source)
    electron.createFromPath.mockReturnValue({
      ...fakeImage(10, 10),
      toPNG: () => Buffer.from('another')
    })
    pictures.fromPath('ichika', source)
    expect(pictures.all().ichika).toBe(
      `data:image/png;base64,${Buffer.from('another').toString('base64')}`
    )
  })

  it('stops telling a listener that left', () => {
    const listener = vi.fn()
    const pictures = openSingerPictures(dir)
    pictures.subscribe(listener)()
    pictures.fromPath('ichika', source)
    expect(listener).not.toHaveBeenCalled()
  })

  it('ignores files in its folder that it didn’t write', () => {
    mkdirSync(join(dir, 'pictures'), { recursive: true })
    writeFileSync(join(dir, 'pictures', 'index.json'), '{ not json')
    writeFileSync(join(dir, 'pictures', 'stray.png'), PNG_BYTES)
    expect(openSingerPictures(dir).all()).toEqual({})
  })

  it('says so when it can’t save, and logs only the error’s code', () => {
    // A file where its folder should be: nothing can be written there.
    writeFileSync(join(dir, 'pictures'), 'in the way')
    const pictures = openSingerPictures(dir)
    expect(pictures.fromPath('extra:my-friend', source)).toEqual({
      ok: false,
      message: 'Couldn’t save the picture.'
    })
    expect(pictures.all()).toEqual({})
    expect(warn).toHaveBeenCalledTimes(1)
    const logged = String(warn.mock.calls[0]?.[0])
    expect(logged).toMatch(/\([A-Z]+\)/)
    expect(logged).not.toContain('my-friend')
    expect(logged).not.toContain(dir)
  })

  describe('choose', () => {
    it('keeps the picture that was chosen', async () => {
      electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [source] })
      const pictures = openSingerPictures(dir)
      expect(await pictures.choose(null, 'saki')).toEqual({ ok: true })
      expect(pictures.all()).toEqual({ saki: dataUrl })
      // No window to sit on: the dialog is asked for on its own.
      expect(electron.showOpenDialog).toHaveBeenCalledTimes(1)
      expect(electron.showOpenDialog.mock.calls[0]).toHaveLength(1)
    })

    it('changes nothing, and says nothing, when the chooser is cancelled', async () => {
      electron.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
      const listener = vi.fn()
      const pictures = openSingerPictures(dir)
      pictures.subscribe(listener)
      expect(await pictures.choose(null, 'saki')).toEqual({ ok: true })
      expect(listener).not.toHaveBeenCalled()
      expect(pictures.all()).toEqual({})
    })

    it('doesn’t even ask for a picture for an unknown singer', async () => {
      const pictures = openSingerPictures(dir)
      expect((await pictures.choose(null, 'nobody')).ok).toBe(false)
      expect(electron.showOpenDialog).not.toHaveBeenCalled()
    })

    it('says why a chosen picture was refused', async () => {
      electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [source] })
      electron.createFromPath.mockReturnValue(fakeImage(0, 0, true))
      const pictures = openSingerPictures(dir)
      expect(await pictures.choose(null, 'saki')).toEqual({
        ok: false,
        message: 'Couldn’t read that picture. Try a JPEG or PNG.'
      })
    })
  })
})
