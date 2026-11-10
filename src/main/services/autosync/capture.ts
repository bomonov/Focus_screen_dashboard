import { AD_TRACK_ID, type PlaybackState, type PlayerId, type Track } from '../music/types'
import type { AudioHelperClient } from './client'
import { playerBundles } from './players'
import { createSongRecording, MAX_SONG_SEC, type SongRecording } from './recording'

/**
 * Audio waits this long before it's placed in the song. A seek or pause reaches us a little
 * after it happens (the player is polled), so by then we know whether the audio heard just
 * before it still belongs where the old position said.
 */
export const HOLD_SEC = 1.5
/** After a play, pause, seek or song change, the reported position needs a moment to settle. */
export const SETTLE_SEC = 0.6
/** A position this far from where the running clock puts it means a seek. */
export const JUMP_SEC = 1
/**
 * Done once this much of the song has been heard while it's still on: in practice, all of it.
 * Lines sung in a part never heard can't be placed, so stopping early piles them up at the end.
 */
export const COMPLETE_COVERAGE = 0.97
/** Or when the song ends or the listener moves on, if this much was heard by then. */
export const LEAVE_COVERAGE = 0.85
/** The player this close to the end counts as the song having ended (it may repeat next). */
export const END_SEC = 0.5
/** While the song plays with no audio for this long, listen again (the player's audio process may have changed). */
export const SILENT_RESTART_MS = 3000
const TICK_MS = 250
/**
 * Songs left part-way keep what was heard (up to ~19 MB each), so coming back to one fills in
 * its gaps instead of starting over.
 */
export const KEEP_PARTIAL = 3

export interface CapturedSong {
  player: PlayerId
  track: Track
  recording: SongRecording
}

/** Where in the song audio heard at `at` (epoch seconds) belongs; null while paused. */
export function songTimeAt(state: PlaybackState, at: number): number | null {
  if (!state.playing) return null
  return state.positionSec + (at - state.positionAt)
}

/** The position moved by more than the clock explains: a seek (or the player skipped). */
export function isJump(previous: PlaybackState, next: PlaybackState): boolean {
  if (!previous.playing || !next.playing) return false
  const expected = previous.positionSec + (next.positionAt - previous.positionAt)
  return Math.abs(next.positionSec - expected) > JUMP_SEC
}

export interface SongCaptureOptions {
  music: {
    get(): PlaybackState
    subscribe(listener: (state: PlaybackState) => void): () => void
  }
  helper: AudioHelperClient
  /** Should this song be recorded? Asked when it comes on (and on refresh). */
  wants(player: PlayerId, track: Track): boolean
  onComplete(song: CapturedSong): void
  /** Each further tenth of the song heard. */
  onProgress?(coverage: number): void
  /** How much of the song must be heard while it plays; COMPLETE_COVERAGE unless a test says otherwise. */
  completeAt?: number
  /** How much must have been heard when the song ends or is left; LEAVE_COVERAGE by default. */
  completeOnLeaveAt?: number
  /** Epoch seconds. */
  now?: () => number
  /** Live sync: the wanted song's audio as soon as it's heard, not held like the recording. */
  live?: LiveListener
}

/**
 * Audio for following the singing as it happens. It can't wait the HOLD_SEC the recording
 * does, so audio heard just before a seek the player hasn't reported yet arrives with the old
 * spot's song time; the follower drops what came just before a `seek`.
 */
export interface LiveListener {
  audio(track: Track, songTimeSec: number, samples: Int16Array): void
  seek(track: Track, songTimeSec: number): void
}

export interface SongCapture {
  /** Asks `wants` again for the song on now, e.g. after the setting behind it changed. */
  refresh(): void
  dispose(): void
}

interface Current {
  key: string
  player: PlayerId
  track: Track
  recording: SongRecording
  tenths: number
}

interface Chunk {
  at: number
  samples: Int16Array
}

const keyOf = (state: PlaybackState): string =>
  state.player && state.track ? `${state.player.id}\n${state.track.id}` : ''

/**
 * Records the music player while a wanted song plays, places each bit of audio at its spot in
 * the song (so pausing and seeking don't matter), and hands the song over once it's mostly
 * been heard. The tap is only open while that song is actually playing.
 */
export function createSongCapture({
  music,
  helper,
  wants,
  onComplete,
  onProgress,
  completeAt = COMPLETE_COVERAGE,
  completeOnLeaveAt = LEAVE_COVERAGE,
  now = () => Date.now() / 1000,
  live
}: SongCaptureOptions): SongCapture {
  let current: Current | null = null
  let last: PlaybackState = music.get()
  let queue: Chunk[] = []
  /** When seeks, pauses and song changes were noticed (epoch seconds), newest last. */
  let changes: number[] = [now()]
  /** The newest of those, kept after `changes` forgets it. */
  let lastChange = now()
  /** The player the tap is open for; null while it's closed. */
  let tapPlayer: PlayerId | null = null
  let starting = false
  let lastAudioMs = 0
  /** When the song on now reached its end; it's handed over once its last audio is placed. */
  let endedAt: number | null = null
  /** Songs already handed over this run; they aren't recorded twice. */
  const finished = new Set<string>()
  /** Part-heard songs, oldest first. */
  const partials = new Map<string, Current>()

  function setAside(song: Current): void {
    if (song.recording.coverage() === 0) return
    partials.delete(song.key)
    partials.set(song.key, song)
    while (partials.size > KEEP_PARTIAL) {
      const oldest = partials.keys().next().value
      if (oldest === undefined) break
      partials.delete(oldest)
    }
  }

  function finish(done: Current): void {
    finished.add(done.key)
    onComplete({ player: done.player, track: done.track, recording: done.recording })
  }

  function choose(state: PlaybackState): void {
    queue = []
    endedAt = null
    if (current) {
      // The song ended or was left: done if enough of it was heard, else kept for later.
      const left = current
      current = null
      if (keyOf(state) !== left.key && left.recording.coverage() >= completeOnLeaveAt) finish(left)
      else setAside(left)
    }
    const key = keyOf(state)
    const { player, track } = state
    if (
      !player ||
      !track ||
      track.id === AD_TRACK_ID ||
      track.durationSec <= 0 ||
      track.durationSec > MAX_SONG_SEC ||
      finished.has(key) ||
      playerBundles(player.id).length === 0 ||
      !wants(player.id, track)
    ) {
      current = null
      return
    }
    const earlier = partials.get(key)
    partials.delete(key)
    current =
      earlier && Math.abs(earlier.recording.durationSec - track.durationSec) < 1
        ? earlier
        : {
            key,
            player: player.id,
            track,
            recording: createSongRecording(track.durationSec),
            tenths: 0
          }
    // Said straight away, so the screen shows the song is being listened to.
    onProgress?.(current.recording.coverage())
  }

  function shouldListen(): boolean {
    return current !== null && last.playing
  }

  function listen(player: PlayerId): void {
    starting = true
    helper
      .start(playerBundles(player))
      .then((result) => {
        starting = false
        tapPlayer = result.ok ? player : null
        if (!result.ok) console.warn(`[autosync] Couldn't listen to the player: ${result.error}`)
        // Counted from now, so a player that isn't making sound yet is retried after a while.
        lastAudioMs = Date.now()
        syncTap()
      })
      .catch(() => {
        starting = false
      })
  }

  function syncTap(): void {
    if (starting) return
    const want = shouldListen() && current ? current.player : null
    if (want !== null && want !== tapPlayer) {
      listen(want)
    } else if (want === null && tapPlayer !== null) {
      tapPlayer = null
      helper.stop()
    }
  }

  function commit(): void {
    const due = now() - HOLD_SEC
    while (queue.length > 0 && (queue[0]?.at ?? Infinity) <= due) {
      const chunk = queue.shift()
      if (!chunk || !current) continue
      const nearChange = changes.some(
        (at) => chunk.at >= at - HOLD_SEC && chunk.at <= at + SETTLE_SEC
      )
      const songTime = nearChange ? null : songTimeAt(last, chunk.at)
      if (songTime === null) continue
      current.recording.write(songTime, chunk.samples)
    }
    if (!current) return
    const coverage = current.recording.coverage()
    const tenths = Math.floor(coverage * 10)
    if (tenths > current.tenths) {
      current.tenths = tenths
      onProgress?.(coverage)
    }
    if (coverage >= completeAt) {
      const done = current
      current = null
      queue = []
      syncTap()
      finish(done)
    }
  }

  /** Where the player is in the song now, playing or paused. */
  function position(): number {
    return songTimeAt(last, now()) ?? last.positionSec
  }

  function tick(): void {
    commit()
    if (current && endedAt === null && position() >= current.track.durationSec - END_SEC) {
      endedAt = now()
    }
    // The end of a song is the end of listening to it, even when the player repeats it.
    if (current && endedAt !== null && now() >= endedAt + HOLD_SEC) {
      const done = current
      endedAt = null
      if (done.recording.coverage() >= completeOnLeaveAt) {
        current = null
        queue = []
        syncTap()
        finish(done)
      }
    }
    // Forget changes no queued audio can be near any more.
    const horizon = now() - HOLD_SEC * 2 - SETTLE_SEC
    changes = changes.filter((at) => at >= horizon)
    if (shouldListen() && !starting && Date.now() - lastAudioMs > SILENT_RESTART_MS) {
      tapPlayer = null
      syncTap()
    }
  }

  /** Live audio goes out at once, except while the position settles after a change. */
  function hearLive(at: number, samples: Int16Array): void {
    if (!live || !current || now() < lastChange + SETTLE_SEC) return
    const songTime = songTimeAt(last, at)
    if (songTime === null || songTime < 0 || songTime >= current.track.durationSec) return
    live.audio(current.track, songTime, samples)
  }

  const unsubscribeMusic = music.subscribe((state) => {
    const songChanged = keyOf(state) !== keyOf(last)
    const jumped = isJump(last, state)
    if (songChanged || state.playing !== last.playing || jumped) {
      changes.push(now())
      lastChange = now()
    }
    if (jumped && !songChanged && current && live) {
      live.seek(current.track, songTimeAt(state, now()) ?? state.positionSec)
    }
    last = state
    // A song not being recorded is looked at again on every change: its length or lyrics may
    // only just have arrived.
    if (songChanged || !current) choose(state)
    syncTap()
  })
  const unsubscribeAudio = helper.onAudio((at, samples) => {
    lastAudioMs = Date.now()
    if (current && last.playing) {
      queue.push({ at, samples })
      hearLive(at, samples)
    }
  })
  const timer = setInterval(tick, TICK_MS)
  choose(last)
  syncTap()

  return {
    refresh() {
      // Keep what's been heard while the same song is still wanted.
      if (current && wants(current.player, current.track)) return
      choose(last)
      syncTap()
    },
    dispose() {
      clearInterval(timer)
      unsubscribeMusic()
      unsubscribeAudio()
      current = null
      if (tapPlayer !== null) helper.stop()
      tapPlayer = null
    }
  }
}
