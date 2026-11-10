import { execFile } from 'child_process'

/** What the helper's map mode prints: a base64 JPEG and the building's spot on it. */
export interface MapPictureReply {
  image: string
  pinX: number
  pinY: number
}

/** A map is under 1 MB; anything bigger isn't one of ours. */
const MAX_IMAGE_CHARS = 1_500_000
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** A picture the helper sent: base64 JPEG of a sensible size. */
export function isPictureData(image: unknown): image is string {
  return (
    typeof image === 'string' &&
    image.length > 0 &&
    image.length <= MAX_IMAGE_CHARS &&
    BASE64.test(image)
  )
}

/** The helper's line, or null for anything else: malformed output is "no data", never a crash. */
export function parseMapReply(raw: unknown): MapPictureReply | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { ok, image, pinX, pinY } = raw as Record<string, unknown>
  if (ok !== true || typeof image !== 'string' || typeof pinX !== 'number') return null
  if (typeof pinY !== 'number' || !Number.isFinite(pinX) || !Number.isFinite(pinY)) return null
  if (!isPictureData(image)) return null
  // A building off the picture isn't a building we can point at.
  if (pinX < 0 || pinX > 1 || pinY < 0 || pinY > 1) return null
  return { image, pinX, pinY }
}

export interface MapPictureRequest {
  lat: number
  lon: number
  /** In points; the picture comes back at the screen's scale (2x on a Retina Mac). */
  width: number
  height: number
  dark: boolean
}

/** Long enough for Apple Maps on a slow network; then it's given up on. */
const TIMEOUT_MS = 20_000

/**
 * Runs one of the helper's picture modes once (one process per picture; pictures are rare and
 * kept) and hands back its last line, parsed; null for anything that isn't JSON.
 */
export function runPictureMode(helperPath: string, args: readonly string[]): Promise<unknown> {
  return new Promise((resolve) => {
    execFile(
      helperPath,
      [...args],
      { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (_error, stdout) => {
        const line = String(stdout).trim().split('\n').pop() ?? ''
        try {
          resolve(JSON.parse(line))
        } catch {
          resolve(null)
        }
      }
    )
  })
}

/** Runs the helper's map mode once: the building's picture for the Next class card. */
export async function makeMapPicture(
  helperPath: string,
  request: MapPictureRequest
): Promise<MapPictureReply | null> {
  return parseMapReply(await runPictureMode(helperPath, ['--map', JSON.stringify(request)]))
}
