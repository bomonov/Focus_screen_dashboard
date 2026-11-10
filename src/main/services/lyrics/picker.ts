// "Pick Other Lyrics…": the list of a song's LRCLIB versions the user can choose from, as main
// holds it for the Focus Screen to show (widgets/music/LyricsPicker). The rows come from LRCLIB
// (with VocaDB's other names for the song); a pick goes to the lyrics service, which keeps it.
import type { SongLyrics } from './chain'
import type { VersionsResult } from './lrclib'
import type { PickStore } from './picks'
import type { LyricsPickerCommand, LyricsPickerState, PickerRow, PickerTag } from './pickerTypes'
import type { LyricsService } from './service'
import { ownLyricsOf, type Lyrics } from './types'
import { sameLyrics, type LyricsVersion } from './versions'

export interface LyricsPickerDeps {
  lyrics: Pick<LyricsService, 'get' | 'subscribe' | 'currentSong' | 'pick'>
  songs: Pick<SongLyrics, 'versions' | 'search'>
  picks: Pick<PickStore, 'get'>
  /** Lyrics shown at all (Music › Show Lyrics). */
  visible(): boolean
  /** Whether auto-sync can time the words here. */
  listen(): LyricsPickerState['listen']
}

export interface LyricsPicker {
  get(): LyricsPickerState
  subscribe(listener: (state: LyricsPickerState) => void): () => void
  command(command: LyricsPickerCommand): Promise<void>
  /** A real song is on with lyrics shown: the menu item is enabled. */
  canOpen(): boolean
  dispose(): void
}

/** Typed words searched for: more than any title needs. */
const MAX_SEARCH = 200
const UNREACHABLE = 'Can’t reach LRCLIB right now'
const NO_VERSIONS = 'LRCLIB has no versions of this song'
const NOTHING_FOUND = 'Nothing on LRCLIB for that'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** What the page sends is untrusted like any renderer message. */
export function parseLyricsPickerCommand(raw: unknown): LyricsPickerCommand | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'open':
    case 'close':
    case 'listen':
    case 'none':
    case 'automatic':
      return { kind: raw.kind }
    case 'pick':
      return typeof raw.id === 'number' && Number.isInteger(raw.id) && raw.id > 0
        ? { kind: 'pick', id: raw.id }
        : null
    case 'search': {
      if (typeof raw.text !== 'string') return null
      const text = raw.text.trim().slice(0, MAX_SEARCH)
      return text ? { kind: 'search', text } : null
    }
    default:
      return null
  }
}

/**
 * A version this far from the song's length is another song with the same name (LRCLIB lists any
 * "One Last Time"), or a whole album uploaded as one track. The singers' own (or the original's)
 * may be an edit of it; anyone else's is a cover only when it's sung over the same track, so
 * within a few seconds.
 */
const LENGTH_SPREAD_SEC = 30
const OTHERS_SPREAD_SEC = 10

const isShowing = (version: LyricsVersion, showing: Lyrics | null): boolean =>
  showing !== null &&
  (showing.from ? showing.from.id === version.id : sameLyrics(showing, version.lyrics))

/**
 * The versions worth a row, in their order: each set of lyrics once (LRCLIB repeats a song under
 * every compilation it's on), none of another length, and always the one showing now.
 */
function worthListing(
  found: readonly LyricsVersion[],
  showing: Lyrics | null,
  songSec: number
): LyricsVersion[] {
  const listed: LyricsVersion[] = []
  for (const version of found) {
    const shown = isShowing(version, showing)
    const offLength =
      songSec > 0 &&
      version.durationSec > 0 &&
      Math.abs(version.durationSec - songSec) >
        (version.credit === null ? OTHERS_SPREAD_SEC : LENGTH_SPREAD_SEC)
    if (offLength && !shown) continue
    const twin = listed.findIndex((kept) => sameLyrics(kept.lyrics, version.lyrics))
    if (twin < 0) listed.push(version)
    // The one showing stands for its twins, so "showing now" is never lost among them.
    else if (shown) listed[twin] = version
  }
  return listed
}

function rowFor(version: LyricsVersion, showing: Lyrics | null): PickerRow {
  const tags: PickerTag[] = []
  if (version.credit === 'singers') tags.push('same singers')
  if (version.credit === 'others') tags.push('the original')
  if (isShowing(version, showing)) tags.push('showing now')
  return {
    id: version.id,
    title: version.title,
    artist: version.artist,
    album: version.album,
    durationSec: version.durationSec,
    kind: version.lyrics.kind,
    tags
  }
}

export function createLyricsPicker(deps: LyricsPickerDeps): LyricsPicker {
  const closed = (): LyricsPickerState => ({
    open: false,
    busy: null,
    song: null,
    rows: [],
    picked: 'automatic',
    listen: deps.listen(),
    message: null
  })
  let state = closed()
  /** The song the list is for, and the versions behind its rows. */
  let forSong: { key: string; trackId: string } | null = null
  let versions = new Map<number, LyricsVersion>()
  const listeners = new Set<(state: LyricsPickerState) => void>()

  function set(change: Partial<LyricsPickerState>): void {
    state = { ...state, ...change }
    for (const listener of listeners) listener(state)
  }

  function close(): void {
    forSong = null
    versions = new Map()
    set(closed())
  }

  /** Still the song the list was opened for. */
  function stillOn(song: { key: string; trackId: string } | null): boolean {
    const now = deps.lyrics.currentSong()
    return song !== null && now?.key === song.key && now.trackId === song.trackId
  }

  /** The lyrics showing for the song, as LRCLIB has them: without the lines the user added. */
  function showing(): Lyrics | null {
    const shown = deps.lyrics.get()
    return shown.trackId === forSong?.trackId ? ownLyricsOf(shown) : null
  }

  /**
   * `searched`: the user's own words found these, so none is left out for its length (a TV-size
   * edit may be just what they're after).
   */
  function fill(result: VersionsResult, searched: boolean): void {
    if (result.kind === 'unavailable') {
      set({ busy: null, rows: [], message: UNREACHABLE })
      return
    }
    const current = showing()
    const songSec = searched ? 0 : (state.song?.durationSec ?? 0)
    const listed = worthListing(result.versions, current, songSec)
    versions = new Map(listed.map((version) => [version.id, version]))
    set({
      busy: null,
      rows: listed.map((version) => rowFor(version, current)),
      message: listed.length > 0 ? null : searched ? NOTHING_FOUND : NO_VERSIONS
    })
  }

  function canOpen(): boolean {
    return deps.visible() && deps.lyrics.currentSong()?.cacheable === true
  }

  async function open(): Promise<void> {
    const song = deps.lyrics.currentSong()
    if (!song || !canOpen()) return
    forSong = { key: song.key, trackId: song.trackId }
    const mine = forSong
    const pick = deps.picks.get(song.key)
    set({
      open: true,
      busy: 'loading',
      song: {
        title: song.query.title,
        artist: song.query.artist,
        durationSec: song.query.durationSec
      },
      rows: [],
      picked: pick === null ? 'automatic' : pick.kind,
      listen: deps.listen(),
      message: null
    })
    const result = await deps.songs.versions(song.query)
    if (forSong !== mine || !stillOn(mine)) return
    fill(result, false)
  }

  async function search(text: string): Promise<void> {
    const song = deps.lyrics.currentSong()
    const mine = forSong
    if (!song || !stillOn(mine)) return
    set({ busy: 'searching', message: null })
    const result = await deps.songs.search(song.query, text)
    if (forSong !== mine || !stillOn(mine)) return
    fill(result, true)
  }

  // A new song closes the list: a pick is only ever for the song it was opened for.
  const stopLyrics = deps.lyrics.subscribe(() => {
    if (state.open && !stillOn(forSong)) close()
  })

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    canOpen,
    async command(command) {
      if (command.kind === 'close') {
        close()
        return
      }
      if (command.kind === 'open') {
        await open()
        return
      }
      // Only for the song the list was opened for. The bottom row works while it's still
      // looking (LRCLIB can be slow); a pick or a search waits for the list.
      if (!state.open || !stillOn(forSong)) {
        if (state.open) close()
        return
      }
      if (state.busy !== null && (command.kind === 'pick' || command.kind === 'search')) return
      switch (command.kind) {
        case 'pick': {
          const version = versions.get(command.id)
          if (!version) return
          deps.lyrics.pick({ kind: 'version', id: command.id }, version)
          close()
          return
        }
        case 'listen':
          if (state.listen !== 'ready') return
          deps.lyrics.pick({ kind: 'listen' })
          close()
          return
        case 'none':
          deps.lyrics.pick({ kind: 'none' })
          close()
          return
        case 'automatic':
          deps.lyrics.pick(null)
          close()
          return
        case 'search':
          await search(command.text)
          return
      }
    },
    dispose() {
      stopLyrics()
      listeners.clear()
    }
  }
}
