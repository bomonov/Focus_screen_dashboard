import { useState } from 'react'
import type { UpNext } from '../../../main/ipc'
import { placeholderCover } from './cover'

function sameSong(a: UpNext | null, b: UpNext | null): boolean {
  return a?.title === b?.title && a?.artist === b?.artist && a?.artwork === b?.artwork
}

/**
 * The song up next, under the controls for the last moments of this one. Its place is kept
 * while the player says what's next, so nothing moves when it fades in. Fading out it keeps the
 * song it showed: by then the player already names the one after.
 */
export function UpNextRow({
  next,
  shown
}: {
  next: UpNext | null
  shown: boolean
}): React.JSX.Element {
  const [kept, setKept] = useState<UpNext | null>(next)
  if (shown && next && !sameSong(kept, next)) setKept(next)
  const song = shown ? next : kept
  const cover = song && !song.artwork ? placeholderCover(song.artist, '', song.title) : null

  return (
    <div className={`up-next${shown ? ' up-next--shown' : ''}`} aria-hidden={!shown}>
      {song && (
        <>
          {song.artwork ? (
            <img className="up-next__cover" src={song.artwork} alt="" />
          ) : (
            <span
              className="up-next__cover up-next__cover--stand-in"
              style={
                {
                  '--cover-base': cover?.base,
                  '--cover-band': cover?.band
                } as React.CSSProperties
              }
            />
          )}
          <span className="up-next__text">
            <span className="up-next__label">Up next</span>
            <span className="up-next__title">{song.title}</span>
            {song.artist && <span className="up-next__artist">{song.artist}</span>}
          </span>
        </>
      )}
    </div>
  )
}
