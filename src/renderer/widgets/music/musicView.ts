import type { PlaybackState, RepeatMode, Track } from '../../../main/ipc'
import { positionAt } from '../../../main/services/music/types'

export interface MusicView {
  /** "1:24" */
  elapsed: string
  /** "3:33"; null when the player doesn't know the length (radio). */
  total: string | null
  /** How full the progress bar is, 0–1. */
  progress: number
  /** "Spotify" or "Apple Music" plus whether it's playing, for the eyebrow. */
  eyebrow: string
  /** "Artist · Album", skipping whichever the player left empty. */
  byline: string
  /** Where the repeat button goes next. */
  nextRepeat: RepeatMode
}

/** The song up next shows for the end of this one: long enough to read, not a distraction. */
export const UP_NEXT_LEAD_SEC = 20

/** Whether "Up next" shows now: in the last moments of a song whose length the player knows. */
export function upNextShown(state: PlaybackState, track: Track, now: number): boolean {
  if (!state.next || track.durationSec <= 0) return false
  return track.durationSec - positionAt(state, now) <= UP_NEXT_LEAD_SEC
}

/** Song times as players show them: "0:07", "3:33", "1:02:09". */
export function formatSongTime(totalSec: number): string {
  const whole = Math.max(0, Math.floor(totalSec))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const seconds = String(whole % 60).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}

export function nextRepeatMode(current: RepeatMode, modes: readonly RepeatMode[]): RepeatMode {
  const index = modes.indexOf(current)
  return modes[(index + 1) % modes.length] ?? 'off'
}

export function byline(track: Pick<Track, 'artist' | 'album'>): string {
  return [track.artist, track.album].filter((part) => part !== '').join(' · ')
}

/** "Spotify or Apple Music", "A, B or C" */
export function joinOr(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
}

export function musicView(
  state: PlaybackState,
  track: Track,
  now: number,
  showPlayerName = true
): MusicView {
  const position = positionAt(state, now)
  const duration = track.durationSec
  const label = state.playing ? 'Now playing' : 'Paused'
  return {
    elapsed: formatSongTime(position),
    total: duration > 0 ? formatSongTime(duration) : null,
    progress: duration > 0 ? Math.min(1, position / duration) : 0,
    eyebrow: state.player && showPlayerName ? `${label} · ${state.player.name}` : label,
    byline: byline(track),
    nextRepeat: nextRepeatMode(state.repeat, state.repeatModes)
  }
}
