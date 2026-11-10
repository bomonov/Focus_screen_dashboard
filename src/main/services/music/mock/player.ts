// The demo player's state machine: pure, so it can be tested without timers.
import type { AdapterCommand, AdapterTrack, PlayerSnapshot } from '../adapter'
import type { RepeatMode } from '../types'

/** The mockup's songs. No covers: the card draws its generated one, as in the mockup. */
export const DEMO_TRACKS: readonly AdapterTrack[] = [
  {
    id: 'demo:low-sun-hours',
    title: 'Low Sun Hours',
    artist: 'The Saguaro Set',
    album: 'Night Shift Sessions',
    durationSec: 213,
    artworkRef: null
  },
  {
    id: 'demo:quiet-library',
    title: 'Quiet Library',
    artist: 'Lofi Desk Club',
    album: 'Study Hall',
    durationSec: 187,
    artworkRef: null
  },
  {
    id: 'demo:monsoon-drive',
    title: 'Monsoon Drive',
    artist: 'Mesa Lights',
    album: 'Late Summer',
    durationSec: 241,
    artworkRef: null
  },
  {
    // Japanese, with romaji and a held word: the sung line's light-up, offline.
    id: 'demo:hoshizora-letter',
    title: '星空レター',
    artist: 'Tempe Night Choir',
    album: 'Desert Radio',
    durationSec: 196,
    artworkRef: null
  }
]

export interface DemoState {
  index: number
  /** Position banked before `since`. */
  positionSec: number
  /** When playback last started (epoch seconds); null when paused. */
  since: number | null
  shuffle: boolean
  repeat: RepeatMode
}

export function initialDemoState(now: number): DemoState {
  // Part-way into the first song, like the mockup.
  return { index: 0, positionSec: 84, since: now, shuffle: false, repeat: 'off' }
}

function trackAt(index: number): AdapterTrack {
  const track = DEMO_TRACKS[index]
  if (!track) throw new Error(`No demo track ${index}`)
  return track
}

function positionNow(state: DemoState, now: number): number {
  return state.positionSec + (state.since === null ? 0 : Math.max(0, now - state.since))
}

/** Shuffle never picks the song that just played. */
function following(state: DemoState, random: () => number): number {
  const count = DEMO_TRACKS.length
  if (!state.shuffle) return (state.index + 1) % count
  return (state.index + 1 + Math.floor(random() * (count - 1))) % count
}

/** Plays through song ends that happened by `now`, honoring repeat and shuffle. */
export function advanceDemo(state: DemoState, now: number, random = Math.random): DemoState {
  let next = state
  // A paused player goes nowhere; a playing one may cross several ends after a long sleep.
  while (next.since !== null) {
    const duration = trackAt(next.index).durationSec
    const endsAt = next.since + (duration - next.positionSec)
    if (endsAt > now) break
    const index = next.repeat === 'one' ? next.index : following(next, random)
    next = { ...next, index, positionSec: 0, since: endsAt }
  }
  return next
}

export function applyDemoCommand(
  state: DemoState,
  command: AdapterCommand,
  now: number,
  random = Math.random
): DemoState {
  const current = advanceDemo(state, now, random)
  const playing = current.since !== null
  switch (command.kind) {
    case 'playPause':
      return playing
        ? { ...current, positionSec: positionNow(current, now), since: null }
        : { ...current, since: now }
    case 'next':
      return {
        ...current,
        index: following(current, random),
        positionSec: 0,
        since: playing ? now : null
      }
    case 'previous': {
      const count = DEMO_TRACKS.length
      const index = (current.index + count - 1) % count
      return { ...current, index, positionSec: 0, since: playing ? now : null }
    }
    case 'restart':
      return { ...current, positionSec: 0, since: playing ? now : null }
    case 'seek':
      return { ...current, positionSec: command.positionSec, since: playing ? now : null }
    case 'setShuffle':
      return { ...current, shuffle: command.on }
    case 'setRepeat':
      return { ...current, repeat: command.mode }
  }
}

/** What the demo reports at `now`. Advance the state to `now` first, so shuffle picks stick. */
export function demoSnapshot(state: DemoState, now: number): PlayerSnapshot {
  // Shuffle picks the next song as this one ends, so only then is it known.
  const upNext =
    state.shuffle || state.repeat === 'one' ? null : trackAt((state.index + 1) % DEMO_TRACKS.length)
  return {
    status: state.since === null ? 'paused' : 'playing',
    track: trackAt(state.index),
    positionSec: positionNow(state, now),
    shuffle: state.shuffle,
    repeat: state.repeat,
    next: upNext
      ? {
          title: upNext.title,
          artist: upNext.artist,
          durationSec: upNext.durationSec,
          artworkRef: null
        }
      : null
  }
}
