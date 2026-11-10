import { useId, useLayoutEffect, useRef } from 'react'
import type { Place } from '../../../main/ipc'
import type { PlaceRow, PlaceSection } from './placeRowsView'
import { RowIcon } from './TripIcons'

/** A saved place's name, as the places file keeps it. */
const MAX_NAME_CHARS = 60

/** The rows' pick buttons that can be picked, for the arrow keys. */
const PICKABLE = '.trip-row__pick:not(:disabled)'

interface PlaceRowsProps {
  /** The listbox's id: each row is `${listId}-${its place in the list}`, for the field's combobox. */
  listId: string
  sections: PlaceSection[]
  /** The row Enter in the field picks (the first, while typing), lit; -1 for none. */
  litIndex: number
  /** The row whose name is being typed for "Save…". */
  saving: string | null
  onPick(row: PlaceRow): void
  onSaving(key: string | null): void
  onSave(place: Place, name: string): void
  /** ↑ from the first row: back to the field. */
  onUpFromTop(): void
  /** The list, so the field's ↓ can move to its first row. */
  listRef?: React.Ref<HTMLDivElement>
}

/**
 * The places the card offers: before typing, Home, the next class, saved and recent places; while
 * typing, the Mac's own matches, then Apple's under "From Apple Maps". Each row is its name and a
 * short second line; ↑ and ↓ move between them, Enter or a click picks. A found place's "Save…"
 * turns its row into a name field (Enter keeps it, Esc steps back).
 */
export function PlaceRows({
  listId,
  sections,
  litIndex,
  saving,
  onPick,
  onSaving,
  onSave,
  onUpFromTop,
  listRef
}: PlaceRowsProps): React.JSX.Element {
  const id = useId()
  // Each row's place in the whole list, across sections: its option id, as the card counts.
  const indexOf = new Map(
    sections.flatMap((section) => section.rows).map((row, at) => [row.key, at])
  )

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(PICKABLE)]
    const at = buttons.indexOf(event.target as HTMLButtonElement)
    if (at === -1) return
    event.preventDefault()
    if (event.key === 'ArrowUp' && at === 0) {
      onUpFromTop()
      return
    }
    const next = event.key === 'ArrowDown' ? Math.min(at + 1, buttons.length - 1) : at - 1
    buttons[next]?.focus()
  }

  return (
    <div
      ref={listRef}
      id={listId}
      className="trip-rows"
      role="listbox"
      aria-label="Places"
      onKeyDown={onKeyDown}
    >
      {sections.map((section) =>
        section.rows.length === 0 ? null : (
          <section
            key={section.key}
            className="trip-rows__section"
            role="group"
            aria-labelledby={section.heading ? `${id}-${section.key}` : undefined}
          >
            {section.heading && (
              <h3 id={`${id}-${section.key}`} className="trip-rows__heading">
                {section.heading}
              </h3>
            )}
            <ul className="trip-rows__list" role="presentation">
              {section.rows.map((row) => {
                const index = indexOf.get(row.key) ?? -1
                return row.savable && saving === row.key ? (
                  <SaveRow
                    key={row.key}
                    row={row}
                    place={row.savable}
                    onSave={(name) => {
                      if (row.savable) onSave(row.savable, name)
                      onSaving(null)
                    }}
                    onCancel={() => onSaving(null)}
                  />
                ) : (
                  <Row
                    key={row.key}
                    id={`${listId}-${index}`}
                    row={row}
                    lit={index === litIndex}
                    onPick={() => onPick(row)}
                    onSaveAsk={() => onSaving(row.key)}
                  />
                )
              })}
            </ul>
          </section>
        )
      )}
    </div>
  )
}

function Row({
  id,
  row,
  lit,
  onPick,
  onSaveAsk
}: {
  id: string
  row: PlaceRow
  lit: boolean
  onPick(): void
  onSaveAsk(): void
}): React.JSX.Element {
  return (
    <li className={`trip-row${lit ? ' trip-row--lit' : ''}`} role="presentation">
      <button
        id={id}
        type="button"
        role="option"
        aria-selected={lit}
        className="trip-row__pick"
        disabled={row.disabled}
        onClick={onPick}
      >
        <span className={`trip-row__icon trip-row__icon--${row.icon}`} aria-hidden="true">
          <RowIcon kind={row.icon} />
        </span>
        <span className="trip-row__words">
          <span className="trip-row__title">{row.title}</span>
          {row.detail && <span className="trip-row__detail">{row.detail}</span>}
        </span>
        {row.aside && <span className="trip-row__aside">{row.aside}</span>}
      </button>
      {row.savable && (
        <button
          type="button"
          className="trip-row__save"
          aria-label={`Save ${row.title}…`}
          onClick={onSaveAsk}
        >
          Save…
        </button>
      )}
    </li>
  )
}

/** "Save…" open: the place's name to keep it by, the user's own ("Alex’s"). */
function SaveRow({
  row,
  place,
  onSave,
  onCancel
}: {
  row: PlaceRow
  place: Place
  onSave(name: string): void
  onCancel(): void
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    field.current?.focus({ preventScroll: true })
    field.current?.select()
  }, [])
  return (
    <li className="trip-row trip-row--saving" role="presentation">
      <form
        className="trip-save"
        onSubmit={(event) => {
          event.preventDefault()
          const name = field.current?.value.trim() ?? ''
          onSave(name || place.name)
        }}
      >
        <span className="trip-row__icon trip-row__icon--saved" aria-hidden="true">
          <RowIcon kind="saved" />
        </span>
        <input
          ref={field}
          className="trip-field__input trip-save__name"
          type="text"
          aria-label={`A name for ${row.title}`}
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_NAME_CHARS}
          defaultValue={place.name.slice(0, MAX_NAME_CHARS)}
        />
        <button type="submit" className="trip-save__button trip-save__button--keep">
          Save
        </button>
        <button type="button" className="trip-save__button" onClick={onCancel}>
          Cancel
        </button>
      </form>
    </li>
  )
}
