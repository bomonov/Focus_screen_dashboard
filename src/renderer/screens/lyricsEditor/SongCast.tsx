import type { Singer } from '../../../main/services/lyrics/singers/cast'
import type { SingerLookup } from '../../widgets/music/singerColors'
import { EveryoneCircle, SingerBadge } from './SingerBadge'
import { KEY_SLOTS } from './singers'

/**
 * Who sings in this song, in order and numbered for the keys, then "Everyone" (the whole row,
 * kept live) and the button that opens the cast to choose who's in it.
 */
export function SongCast({
  cast,
  hexes,
  pictures,
  duet,
  choosing,
  pickerOpen,
  canAssign,
  onAssign,
  onEveryone,
  onChoose,
  onTogglePicker,
  onMenu,
  onDropFile
}: {
  cast: readonly Singer[]
  hexes: SingerLookup
  pictures: Record<string, string>
  /** The singers being clicked into the selected words, to show as pressed. */
  duet: readonly string[]
  /** The cast below is open for choosing who's in the song. */
  choosing: boolean
  /** The whole cast is showing below. */
  pickerOpen: boolean
  canAssign: boolean
  onAssign: (id: string) => void
  onEveryone: () => void
  onChoose: () => void
  onTogglePicker: () => void
  onMenu: (singer: Singer, at: { x: number; y: number }) => void
  onDropFile: (singer: Singer, file: File) => void
}): React.JSX.Element {
  const everyone = cast.length >= 2
  return (
    <section className="song-cast" aria-label="Who sings in this song">
      <h2 className="lyrics-editor__label">In this song</h2>
      <div className="song-cast__row">
        {cast.length === 0 && (
          <p className="song-cast__empty">Nobody yet: add who sings it, then 1–9 picks them.</p>
        )}
        {cast.map((singer, i) => (
          <SingerBadge
            key={singer.id}
            singer={singer}
            hex={hexes([singer.id])[0] ?? singer.color}
            picture={pictures[singer.id]}
            keyHint={i < KEY_SLOTS ? String(i + 1) : undefined}
            pressed={duet.includes(singer.id)}
            onPick={() => {
              if (canAssign) onAssign(singer.id)
            }}
            onMenu={onMenu}
            onDropFile={onDropFile}
          />
        ))}
        <button
          type="button"
          className="singer-badge"
          disabled={!everyone || !canAssign}
          title={everyone ? 'Everyone in this song' : 'Add at least two singers to this song first'}
          onClick={onEveryone}
        >
          <EveryoneCircle hexes={everyone ? hexes(cast.map((singer) => singer.id)) : []} />
          <span className="singer-badge__name">Everyone</span>
        </button>
        <button
          type="button"
          className="lyrics-editor__button song-cast__add"
          aria-pressed={choosing}
          onClick={onChoose}
        >
          {choosing ? 'Done' : cast.length === 0 ? 'Add singers…' : 'Change…'}
        </button>
        {!choosing && (
          <button
            type="button"
            className="lyrics-editor__button lyrics-editor__button--quiet"
            aria-expanded={pickerOpen}
            aria-controls="cast-picker"
            onClick={onTogglePicker}
          >
            {pickerOpen ? 'Hide other singers' : 'Other singers…'}
          </button>
        )}
      </div>
    </section>
  )
}
