// Each card's status dot, shared with the renderer. Keep this file free of imports: the
// renderer compiles it too.

/** ok: green, connected. problem: red, needs a look. none: grey, nothing to connect. */
export type StatusTone = 'ok' | 'problem' | 'none'

export interface CardStatus {
  tone: StatusTone
  /** One line per source, for the dot's menu and label: "YouTube Music in Safari: connected". */
  lines: string[]
}

export interface CardStatuses {
  music: CardStatus
  todos: CardStatus
  timer: CardStatus
}

export const NO_STATUS: CardStatuses = {
  music: { tone: 'none', lines: [] },
  todos: { tone: 'none', lines: [] },
  timer: { tone: 'none', lines: [] }
}

/**
 * A card's menu, as the dot's glass menu draws it: plain data, made in main from the same items
 * as the app menu. Picking sends the entry's id back with the menu's `token`.
 */
export type CardMenuEntry =
  | { kind: 'separator' }
  | {
      kind: 'item'
      id: string
      label: string
      enabled: boolean
      /** null: not a checkbox. */
      checked: boolean | null
      /** "⌘L" on a Mac, "Ctrl+L" on Windows; null without one. */
      shortcut: string | null
    }
  | { kind: 'submenu'; id: string; label: string; enabled: boolean; entries: CardMenuEntry[] }

export interface CardMenu {
  /** Which opening of the menu this is; a pick from an older one is ignored. */
  token: number
  /** The card's status lines, shown above its items. */
  lines: string[]
  entries: CardMenuEntry[]
}
