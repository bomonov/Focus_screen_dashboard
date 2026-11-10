// The trip card's and Customize's commands, from the renderer: only the exact known shapes pass,
// and a place in one is checked again (its text, its position) however the renderer came by it.
import { MAX_RESULTS } from './rank'
import type { Place, TripCommand, TripFrom, TripWhen } from './types'

/** Past any name or line a place of ours has (places.ts keeps 60 and 200). */
const MAX_TEXT_CHARS = 200

const PLACE_KINDS: readonly Place['kind'][] = [
  'home',
  'saved',
  'recent',
  'class',
  'building',
  'stop',
  'apple'
]

const BARE = new Set<TripCommand['kind']>([
  'open',
  'close',
  'unkeep',
  'setHomeHere',
  'clearHome',
  'clearRecents',
  'downloadSchedule',
  'requestAccess',
  'openLocationSettings'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_TEXT_CHARS

const isId = (value: unknown): value is string => isText(value) && value.length > 0

const isWithin = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit

/** Only a place's own fields: the next class's title and start come from main, never from here. */
function parsePlace(raw: unknown): Place | null {
  if (!isRecord(raw)) return null
  const { id, kind, name, detail, lat, lon } = raw
  if (!isId(id) || !PLACE_KINDS.includes(kind as Place['kind'])) return null
  if (!isText(name) || !isText(detail)) return null
  if (!isWithin(lat, 90) || !isWithin(lon, 180)) return null
  return { id, kind: kind as Place['kind'], name, detail, lat, lon }
}

function parseFrom(raw: unknown): TripFrom | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'here') return { kind: 'here' }
  if (raw.kind !== 'place') return null
  const place = parsePlace(raw.place)
  return place ? { kind: 'place', place } : null
}

function parseWhen(raw: unknown): TripWhen | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'now') return { kind: 'now' }
  if (raw.kind !== 'depart' && raw.kind !== 'arrive') return null
  const { time } = raw
  return typeof time === 'number' && Number.isFinite(time) ? { kind: raw.kind, time } : null
}

export function parseTripCommand(raw: unknown): TripCommand | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string') return null
  const kind = raw.kind as TripCommand['kind']
  if (BARE.has(kind)) return { kind } as TripCommand
  switch (kind) {
    case 'plan': {
      const to = parsePlace(raw.to)
      const from = parseFrom(raw.from)
      const when = parseWhen(raw.when)
      return to && from && when ? { kind, to, from, when } : null
    }
    case 'keep': {
      const { index, leave, tripId } = raw
      const isIndex =
        Number.isInteger(index) && (index as number) >= 0 && (index as number) < MAX_RESULTS
      const isLeave = typeof leave === 'number' && Number.isFinite(leave)
      if (!isIndex || !isLeave || (tripId !== null && !isText(tripId))) return null
      return { kind, index: index as number, leave, tripId }
    }
    case 'save': {
      const place = parsePlace(raw.place)
      return place && isText(raw.name) ? { kind, place, name: raw.name } : null
    }
    case 'rename':
      return isId(raw.id) && isText(raw.name) ? { kind, id: raw.id, name: raw.name } : null
    case 'remove':
      return isId(raw.id) ? { kind, id: raw.id } : null
    default:
      return null
  }
}
