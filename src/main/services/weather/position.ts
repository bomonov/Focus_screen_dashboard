import { distanceM } from '../transit/routeLine'
import type { LatLon } from './types'

/** The place name is looked up again only after a move this far. */
export const PLACE_MOVE_M = 1000

/**
 * Two decimals: about a kilometre, finer than a weather model's grid, too coarse to point at
 * a building. The only position that ever leaves the Mac.
 */
export function roundPosition({ lat, lon }: LatLon): LatLon {
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 }
}

/** Far enough from where the place was last looked up (or none yet) to look it up again. */
export function movedFar(from: LatLon | null, to: LatLon): boolean {
  return from === null || distanceM([from.lat, from.lon], [to.lat, to.lon]) >= PLACE_MOVE_M
}
