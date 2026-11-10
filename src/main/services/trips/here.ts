// Where the Mac is, for the trip card: one handle on the shared location while something needs
// it (the card open, a kept trip, "Use where I am now"), a fix when one's asked for, and plain
// words when there's none to be had. The position stays in this process's memory: never logged,
// never saved, and forgotten as the handle's let go.
import { distanceM, type LatLon } from '../transit/routeLine'
import type { LocateResult, LocationSource } from '../weather/location'
import type { LocationAccess } from '../weather/types'
import type { Fix } from './kept'
import type { Place, TripState } from './types'

/** No fix this long after asking: the start says so ("Pick a start"), never a spinner for good. */
export const GIVE_UP_MS = 45_000
/** A building or stop this close names where the Mac is. */
export const NAME_WITHIN_M = 150

export type HereStatus = NonNullable<TripState['here']>['status']

export interface HereFix extends Fix {
  /** When it was taken, ms. */
  takenAt: number
}

function nearest(at: LatLon, places: readonly Place[]): Place | null {
  let best: Place | null = null
  let bestM = NAME_WITHIN_M
  for (const place of places) {
    const metres = distanceM(at, [place.lat, place.lon])
    if (metres <= bestM) {
      best = place
      bestM = metres
    }
  }
  return best
}

/**
 * What to call where the Mac is, from what's on this Mac only (a lookup would send the position
 * somewhere): the nearest school building within 150 m, else "near" the nearest stop within
 * 150 m, else nothing.
 */
export function hereName(
  at: LatLon,
  buildings: readonly Place[],
  stops: readonly Place[]
): string | null {
  const building = nearest(at, buildings)
  if (building) return building.name
  const stop = nearest(at, stops)
  return stop ? `near ${stop.name}` : null
}

export interface HereOptions {
  /** A handle on the shared location; null where there's none (not a Mac, or no helper). */
  start(): LocationSource | null
  /** ms, like Date.now. */
  now(): number
  /** The status or the fix changed, or an attempt ended (with or without a new fix). */
  changed(): void
  /**
   * Something needs where the Mac is now (the card, a kept trip, Home): Location allowed while
   * nothing does (Customize asking macOS) reads nothing.
   */
  wanted(): boolean
  /** macOS's answer for Location, each time the helper tells it. */
  accessChanged(access: LocationAccess): void
}

export interface Here {
  status(): HereStatus
  fix(): HereFix | null
  held(): boolean
  /**
   * A fix is still worth waiting for: one's being asked for (or macOS's prompt answered), and it
   * hasn't been given up on. When this turns false with no new fix, the attempt's over.
   */
  busy(): boolean
  /** Takes a handle (starting the helper if nobody else has); asks for nothing yet. */
  hold(): void
  /** Lets the handle go and forgets the fix. */
  release(): void
  /** Asks for a fix, unless one's already under way. */
  locate(): void
  /** macOS's Location prompt, if it hasn't been answered. */
  requestAccess(): void
}

export function createHere(options: HereOptions): Here {
  let source: LocationSource | null = null
  let unlisten: (() => void) | null = null
  let fix: HereFix | null = null
  let status: HereStatus = 'failed'
  let locating = false
  /** Asked macOS, and waiting for its answer before a fix can be had. */
  let awaitingAccess = false
  /** macOS is asked once per handle; its prompt shows only once anyway. */
  let asked = false
  /** The attempt under way has taken too long: a fix it still brings is taken, but not waited on. */
  let gaveUp = false
  /** Bumped as the handle goes, so a fix under way lands nowhere. */
  let generation = 0
  let giveUp: ReturnType<typeof setTimeout> | undefined

  function set(next: HereStatus): void {
    if (next === status) return
    status = next
    options.changed()
  }

  /** Nothing waits on a fix longer than this; a slow refresh keeps the last one standing. */
  function armGiveUp(): void {
    clearTimeout(giveUp)
    gaveUp = false
    giveUp = setTimeout(() => {
      gaveUp = true
      if (!fix) status = 'failed'
      options.changed()
    }, GIVE_UP_MS)
  }

  function awaitAccess(from: LocationSource): void {
    if (!asked) {
      asked = true
      from.requestAccess()
    }
    awaitingAccess = true
    // Before saying so: an attempt given up on earlier mustn't make this one look over.
    armGiveUp()
    if (!fix) set('locating')
  }

  function onAccess(next: LocationAccess): void {
    // Allowed now (the prompt answered, or turned on in System Settings with the card open):
    // the fix that couldn't be had, when it's wanted.
    if (next === 'granted' && (awaitingAccess || (!fix && options.wanted()))) {
      awaitingAccess = false
      locate()
    }
    // Refused, or Location taken away: locate says which, and the last fix goes.
    if ((next === 'denied' || next === 'restricted') && (awaitingAccess || fix)) {
      awaitingAccess = false
      locate()
    }
    options.accessChanged(next)
  }

  function locate(): void {
    const from = source
    if (!from || locating || awaitingAccess) return
    if (from.access() === 'notDetermined') {
      awaitAccess(from)
      return
    }
    locating = true
    armGiveUp()
    if (!fix) set('locating')
    const mine = generation
    // A helper that's gone rejects: that's a fix that didn't come, not one still on its way.
    const asking = from.locate().catch((): LocateResult => ({ ok: false, reason: 'failed' }))
    void asking.then((result) => {
      if (mine !== generation) return
      locating = false
      if (result.ok) {
        clearTimeout(giveUp)
        const { lat, lon } = result.position
        fix = { at: [lat, lon], accuracyM: result.accuracyM, takenAt: options.now() }
        status = 'found'
        options.changed()
        return
      }
      if (result.reason === 'access' && from.access() === 'notDetermined') {
        awaitAccess(from)
        return
      }
      clearTimeout(giveUp)
      // A fix that just didn't come leaves the last one standing; Location turned off or
      // refused takes it away.
      if (result.reason !== 'failed' || !fix) {
        fix = null
        status = result.reason === 'access' ? 'denied' : result.reason
      }
      options.changed()
    })
  }

  return {
    status: () => status,
    fix: () => fix,
    held: () => source !== null,
    busy: () => (locating || awaitingAccess) && !gaveUp,
    hold() {
      if (source) return
      source = options.start()
      if (!source) return
      status = 'locating'
      const held = source
      unlisten = held.onAccess((next) => {
        if (source === held) onAccess(next)
      })
    },
    release() {
      generation += 1
      clearTimeout(giveUp)
      unlisten?.()
      unlisten = null
      source?.stop()
      source = null
      fix = null
      status = 'failed'
      locating = false
      awaitingAccess = false
      asked = false
      gaveUp = false
    },
    locate,
    requestAccess() {
      source?.requestAccess()
    }
  }
}
