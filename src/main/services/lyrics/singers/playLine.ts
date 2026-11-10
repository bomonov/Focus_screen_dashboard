import { JUMP_SEC } from '../../autosync/capture'
import {
  canSeek,
  positionAt,
  seekEnd,
  type MusicCommand,
  type PlaybackState
} from '../../music/types'
import type { SongColors } from './types'

// The editor's Play line: the player is sent to a line's start, played if it was paused, and
// paused again once the line is over.

/** Gives up when the player hasn't landed on the line by then. */
const LAND_WAIT_SEC = 5
/** Players land a hair before where they're sent. */
const LAND_SLACK_SEC = 0.5
const LAND_POLL_MS = 250
/** Looked at just after the line's end, so float dust doesn't leave it a hair short. */
const END_MARGIN_MS = 20

/** A replay with no line before it starts this far ahead of the line, to hear the way in. */
export const REPLAY_LEAD_SEC = 3

/**
 * What "Replay" plays for a line: from the main line before it (second voices skipped) to its
 * end, so the line is heard with its lead-in. Without one before it, or one that doesn't start
 * before it (out of order), a few seconds ahead of it instead. Null when there's no such line.
 */
export function replaySpan(
  colors: SongColors,
  line: number
): { start: number; end: number } | null {
  const target = Number.isInteger(line) ? colors.lines[line] : undefined
  if (!target) return null
  let before: number | undefined
  for (let i = (target.under ?? line) - 1; i >= 0; i--) {
    if (colors.lines[i]?.under === undefined) {
      before = colors.lines[i]?.start
      break
    }
  }
  const start =
    before !== undefined && before < target.start
      ? before
      : Math.max(0, target.start - REPLAY_LEAD_SEC)
  return { start, end: target.end }
}

export interface PlayLineOptions {
  music: { get(): PlaybackState; command(command: MusicCommand): void }
  /** The player has the editor's song on: Play line is off, and stops, otherwise. */
  playingThis(): boolean
  /** Epoch seconds. */
  now(): number
}

export interface PlayLine {
  /** Plays `start`..`end` (song seconds); nothing when the player can't seek or has another song on. */
  play(start: number, end: number): void
  /** Looks again; call it with every word from the player. */
  check(): void
  stop(): void
}

interface Watch {
  start: number
  end: number
  since: number
  /** The player has been seen on the line, playing. */
  landed: boolean
}

export function createPlayLine({ music, playingThis, now }: PlayLineOptions): PlayLine {
  let watch: Watch | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  function stop(): void {
    watch = null
    clearTimeout(timer)
    timer = undefined
  }

  /**
   * Timed again from every word from the player, rather than one timer from the start: a seek
   * while the line plays moves where its end is.
   */
  function check(): void {
    clearTimeout(timer)
    timer = undefined
    const line = watch
    if (!line) return
    if (!playingThis()) {
      stop()
      return
    }
    const playback = music.get()
    const at = now()
    const position = positionAt(playback, at)
    if (!line.landed) {
      if (playback.playing && position >= line.start - LAND_SLACK_SEC && position <= line.end) {
        line.landed = true
      } else if (at - line.since >= LAND_WAIT_SEC) {
        stop()
        return
      } else {
        timer = setTimeout(check, LAND_POLL_MS)
        return
      }
    }
    // Paused by hand, or sought back before the line: it's the user's now.
    if (!playback.playing || position < line.start - JUMP_SEC) {
      stop()
      return
    }
    if (position >= line.end) {
      stop()
      // Further past than the clock explains is a seek of the user's own: left playing.
      if (position < line.end + JUMP_SEC) music.command({ kind: 'playPause' })
      return
    }
    timer = setTimeout(check, Math.ceil((line.end - position) * 1000) + END_MARGIN_MS)
  }

  return {
    play(start, end) {
      const playback = music.get()
      if (!playback.track || !canSeek(playback.track) || !playingThis()) return
      // Set before the commands: a player that answers at once is looked at straight away.
      watch = { start, end, since: now(), landed: false }
      music.command({
        kind: 'seek',
        positionSec: Math.min(Math.max(0, start), seekEnd(playback.track))
      })
      // `playPause` toggles, so it's only sent to a paused player.
      if (!playback.playing) music.command({ kind: 'playPause' })
      check()
    },
    check,
    stop
  }
}
