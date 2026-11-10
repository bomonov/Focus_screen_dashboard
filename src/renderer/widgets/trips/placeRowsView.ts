// The places the trip card lists: before typing, Home (or setting it), the next class, saved and
// recent places; picking a start, where the Mac is, Home, saved and recent; typing, what matches,
// the Mac's own then Apple's. Rows are data with what picking them does, so the lists can be
// tested and built during render without reaching for anything.
import type { Place, TripFrom, TripState } from '../../../main/ipc'
import type { PlaceResults } from './placeSearch'
import {
  canSave,
  classDetail,
  classTitle,
  homeLine,
  homeRow,
  isClassPlace,
  placeLine
} from './tripCardView'
import { clockWords, type ClockWords } from './tripView'

/** Before typing, this many recent places are offered (ten are kept). */
export const RECENTS_SHOWN = 5

/** What a row in the trip card is: its own icon beside the name. */
export type RowIconKind = Place['kind'] | 'here'

/** What picking a row does: plans the trip there, starts it there, or sets Home. */
export type RowAction =
  { kind: 'to'; place: Place } | { kind: 'from'; from: TripFrom } | { kind: 'setHome' }

export interface PlaceRow {
  /** Unique across the card's lists (a section's own key first). */
  key: string
  icon: RowIconKind
  title: string
  /** The second line: a street, "Saved", a stop's routes; '' for none. */
  detail: string
  /** Words at the right: "Next class". */
  aside?: string
  disabled?: boolean
  /** A found place that can be kept under a name of the user's ("Save…"). */
  savable?: Place
  action: RowAction
}

export interface PlaceSection {
  key: string
  /** "From Apple Maps"; null for none. */
  heading: string | null
  rows: PlaceRow[]
}

/** Which way a picked place goes: where to, or where from. */
export type Side = 'to' | 'from'

const actionFor = (side: Side, place: Place): RowAction =>
  side === 'to' ? { kind: 'to', place } : { kind: 'from', from: { kind: 'place', place } }

/** A place as a row: its icon, name and second line; the class by its title and time. */
export function placeRow(
  section: string,
  place: Place,
  side: Side,
  now: number,
  clock: ClockWords = clockWords
): PlaceRow {
  const key = `${section}:${place.id}`
  const action = actionFor(side, place)
  if (isClassPlace(place)) {
    return {
      key,
      icon: 'class',
      title: classTitle(place, now, clock),
      detail: classDetail(place),
      aside: 'Next class',
      action
    }
  }
  return {
    key,
    icon: place.kind,
    title: place.kind === 'home' ? 'Home' : place.name,
    detail: placeLine(place),
    savable: canSave(place) ? place : undefined,
    action
  }
}

type Lists = Pick<
  TripState,
  'from' | 'home' | 'homePreview' | 'supported' | 'here' | 'nextClass' | 'saved' | 'recents'
>

/** The same start: where the Mac is, or the same place picked. */
function sameStart(a: TripFrom, b: TripFrom): boolean {
  if (a.kind === 'here' || b.kind === 'here') return a.kind === b.kind
  return a.place.id === b.place.id
}

/**
 * "Set Home to where you are now", once pressed: waiting on a fix (`sawLocating` once main has
 * gone looking, so a failure from before the press isn't taken as this one's), or failed.
 */
export type HomeAsk =
  { kind: 'idle' } | { kind: 'waiting'; sawLocating: boolean } | { kind: 'failed' }

/** The ask, as where the Mac is and Home change. */
export function homeAskNext(ask: HomeAsk, here: TripState['here'], home: Place | null): HomeAsk {
  if (ask.kind === 'idle') return ask
  if (home) return { kind: 'idle' }
  if (ask.kind === 'failed') return ask
  const status = here?.status
  // Refused or off: the row greys with why, rather than "Couldn't find".
  if (status === 'denied' || status === 'servicesOff') return { kind: 'idle' }
  if (status === 'locating') return ask.sawLocating ? ask : { kind: 'waiting', sawLocating: true }
  if (status === 'failed' && ask.sawLocating) return { kind: 'failed' }
  return ask
}

/** Home's row when there's no Home yet: setting it, with why it can't be, or that it failed. */
function setHomeRow(state: Lists, ask: HomeAsk): PlaceRow {
  const home = homeRow(state)
  const waiting = ask.kind === 'waiting'
  const failed = ask.kind === 'failed' && home.kind === 'setHome' && !home.disabled
  return {
    key: 'ready:set-home',
    icon: 'home',
    title: waiting ? 'Setting Home…' : 'Set Home to where you are now',
    detail: waiting
      ? 'Finding where you are…'
      : failed
        ? 'Couldn’t find where you are'
        : home.kind === 'setHome'
          ? home.detail
          : '',
    disabled: (home.kind === 'setHome' && home.disabled) || waiting,
    action: { kind: 'setHome' }
  }
}

/**
 * Where to, before typing (call 9): Home with when to leave for it (main plans it as the card
 * opens, from main's start: nothing's said of it while the card's `start` is one main hasn't been
 * asked from yet), or "Set Home to where you are now" (greyed with why when it can't be, "Setting
 * Home…" while it waits on a fix, "Couldn't find where you are" when none came), the next class,
 * saved places, then the five latest recent ones.
 */
export function readySections(
  state: Lists,
  start: TripFrom,
  now: number,
  homeAsk: HomeAsk,
  clock: ClockWords = clockWords
): PlaceSection[] {
  const home = homeRow(state)
  const preview = sameStart(start, state.from) ? state.homePreview : null
  const homeRows: PlaceRow[] =
    home.kind === 'home'
      ? [
          {
            ...placeRow('ready', home.place, 'to', now, clock),
            detail: homeLine(preview, now, clock)
          }
        ]
      : [setHomeRow(state, homeAsk)]
  const places = [
    ...(state.nextClass ? [state.nextClass] : []),
    ...state.saved,
    ...state.recents.slice(0, RECENTS_SHOWN)
  ].map((place) => placeRow('ready', place, 'to', now, clock))
  return [{ key: 'ready', heading: null, rows: [...homeRows, ...places] }]
}

/**
 * Where from, before typing (call 2): where the Mac is, when it can be known and isn't the start
 * already, then Home, saved and recent places. Not the next class: a class is somewhere to go.
 */
export function startSections(
  state: Lists,
  start: TripFrom,
  now: number,
  clock: ClockWords = clockWords
): PlaceSection[] {
  const status = state.here?.status
  const canHere =
    state.supported.location &&
    start.kind !== 'here' &&
    status !== 'denied' &&
    status !== 'servicesOff'
  const here: PlaceRow[] = canHere
    ? [
        {
          key: 'starts:here',
          icon: 'here',
          title: 'Where you are',
          detail: state.here?.name ?? '',
          action: { kind: 'from', from: { kind: 'here' } }
        }
      ]
    : []
  const places = [
    ...(state.home ? [state.home] : []),
    ...state.saved,
    ...state.recents.slice(0, RECENTS_SHOWN)
  ].map((place) => placeRow('starts', place, 'from', now, clock))
  return [{ key: 'starts', heading: null, rows: [...here, ...places] }]
}

/**
 * What's typed matches: the Mac's own first, then Apple's under a quiet "From Apple Maps"
 * (which isn't there at all when Apple has nothing, or no helper). A list for other words than
 * the field's isn't shown: the answer for these is on its way.
 */
export function resultSections(
  results: PlaceResults,
  text: string,
  side: Side,
  now: number,
  clock: ClockWords = clockWords
): PlaceSection[] {
  if (results.text !== text) return []
  return [
    {
      key: 'local',
      heading: null,
      rows: results.local.map((place) => placeRow('local', place, side, now, clock))
    },
    {
      key: 'apple',
      heading: 'From Apple Maps',
      rows: results.apple.map((place) => placeRow('apple', place, side, now, clock))
    }
  ].filter((section) => section.rows.length > 0)
}

/**
 * Nothing matches what's typed: said only once the Mac's answer for these words is in and Apple
 * has answered (or won't be asked), never in the moment before Apple's rows arrive.
 */
export function nothingFound(results: PlaceResults, text: string): boolean {
  return (
    text.trim() !== '' &&
    results.text === text &&
    !results.localWaiting &&
    !results.appleWaiting &&
    results.local.length === 0 &&
    results.apple.length === 0
  )
}

/** For a screen reader, politely: "5 places", "No places found"; '' while it's still changing. */
export function resultsWords(results: PlaceResults, text: string): string {
  if (text.trim() === '' || results.text !== text || results.localWaiting) return ''
  if (nothingFound(results, text)) return 'No places found'
  const count = results.local.length + results.apple.length
  if (count === 0) return ''
  return `${count} ${count === 1 ? 'place' : 'places'}`
}

/** The first row that can be picked: what Enter in the field picks. */
export function firstPickable(sections: readonly PlaceSection[]): PlaceRow | null {
  return sections.flatMap((section) => section.rows).find((row) => !row.disabled) ?? null
}
