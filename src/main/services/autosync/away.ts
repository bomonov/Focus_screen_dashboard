import type { PlaybackState } from '../music/types'
import { playerBundles } from './players'
import type { PrepareService } from './prepare'

/** Nobody has touched the keyboard, mouse or trackpad for this long: they've stepped away. */
export const AWAY_AFTER_SEC = 300
/** Input this recent means someone is back. */
const BACK_WITHIN_SEC = 3
const CHECK_MS = 5000

export interface AwayOptions {
  prepare: Pick<PrepareService, 'get' | 'subscribe' | 'start' | 'stop'>
  music: { get(): PlaybackState }
  /** The "Prepare while I'm away" setting. */
  armed(): boolean
  /** Seconds since the last keyboard, mouse or trackpad input (Electron's powerMonitor). */
  idleSeconds(): number
  /** Whether these apps are silent right now: a short level check, nothing kept. */
  isQuiet(bundles: string[]): Promise<boolean>
  awayAfterSec?: number
  checkMs?: number
}

export interface AwayPreparer {
  dispose(): void
}

/**
 * Prepares the playlist on in YouTube Music (playing or paused) while nobody uses the Mac, so
 * the browser is only muted when no one is touching it, and gives the sound back the moment
 * someone touches the keyboard or mouse. It carries on with the same playlist the next time.
 */
export function createAwayPreparer(options: AwayOptions): AwayPreparer {
  const { prepare, music } = options
  const awayAfter = options.awayAfterSec ?? AWAY_AFTER_SEC
  /** Playlists finished or given up on this session, so they aren't started on every absence. */
  const handled = new Set<string>()
  /** The away run under way: started, or still muting the browser. */
  let current: { playlistId: string; started: boolean } | null = null
  /** Where the last away run stopped when someone came back: it goes on from there. */
  let stoppedAt: { playlistId: string; trackId: string } | null = null
  let checking = false

  /** Notes how the away run ended, once it has. */
  function noteEnd(): void {
    const state = prepare.get()
    if (!current?.started || state.running) return
    // It ended on its own (done, paused, gone…): this playlist is dealt with for now.
    if (state.ended !== 'cameBack') handled.add(current.playlistId)
    current = null
  }

  const unsubscribe = prepare.subscribe(noteEnd)

  async function startIfAway(): Promise<void> {
    if (current || checking || !options.armed() || options.idleSeconds() < awayAfter) return
    const state = prepare.get()
    const playback = music.get()
    const playlistId = playback.playlistId
    // The playlist may be playing: Kenny chose that being idle this long means he's away, even
    // if that mutes music he's listening to without touching the Mac.
    if (state.running || state.blocker || !playback.player || !playlistId) return
    if (handled.has(playlistId)) return
    // With the playlist paused, the browser should be quiet: a video playing in another tab
    // means someone is watching.
    if (!playback.playing) {
      checking = true
      const quiet = await options.isQuiet(playerBundles(playback.player.id)).catch(() => false)
      checking = false
      if (!quiet) return
    }
    if (
      !options.armed() ||
      options.idleSeconds() < awayAfter ||
      music.get().playlistId !== playlistId
    ) {
      return
    }
    current = { playlistId, started: false }
    const resumeTrack = stoppedAt?.playlistId === playlistId ? stoppedAt.trackId : null
    const started = await prepare.start({ trigger: 'away', resumeTrack })
    if (!started) {
      // A browser that can't be muted isn't tried again for this playlist.
      if (prepare.get().ended === 'muteFailed') handled.add(playlistId)
      current = null
      return
    }
    current.started = true
    // It may have ended already (the playlist was at its end).
    noteEnd()
  }

  function check(): void {
    noteEnd()
    const state = prepare.get()
    if (current?.started && state.running && state.trigger === 'away') {
      if (options.idleSeconds() < BACK_WITHIN_SEC || !options.armed()) {
        const trackId = music.get().track?.id
        stoppedAt = trackId ? { playlistId: current.playlistId, trackId } : null
        prepare.stop('cameBack')
      }
      return
    }
    void startIfAway()
  }

  const timer = setInterval(check, options.checkMs ?? CHECK_MS)

  return {
    dispose() {
      clearInterval(timer)
      unsubscribe()
    }
  }
}
