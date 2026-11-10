import type { Track } from '../../../main/ipc'
import { placeholderCover } from './cover'

/** The stand-in cover for a song without one: its album's colors, a band and a dot. */
export function PlaceholderArt({ track }: { track: Track }): React.JSX.Element {
  const cover = placeholderCover(track.artist, track.album, track.title)
  return (
    <div className="disc__placeholder" style={{ background: cover.base }}>
      <div className="disc__placeholder-band" style={{ background: cover.band }} />
      <div className="disc__placeholder-dot" style={{ background: cover.dot }} />
    </div>
  )
}
