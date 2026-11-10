// Where the Mac is, from the Reminders helper's location mode. Its lines are the same shape as
// calendar mode's (access, then request/reply by id), so the same client carries them.
import { createRemindersClient, type StartHelper } from '../todos/apple-reminders/client'
import type { LatLon, LocationAccess } from './types'

/** The helper gives up on a fix after 30 s; this leaves it room to say so. */
const LOCATE_TIMEOUT_MS = 45_000
const PLACE_TIMEOUT_MS = 20_000
const ACCESS_TIMEOUT_MS = 10_000
/** A town's name; anything longer isn't one. */
const MAX_PLACE_CHARS = 80

/**
 * Standing in for an accuracy the helper didn't give or CoreLocation couldn't vouch for (it
 * reports -1): a Wi-Fi fix is about this far out, so a trip's "has the Mac moved" check stays
 * neither jumpy nor deaf.
 */
const DEFAULT_ACCURACY_M = 100

export type LocateResult =
  | {
      ok: true
      position: LatLon
      /** How far out the fix may be, metres: the helper's when it's a usable number, else 100. */
      accuracyM: number
    }
  | { ok: false; reason: 'servicesOff' | 'access' | 'failed' }

export interface LocationSource {
  /** null until the helper says. Never 'off': that comes from locate. */
  access(): LocationAccess | null
  onAccess(listener: (access: LocationAccess) => void): () => void
  requestAccess(): void
  locate(): Promise<LocateResult>
  /** The town at an already rounded position; null where there's none. Rejects if it failed. */
  placeName(position: LatLon): Promise<string | null>
  stop(): void
}

const isNumberWithin = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit

export function helperLocation(start: StartHelper): LocationSource {
  const listeners = new Set<(access: LocationAccess) => void>()
  const client = createRemindersClient(start, {
    access(status) {
      for (const listener of listeners) listener(status)
    },
    // Location mode never sends "changed".
    changed: () => undefined
  })

  return {
    access: () => client.access(),
    onAccess(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    requestAccess() {
      // The prompt's answer comes back as an access line.
      client.request({ op: 'requestAccess' }, ACCESS_TIMEOUT_MS).catch(() => undefined)
    },
    async locate() {
      const body = await client.request({ op: 'locate' }, LOCATE_TIMEOUT_MS).catch(() => null)
      if (body?.ok === true && isNumberWithin(body.lat, 90) && isNumberWithin(body.lon, 180)) {
        const accuracyM =
          typeof body.accuracyM === 'number' &&
          Number.isFinite(body.accuracyM) &&
          body.accuracyM >= 0
            ? body.accuracyM
            : DEFAULT_ACCURACY_M
        return { ok: true, position: { lat: body.lat, lon: body.lon }, accuracyM }
      }
      const reason =
        body?.error === 'servicesOff' || body?.error === 'access' ? body.error : 'failed'
      return { ok: false, reason }
    },
    async placeName({ lat, lon }) {
      const body = await client.request({ op: 'place', lat, lon }, PLACE_TIMEOUT_MS)
      if (body.ok !== true) throw new Error('The place couldn’t be looked up.')
      const place = typeof body.place === 'string' ? body.place.trim() : ''
      return place && place.length <= MAX_PLACE_CHARS ? place : null
    },
    stop: () => client.stop()
  }
}
