import { useEffect, useId, useRef, useState } from 'react'
import type { ColorEditorState, PlaybackState } from '../../../main/ipc'
import { positionAt } from '../../../main/services/music/types'
import { sendColorEditor as send } from '../../hooks/useLyricsColorEditor'
import { formatSongTime } from '../../widgets/music/musicView'
import { cueTime } from './lineRows'
import type { TapMode } from './selection'
import type { AddAt } from './useAddLines'

const epochSeconds = (): number => Date.now() / 1000
/** The time readout counts in hundredths; ten updates a second reads as smooth without costing much. */
const CLOCK_MS = 100

/** Where the song is, counted on here between main's readings while it plays. */
function useSongPosition(music: PlaybackState | null, active: boolean): number {
  const [now, setNow] = useState(epochSeconds)
  const playing = active && (music?.playing ?? false)
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => setNow(epochSeconds()), CLOCK_MS)
    return () => clearInterval(timer)
  }, [playing])
  return music && active ? positionAt(music, now) : 0
}

/**
 * The editor's top row: the song, Play line and Replay from the line before (or Play/Pause for a
 * player that can't seek), the time, "＋ Add lines", Tap timing with its Words / Lines switch,
 * Undo/Redo and "Remove colors for this song…". While the player is on another song, a note
 * under it says so, with the button that follows the player.
 */
export function Toolbar({
  state,
  music,
  tapOn,
  tapMode,
  canPlayLine,
  addAt,
  breakAt,
  onPlayLine,
  onReplay,
  onAddLines,
  onAddBreak,
  onTapOn,
  onTapMode
}: {
  state: ColorEditorState
  music: PlaybackState | null
  tapOn: boolean
  tapMode: TapMode
  /** Play line and Replay have a line to play. */
  canPlayLine: boolean
  /**
   * Where lines added at a press there would go; null while adding is off altogether (the song
   * isn't on, or its lyrics aren't on screen yet).
   */
  addAt: ((pressSec: number) => AddAt | null) | null
  /** Where a music break pressed there would go (null in untimed lyrics); null while adding is off. */
  breakAt: ((pressSec: number) => { start: number } | null) | null
  onPlayLine: () => void
  onReplay: () => void
  onAddLines: () => void
  onAddBreak: () => void
  onTapOn: (on: boolean) => void
  onTapMode: (mode: TapMode) => void
}): React.JSX.Element {
  const song = state.song
  const position = useSongPosition(music, state.playingThis)
  const [confirming, setConfirming] = useState(false)
  const playing = state.playingThis && (music?.playing ?? false)
  // Live with the song, so the label says where a press now would put them.
  const place = addAt?.(position) ?? null
  const breakPlace = breakAt?.(position) ?? null

  return (
    <header className="editor-toolbar">
      <div className="editor-toolbar__row">
        <div className="editor-toolbar__song">
          <h1 className="editor-toolbar__title">Color-code lyrics</h1>
          {song && (
            <span className="editor-toolbar__byline">
              {song.title}
              {song.artist ? ` · ${song.artist}` : ''}
            </span>
          )}
        </div>
        {state.canSeek ? (
          <>
            <button
              type="button"
              className="lyrics-editor__button"
              disabled={!state.playingThis || !canPlayLine}
              onClick={onPlayLine}
              title="Play the selected line (Space)"
            >
              <span aria-hidden="true">▶</span> Play line
            </button>
            <button
              type="button"
              className="lyrics-editor__button"
              disabled={!state.playingThis || !canPlayLine}
              onClick={onReplay}
              title="Play from the line before this one, to tap it again (⇧Space)"
            >
              Replay from the line before
            </button>
          </>
        ) : (
          // A player that can't seek gets Play and Pause only.
          <button
            type="button"
            className="lyrics-editor__button"
            disabled={!state.playingThis}
            onClick={() => window.focusScreen.sendMusicCommand({ kind: 'playPause' })}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
        )}
        <span className="editor-toolbar__time" aria-label="Where the song is">
          {state.playingThis ? cueTime(position) : '–:––.––'}
          <span className="editor-toolbar__length">
            {' '}
            / {formatSongTime(song?.durationSec ?? 0)}
          </span>
        </span>
        <button
          type="button"
          className="lyrics-editor__button lyrics-editor__button--accent"
          disabled={place === null}
          onClick={onAddLines}
          title={
            !addAt
              ? 'Play the song to add them'
              : place === null
                ? 'Select the line the verse comes after'
                : 'Add lines the lyrics are missing (⌘N)'
          }
        >
          ＋ Add lines
          {place &&
            (place.byTime ? ` at ${formatSongTime(position)}` : ` after line ${place.after ?? ''}`)}
        </button>
        <button
          type="button"
          className="lyrics-editor__button"
          disabled={breakPlace === null}
          onClick={onAddBreak}
          title={
            !breakAt
              ? 'Play the song to mark a break'
              : breakPlace === null
                ? 'Breaks need lyrics with times; these have none yet'
                : 'Mark a music break here: the screen shows the note filling up until the next line'
          }
        >
          <span aria-hidden="true">♪</span> Add break
          {breakPlace && ` at ${formatSongTime(position)}`}
        </button>
        <button
          type="button"
          className="lyrics-editor__button"
          aria-pressed={tapOn}
          disabled={!state.playingThis || state.colors === null}
          onClick={() => onTapOn(!tapOn)}
          title={
            tapMode === 'lines'
              ? 'While on, press J as each line starts: it sets the line’s start'
              : "While on, press J as each word starts; hold it to the word's end"
          }
        >
          Tap timing{tapOn ? ' · J' : ''}
        </button>
        {tapOn && <TapModeSwitch mode={tapMode} onMode={onTapMode} />}
        {/* At the right end, together: a narrow window wraps them onto a row of their own. */}
        <div className="editor-toolbar__end">
          <button
            type="button"
            className="lyrics-editor__button lyrics-editor__button--icon"
            aria-label="Undo"
            title="Undo (⌘Z)"
            disabled={!state.canUndo}
            onClick={() => send({ kind: 'undo' })}
          >
            <TurnIcon flip={false} />
          </button>
          <button
            type="button"
            className="lyrics-editor__button lyrics-editor__button--icon"
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
            disabled={!state.canRedo}
            onClick={() => send({ kind: 'redo' })}
          >
            <TurnIcon flip />
          </button>
          <RemoveColors
            disabled={state.colors === null}
            confirming={confirming}
            onConfirming={setConfirming}
            onRemove={() => send({ kind: 'removeAll' })}
          />
        </div>
      </div>
      {song && !state.playingThis && (
        <div className="editor-toolbar__away" role="status">
          <span>Play {song.title} to time it. Colors can still be changed.</span>
          {state.canSwitch && (
            <button
              type="button"
              className="lyrics-editor__button"
              onClick={() => send({ kind: 'switchToPlaying' })}
            >
              Switch to the song playing now
            </button>
          )}
        </div>
      )}
    </header>
  )
}

/** "Tap: Words / Lines": what J marks while Tap timing is on. */
function TapModeSwitch({
  mode,
  onMode
}: {
  mode: TapMode
  onMode: (mode: TapMode) => void
}): React.JSX.Element {
  const label = useId()
  return (
    <span className="tap-mode" role="group" aria-labelledby={label}>
      <span id={label} className="tap-mode__label">
        Tap
      </span>
      <span className="tap-mode__switch">
        <button
          type="button"
          className="lyrics-editor__button"
          aria-pressed={mode === 'words'}
          title="J marks each word"
          onClick={() => onMode('words')}
        >
          Words
        </button>
        <button
          type="button"
          className="lyrics-editor__button"
          aria-pressed={mode === 'lines'}
          title="J marks each line’s start"
          onClick={() => onMode('lines')}
        >
          Lines
        </button>
      </span>
    </span>
  )
}

/** A curved arrow back (undo), or forward when flipped (redo). */
function TurnIcon({ flip }: { flip: boolean }): React.JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  )
}

/** "Remove colors for this song…": asks first, since it deletes the song's file and waveform. */
function RemoveColors({
  disabled,
  confirming,
  onConfirming,
  onRemove
}: {
  disabled: boolean
  confirming: boolean
  onConfirming: (on: boolean) => void
  onRemove: () => void
}): React.JSX.Element {
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (confirming) cancel.current?.focus()
  }, [confirming])

  if (!confirming) {
    return (
      <button
        type="button"
        className="lyrics-editor__button lyrics-editor__button--quiet"
        disabled={disabled}
        onClick={() => onConfirming(true)}
      >
        Remove colors for this song…
      </button>
    )
  }
  return (
    <div
      className="editor-toolbar__confirm"
      role="alertdialog"
      aria-label="Remove colors for this song"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onConfirming(false)
      }}
    >
      <span>Remove this song’s colors, timings and waveform?</span>
      {/* Cancel is the default: it takes the focus, so Enter can't remove by accident. */}
      <button
        ref={cancel}
        type="button"
        className="lyrics-editor__button"
        onClick={() => onConfirming(false)}
      >
        Cancel
      </button>
      <button
        type="button"
        className="lyrics-editor__button lyrics-editor__button--danger"
        onClick={() => {
          onConfirming(false)
          onRemove()
        }}
      >
        Remove
      </button>
    </div>
  )
}
