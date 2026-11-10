import { useState } from 'react'
import type { SongColors } from '../../../main/ipc'
import { CAST, CAST_GROUPS, type Singer } from '../../../main/services/lyrics/singers/cast'
import { MAX_SINGER_NAME } from '../../../main/services/lyrics/singers/parse'
import type { SingerLookup } from '../../widgets/music/singerColors'
import { SingerBadge } from './SingerBadge'
import { nameTaken } from './singers'

/** A new singer's color until one is picked: a quiet grey that reads on every theme. */
const NEW_SINGER_COLOR = '#888888'

/**
 * Every singer, by group, then the ones the user added and "Add singer…". Clicking assigns the
 * selected words; while the song's cast is being chosen, clicking adds or takes out instead.
 */
export function CastPicker({
  extra,
  songCast,
  hexes,
  pictures,
  duet,
  choosing,
  canAssign,
  onPick,
  onAddSinger,
  onMenu,
  onDropFile
}: {
  extra: SongColors['extra']
  songCast: readonly string[]
  hexes: SingerLookup
  pictures: Record<string, string>
  duet: readonly string[]
  choosing: boolean
  canAssign: boolean
  onPick: (id: string) => void
  onAddSinger: (name: string, color: string) => void
  onMenu: (singer: Singer, at: { x: number; y: number }) => void
  onDropFile: (singer: Singer, file: File) => void
}): React.JSX.Element {
  const extras: Singer[] = extra.map((singer) => ({ ...singer, group: 'extra' }))

  const badge = (singer: Singer): React.JSX.Element => {
    const inSong = songCast.includes(singer.id)
    return (
      <SingerBadge
        key={singer.id}
        singer={singer}
        hex={hexes([singer.id])[0] ?? singer.color}
        picture={pictures[singer.id]}
        pressed={choosing ? inSong : duet.includes(singer.id)}
        label={
          choosing ? `${singer.name}, ${inSong ? 'in this song' : 'not in this song'}` : undefined
        }
        onPick={() => {
          if (choosing || canAssign) onPick(singer.id)
        }}
        onMenu={onMenu}
        onDropFile={onDropFile}
      />
    )
  }

  return (
    <section
      id="cast-picker"
      className={`cast-picker${choosing ? ' cast-picker--choosing' : ''}`}
      aria-label={choosing ? 'Choose who sings in this song' : 'All singers'}
    >
      <p className="cast-picker__hint" role={choosing ? 'status' : undefined}>
        {choosing
          ? 'Click the singers in this song to add or take them out; their order is the 1–9 keys.'
          : 'Click a singer to give them the selected words; click more for a duet. Right-click for a picture.'}
      </p>
      <div className="cast-picker__groups">
        {CAST_GROUPS.map((group) => (
          <div key={group.id} className="cast-picker__group">
            <h3 className="lyrics-editor__label">{group.name}</h3>
            {CAST.filter((singer) => singer.group === group.id).map(badge)}
          </div>
        ))}
        <div className="cast-picker__group">
          <h3 className="lyrics-editor__label">Added by you</h3>
          {extras.map(badge)}
          <AddSinger extra={extra} onAdd={onAddSinger} />
        </div>
      </div>
    </section>
  )
}

/** "Add singer…": a name and a color, for a character not listed or another song's singer. */
function AddSinger({
  extra,
  onAdd
}: {
  extra: SongColors['extra']
  onAdd: (name: string, color: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(NEW_SINGER_COLOR)
  const taken = nameTaken(name, extra, CAST)

  if (!open) {
    return (
      <button type="button" className="lyrics-editor__button" onClick={() => setOpen(true)}>
        Add singer…
      </button>
    )
  }

  const close = (): void => {
    setOpen(false)
    setName('')
    setColor(NEW_SINGER_COLOR)
  }
  const add = (): void => {
    if (name.trim() === '' || taken) return
    onAdd(name.trim(), color.toUpperCase())
    close()
  }

  return (
    <form
      className="add-singer"
      onSubmit={(event) => {
        event.preventDefault()
        add()
      }}
      onKeyDown={(event) => {
        // Esc that ends a Japanese input method's word isn't a cancel.
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') close()
      }}
    >
      <label className="add-singer__field">
        <span className="lyrics-editor__label">Name</span>
        <input
          type="text"
          value={name}
          maxLength={MAX_SINGER_NAME}
          // It opens on the user's click, so the typing goes straight in.
          autoFocus
          onChange={(event) => setName(event.target.value)}
          aria-invalid={taken}
        />
      </label>
      <label className="add-singer__field add-singer__field--color">
        <span className="lyrics-editor__label">Color</span>
        <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
      </label>
      {taken && <p className="add-singer__error">There’s already a singer called that.</p>}
      <div className="add-singer__actions">
        <button
          type="submit"
          className="lyrics-editor__button"
          disabled={name.trim() === '' || taken}
        >
          Add
        </button>
        <button
          type="button"
          className="lyrics-editor__button lyrics-editor__button--quiet"
          onClick={close}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
