// Pure helpers for the YouTube video in the Now playing card (Bek's fork).
import type { PlaybackState } from '../../../main/ipc'

/** The YouTube video id behind a track the browser extension reports, else null. */
export function youTubeVideoId(state: PlaybackState | null): string | null {
  const player = state?.player?.id
  if (player !== 'ytmChrome' && player !== 'ytmSafari') return null
  const match = state?.track?.id.match(/^ytm:([\w-]{6,20})$/)
  return match?.[1] ?? null
}

/** Where the browser tab's video is now, in seconds. */
export function expectedPosition(state: PlaybackState, nowMs: number): number {
  const since = state.playing ? Math.max(0, nowMs / 1000 - state.positionAt) : 0
  return state.positionSec + since
}
