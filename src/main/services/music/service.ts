import type { AdapterTrack, MusicAdapter, PlayerInfo, PlayerReport } from './adapter'
import {
  applyExpectation,
  choosePlayer,
  expectationFor,
  playbackChanged,
  previousCommand,
  toPlaybackState,
  type Expectation,
  type PlayerChoice
} from './playback'
import {
  canSeek,
  positionAt,
  seekEnd,
  type MusicCommand,
  type PlaybackState,
  type PlayerId
} from './types'

/** Covers for recent songs, so skipping back and forth doesn't reload them. */
const ARTWORK_CACHE_SIZE = 20
/**
 * A cover can show up a moment after the song starts (streams, slow networks), and a load can
 * fail (a browser's connection dropping for a moment): look once more, for Up next's too.
 */
const ARTWORK_RETRY_SEC = 10
const ARTWORK_ATTEMPTS = 2
/** Readings arrive every second; one this old means its poller is gone or the player hung. */
const STALE_AFTER_SEC = 10

export interface MusicService {
  get(): PlaybackState
  command(command: MusicCommand): void
  subscribe(listener: (state: PlaybackState) => void): () => void
  /** Dev builds have a demo player that stands in when no real player is open. */
  readonly hasDemo: boolean
  isDemoEnabled(): boolean
  setDemoEnabled(on: boolean): void
  dispose(): void
}

export interface MusicServiceOptions {
  /** Real players, in priority order. */
  adapters: readonly MusicAdapter[]
  demo?: MusicAdapter | null
  /** Turns cover bytes into a data URL, or null when they aren't an image. */
  toArtwork: (bytes: Uint8Array) => string | null
  /** Unix epoch seconds; injectable for tests. */
  now?: () => number
}

interface ArtworkEntry {
  url: string | null
  at: number
  attempts: number
}

const epochSeconds = (): number => Date.now() / 1000

export function createMusicService({
  adapters,
  demo = null,
  toArtwork,
  now = epochSeconds
}: MusicServiceOptions): MusicService {
  const allAdapters = demo ? [...adapters, demo] : adapters
  const owners = new Map<PlayerId, MusicAdapter>()
  const infos = new Map<PlayerId, PlayerInfo>()
  for (const adapter of allAdapters) {
    for (const player of adapter.players) {
      owners.set(player.id, adapter)
      infos.set(player.id, player)
    }
  }
  const realPlayers = adapters.flatMap((adapter) => adapter.players.map((player) => player.id))
  const info = (player: PlayerId): PlayerInfo =>
    infos.get(player) ?? { id: player, name: player, repeatModes: ['off'] }
  /** Players whose app isn't on this computer; the hint shouldn't suggest them. */
  const notInstalled = new Set<PlayerId>()
  const supportedPlayers = (): string[] => [
    ...new Set(realPlayers.filter((id) => !notInstalled.has(id)).map((id) => info(id).name))
  ]

  const reports = new Map<PlayerId, PlayerReport>()
  const artwork = new Map<string, ArtworkEntry>()
  const loadingArtwork = new Set<string>()
  const listeners = new Set<(state: PlaybackState) => void>()
  let demoEnabled = demo !== null
  let lastShown: PlayerId | null = null
  const lastPlayed = new Map<PlayerId, number>()
  /** A button just pressed, shown before the player confirms it. */
  let expectation: Expectation | null = null
  let disposed = false
  let state = toPlaybackState({
    choice: { kind: 'none' },
    info,
    artwork: null,
    supportedPlayers: supportedPlayers(),
    now: now()
  })

  function ingest(report: PlayerReport): void {
    if (disposed || report.kind === 'failed') return
    // A command's reading and the poll can cross; never let an older reading win.
    const previous = reports.get(report.player)
    if (previous && report.at < previous.at) return
    reports.set(report.player, report)
    if (report.kind === 'open' && report.snapshot.status === 'playing') {
      lastPlayed.set(report.player, report.at)
    }
    if (report.kind === 'closed' && report.installed === false) notInstalled.add(report.player)
    else notInstalled.delete(report.player)
    refresh()
  }

  function current(player: PlayerId, at: number): PlayerReport {
    const report = reports.get(player)
    return report && at - report.at <= STALE_AFTER_SEC ? report : { player, at, kind: 'closed' }
  }

  function refresh(): void {
    const at = now()
    const choice = choosePlayer(
      realPlayers.map((id) => current(id, at)),
      demo && demoEnabled ? current('demo', at) : null,
      lastShown,
      lastPlayed
    )
    // Only playing counts: a paused app that happened to report first shouldn't hold the card.
    if (choice.kind === 'player' && choice.snapshot.status === 'playing') lastShown = choice.player
    const reading = toPlaybackState({
      choice,
      info,
      artwork: coverFor(choice),
      nextArtwork: nextCoverFor(choice),
      supportedPlayers: supportedPlayers(),
      now: at
    })
    const { state: next, pending } = applyExpectation(reading, state, expectation, at)
    expectation = pending
    if (!playbackChanged(state, next)) return
    state = next
    for (const listener of listeners) listener(state)
  }

  /** The cover if we have it; otherwise starts loading it and refreshes when it arrives. */
  function coverFor(choice: PlayerChoice): string | null {
    if (choice.kind !== 'player' || choice.snapshot.status === 'stopped') return null
    const track = choice.snapshot.track
    if (!track) return null
    const key = `${choice.player}:${track.id}`
    const entry = artwork.get(key)
    if (entry?.url) return entry.url
    if (loadDue(key, entry)) loadCover(choice.player, track, key, entry)
    return null
  }

  /** Not tried yet, or worth one more look a little later; and not loading right now. */
  function loadDue(key: string, entry: ArtworkEntry | undefined): boolean {
    const due =
      !entry || (entry.attempts < ARTWORK_ATTEMPTS && now() - entry.at >= ARTWORK_RETRY_SEC)
    return due && !loadingArtwork.has(key)
  }

  /** The cover of the song up next, loaded the same way (and kept with the others). */
  function nextCoverFor(choice: PlayerChoice): string | null {
    if (choice.kind !== 'player' || choice.snapshot.status === 'stopped') return null
    const next = choice.snapshot.next
    if (!next?.artworkRef) return null
    const key = `${choice.player}:next:${next.artworkRef}`
    const entry = artwork.get(key)
    if (entry?.url) return entry.url
    if (loadDue(key, entry)) loadCover(choice.player, { id: key, album: '', ...next }, key, entry)
    return null
  }

  function loadCover(
    player: PlayerId,
    track: AdapterTrack,
    key: string,
    entry: ArtworkEntry | undefined
  ): void {
    const adapter = owners.get(player)
    if (!adapter) return
    loadingArtwork.add(key)
    adapter
      .loadArtwork(player, track)
      .then((bytes) => (bytes ? toArtwork(bytes) : null))
      .catch((error: unknown) => {
        console.warn(`[music] Could not load the cover from ${player}.`, error)
        return null
      })
      .then((url) => {
        loadingArtwork.delete(key)
        if (disposed) return
        artwork.delete(key)
        artwork.set(key, { url, at: now(), attempts: (entry?.attempts ?? 0) + 1 })
        // Maps keep insertion order, so the first key is the least recently loaded.
        if (artwork.size > ARTWORK_CACHE_SIZE) {
          const oldest = artwork.keys().next().value
          if (oldest !== undefined) artwork.delete(oldest)
        }
        refresh()
      })
  }

  function runCommand(command: MusicCommand): void {
    const player = state.player?.id
    const adapter = player ? owners.get(player) : undefined
    if (!player || !adapter || !state.track) return
    if (command.kind === 'setRepeat' && !state.repeatModes.includes(command.mode)) return
    if (command.kind === 'seek' && !canSeek(state.track)) return
    const adapterCommand =
      command.kind === 'previous'
        ? previousCommand(positionAt(state, now()))
        : command.kind === 'seek'
          ? { ...command, positionSec: Math.min(command.positionSec, seekEnd(state.track)) }
          : command
    // Show the press right away; the player's next reading confirms it (or takes it back).
    expectation = expectationFor(state, adapterCommand, now())
    if (expectation) refresh()
    adapter
      .command(player, adapterCommand)
      .then((report) => {
        if (report) ingest(report)
      })
      .catch((error: unknown) => {
        console.warn(`[music] ${command.kind} failed in ${player}.`, error)
      })
  }

  for (const adapter of allAdapters) adapter.start(ingest)

  return {
    get: () => state,
    command: runCommand,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hasDemo: demo !== null,
    isDemoEnabled: () => demoEnabled,
    setDemoEnabled(on) {
      if (!demo || on === demoEnabled) return
      demoEnabled = on
      refresh()
    },
    dispose() {
      disposed = true
      for (const adapter of allAdapters) adapter.dispose()
      listeners.clear()
    }
  }
}
