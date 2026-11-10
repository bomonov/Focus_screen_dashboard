import type { SpinSpeed, Track } from '../../../main/ipc'
import { Crossfade } from '../Crossfade'
import { COVER_IN, COVER_IN_TIMING, coverReady } from './coverIn'
import { PlaceholderArt } from './PlaceholderArt'

interface DiscProps {
  /** null when nothing is playing: an empty record. */
  track: Track | null
  spinning: boolean
  speed: SpinSpeed
}

export function Disc({ track, spinning, speed }: DiscProps): React.JSX.Element {
  return (
    <div className={`disc disc--${speed}`} data-spinning={spinning} aria-hidden="true">
      <div className="disc__label">
        {/* A new song, or its cover arriving after it, fades in over what was there. */}
        <Crossfade
          value={track}
          itemKey={track ? `${track.id}|${track.artwork ?? ''}` : ''}
          className="disc__layer"
          keyframes={COVER_IN}
          timing={COVER_IN_TIMING}
          ready={coverReady}
        >
          {(shown) =>
            shown.artwork ? (
              <img className="disc__art" src={shown.artwork} alt="" draggable={false} />
            ) : (
              <PlaceholderArt track={shown} />
            )
          }
        </Crossfade>
        <div className="disc__hole" />
      </div>
    </div>
  )
}
