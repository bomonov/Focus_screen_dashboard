// Display types shared with the renderer.
// Keep this file free of runtime imports: the renderer compiles it too.
import type { ShowOn } from '../settings/schema'

/** One "Show on" button on the Customize screen. */
export interface DisplayChoice {
  showOn: ShowOn
  /** "Automatic", "Display 2", "Floating window" */
  label: string
  /** "DELL U2720Q · 2560×1440", or what Automatic picks right now. */
  detail: string
  selected: boolean
  /** A saved display that isn't plugged in: shown so the choice makes sense, but can't be picked. */
  missing: boolean
}

/** What the Focus Screen does to spare the monitor. */
export interface ScreenCare {
  /** Nothing has happened for a while: show only the clock and album art, dimmed. */
  dimmed: boolean
  /** CSS pixels the whole layout is moved by, so nothing stays lit in exactly one spot. */
  shift: { x: number; y: number }
}

/** How choosing a background photo went; a null message means the dialog was cancelled. */
export type PhotoResult = { ok: true } | { ok: false; message: string | null }
