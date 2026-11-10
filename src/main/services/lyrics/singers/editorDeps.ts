import type { BrowserWindow } from 'electron'
import type { StartResult } from '../../autosync/client'
import type { CaptureAccess } from '../../autosync/protocol'

// What the color-coding editor needs from the waveform tap and the character pictures. The
// shapes are the ones `tap.ts` (openSingerTap) and `pictures.ts` (openSingerPictures) produce;
// they're declared here so the editor can be built, and tested with fakes, on its own.

/** The editor's own tap on the music player's audio, opened with the editor and closed with it. */
export interface SingerTap {
  /** Listens to the apps whose bundle IDs start with one of `bundles`, replacing any tap. */
  start(bundles: string[]): Promise<StartResult>
  stop(): void
  /** 16 kHz mono; `at` is the first sample's time in epoch seconds. */
  onAudio(listener: (at: number, samples: Int16Array) => void): () => void
  /** null until the helper says. */
  access(): CaptureAccess | null
  dispose(): void
}

/** Null on Windows, or when the audio helper isn't built. */
export type OpenSingerTap = () => SingerTap | null

export interface SingerPictures {
  /** id → PNG data URL */
  all(): Record<string, string>
  /** Asks for a picture. Closing the chooser isn't a refusal: nothing changes, and it's `ok`. */
  choose(
    win: BrowserWindow | null,
    id: string
  ): Promise<{ ok: true } | { ok: false; message: string }>
  fromPath(id: string, path: string): { ok: true } | { ok: false; message: string }
  remove(id: string): void
  subscribe(listener: () => void): () => void
}
