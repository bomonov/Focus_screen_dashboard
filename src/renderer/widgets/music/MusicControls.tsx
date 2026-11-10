import type { MusicCommand, PlaybackState, RepeatMode } from '../../../main/ipc'

function send(command: MusicCommand): void {
  window.focusScreen.sendMusicCommand(command)
}

interface MusicControlsProps {
  state: PlaybackState
  nextRepeat: RepeatMode
  showLyrics: boolean
}

export function MusicControls({
  state,
  nextRepeat,
  showLyrics
}: MusicControlsProps): React.JSX.Element {
  return (
    <div className="music-controls" role="group" aria-label="Playback controls">
      <button
        type="button"
        className="music-controls__button music-controls__toggle"
        aria-label="Shuffle"
        aria-pressed={state.shuffle}
        onClick={() => send({ kind: 'setShuffle', on: !state.shuffle })}
      >
        <svg viewBox="0 0 24 24" className="music-controls__icon--small" {...STROKE}>
          <path d="M16 3h5v5" />
          <path d="M4 20L21 3" />
          <path d="M21 16v5h-5" />
          <path d="M15 15l6 6" />
          <path d="M4 4l5 5" />
        </svg>
      </button>
      <button
        type="button"
        className="music-controls__button"
        aria-label="Previous track"
        onClick={() => send({ kind: 'previous' })}
      >
        <svg viewBox="0 0 24 24" {...FILLED_STROKE}>
          <polygon points="19 20 9 12 19 4 19 20" />
          <line x1="5" y1="19" x2="5" y2="5" />
        </svg>
      </button>
      <button
        type="button"
        className="music-controls__play"
        aria-label={state.playing ? 'Pause' : 'Play'}
        onClick={() => send({ kind: 'playPause' })}
      >
        {state.playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="7 4 20 12 7 20 7 4" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="music-controls__button"
        aria-label="Next track"
        onClick={() => send({ kind: 'next' })}
      >
        <svg viewBox="0 0 24 24" {...FILLED_STROKE}>
          <polygon points="5 4 15 12 5 20 5 4" />
          <line x1="19" y1="5" x2="19" y2="19" />
        </svg>
      </button>
      <button
        type="button"
        className="music-controls__button music-controls__toggle"
        aria-label={`Repeat: ${state.repeat}`}
        aria-pressed={state.repeat !== 'off'}
        onClick={() => send({ kind: 'setRepeat', mode: nextRepeat })}
      >
        <svg viewBox="0 0 24 24" className="music-controls__icon--small" {...STROKE}>
          <path d="M17 1l4 4-4 4" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <path d="M7 23l-4-4 4-4" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
        {state.repeat === 'one' && <span className="music-controls__badge">1</span>}
      </button>
      <button
        type="button"
        className="music-controls__lyrics"
        aria-pressed={showLyrics}
        onClick={() =>
          window.focusScreen.sendLyricsCommand({ kind: 'setVisible', on: !showLyrics })
        }
      >
        Lyrics
      </button>
    </div>
  )
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const

const FILLED_STROKE = { ...STROKE, fill: 'currentColor' } as const
