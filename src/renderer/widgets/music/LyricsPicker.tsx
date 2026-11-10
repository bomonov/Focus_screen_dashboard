import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type {
  LyricsPickerCommand,
  LyricsPickerState,
  PickerTag
} from '../../../main/services/lyrics/pickerTypes'
import { CheckIcon } from '../cardMenu/CardMenu'
import type { Box } from '../cardMenu/cardMenuMotion'
import { remPx } from '../cardMenu/cardMenuPrepare'
import { PeekCard, type PeekCardHandle } from '../peek/PeekCard'
import {
  footActions,
  formatLength,
  pickerHeading,
  rowDetail,
  SEARCH_MAX,
  sameLength,
  searchText,
  statusLine,
  type FootAction
} from './pickerRows'
import './LyricsPicker.css'

/** The card's width in LyricsPicker.css, to center it when there's nothing to grow out of. */
const WIDTH_REM = 34

const TONE: Record<PickerTag, string> = {
  'same singers': 'same',
  'the original': 'original',
  'showing now': 'now'
}

interface LyricsPickerProps {
  state: LyricsPickerState
  /** What the list grows out of and shrinks back into (the Music card's dot), read as it opens. */
  from: Box | null
  onCommand(command: LyricsPickerCommand): void
}

interface Shown {
  /** A fresh card each time it opens, even over one still shrinking away. */
  key: number
  from: Box
  returnFocus: HTMLElement | null
}

function middle(): Box {
  const left = Math.max(0, (window.innerWidth - WIDTH_REM * remPx()) / 2)
  const top = window.innerHeight / 4
  return { left, right: left, top, bottom: top }
}

function focused(): HTMLElement | null {
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body ? active : null
}

/**
 * Every LRCLIB version of the playing song, on a glass card (main opens it from "Pick Other
 * Lyrics…"): best guess first and lit, each row the singers, what main knows of them, and the
 * version's length beside the song's. A row picks that version; the bottom row goes back to
 * automatic, times the words by listening, searches other words, or shows none.
 */
export function LyricsPicker({
  state,
  from,
  onCommand
}: LyricsPickerProps): React.JSX.Element | null {
  const [shown, setShown] = useState<Shown | null>(null)
  const [wasOpen, setWasOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [text, setText] = useState('')
  const card = useRef<PeekCardHandle>(null)
  const firstRow = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const openRef = useRef(state.open)
  /** Main closed it (a pick, or the song changed), so the shrink needn't tell main. */
  const closedByMain = useRef(false)
  const hintId = useId()

  if (state.open !== wasOpen) {
    setWasOpen(state.open)
    if (state.open && !shown) {
      setShown({ key: 0, from: from ?? middle(), returnFocus: focused() })
      setSearching(false)
      setText('')
    }
  }

  const clearRef = useRef<() => boolean>(() => false)
  useLayoutEffect(() => {
    openRef.current = state.open
    clearRef.current = () => {
      if (text === '') return false
      setText('')
      return true
    }
  })

  // PeekCard closes on Esc from a capturing listener on the window. This one is added first, so
  // it hears the key first: Esc in the search field with words in it clears them instead, and
  // Esc that ends a Japanese input method's composition is left to the input method.
  useLayoutEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.target !== field.current) return
      if (!event.isComposing && !clearRef.current()) return
      if (!event.isComposing) event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])

  useEffect(() => {
    if (state.open || !card.current) return
    closedByMain.current = true
    card.current.close()
  }, [state.open])

  // The rows come after the card opens: the focus moves from the card onto the best guess.
  useEffect(() => {
    const row = firstRow.current
    const active = document.activeElement
    if (!row || !(active instanceof HTMLElement)) return
    if (active.classList.contains('peek-card') && active.contains(row)) {
      row.focus({ preventScroll: true })
    }
  }, [state.rows])

  useEffect(() => {
    if (searching) field.current?.focus({ preventScroll: true })
  }, [searching])

  if (!shown) return null

  function closed(): void {
    const byMain = closedByMain.current
    closedByMain.current = false
    if (!openRef.current) {
      setShown(null)
      return
    }
    // Opened again while it shrank: a new card. Otherwise the user closed it (Esc, a press
    // outside, the window losing the focus), which main hasn't heard yet.
    if (byMain) {
      setShown((last) => ({ key: (last?.key ?? 0) + 1, from: from ?? middle(), returnFocus: null }))
      return
    }
    setShown(null)
    onCommand({ kind: 'close' })
  }

  function run(action: FootAction): void {
    if (action.disabled) return
    if (action.kind === 'search') {
      setSearching((open) => !open)
      return
    }
    onCommand({ kind: action.kind })
  }

  function search(): void {
    const words = searchText(text)
    if (words) onCommand({ kind: 'search', text: words })
  }

  /** ↑ and ↓ move between the rows, like a menu's. */
  function moveFocus(event: React.KeyboardEvent<HTMLOListElement>): void {
    const way = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (way === 0) return
    const rows = [...event.currentTarget.querySelectorAll('button')]
    const at = rows.findIndex((row) => row === document.activeElement)
    const next = rows[Math.min(rows.length - 1, Math.max(0, at + way))]
    if (!next) return
    event.preventDefault()
    next.focus()
  }

  const { song } = state
  const status = statusLine(state)
  const actions = footActions(state.picked, state.listen)
  const hint = actions.find((action) => action.hint)?.hint

  return (
    <PeekCard
      key={shown.key}
      handle={card}
      className="lyrics-picker"
      label="Pick other lyrics"
      from={shown.from}
      keyboard
      focus={firstRow}
      returnFocus={shown.returnFocus}
      onClosed={closed}
    >
      <div className="lyrics-picker__head">
        <p className="lyrics-picker__heading">{pickerHeading(song)}</p>
        {status && (
          <p
            className={`lyrics-picker__status${state.busy ? ' lyrics-picker__status--busy' : ''}`}
            role="status"
          >
            {status}
          </p>
        )}
      </div>
      {state.rows.length > 0 && (
        <ol
          className="lyrics-picker__rows"
          aria-label="Versions on LRCLIB, best guess first"
          aria-busy={state.busy !== null}
          onKeyDown={moveFocus}
        >
          {state.rows.map((row, index) => {
            const best = index === 0
            const same = song !== null && sameLength(row.durationSec, song.durationSec)
            const detail = rowDetail(row)
            return (
              <li key={row.id}>
                <button
                  ref={best ? firstRow : undefined}
                  type="button"
                  className={`lyrics-picker__row${best ? ' lyrics-picker__row--best' : ''}`}
                  onClick={() => onCommand({ kind: 'pick', id: row.id })}
                >
                  <span className="lyrics-picker__mark">{best && <CheckIcon />}</span>
                  <span className="lyrics-picker__text">
                    <span className="lyrics-picker__who">
                      <span className="lyrics-picker__singers" title={row.artist}>
                        {row.artist}
                      </span>
                      {row.tags.map((tag) => (
                        <span
                          key={tag}
                          className={`lyrics-picker__tag lyrics-picker__tag--${TONE[tag]}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                    <span className="lyrics-picker__what">
                      {detail.names && (
                        <span className="lyrics-picker__names" title={detail.names}>
                          {detail.names}
                        </span>
                      )}
                      <span className="lyrics-picker__kind">
                        {detail.names ? ` · ${detail.kind}` : detail.kind}
                      </span>
                    </span>
                  </span>
                  <span
                    className={`lyrics-picker__length${same ? ' lyrics-picker__length--same' : ''}`}
                  >
                    {formatLength(row.durationSec)}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
      <div className="lyrics-picker__foot">
        <div className="lyrics-picker__actions">
          {actions.map((action) => (
            <button
              key={action.kind}
              type="button"
              className={`lyrics-picker__pill${action.current ? ' lyrics-picker__pill--current' : ''}`}
              aria-disabled={action.disabled || undefined}
              aria-describedby={action.hint ? hintId : undefined}
              aria-current={action.current || undefined}
              aria-expanded={action.kind === 'search' ? searching : undefined}
              onClick={() => run(action)}
            >
              {action.current && <CheckIcon />}
              {action.label}
            </button>
          ))}
        </div>
        {hint && (
          <p id={hintId} className="lyrics-picker__hint">
            {hint}
          </p>
        )}
        {searching && (
          <form
            className="lyrics-picker__search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault()
              search()
            }}
          >
            <input
              ref={field}
              className="lyrics-picker__field"
              type="text"
              value={text}
              maxLength={SEARCH_MAX}
              placeholder="Another title or singer"
              aria-label="Search LRCLIB for"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                // Enter that picks a Japanese input method's word isn't a search yet.
                event.preventDefault()
                if (!event.nativeEvent.isComposing) search()
              }}
            />
            <button
              type="submit"
              className="lyrics-picker__go"
              aria-disabled={searchText(text) === null || undefined}
            >
              Search
            </button>
          </form>
        )}
      </div>
    </PeekCard>
  )
}
