// The route card's map: one flat Apple Maps picture of a box around the bus's path, made by the
// Reminders helper's route map mode. Only the box goes to Apple Maps: the path is drawn on top
// by the card, from where the helper says the box's corners landed.
import { isPictureData, runPictureMode } from '../calendar/mapPicture'
import type { MapBox } from './routeLine'

export interface RouteMapRequest extends MapBox {
  /** In points; the picture comes back at the screen's scale. */
  width: number
  height: number
  dark: boolean
}

export interface RouteMapReply {
  /** Base64 JPEG. */
  image: string
  /** Where the box's corners landed, as shares of the picture's size (0–1, y down). */
  northWest: [number, number]
  southEast: [number, number]
}

const isCorner = (raw: unknown): raw is [number, number] =>
  Array.isArray(raw) &&
  raw.length === 2 &&
  raw.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))

/** The helper's line, or null for anything else: malformed output is "no data", never a crash. */
export function parseRouteMapReply(raw: unknown): RouteMapReply | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { ok, image, northWest, southEast } = raw as Record<string, unknown>
  if (ok !== true || !isPictureData(image) || !isCorner(northWest) || !isCorner(southEast)) {
    return null
  }
  // A box that doesn't span the picture, top left to bottom right, isn't the one asked for.
  const [left, top] = northWest
  const [right, bottom] = southEast
  if (right - left < 0.5 || bottom - top < 0.5 || Math.max(-left, -top, right, bottom) > 2) {
    return null
  }
  return { image, northWest: [left, top], southEast: [right, bottom] }
}

/** Runs the helper's route map mode once. */
export async function makeRouteMapPicture(
  helperPath: string,
  request: RouteMapRequest
): Promise<RouteMapReply | null> {
  return parseRouteMapReply(
    await runPictureMode(helperPath, ['--route-map', JSON.stringify(request)])
  )
}
