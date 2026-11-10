import type { ColorEditorCommand } from './editorTypes'
import type { ColorEdit } from './types'

// What the editor's page sends is untrusted like any renderer message: off-shape is dropped.

/** Every kind of edit, so a new one can't be left out (the Record has to name them all). */
const EDIT_KINDS = new Set<string>(
  Object.keys({
    assign: true,
    lineTime: true,
    wordTime: true,
    tapTime: true,
    splitWord: true,
    makeVoice: true,
    addVoice: true,
    setCast: true,
    addSinger: true,
    romajiSplits: true,
    newWords: true,
    addLine: true,
    addLines: true,
    addBreak: true,
    retype: true,
    removeLine: true,
    moveLine: true,
    slideLine: true,
    resetTimes: true,
    // Kept here so the Record names every kind; the editor refuses it from the page (`editAllowed`).
    heardTimes: true
  } satisfies Record<ColorEdit['kind'], true>)
)

/** Far past any song's lines or words; a bigger number is nobody's. */
const MAX_INDEX = 100_000
const MAX_SINGER_ID = 200
const MAX_PATH = 4096
/** Far longer than any note main writes. */
const MAX_NOTE = 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_INDEX
}

function isSinger(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SINGER_ID
}

/** A dropped file's full path; anything relative or odd isn't one. */
function isPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_PATH &&
    !value.includes('\0') &&
    (value.startsWith('/') || /^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\'))
  )
}

/**
 * The command, or null when it isn't one. An edit's own fields aren't looked at here:
 * `applyEdit` checks every one of them itself and leaves the coding as it was when they're off.
 */
export function parseColorEditorCommand(raw: unknown): ColorEditorCommand | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'begin':
      return { kind: 'begin', colors: raw.colors }
    case 'edit': {
      const { edit } = raw
      if (!isRecord(edit) || typeof edit.kind !== 'string' || !EDIT_KINDS.has(edit.kind)) {
        return null
      }
      return { kind: 'edit', edit: edit as unknown as ColorEdit }
    }
    case 'undo':
    case 'redo':
    case 'switchToPlaying':
    case 'removeAll':
      return { kind: raw.kind }
    case 'playLine':
    case 'replayLine':
      return isIndex(raw.line) ? { kind: raw.kind, line: raw.line } : null
    case 'listen':
      return isIndex(raw.from) && isIndex(raw.to) && raw.to > raw.from
        ? { kind: 'listen', from: raw.from, to: raw.to }
        : null
    case 'clearNote':
      return typeof raw.note === 'string' && raw.note.length <= MAX_NOTE
        ? { kind: 'clearNote', note: raw.note }
        : null
    case 'tap': {
      if (raw.phase !== 'down' && raw.phase !== 'up') return null
      if (!isIndex(raw.line) || !isIndex(raw.word)) return null
      // Only a press moves a whole line; anything but `true` is a word's tap.
      const whole = raw.phase === 'down' && raw.whole === true
      return {
        kind: 'tap',
        phase: raw.phase,
        line: raw.line,
        word: raw.word,
        ...(whole ? { whole: true as const } : {})
      }
    }
    case 'choosePicture':
    case 'removePicture':
      return isSinger(raw.singer) ? { kind: raw.kind, singer: raw.singer } : null
    case 'pictureFromPath':
      return isSinger(raw.singer) && isPath(raw.path)
        ? { kind: 'pictureFromPath', singer: raw.singer, path: raw.path }
        : null
    default:
      return null
  }
}
