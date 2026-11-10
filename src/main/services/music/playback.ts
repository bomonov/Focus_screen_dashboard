import type {
  AdapterCommand,
  AdapterTrack,
  PlayerInfo,
  PlayerReport,
  PlayerSnapshot
} from './adapter'
import {
  positionAt,
  type PlaybackState,
  type PlayerId,
  type RepeatMode,
  type Track,
  type UpNext
} from './types'

/** "Previous" past this point restarts the song, like the buttons in Spotify and Music. */
export const RESTART_AFTER_SEC = 3
/**
 * A reading this far off from where the last one said we'd be is a seek (or a stall) worth
 * pushing. Smaller drift is just read timing; the renderer counts on from the anchor anyway.
 */
export const POSITION_TOLERANCE_SEC = 1
/** How long a pressed button shows its result before the player has to confirm it. */
export const EXPECTATION_SEC = 2.5

type OpenReport = PlayerReport & { kind: 'open' }

export type PlayerChoice =
  | { kind: 'player'; player: PlayerId; snapshot: PlayerSnapshot; at: number }
  | { kind: 'denied'; player: PlayerId }
  | { kind: 'none' }

function isOpen(report: PlayerReport | null | undefined): report is OpenReport {
  return report?.kind === 'open'
}

function hasSong(report: OpenReport): boolean {
  return report.snapshot.status !== 'stopped' && report.snapshot.track !== null
}

/**
 * Which player the card shows. Playing beats paused. Among paused ones, the one you listened
 * to last wins, so pausing your music doesn't hand the card to an app that's merely open.
 * Otherwise the one shown last stays, so the card doesn't flip between players. The demo only
 * stands in when no real player is open at all.
 *
 * @param real reports in priority order, for ties nothing else settles
 * @param lastPlayed when each player was last seen playing (Unix seconds)
 */
export function choosePlayer(
  real: readonly PlayerReport[],
  demo: PlayerReport | null,
  lastShown: PlayerId | null,
  lastPlayed: ReadonlyMap<PlayerId, number> = new Map()
): PlayerChoice {
  const open = real.filter(isOpen)
  const withSong = open.filter(hasSong)
  const playing = withSong.filter((report) => report.snapshot.status === 'playing')
  const choose = (report: OpenReport | undefined): PlayerChoice =>
    report
      ? { kind: 'player', player: report.player, snapshot: report.snapshot, at: report.at }
      : { kind: 'none' }
  const pick = (list: readonly OpenReport[]): PlayerChoice =>
    choose(list.find((r) => r.player === lastShown) ?? list[0])
  const latestPlayed = (list: readonly OpenReport[]): OpenReport | undefined =>
    list
      .filter((r) => lastPlayed.has(r.player))
      .sort((a, b) => (lastPlayed.get(b.player) ?? 0) - (lastPlayed.get(a.player) ?? 0))[0]

  if (playing.length > 0) return pick(playing)
  if (withSong.length > 0) {
    const recent = latestPlayed(withSong)
    return recent ? choose(recent) : pick(withSong)
  }
  // A player we can't read might be the one playing, so its problem outranks an idle player.
  const denied = real.find((report) => report.kind === 'denied')
  if (denied) return { kind: 'denied', player: denied.player }
  if (open.length > 0) return pick(open)
  if (isOpen(demo)) return pick([demo])
  return { kind: 'none' }
}

export interface StateInputs {
  choice: PlayerChoice
  info: (player: PlayerId) => PlayerInfo
  /** Cover for the chosen song, if loaded. */
  artwork: string | null
  /** Cover for the song up next, if loaded. */
  nextArtwork?: string | null
  supportedPlayers: string[]
  now: number
}

function toTrack(track: AdapterTrack, artwork: string | null): Track {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationSec: track.durationSec,
    artwork
  }
}

export function toPlaybackState({
  choice,
  info,
  artwork,
  nextArtwork = null,
  supportedPlayers,
  now
}: StateInputs): PlaybackState {
  const empty: PlaybackState = {
    player: null,
    track: null,
    playing: false,
    positionSec: 0,
    positionAt: now,
    shuffle: false,
    repeat: 'off',
    repeatModes: ['off', 'all'],
    problem: null,
    supportedPlayers
  }

  if (choice.kind === 'none') return empty
  const { id, name, repeatModes } = info(choice.player)
  if (choice.kind === 'denied') {
    return {
      ...empty,
      player: { id, name },
      problem: { kind: 'automationDenied', playerName: name }
    }
  }

  const { snapshot } = choice
  const track = snapshot.status === 'stopped' ? null : snapshot.track
  return {
    player: { id, name },
    track: track ? toTrack(track, artwork) : null,
    playing: track !== null && snapshot.status === 'playing',
    positionSec: track ? snapshot.positionSec : 0,
    positionAt: choice.at,
    shuffle: snapshot.shuffle,
    // A player can report a mode its script can't set (Music's "one" is fine, Spotify has none).
    repeat: repeatModes.includes(snapshot.repeat) ? snapshot.repeat : 'off',
    repeatModes: [...repeatModes],
    problem: null,
    supportedPlayers,
    playlistId: snapshot.playlistId,
    next:
      track && snapshot.next
        ? {
            title: snapshot.next.title,
            artist: snapshot.next.artist,
            durationSec: snapshot.next.durationSec,
            artwork: nextArtwork
          }
        : null
  }
}

function sameTrack(a: Track | null, b: Track | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.durationSec === b.durationSec &&
    a.artwork === b.artwork
  )
}

function sameUpNext(a: UpNext | null, b: UpNext | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.durationSec === b.durationSec &&
    a.artwork === b.artwork
  )
}

/**
 * Whether `next` tells the renderer anything new. Position readings that agree with the last
 * anchor aren't news, so a playing song costs no IPC between real changes.
 */
export function playbackChanged(prev: PlaybackState, next: PlaybackState): boolean {
  const same =
    prev.player?.id === next.player?.id &&
    prev.player?.name === next.player?.name &&
    sameTrack(prev.track, next.track) &&
    prev.playing === next.playing &&
    prev.shuffle === next.shuffle &&
    prev.repeat === next.repeat &&
    prev.repeatModes.join() === next.repeatModes.join() &&
    prev.problem?.kind === next.problem?.kind &&
    prev.problem?.playerName === next.problem?.playerName &&
    prev.supportedPlayers.join() === next.supportedPlayers.join() &&
    prev.playlistId === next.playlistId &&
    sameUpNext(prev.next ?? null, next.next ?? null)
  if (!same) return true
  if (next.track === null) return false
  const expected = positionAt(prev, next.positionAt)
  return Math.abs(expected - next.positionSec) > POSITION_TOLERANCE_SEC
}

export function previousCommand(positionSec: number): AdapterCommand {
  return positionSec > RESTART_AFTER_SEC ? { kind: 'restart' } : { kind: 'previous' }
}

/** What a button press should change on screen, shown at once until the player confirms it. */
export interface Expectation {
  player: PlayerId
  playing: boolean | null
  repeat: RepeatMode | null
  shuffle: boolean | null
  /** Where a jump put the song: `sec` into it at `at` (Unix epoch seconds). */
  position: { sec: number; at: number } | null
  /** Unix epoch seconds; after this the player's own readings win again. */
  until: number
}

export function expectationFor(
  shown: PlaybackState,
  command: AdapterCommand,
  now: number
): Expectation | null {
  if (!shown.player || !shown.track) return null
  const none = {
    player: shown.player.id,
    playing: null,
    repeat: null,
    shuffle: null,
    position: null,
    until: now + EXPECTATION_SEC
  }
  switch (command.kind) {
    case 'playPause':
      return { ...none, playing: !shown.playing }
    case 'setRepeat':
      return { ...none, repeat: command.mode }
    case 'setShuffle':
      return { ...none, shuffle: command.on }
    case 'seek':
      return { ...none, position: { sec: command.positionSec, at: now } }
    default:
      // Skipping shows nothing new until the player says which song comes next.
      return null
  }
}

/**
 * Lays a pending button press over a fresh reading, so buttons answer instantly even when the
 * player takes a moment. Whatever the reading already agrees with is confirmed and dropped;
 * a press the player never confirms gives way to its readings after EXPECTATION_SEC.
 *
 * @param shown what's on screen now, for where a paused or resumed song should sit
 */
export function applyExpectation(
  reading: PlaybackState,
  shown: PlaybackState,
  expectation: Expectation | null,
  now: number
): { state: PlaybackState; pending: Expectation | null } {
  if (
    !expectation ||
    now > expectation.until ||
    reading.player?.id !== expectation.player ||
    !reading.track
  ) {
    return { state: reading, pending: null }
  }
  let state = reading
  const pending = { ...expectation }

  if (pending.playing !== null) {
    if (reading.playing === pending.playing) pending.playing = null
    else {
      state = {
        ...state,
        playing: pending.playing,
        positionSec: positionAt(shown, now),
        positionAt: now
      }
    }
  }
  if (pending.repeat !== null) {
    if (reading.repeat === pending.repeat) pending.repeat = null
    else state = { ...state, repeat: pending.repeat }
  }
  if (pending.shuffle !== null) {
    if (reading.shuffle === pending.shuffle) pending.shuffle = null
    else state = { ...state, shuffle: pending.shuffle }
  }
  if (pending.position !== null) {
    // Where the jump has got to by now, counting on while the song plays.
    const sincePosition = state.playing ? Math.max(0, now - pending.position.at) : 0
    const expected = pending.position.sec + sincePosition
    if (Math.abs(positionAt(reading, now) - expected) <= POSITION_TOLERANCE_SEC) {
      pending.position = null
    } else {
      state = { ...state, positionSec: expected, positionAt: now }
    }
  }

  const waiting =
    pending.playing !== null ||
    pending.repeat !== null ||
    pending.shuffle !== null ||
    pending.position !== null
  return { state, pending: waiting ? pending : null }
}
