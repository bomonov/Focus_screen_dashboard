import { HOLD_SEC, isJump, SETTLE_SEC, songTimeAt } from '../../autosync/capture'
import type { PlaybackState } from '../../music/types'

// The editor's waveform hears the player as it plays, but the player tells us about a seek or a
// pause a moment after it happens. Audio waits HOLD_SEC before it's given a song time, and what
// was heard around such a change is left out: the outline keeps the loudest it hears, so audio
// put in the wrong spot would stay there for good. Everything still waiting when a change is
// noticed goes too: it was heard under the old place in the song, and only the new one is known.

/** Audio stamped further ahead than this has a clock that can't be trusted. */
const FUTURE_SLACK_SEC = 5

export interface HeardAudio {
  /** Holds audio heard at `at` (epoch seconds) until it's old enough to place. */
  hear(at: number, samples: Int16Array): void
  /**
   * Every word from the player. A seek, pause or song change drops what's waiting and is
   * remembered for a while; returns whether this was one.
   */
  playerChanged(previous: PlaybackState, next: PlaybackState): boolean
  /**
   * Hands what's old enough to `add`, at its time in the song by `playback` (the latest word);
   * with `keep` false (another song on, or paused) it's dropped instead.
   */
  place(
    playback: PlaybackState,
    keep: boolean,
    add: (songTimeSec: number, samples: Int16Array) => void
  ): void
  clear(): void
}

interface Chunk {
  at: number
  samples: Int16Array
}

export function createHeardAudio(now: () => number): HeardAudio {
  let queue: Chunk[] = []
  /** When seeks, pauses and song changes were noticed (epoch seconds). */
  let changes: number[] = []

  /** Changes no held audio can be near any more. */
  function forget(): void {
    const horizon = now() - HOLD_SEC * 2 - SETTLE_SEC
    changes = changes.filter((at) => at >= horizon)
  }

  return {
    hear(at, samples) {
      if (!Number.isFinite(at) || at > now() + FUTURE_SLACK_SEC) return
      queue.push({ at, samples })
    },
    playerChanged(previous, next) {
      const songChanged =
        next.track?.id !== previous.track?.id || next.player?.id !== previous.player?.id
      const changed = songChanged || next.playing !== previous.playing || isJump(previous, next)
      if (changed) {
        changes.push(now())
        queue = []
      }
      // Also while nothing is placed (the editor closed), so the list can't grow.
      forget()
      return changed
    },
    place(playback, keep, add) {
      const due = now() - HOLD_SEC
      while (queue.length > 0 && (queue[0]?.at ?? Number.POSITIVE_INFINITY) <= due) {
        const chunk = queue.shift()
        if (!chunk || !keep) continue
        if (changes.some((at) => chunk.at >= at - HOLD_SEC && chunk.at <= at + SETTLE_SEC)) continue
        const songTime = songTimeAt(playback, chunk.at)
        if (songTime !== null) add(songTime, chunk.samples)
      }
      forget()
    },
    clear() {
      queue = []
    }
  }
}
