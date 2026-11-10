import type { MusicCommand, RepeatMode } from './types'

const REPEAT_MODES: readonly RepeatMode[] = ['off', 'all', 'one']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseRepeatMode(value: unknown): RepeatMode | undefined {
  return REPEAT_MODES.find((mode) => mode === value)
}

/** Commands come from the renderer, so they're untrusted: only the exact known shapes pass. */
export function parseMusicCommand(raw: unknown): MusicCommand | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'playPause':
    case 'next':
    case 'previous':
      return { kind: raw.kind }
    case 'setShuffle':
      return typeof raw.on === 'boolean' ? { kind: 'setShuffle', on: raw.on } : null
    case 'setRepeat': {
      const mode = parseRepeatMode(raw.mode)
      return mode ? { kind: 'setRepeat', mode } : null
    }
    case 'seek':
      // How far into the song is checked against its length when the command runs.
      return typeof raw.positionSec === 'number' && Number.isFinite(raw.positionSec)
        ? { kind: 'seek', positionSec: Math.max(0, raw.positionSec) }
        : null
    default:
      return null
  }
}
