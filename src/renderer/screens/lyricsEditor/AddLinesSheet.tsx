import { useId, useState } from 'react'
import { formatSongTime } from '../../widgets/music/musicView'
import { pastedLines } from './addLines'
import type { AddAt } from './useAddLines'

/**
 * "＋ Add lines": the box laid over the top of the line list where the missing verse is pasted
 * or typed, one line per line. It says where the lines go (at the press, or after a line), counts
 * them as they're typed, or says why they can't be added. ⌘Enter adds, Esc cancels.
 */
export function AddLinesSheet({
  pressSec,
  place,
  canAdd,
  onAdd,
  onCancel
}: {
  /** Where the song was at the press. */
  pressSec: number
  /**
   * Where they'd go on the coding as it is now; null when the line they were to go after is
   * gone and the press can't place them by time.
   */
  place: AddAt | null
  /** False while the editor's song isn't on, or its lyrics aren't on screen yet. */
  canAdd: boolean
  onAdd: (lines: string[]) => void
  onCancel: () => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const caption = useId()
  const pasted = pastedLines(text)
  const { lines } = pasted
  // Only worth saying while they could be added: the song away is said by the button's title.
  const problem =
    pasted.problem ?? (canAdd && place === null ? 'The line they go after is gone.' : null)
  const ready = canAdd && place !== null && lines.length > 0
  const add = (): void => {
    if (ready) onAdd(lines)
  }

  return (
    <form
      className="add-lines"
      aria-label="Add lines"
      onSubmit={(event) => {
        event.preventDefault()
        add()
      }}
      onKeyDown={(event) => {
        // Esc or Enter that ends a Japanese input method's word isn't for the box.
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        } else if (event.key === 'Enter' && event.metaKey) {
          event.preventDefault()
          add()
        }
      }}
    >
      <p id={caption} className="add-lines__caption">
        Paste or type the missing lines, one per line.
        {place?.byTime && ` The first starts at ${formatSongTime(pressSec)}.`}
        {place && !place.byTime && ` They go after line ${place.after ?? ''}.`}
      </p>
      <label className="add-lines__field">
        <span className="lyrics-editor__label">Missing lines</span>
        <textarea
          value={text}
          rows={5}
          aria-describedby={caption}
          // It opens on the user's press, so the paste goes straight in.
          autoFocus
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="add-lines__row">
        <span
          className={`add-lines__count${problem ? ' add-lines__count--problem' : ''}`}
          role="status"
        >
          {problem ?? (lines.length > 0 ? countOf(lines.length) : '')}
        </span>
        <button
          type="button"
          className="lyrics-editor__button lyrics-editor__button--quiet"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="lyrics-editor__button lyrics-editor__button--primary"
          disabled={!ready}
          title={canAdd ? 'Add them (⌘Enter)' : 'Play the song to add them'}
        >
          Add {lines.length > 0 ? countOf(lines.length) : 'lines'}
        </button>
      </div>
    </form>
  )
}

function countOf(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'}`
}
