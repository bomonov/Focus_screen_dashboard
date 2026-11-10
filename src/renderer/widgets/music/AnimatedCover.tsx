import { useEffect, useMemo, useRef } from 'react'
import type { CoverLight, CoverScene, Track } from '../../../main/ipc'
import { useCoverMotion } from '../../hooks/useCoverMotion'
import { useCoverPalette } from '../../hooks/useCoverPalette'
import { Crossfade } from '../Crossfade'
import { placeholderCover } from './cover'
import {
  glowColors,
  GLOW_SHIFT_MS,
  SHEEN_EVERY_MS,
  SHEEN_FIRST_DELAY_MS,
  SHEEN_SWEEP_MS,
  sparkles,
  type Sparkle
} from './coverLight'
import { coverReady } from './coverIn'
import { PartsCanvas } from './coverParts/PartsCanvas'
import { PlaceholderArt } from './PlaceholderArt'

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** A new song's cover fades in over the old one where it is: no zoom, nothing that moves. */
const ART_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }]
const ART_IN_TIMING: KeyframeAnimationOptions = { duration: 900, easing: 'ease-in-out' }
/** And its colors melt into the glow, slower still. */
const GLOW_IN_TIMING: KeyframeAnimationOptions = { duration: 1600, easing: 'ease-in-out' }

/** The glint crosses once, then waits out the rest of SHEEN_EVERY_MS off the cover. */
const SHEEN_ACROSS = SHEEN_SWEEP_MS / SHEEN_EVERY_MS
const SHEEN: Keyframe[] = [
  { transform: 'translateX(-80%)', easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
  { transform: 'translateX(14%)', offset: SHEEN_ACROSS },
  { transform: 'translateX(14%)' }
]

/**
 * An endless animation that runs while the music plays and rests where it is while it's paused,
 * as the record does. None at all with reduced motion: the cover is then simply still.
 */
function useLoop(
  element: React.RefObject<HTMLElement | null>,
  make: (element: HTMLElement) => Animation,
  playing: boolean
): void {
  const animation = useRef<Animation | null>(null)
  useEffect(() => {
    const target = element.current
    if (!target || reducedMotion.matches) return
    const made = make(target)
    animation.current = made
    return () => {
      made.cancel()
      animation.current = null
    }
  }, [element, make])
  useEffect(() => {
    if (playing) animation.current?.play()
    else animation.current?.pause()
  }, [playing, make])
}

interface AnimatedCoverProps {
  /** null when nothing is playing: an empty frame. */
  track: Track | null
  playing: boolean
  light: CoverLight
  /** Its colors glowing behind it (Customize › Music › Backlight). */
  glow: boolean
}

/**
 * Which pictures a scene draws, cheaply: a new cover, or parts saved anew, remount the canvas
 * (its pictures are uploaded once); a strength change alone doesn't.
 */
function sceneKey(scene: CoverScene): string {
  const tail = (url: string | null): string => (url ? `${url.length}:${url.slice(-24)}` : '-')
  return [scene.cover, scene.plate, ...scene.parts.map((part) => part.weight)].map(tail).join('|')
}

/**
 * The square cover, alive without moving, as an alternative to the spinning record: with the
 * backlight on its colors glow behind it and slowly wander (coverLight.ts says why the picture
 * itself stays still), and with Sheen or Sparkle a glint of light crosses it now and then, or a
 * few specks drift up.
 */
export function AnimatedCover({
  track,
  playing,
  light,
  glow
}: AnimatedCoverProps): React.JSX.Element {
  const scene = useCoverMotion()?.scene ?? null
  const fallback = track ? placeholderCover(track.artist, track.album, track.title) : null
  const palette = useCoverPalette(
    track?.artwork ?? null,
    fallback ? [fallback.base, fallback.band, fallback.dot] : []
  )
  const songKey = track?.id ?? ''

  return (
    <div className="cover" aria-hidden="true">
      {glow && (
        <Crossfade
          value={track ? palette : null}
          itemKey={track ? palette.join() : ''}
          className="cover__glow"
          keyframes={ART_IN}
          timing={GLOW_IN_TIMING}
        >
          {(colors) => <Glow palette={colors} playing={playing} />}
        </Crossfade>
      )}
      <div className="cover__frame">
        <Crossfade
          value={track}
          itemKey={track ? `${track.id}|${track.artwork ?? ''}` : ''}
          className="cover__layer"
          keyframes={ART_IN}
          timing={ART_IN_TIMING}
          ready={coverReady}
        >
          {(shown) =>
            shown.artwork ? (
              <img className="cover__art" src={shown.artwork} alt="" draggable={false} />
            ) : (
              <PlaceholderArt track={shown} />
            )
          }
        </Crossfade>
        {scene && <PartsCanvas key={sceneKey(scene)} scene={scene} playing={playing} />}
        {/* Siblings: their keys must differ, or React loses track of one and leaves it behind. */}
        {track && light === 'sparkle' && (
          <Sparkles key={`sparkles:${songKey}`} seed={songKey} playing={playing} />
        )}
        {track && light !== 'none' && <Sheen key={`sheen:${songKey}`} playing={playing} />}
      </div>
    </div>
  )
}

/** The cover's colors behind it, in two arrangements that cross over most of a minute. */
function Glow({ palette, playing }: { palette: string[]; playing: boolean }): React.JSX.Element {
  const { a, b } = glowColors(palette)
  const first = useRef<HTMLDivElement>(null)
  const second = useRef<HTMLDivElement>(null)
  useLoop(first, fadeGlowOut, playing)
  useLoop(second, fadeGlowIn, playing)
  return (
    <div className="cover__glow-light">
      <div ref={first} className="cover__glow-colors" style={glowStyle(a)} />
      <div ref={second} className="cover__glow-colors cover__glow-colors--b" style={glowStyle(b)} />
    </div>
  )
}

const GLOW_SHIFT: KeyframeAnimationOptions = {
  duration: GLOW_SHIFT_MS,
  easing: 'ease-in-out',
  direction: 'alternate',
  iterations: Infinity
}

function fadeGlowOut(element: HTMLElement): Animation {
  return element.animate([{ opacity: 1 }, { opacity: 0 }], GLOW_SHIFT)
}

function fadeGlowIn(element: HTMLElement): Animation {
  return element.animate([{ opacity: 0 }, { opacity: 1 }], GLOW_SHIFT)
}

function glowStyle(colors: string[]): React.CSSProperties {
  const [one, two, three] = colors
  return { '--glow-1': one, '--glow-2': two, '--glow-3': three } as React.CSSProperties
}

/** A glint of light across the cover now and then, like a glossy sleeve tilted to a lamp. */
function Sheen({ playing }: { playing: boolean }): React.JSX.Element {
  const element = useRef<HTMLDivElement>(null)
  useLoop(element, sweepSheen, playing)
  return <div ref={element} className="cover__sheen" />
}

function sweepSheen(element: HTMLElement): Animation {
  return element.animate(SHEEN, {
    duration: SHEEN_EVERY_MS,
    delay: SHEEN_FIRST_DELAY_MS,
    iterations: Infinity,
    fill: 'backwards'
  })
}

/** A few specks of light drifting slowly up across the cover, fading in and out. */
function Sparkles({ seed, playing }: { seed: string; playing: boolean }): React.JSX.Element {
  const specks = useMemo(() => sparkles(seed), [seed])
  return (
    <>
      {specks.map((speck, i) => (
        <Speck key={i} speck={speck} playing={playing} />
      ))}
    </>
  )
}

function Speck({ speck, playing }: { speck: Sparkle; playing: boolean }): React.JSX.Element {
  const element = useRef<HTMLDivElement>(null)
  // Each speck rides a layer the size of the cover, so its drift is in shares of the cover.
  const drift = useMemo(
    () =>
      (target: HTMLElement): Animation =>
        target.animate(
          [
            { transform: 'translate(0, 0)', opacity: 0 },
            { opacity: 0.75, offset: 0.25 },
            { opacity: 0.75, offset: 0.7 },
            {
              transform: `translate(${speck.drift * 100}%, ${-speck.rise * 100}%)`,
              opacity: 0
            }
          ],
          {
            duration: speck.durationMs,
            delay: -speck.startMs,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
            iterations: Infinity
          }
        ),
    [speck]
  )
  useLoop(element, drift, playing)
  return (
    <div ref={element} className="cover__speck">
      <span
        style={{
          left: `${speck.x * 100}%`,
          top: `${speck.y * 100}%`,
          width: `${speck.size}rem`,
          height: `${speck.size}rem`
        }}
      />
    </div>
  )
}
