import type {
  Lyrics,
  LyricsColors,
  LyricsState,
  RomajiSource,
  SyncedLine,
  Track
} from '../../../main/ipc'
import { AD_TRACK_ID } from '../../../main/services/music/types'

/** Lyrics that fill the panel under the record. */
export type ShownLyrics = Extract<Lyrics, { kind: 'synced' | 'plain' }>

/**
 * What the music card shows under the song. "lyrics" with null lyrics is a lookup in progress:
 * the panel stays up so a song with lyrics doesn't jump the layout twice. Everything else is
 * the larger record, with a short note saying why there are no lyrics.
 */
export type LyricsLayout =
  | {
      kind: 'lyrics'
      lyrics: ShownLyrics | null
      /** Romaji under each line (same index; '' under a line without), or null. */
      romaji: string[] | null
      romajiFrom?: RomajiSource
      /** Who sings what, when the user colored the song (one entry per line, like the romaji). */
      colors?: LyricsColors
    }
  | { kind: 'art'; note: string | null }

const ART: LyricsLayout = { kind: 'art', note: null }
const LOADING: LyricsLayout = { kind: 'lyrics', lyrics: null, romaji: null }

export function lyricsLayout(
  showLyrics: boolean,
  track: Track | null,
  state: LyricsState | null
): LyricsLayout {
  if (!showLyrics || !track || track.id === AD_TRACK_ID) return ART
  // The song changed and its lyrics haven't arrived from the main process yet.
  if (!state || state.trackId !== track.id) return state?.status === 'idle' ? ART : LOADING
  switch (state.status) {
    case 'loading':
      return LOADING
    case 'found':
      if (state.lyrics?.kind === 'synced' || state.lyrics?.kind === 'plain') {
        // Only romaji and colors that line up with these lines, never a stale push's.
        const count = state.lyrics.lines.length
        const romaji = state.romaji?.length === count ? state.romaji : null
        const colors = state.colors?.lines.length === count ? state.colors : null
        return {
          kind: 'lyrics',
          lyrics: state.lyrics,
          romaji,
          ...(romaji && state.romajiFrom ? { romajiFrom: state.romajiFrom } : {}),
          ...(colors ? { colors } : {})
        }
      }
      return { kind: 'art', note: 'Instrumental' }
    case 'notFound':
      // YouTube Music has its own lyrics for many songs; the extension reads them from its tab.
      return {
        kind: 'art',
        note: track.id.startsWith('ytm:')
          ? 'No lyrics found · open YouTube Music’s Lyrics tab to use its lyrics'
          : 'No lyrics found'
      }
    case 'unavailable':
      return { kind: 'art', note: 'Lyrics unavailable · can’t reach the lyrics sites' }
    case 'idle':
      return ART
  }
}

/**
 * Song positions where the line on screen changes, for waking up exactly then. A second voice's
 * start and end count too: it lights on its own, also where it runs on past its main line.
 */
export function lineChanges(
  lines: readonly SyncedLine[],
  offsetSec: number,
  voices: LyricsColors['voices'] = []
): number[] {
  const changes = lines.map((line) => line.timeSec - offsetSec)
  if (voices.length === 0) return changes
  for (const voice of voices) {
    const first = voice.words[0]
    const last = voice.words.at(-1)
    if (first && last) changes.push(first.start - offsetSec, last.end - offsetSec)
  }
  return changes.sort((a, b) => a - b)
}

/**
 * Whether the user's coloring shows anywhere: a word or a second voice given a singer. A song
 * just begun in the editor has every line coded and nobody in it yet.
 */
export function colorsShown(colors: LyricsColors | null | undefined): boolean {
  if (!colors) return false
  const sung = (words: readonly (string[] | null)[] | null): boolean =>
    words?.some(Boolean) ?? false
  return colors.lines.some(sung) || colors.voices.some((voice) => sung(voice.singers))
}

/** "0.5 s earlier", "1 s later"; null when there's no offset. */
export function formatOffset(offsetSec: number): string | null {
  if (offsetSec === 0) return null
  const amount = Math.abs(offsetSec).toFixed(1).replace(/\.0$/, '')
  return `${amount} s ${offsetSec > 0 ? 'earlier' : 'later'}`
}

/** Auto-sync working on the song on screen: listening to it, or lining the words up. */
export interface AutoSyncProgress {
  stage: 'listening' | 'aligning'
  /** 0–1 of the song heard. */
  heard: number
  /** Live sync is lighting the line being sung (first play, an estimate). */
  live?: boolean
}

/** "auto-syncing · 40% heard", for plain lyrics that are being timed. */
function autoSyncNote(progress: AutoSyncProgress): string {
  return progress.stage === 'aligning'
    ? 'timing the lines…'
    : `${progress.live ? 'following live' : 'auto-syncing'} · ${Math.floor(progress.heard * 10) * 10}% heard`
}

function wordTimingNote(progress: AutoSyncProgress): string {
  return progress.stage === 'aligning'
    ? 'timing the words…'
    : `adding word timing · ${Math.floor(progress.heard * 10) * 10}% heard`
}

/** "YouTube Music · Musixmatch": the page, and who it licensed the words from. */
function youTubeMusic(credit: string | undefined): string {
  return credit ? `YouTube Music · ${credit}` : 'YouTube Music'
}

/** Who to credit for the lines. VocaDB asks to be named, also when we timed its words. */
function sourceNote(lyrics: ShownLyrics): string {
  switch (lyrics.source) {
    case 'lrclib':
      return 'LRCLIB'
    case 'vocadb':
      return 'VocaDB'
    case 'ytmusic':
      return youTubeMusic(lyrics.credit)
    case 'autosync':
      if (lyrics.kind === 'synced' && lyrics.wordsFrom === 'vocadb') {
        return 'VocaDB · Auto-synced (estimate)'
      }
      return lyrics.kind === 'synced' && lyrics.wordsFrom === 'ytmusic'
        ? `${youTubeMusic(lyrics.credit)} · Auto-synced (estimate)`
        : 'Auto-synced (estimate)'
    case 'demo':
      return 'Demo'
  }
}

/**
 * "Synced lyrics · LRCLIB", the mockup's note under the lines, plus who the romaji came from,
 * any timing fix, or how far auto-sync has got with plain lyrics.
 */
export function lyricsCaption(
  lyrics: ShownLyrics | null,
  offsetSec: number,
  autoSync: AutoSyncProgress | null = null,
  romaji: RomajiSource | null = null,
  colored = false
): string {
  if (!lyrics) return 'Looking up lyrics'
  const source = sourceNote(lyrics)
  // VocaDB asks to be credited, but once is enough; the demo's romaji is its own.
  const credited = source.startsWith('VocaDB') || lyrics.source === 'demo'
  const romajiNote =
    romaji === 'dictionary'
      ? ['romaji made on this computer']
      : romaji === 'both'
        ? [
            credited
              ? 'with romaji, some made on this computer'
              : 'romaji · VocaDB, some made on this computer'
          ]
        : romaji
          ? [credited ? 'with romaji' : 'romaji · VocaDB']
          : []
  // The words keep their source's credit when the user colored (and timed) them.
  const colorsNote = colored ? ['colors by you'] : []
  // Auto-synced lyrics being timed again (for word timing) say so while it's under way.
  const parts =
    lyrics.kind === 'synced'
      ? [
          'Synced lyrics',
          source,
          ...romajiNote,
          ...colorsNote,
          ...(autoSync ? [wordTimingNote(autoSync)] : [])
        ]
      : [
          'Lyrics',
          source,
          ...romajiNote,
          ...colorsNote,
          autoSync ? autoSyncNote(autoSync) : 'not synced'
        ]
  const offset = lyrics.kind === 'synced' ? formatOffset(offsetSec) : null
  return [...parts, ...(offset ? [offset] : [])].join(' · ')
}
