// Messages inside the extension: page ↔ background ↔ popup. The app protocol is separate.
import type {
  PageCommand,
  PageLyrics,
  PageState
} from '../../src/main/services/music/extension-ws/protocol'

/** Content script → background. */
export interface PageMessage {
  type: 'page'
  /** null when the tab has nothing loaded to play. */
  state: PageState | null
}

/** Content script → background: YouTube Music's own lyrics for the song, once per song. */
export interface PageLyricsMessage {
  type: 'lyrics'
  lyrics: PageLyrics
}

/** The name of the line each YouTube Music tab keeps open to the background (see content.ts). */
export const PAGE_LINE = 'focus-screen-page'

/** Background → content script. */
export type TabMessage = { type: 'command'; command: PageCommand } | { type: 'report' }

/** Popup → background. */
export type PopupRequest = { type: 'status' } | { type: 'pair'; code: string } | { type: 'forget' }

export type ConnectionStatus =
  /** Paired and talking to Focus Screen. */
  | 'connected'
  | 'connecting'
  /** Paired, but Focus Screen isn't running (or isn't reachable). */
  | 'offline'
  | 'unpaired'
  /** The last pairing code was wrong or had expired. */
  | 'badCode'

/** Background → popup. */
export interface PopupStatus {
  status: ConnectionStatus
  /** The song being sent, if any. */
  song: string | null
  /** Why the last attempt failed, in words for the user. */
  error: string | null
}

/** Picks out the extension API in either browser. */
export const ext: WebExtApi = typeof browser !== 'undefined' && browser ? browser : chrome
