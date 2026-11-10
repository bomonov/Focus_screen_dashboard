import { useMusic } from '../hooks/useMusic'
import { useNow } from '../hooks/useNow'
import { dateFormat, timeFormat } from './clockFormat'
import './IdleView.css'

/** Idle dim: nothing has happened for a while, so only the clock and the last cover stay up. */
export function IdleView(): React.JSX.Element {
  const now = useNow()
  const track = useMusic()?.track ?? null

  return (
    <div className="idle-view" role="status" aria-label="Focus Screen is resting">
      {track?.artwork && <img className="idle-view__art" src={track.artwork} alt="" />}
      <div className="idle-view__text">
        <time className="idle-view__time" dateTime={now.toISOString()}>
          {timeFormat.format(now)}
        </time>
        <span className="idle-view__date">{dateFormat.format(now)}</span>
        {track && (
          <span className="idle-view__track">
            {track.artist ? `${track.title} · ${track.artist}` : track.title}
          </span>
        )}
      </div>
    </div>
  )
}
