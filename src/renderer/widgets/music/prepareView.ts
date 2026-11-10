import type { PrepareState } from '../../../main/ipc'

/** "2 timed · 1 timing · 5 skipped": how a playlist run is going, or went. */
export function prepareCounts(state: PrepareState): string {
  const parts = [`${state.timed} timed`]
  if (state.pending > 0) parts.push(`${state.pending} timing`)
  if (state.failed > 0) parts.push(`${state.failed} couldn’t be timed`)
  parts.push(`${state.skipped} skipped`)
  return parts.join(' · ')
}

/** The line over the song while a playlist is being prepared; null the rest of the time. */
export function prepareEyebrow(state: PrepareState | null): string | null {
  return state?.running ? `Preparing playlist (muted) · ${prepareCounts(state)}` : null
}
