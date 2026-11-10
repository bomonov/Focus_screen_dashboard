import { Crossfade } from '../widgets/Crossfade'
import type { BackdropView } from './backdropView'
import { LivingColors } from './LivingColors'
import './Backdrop.css'

/** A new cover (or photo) melting in over the last. */
const IMAGE_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }]
const IMAGE_IN_TIMING: KeyframeAnimationOptions = { duration: 900, easing: 'ease-in-out' }

/** Loaded before it fades in, so a slow cover never fades in as a blank. */
function imageReady(layer: HTMLElement): Promise<unknown> {
  const url = layer.querySelector<HTMLElement>('[data-image]')?.dataset.image
  if (!url) return Promise.resolve()
  const image = new Image()
  image.src = url
  return image.decode()
}

/**
 * The blurred cover, the song's living colors, or the user's photo, behind the cards and toned
 * down by a veil.
 */
export function Backdrop({
  view,
  playing
}: {
  view: BackdropView
  /** Living colors drift only while the music plays. */
  playing: boolean
}): React.JSX.Element {
  return (
    <div className={`backdrop backdrop--${view.kind}`} aria-hidden="true">
      {view.kind === 'living' ? (
        <LivingColors artwork={view.artwork} fallback={view.fallback} playing={playing} />
      ) : (
        <Crossfade
          value={view.image}
          itemKey={view.image}
          className="backdrop__layer"
          keyframes={IMAGE_IN}
          timing={IMAGE_IN_TIMING}
          ready={imageReady}
        >
          {(url) => (
            <div
              className="backdrop__image"
              data-image={url}
              style={{ backgroundImage: `url("${url}")` }}
            />
          )}
        </Crossfade>
      )}
      <div className="backdrop__veil" />
    </div>
  )
}
