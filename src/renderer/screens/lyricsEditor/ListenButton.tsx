import type { ListenState, SongColors } from '../../../main/ipc'
import { NOT_HEARD_NOTE, type OwnLyrics } from '../../../main/services/lyrics/singers/listen'
import { sendColorEditor } from '../../hooks/useLyricsColorEditor'
import { listenView } from './editorView'

/** As Customize says it: plain words for friends running the app, the command only in a tooltip. */
const NOT_INSTALLED = 'Needs the auto-sync add-on, which isn’t installed on this Mac'
const SET_UP = 'Set it up with: npm run setup:aligner'

/**
 * "Time by listening" for a run of lines (or the selected line's): the auto-sync add-on's aligner
 * times them from what the editor heard, even while the player is on another song. It's off,
 * with plain words why, while the add-on isn't installed, a run is going ("Timing 3 lines…") or
 * the stretch hasn't been heard. How the last run went shows under it, beside its lines.
 */
export function ListenButton({
  listen,
  note,
  colors,
  run,
  durationSec,
  own
}: {
  listen: ListenState
  /** How the last run went, while it's about the selected lines (`useRunNote`). */
  note: string | null
  colors: SongColors
  /** Places in `lines`, `to` exclusive. */
  run: { from: number; to: number }
  durationSec: number
  /** The lyrics' own lines while they're this song's (`editorLyrics`), else null. */
  own: OwnLyrics | null
}): React.JSX.Element | null {
  const view = listenView(listen, colors, run, durationSec, own)
  if (view === null) return null
  const why =
    view.kind === 'notInstalled'
      ? NOT_INSTALLED
      : view.kind === 'timing'
        ? `Timing ${view.count} ${view.count === 1 ? 'line' : 'lines'}…`
        : view.kind === 'notHeard'
          ? NOT_HEARD_NOTE
          : ''
  // Main answers with the same words when it finds the stretch unheard: once is enough.
  const said = note !== null && note !== why ? note : null
  const setUp = view.kind === 'notInstalled' ? SET_UP : undefined

  return (
    <div className="listen">
      <div className="listen__row">
        <button
          type="button"
          className="lyrics-editor__button"
          disabled={view.kind !== 'ready'}
          title={setUp}
          onClick={() => sendColorEditor({ kind: 'listen', from: run.from, to: run.to })}
        >
          Time by listening
        </button>
        <span className="listen__why" role="status" title={setUp}>
          {why}
        </span>
      </div>
      {said && (
        <p className="listen__note" role="status">
          {said}
        </p>
      )}
    </div>
  )
}
