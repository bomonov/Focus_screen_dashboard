import { useRef, useState } from 'react'
import type { CodedLine, ColorEdit, SongColors } from '../../../main/ipc'
import { romajiCuts, type SingerLookup } from '../../widgets/music/singerColors'
import { retypeCheck, retypedLine } from './addLines'
import { cueTime, lineParts, lineRows, resolveSingers } from './lineRows'
import { Painted } from './LineList'
import { RomajiLine } from './RomajiLine'
import { splitPoint, type Selection } from './selection'
import { singerById } from './singers'

/** The text node and offset the browser puts a caret at under the pointer. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  if (typeof document.caretPositionFromPoint === 'function') {
    const position = document.caretPositionFromPoint(x, y)
    return position ? { node: position.offsetNode, offset: position.offset } : null
  }
  const range = document.caretRangeFromPoint(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : null
}

/** The word element a pointer event is over. */
function wordAt(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null
  const element = target.closest<HTMLElement>('[data-word]')
  const index = Number(element?.dataset.word)
  return Number.isInteger(index) ? index : null
}

/**
 * The selected line, big, as the word pieces the Focus Screen lights: press and drag (or
 * Shift-click) selects a run of them, Option-click between two letters splits a word. Under it,
 * "Make second voice" (with part of the line selected), "Add second voice…", "Use the new
 * words" on a changed line, and the romaji with a handle where each singer's part starts. A line
 * the user added also has "Edit words…" (or a double-click on its words) and "Remove line".
 */
export function EditLine({
  colors,
  shownLines,
  lineIndex,
  selection,
  range,
  hexes,
  romaji,
  tapWord,
  isNew,
  aside,
  onSelect,
  onEdit,
  onNewWords
}: {
  colors: SongColors
  /** The lyrics' own lines, for whether an added line is in them now. */
  shownLines: readonly string[]
  lineIndex: number
  selection: Selection
  range: { from: number; to: number } | null
  hexes: SingerLookup
  romaji: string | null
  /** The word J marks next, while tap timing is on. */
  tapWord: number | null
  /** A line the lyrics have that the coding hasn't yet: its first edit adds it. */
  isNew: boolean
  /** Shown at the end of the line's header row ("Time by listening"). */
  aside?: React.ReactNode
  onSelect: (selection: Selection) => void
  /** Sends an edit (a new line is added with it). */
  onEdit: (edit: ColorEdit) => void
  /**
   * A changed line whose new words the lyrics have: takes them. Null while its song isn't
   * playing (they come from the lyrics on screen); undefined for a line that has none.
   */
  onNewWords?: (() => void) | null
}): React.JSX.Element | null {
  const line = colors.lines[lineIndex]
  const dragging = useRef<number | null>(null)
  const [adding, setAdding] = useState(false)
  // The line "Edit words…" was opened on, by its place and text.
  const [retypeOn, setRetypeOn] = useState<string | null>(null)
  if (!line) return null
  const lineKey = `${lineIndex}\n${line.text}`
  // Removed, undone or redone under it, the line it was opened on is gone: the field closes, so
  // its words can't be saved onto the line now in its place.
  if (retypeOn !== null && retypeOn !== lineKey) setRetypeOn(null)
  const retyping = retypeOn === lineKey

  const rows = lineRows(colors, shownLines)
  const row = rows[lineIndex]
  const mainNumber = line.under === undefined ? row?.number : rows[line.under]?.number
  // Only the user's own lines can have their words changed: the lyrics' are matched by theirs.
  const ownWords = row?.added === true && line.under === undefined
  const partial = range !== null && range.to - range.from < line.words.length
  const parts = lineParts(line, colors.cast, hexes)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const word = wordAt(event.target)
    if (word === null) return
    event.preventDefault()
    if (event.altKey) {
      // A word is split so a singer can come in mid-word: the piece after the cut is the one
      // to give them, so it's what's selected (a whole-line selection would now miss a piece).
      if (splitWordAt(line, lineIndex, word, event.clientX, event.clientY, onEdit)) {
        onSelect({ line: lineIndex, anchor: word + 1, focus: word + 1 })
      }
      return
    }
    if (event.shiftKey) {
      onSelect({ line: lineIndex, anchor: selection.anchor, focus: word })
      return
    }
    dragging.current = word
    onSelect({ line: lineIndex, anchor: word, focus: word })
    // Let go anywhere ends the drag, even outside the line.
    window.addEventListener('pointerup', () => (dragging.current = null), { once: true })
  }

  const onPointerOver = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragging.current === null || (event.buttons & 1) === 0) return
    const word = wordAt(event.target)
    if (word !== null && word !== selection.focus) {
      onSelect({ line: lineIndex, anchor: dragging.current, focus: word })
    }
  }

  // A music break has no words to pick or color: it can only be moved (its block) or removed.
  if (line.instrumental) {
    return (
      <section className="edit-line" aria-label="The selected music break">
        <div className="edit-line__head">
          <p className="edit-line__meta">
            Music break · {cueTime(line.start)} – {cueTime(line.end)} · added
          </p>
        </div>
        <p className="edit-line__empty">
          <span aria-hidden="true">♪ </span>
          Nobody sings here: the Focus Screen shows the note filling up until the next line. Drag
          its block on the waveform to move it.
        </p>
        <div className="edit-line__actions">
          <button
            type="button"
            className="lyrics-editor__button"
            // ⌘Z brings it back, so it doesn't ask.
            onClick={() => onEdit({ kind: 'removeLine', line: lineIndex })}
          >
            Remove break
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="edit-line" aria-label="The selected line">
      <div className="edit-line__head">
        <p className="edit-line__meta">
          {line.under === undefined
            ? `Line ${mainNumber ?? ''}`
            : `Second voice under line ${mainNumber ?? ''}`}{' '}
          · {cueTime(line.start)} – {cueTime(line.end)}
          {isNew && ' · new in the lyrics, added once you color it'}
          {row?.added && ' · added'}
          {row?.alsoInLyrics && ' · also in the lyrics now'}
        </p>
        {aside}
      </div>
      {retyping && ownWords ? (
        <Retype
          key={lineKey}
          words={row.text.trim()}
          onSave={(text) => {
            onEdit({ kind: 'retype', line: lineIndex, shown: retypedLine(line, text) })
            setRetypeOn(null)
          }}
          onCancel={() => setRetypeOn(null)}
        />
      ) : (
        <div
          className="edit-line__words"
          role="listbox"
          aria-label="Words: drag or Shift-click to select, Option-click between letters to split"
          aria-multiselectable="true"
          onPointerDown={onPointerDown}
          onPointerOver={onPointerOver}
          onDoubleClick={ownWords ? () => setRetypeOn(lineKey) : undefined}
        >
          {line.words.length === 0 && (
            <span className="edit-line__empty">No words left on this line.</span>
          )}
          {line.words.map((word, i) => {
            const picked = range !== null && i >= range.from && i < range.to
            const singers = resolveSingers(word.singers, colors.cast)
            const shown = word.text.trim()
            return (
              <span
                key={i}
                data-word={i}
                role="option"
                aria-selected={picked}
                className={`edit-word${picked ? ' edit-word--picked' : ''}${tapWord === i ? ' edit-word--tap' : ''}`}
              >
                <Painted
                  text={shown === '' ? '␣' : shown}
                  colors={singers ? hexes(singers) : null}
                />
              </span>
            )
          })}
        </div>
      )}
      {romaji !== null && line.under === undefined && (
        <RomajiLine
          key={lineIndex}
          romaji={romaji}
          lineIndex={lineIndex}
          parts={parts}
          partNames={parts.map((part) => {
            const ids = resolveSingers(line.words[part.from]?.singers ?? null, colors.cast) ?? []
            return ids.map((id) => singerById(id, colors.extra)?.name ?? id).join(' and ')
          })}
          cuts={romajiCuts(
            romaji,
            line.text,
            parts,
            line.words.map((word) => word.text),
            line.romajiSplits ?? null
          )}
          userSet={line.romajiSplits !== undefined}
          onEdit={onEdit}
        />
      )}
      <div className="edit-line__actions">
        {ownWords && !retyping && (
          <button
            type="button"
            className="lyrics-editor__button"
            onClick={() => setRetypeOn(lineKey)}
          >
            Edit words…
          </button>
        )}
        {ownWords && !retyping && (
          <button
            type="button"
            className="lyrics-editor__button"
            title={
              row.alsoInLyrics ? 'Remove this line; the lyrics’ own line shows again' : undefined
            }
            // ⌘Z brings it back, so it doesn't ask.
            onClick={() => onEdit({ kind: 'removeLine', line: lineIndex })}
          >
            Remove line
          </button>
        )}
        {onNewWords !== undefined && (
          <button
            type="button"
            className="lyrics-editor__button"
            disabled={onNewWords === null}
            title={
              onNewWords === null
                ? 'Play the song to use the words its lyrics have now'
                : 'Take the words the lyrics have now, keeping the singers on words that match'
            }
            onClick={() => onNewWords?.()}
          >
            Use the new words
          </button>
        )}
        {partial && range && (
          <button
            type="button"
            className="lyrics-editor__button"
            onClick={() =>
              onEdit({ kind: 'makeVoice', line: lineIndex, from: range.from, to: range.to })
            }
          >
            Make second voice
          </button>
        )}
        {adding ? (
          <AddVoice
            onAdd={(text) => {
              onEdit({ kind: 'addVoice', line: lineIndex, text })
              setAdding(false)
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button type="button" className="lyrics-editor__button" onClick={() => setAdding(true)}>
            Add second voice…
          </button>
        )}
      </div>
    </section>
  )
}

/** Option-click: the word splits where the pointer is between two of its letters. Whether it did. */
function splitWordAt(
  line: CodedLine,
  lineIndex: number,
  word: number,
  x: number,
  y: number,
  onEdit: (edit: ColorEdit) => void
): boolean {
  const text = line.words[word]?.text
  const caret = caretAt(x, y)
  if (text === undefined || !caret || caret.node.nodeType !== Node.TEXT_NODE) return false
  // The piece shows the word without its spaces; the offset is into the word as saved.
  const leading = text.length - text.trimStart().length
  const at = splitPoint(text, caret.offset + leading)
  if (at === null) return false
  onEdit({ kind: 'splitWord', line: lineIndex, word, at })
  return true
}

/**
 * "Edit words…": an added line's words as one field. Enter or Save keeps them, Esc or Cancel
 * leaves them. A blank line can't be saved; a line too long says why.
 */
function Retype({
  words,
  onSave,
  onCancel
}: {
  words: string
  onSave: (text: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [text, setText] = useState(words)
  const check = retypeCheck(text)
  return (
    <form
      className="edit-line__retype"
      onSubmit={(event) => {
        event.preventDefault()
        if (check.text === null) return
        // Unchanged, there's nothing to save: the words keep their own times.
        if (check.text === words) onCancel()
        else onSave(check.text)
      }}
      onKeyDown={(event) => {
        // Esc that ends a Japanese input method's word isn't a cancel.
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      <input
        type="text"
        value={text}
        aria-label="The line’s words"
        // It opens on the user's click, so the typing goes straight in.
        autoFocus
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className="lyrics-editor__button" disabled={check.text === null}>
        Save
      </button>
      <button
        type="button"
        className="lyrics-editor__button lyrics-editor__button--quiet"
        onClick={onCancel}
      >
        Cancel
      </button>
      {check.problem && (
        <span className="edit-line__problem" role="status">
          {check.problem}
        </span>
      )}
    </form>
  )
}

/** "Add second voice…": typed words for a line sung under this one. */
function AddVoice({
  onAdd,
  onCancel
}: {
  onAdd: (text: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  return (
    <form
      className="edit-line__add"
      onSubmit={(event) => {
        event.preventDefault()
        if (text.trim() !== '') onAdd(text.trim())
      }}
      onKeyDown={(event) => {
        // Esc that ends a Japanese input method's word isn't a cancel.
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') onCancel()
      }}
    >
      <input
        type="text"
        value={text}
        aria-label="The second voice's words"
        placeholder="The second voice's words"
        // It opens on the user's click, so the typing goes straight in.
        autoFocus
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className="lyrics-editor__button" disabled={text.trim() === ''}>
        Add
      </button>
      <button
        type="button"
        className="lyrics-editor__button lyrics-editor__button--quiet"
        onClick={onCancel}
      >
        Cancel
      </button>
    </form>
  )
}
