import type { LyricsState } from '../lyrics/types'
import type { AdapterCommand } from '../music/adapter'
import {
  AD_TRACK_ID,
  positionAt,
  type PlaybackState,
  type PlayerId,
  type Track
} from '../music/types'
import { playerBundles } from './players'
import { MAX_SONG_SEC } from './recording'
import { needsTiming, type AutoSyncResult } from './service'
import {
  playlistKind,
  type AutoSyncState,
  type PrepareBlocker,
  type PrepareCommand,
  type PrepareEnd,
  type PrepareState
} from './types'

/** YouTube Music: the player the app can skip through and that reports its playlist. */
const PREPARE_PLAYERS: readonly PlayerId[] = ['ytmSafari', 'ytmChrome']
const TICK_MS = 1000
/** While LRCLIB or VocaDB can't be reached, a song waits this long before it's passed by. */
const UNAVAILABLE_WAIT_MS = 60_000
/** Paused by something else for this long (e.g. "still listening?"): the run ends. */
const PAUSED_STOP_MS = 120_000
/** The player gone for this long: the run ends. */
const GONE_STOP_MS = 60_000
/** Paused within this much of a song's end, for END_WAIT_MS: the player ran out of songs. */
const END_SLACK_SEC = 2
const END_WAIT_MS = 5000
/** Safety limits for a run nobody is watching. */
const MAX_RUN_MS = 6 * 3600 * 1000
const MAX_SONGS = 200
/** A skip that didn't take is sent again after this long; after the last try the run is done. */
const SKIP_RETRY_MS = 5000
const SKIP_TRIES = 3
/** A song that needs timing but is further in than this starts over, so all of it is heard. */
const RESTART_AFTER_SEC = 3
/** Sound comes back only once the player has had time to pause. */
const UNMUTE_AFTER_MS = 1000

/** Commands come from the renderer, so they're untrusted: only the exact known shapes pass. */
export function parsePrepareCommand(raw: unknown): PrepareCommand | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { kind } = raw as Record<string, unknown>
  return kind === 'start' || kind === 'stop' ? { kind } : null
}

export type Decision = 'wait' | 'play' | 'skip'

/**
 * What to do with the song on now: let it play so auto-sync times it, skip it, or wait for its
 * lyrics. `waitedMs` is how long it has been on.
 */
export function decide(track: Track, lyrics: LyricsState, waitedMs: number): Decision {
  // Ads can't be skipped; they play out (muted like everything else).
  if (track.id === AD_TRACK_ID || lyrics.trackId !== track.id) return 'wait'
  switch (lyrics.status) {
    case 'idle':
    case 'loading':
      return 'wait'
    case 'unavailable':
      return waitedMs < UNAVAILABLE_WAIT_MS ? 'wait' : 'skip'
    case 'notFound':
      return 'skip'
    case 'found':
      if (!needsTiming(lyrics, track.id)) return 'skip'
      if (track.durationSec <= 0) return 'wait'
      return track.durationSec > MAX_SONG_SEC ? 'skip' : 'play'
  }
}

/** Why a run can't start with things as they are; null when it can. */
export function prepareBlocker(
  autoSync: AutoSyncState,
  showLyrics: boolean,
  playback: PlaybackState
): PrepareBlocker | null {
  if (!autoSync.enabled || autoSync.problem) return 'autoSyncOff'
  if (!showLyrics) return 'lyricsHidden'
  const player = playback.player?.id
  if (!player || !PREPARE_PLAYERS.includes(player) || !playback.track) return 'noYouTubeMusic'
  // A run needs a list that ends; a mix (or a single song) would go on with whatever comes.
  const kind = playlistKind(playback.playlistId)
  if (kind === null || kind === 'radio') return 'noPlaylist'
  return null
}

export interface PrepareStart {
  trigger: 'manual' | 'away'
  /** The song an earlier run stopped part-way through: it goes on from there, not the top. */
  resumeTrack?: string | null
}

export interface PrepareService {
  get(): PrepareState
  subscribe(listener: (state: PrepareState) => void): () => void
  /** Resolves with whether a run started (not when one is on already, can't start, or can't mute). */
  start(how?: PrepareStart): Promise<boolean>
  stop(reason?: Extract<PrepareEnd, 'stopped' | 'cameBack'>): void
  /** Settings changed (lyrics shown or hidden): says again whether a run can start. */
  refresh(): void
  dispose(): void
}

export interface PrepareOptions {
  music: {
    get(): PlaybackState
    subscribe(listener: (state: PlaybackState) => void): () => void
  }
  lyrics: {
    get(): LyricsState
    subscribe(listener: (state: LyricsState) => void): () => void
  }
  autoSync: {
    get(): AutoSyncState
    subscribe(listener: (state: AutoSyncState) => void): () => void
    onResult(listener: (result: AutoSyncResult) => void): () => void
  }
  showLyrics(): boolean
  /** Sent to the prepared player itself, whichever player the screen shows. */
  command(player: PlayerId, command: AdapterCommand): void
  /** Keeps these apps off the speakers; resolves with a way to undo it, or null if it can't. */
  mute(bundles: string[]): Promise<(() => void) | null>
  /** Keeps the Mac from sleeping until the returned function is called. */
  keepAwake(): () => void
  /** Epoch seconds. */
  now?: () => number
  tickMs?: number
}

interface Song {
  firstAt: number
  decision: Decision
  skips: number
  lastSkipAt: number
}

interface Run {
  player: PlayerId
  playlistId: string | null
  resumeTrack: string | null
  startedAt: number
  unmute: () => void
  allowSleep: () => void
  songs: Map<string, Song>
  current: string | null
  pausedSince: number | null
  goneSince: number | null
}

const IDLE: Omit<PrepareState, 'blocker'> = {
  running: false,
  trigger: null,
  ended: null,
  timed: 0,
  failed: 0,
  pending: 0,
  skipped: 0
}

export function createPrepareService(options: PrepareOptions): PrepareService {
  const { music, lyrics, autoSync, command } = options
  const now = options.now ?? ((): number => Date.now() / 1000)
  const listeners = new Set<(state: PrepareState) => void>()
  let run: Run | null = null
  let starting = false
  let timer: ReturnType<typeof setInterval> | undefined
  /** Songs this run played for timing, until auto-sync says how it went (even after the run). */
  const awaiting = new Set<string>()
  let state: PrepareState = { ...IDLE, blocker: blocker() }

  function blocker(): PrepareBlocker | null {
    return run ? null : prepareBlocker(autoSync.get(), options.showLyrics(), music.get())
  }

  function publish(change: Partial<PrepareState>): void {
    const next = { ...state, ...change, pending: awaiting.size, blocker: blocker() }
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    for (const listener of listeners) listener(state)
  }

  function end(reason: PrepareEnd, unmuteAfterMs = UNMUTE_AFTER_MS): void {
    const finished = run
    if (!finished) return
    run = null
    clearInterval(timer)
    // Paused first and unmuted a moment later, so the next song doesn't play out loud.
    const playback = music.get()
    if (playback.player?.id === finished.player && playback.playing) {
      command(finished.player, { kind: 'playPause' })
    }
    if (unmuteAfterMs > 0) setTimeout(finished.unmute, unmuteAfterMs)
    else finished.unmute()
    finished.allowSleep()
    console.log(`[prepare] Done preparing (${reason}).`)
    publish({ running: false, ended: reason })
  }

  /** The song that just came on: new, or back again (then it's been dealt with). */
  function songFor(current: Run, trackId: string, at: number): Song | null {
    if (trackId === current.current) return current.songs.get(trackId) ?? null
    current.current = trackId
    const earlier = current.songs.get(trackId)
    if (earlier) {
      // Round again (the playlist looped): it was timed or passed by already.
      earlier.decision = 'skip'
      earlier.skips = 0
      earlier.lastSkipAt = 0
      return earlier
    }
    if (current.songs.size >= MAX_SONGS) return null
    const song: Song = { firstAt: at, decision: 'wait', skips: 0, lastSkipAt: 0 }
    current.songs.set(trackId, song)
    return song
  }

  function evaluate(): void {
    const current = run
    if (!current) {
      publish({})
      return
    }
    const at = now()
    const auto = autoSync.get()
    if (!auto.enabled || auto.problem) return end('autoSyncOff')
    if ((at - current.startedAt) * 1000 >= MAX_RUN_MS) return end('limit')

    const playback = music.get()
    if (playback.player?.id !== current.player) {
      current.goneSince ??= at
      if ((at - current.goneSince) * 1000 >= GONE_STOP_MS) end('disconnected')
      return
    }
    current.goneSince = null
    // Ran out into autoplay's suggestions, or something else was picked.
    const playlist = playback.playlistId ?? null
    if (current.playlistId && playlist && playlist !== current.playlistId) return end('done')

    const track = playback.track
    if (!track) return
    if (!playback.playing) {
      current.pausedSince ??= at
      const paused = (at - current.pausedSince) * 1000
      const atEnd =
        track.durationSec > 0 && positionAt(playback, at) >= track.durationSec - END_SLACK_SEC
      if (atEnd && paused >= END_WAIT_MS) return end('done')
      if (paused >= PAUSED_STOP_MS) end('paused')
      return
    }
    current.pausedSince = null
    if (track.id === AD_TRACK_ID) return

    const song = songFor(current, track.id, at)
    if (!song) return end('limit')
    if (song.decision === 'wait') {
      song.decision = decide(track, lyrics.get(), (at - song.firstAt) * 1000)
      if (song.decision === 'skip') publish({ skipped: state.skipped + 1 })
      if (song.decision === 'play') {
        awaiting.add(track.id)
        // Started part-way (the run began mid-song): from the top, so all of it is heard. Not
        // a song an earlier run was stopped in: what it heard then is still kept.
        if (positionAt(playback, at) > RESTART_AFTER_SEC && track.id !== current.resumeTrack)
          command(current.player, { kind: 'restart' })
        publish({})
      }
    }
    if (song.decision === 'skip' && (at - song.lastSkipAt) * 1000 >= SKIP_RETRY_MS) {
      // Still on after every try: there's no next song.
      if (song.skips >= SKIP_TRIES) return end('done')
      command(current.player, { kind: 'next' })
      song.skips += 1
      song.lastSkipAt = at
    }
  }

  /** Whether a run started. */
  async function start({ trigger, resumeTrack = null }: PrepareStart): Promise<boolean> {
    if (run || starting) return false
    const playback = music.get()
    const player = playback.player?.id
    if (blocker() || !player) return false
    starting = true
    const unmute = await options.mute(playerBundles(player)).catch(() => null)
    starting = false
    if (!unmute) {
      publish({ trigger, ended: 'muteFailed' })
      return false
    }
    awaiting.clear()
    run = {
      player,
      playlistId: playback.playlistId ?? null,
      resumeTrack,
      startedAt: now(),
      unmute,
      allowSleep: options.keepAwake(),
      songs: new Map(),
      current: null,
      pausedSince: null,
      goneSince: null
    }
    console.log(
      `[prepare] Preparing the playlist, muted${trigger === 'away' ? ' (nobody is using the Mac)' : ''}.`
    )
    if (playback.repeat !== 'off') command(player, { kind: 'setRepeat', mode: 'off' })
    if (!playback.playing) command(player, { kind: 'playPause' })
    timer = setInterval(evaluate, options.tickMs ?? TICK_MS)
    publish({ ...IDLE, running: true, trigger })
    evaluate()
    return true
  }

  const unsubscribe = [
    music.subscribe(() => evaluate()),
    lyrics.subscribe(() => evaluate()),
    autoSync.subscribe(() => evaluate()),
    autoSync.onResult(({ trackId, timed }) => {
      if (!awaiting.delete(trackId)) return
      publish(timed ? { timed: state.timed + 1 } : { failed: state.failed + 1 })
    })
  ]

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start: (how = { trigger: 'manual' }) => start(how),
    stop(reason = 'stopped') {
      end(reason)
    },
    refresh() {
      publish({})
    },
    dispose() {
      end('stopped', 0)
      for (const stop of unsubscribe) stop()
      listeners.clear()
    }
  }
}
