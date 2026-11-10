import type { MusicSettings, PlaybackState, Track } from '../../main/ipc'
import { positionAt } from '../../main/services/music/types'
import { useAnchoredNow } from '../hooks/useAnchoredNow'
import { useAutoSync } from '../hooks/useAutoSync'
import { useLyrics } from '../hooks/useLyrics'
import { useMusic } from '../hooks/useMusic'
import { usePlayOnMount } from '../hooks/usePlayOnMount'
import { usePrepare } from '../hooks/usePrepare'
import { Card } from './Card'
import { AnimatedCover } from './music/AnimatedCover'
import { Disc } from './music/Disc'
import { LyricsPanel } from './music/LyricsPanel'
import { lyricsLayout } from './music/lyricsView'
import { MusicControls } from './music/MusicControls'
import { joinOr, musicView, upNextShown } from './music/musicView'
import { prepareEyebrow } from './music/prepareView'
import { SeekBar } from './music/SeekBar'
import { UpNextRow } from './music/UpNextRow'
import './NowPlaying.css'

interface NowPlayingProps {
  /** null until the main process answers. */
  settings: MusicSettings | null
}

export function NowPlaying({ settings }: NowPlayingProps): React.JSX.Element {
  const music = useMusic()
  const lyrics = useLyrics()
  const autoSync = useAutoSync()
  const preparing = prepareEyebrow(usePrepare())
  const track = music?.track ?? null
  const showLyrics = settings?.showLyrics ?? false
  const showPlayerName = settings?.showPlayerName ?? true
  const layout = lyricsLayout(showLyrics, track, lyrics)

  return (
    <Card label="Now playing" className={`now-playing now-playing--${layout.kind}`}>
      <div className="now-playing__main">
        {settings?.cover === 'animated' ? (
          <AnimatedCover
            track={track}
            playing={music?.playing ?? false}
            light={settings.coverLight}
            glow={settings.coverGlow}
          />
        ) : (
          <Disc
            track={track}
            spinning={music?.playing ?? false}
            speed={settings?.spinSpeed ?? 'normal'}
          />
        )}
        <div className="now-playing__info">
          {music && track ? (
            <Playing
              state={music}
              track={track}
              showLyrics={showLyrics}
              showPlayerName={showPlayerName}
              note={layout.kind === 'art' ? layout.note : null}
              preparing={preparing}
            />
          ) : music ? (
            <NotPlaying state={music} showPlayerName={showPlayerName} />
          ) : (
            <span className="now-playing__eyebrow">Now playing</span>
          )}
        </div>
      </div>
      {layout.kind === 'lyrics' && music && track && (
        <LyricsPanel
          state={music}
          track={track}
          lyrics={layout.lyrics}
          romaji={layout.romaji}
          romajiFrom={layout.romajiFrom ?? null}
          offsetSec={lyrics?.offsetSec ?? 0}
          style={settings?.lyricsStyle ?? 'synced'}
          autoSync={
            autoSync?.stage && autoSync.trackId === track.id
              ? {
                  stage: autoSync.stage,
                  heard: autoSync.heard,
                  live: autoSync.liveLine !== null
                }
              : null
          }
          liveLine={autoSync?.trackId === track.id ? autoSync.liveLine : null}
          colors={layout.colors ?? null}
          albumInk={settings?.albumInk ?? false}
        />
      )}
    </Card>
  )
}

interface PlayingProps {
  state: PlaybackState
  track: Track
  showLyrics: boolean
  showPlayerName: boolean
  /** Why there are no lyrics under the song ("No lyrics found"); null when that needs no saying. */
  note: string | null
  /** Replaces "Now playing" while a playlist is being prepared, muted. */
  preparing: string | null
}

function Playing({
  state,
  track,
  showLyrics,
  showPlayerName,
  note,
  preparing
}: PlayingProps): React.JSX.Element {
  const now = useAnchoredNow(state.playing ? state.positionAt : null, state.positionSec)
  const view = musicView(state, track, now, showPlayerName)

  return (
    <>
      {/* Its own element per song, so a new song's name rises in with its cover. */}
      <SongHeading key={track.id}>
        <span className="now-playing__eyebrow">{preparing ?? view.eyebrow}</span>
        <h1 className="now-playing__title">{track.title}</h1>
        {view.byline && <p className="now-playing__byline">{view.byline}</p>}
      </SongHeading>
      <SeekBar track={track} positionSec={positionAt(state, now)} />
      <MusicControls state={state} nextRepeat={view.nextRepeat} showLyrics={showLyrics} />
      {state.next && <UpNextRow next={state.next} shown={upNextShown(state, track, now)} />}
      {note && <p className="now-playing__note">{note}</p>}
    </>
  )
}

const SONG_IN: Keyframe[] = [
  { opacity: 0, transform: 'translateY(0.5rem)' },
  { opacity: 1, transform: 'none' }
]
const SONG_IN_TIMING: KeyframeAnimationOptions = { duration: 450, easing: 'ease-out' }

function SongHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  const ref = usePlayOnMount<HTMLDivElement>(SONG_IN, SONG_IN_TIMING)
  return (
    <div ref={ref} className="now-playing__heading">
      {children}
    </div>
  )
}

function NotPlaying({
  state,
  showPlayerName
}: {
  state: PlaybackState
  showPlayerName: boolean
}): React.JSX.Element {
  const playerName = showPlayerName ? state.player?.name : undefined

  if (state.problem?.kind === 'automationDenied') {
    const name = state.problem.playerName
    return (
      <div className="now-playing__heading">
        <span className="now-playing__eyebrow">Now playing · {name}</span>
        <h1 className="now-playing__title">Can’t see {name}</h1>
        <p className="now-playing__hint">
          Focus Screen needs permission to show and control {name}. Turn it on in System Settings →
          Privacy &amp; Security → Automation.
        </p>
        <button
          type="button"
          className="now-playing__action"
          onClick={() => window.focusScreen.openAutomationSettings()}
        >
          Open System Settings
        </button>
      </div>
    )
  }

  return (
    <div className="now-playing__heading">
      <span className="now-playing__eyebrow">
        {playerName ? `Now playing · ${playerName}` : 'Now playing'}
      </span>
      <h1 className="now-playing__title now-playing__title--idle">Nothing playing</h1>
      <p className="now-playing__hint">
        {state.supportedPlayers.length > 0
          ? `Play something in ${joinOr(state.supportedPlayers)} and it shows up here.`
          : 'Music from this computer isn’t supported yet.'}
      </p>
    </div>
  )
}
