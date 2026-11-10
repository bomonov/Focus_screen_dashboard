import { Fragment, useCallback, useId, useLayoutEffect, useMemo, useRef } from 'react'
import { CHANNELS, toDataUrl } from './glassPieces'
import { capsuleMaps } from './liquidGlass'

/** How much of the rim light shows while the glass rests (it all shows when lifted). */
const RESTING_SHINE = 0.45

export interface CapsuleGlass {
  id: string
  filter: React.JSX.Element
  /**
   * How strongly the glass bends what's behind it, 0 (not at all) to 1 (fully), and how bright
   * its rim is. Set straight on the filter, so it can change every frame.
   */
  setStrength(amount: number): void
  /** The glass's width in px; also every frame, and its ends stay round. */
  setWidth(width: number): void
}

/** The three pieces each map is laid out in: round left end, stretched middle, round right end. */
type Piece = 'left' | 'middle' | 'right'
const PIECES: readonly Piece[] = ['left', 'middle', 'right']

/**
 * An SVG filter that bends and lights what's behind a capsule of glass this tall, for
 * `backdrop-filter: url(#id)`. Its maps are made once per height: the width can change every
 * frame (setWidth), because each map is a left end, a middle that's the same all along, and a
 * right end, and only where those sit changes.
 */
export function useCapsuleGlass(
  height: number,
  bezel: number,
  thickness: number
): CapsuleGlass | null {
  // useId gives ":r1:"; colons would need escaping inside url(#…).
  const id = `glass${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const h = Math.round(height)
  const filterRef = useRef<SVGFilterElement | null>(null)
  const bends = useRef<(SVGFEDisplacementMapElement | null)[]>([])
  const shine = useRef<SVGFEFuncAElement | null>(null)
  /** feImages by map ('d' displacement, 's' specular) and piece, to move as the width changes. */
  const images = useRef(new Map<string, SVGFEImageElement | null>())
  const strength = useRef(0)
  const width = useRef(0)

  const maps = useMemo(() => {
    if (h < 2) return null
    const made = capsuleMaps(h, bezel, thickness)
    const url = (pixels: Uint8ClampedArray, piece: Piece): string =>
      toDataUrl(pixels, piece === 'middle' ? 1 : made.cap, made.height)
    return {
      cap: made.cap,
      height: made.height,
      displacement: Object.fromEntries(
        PIECES.map((piece) => [piece, url(made.displacement[piece], piece)])
      ) as Record<Piece, string>,
      specular: Object.fromEntries(
        PIECES.map((piece) => [piece, url(made.specular[piece], piece)])
      ) as Record<Piece, string>,
      // feDisplacementMap moves by scale × (channel − ½), so a full channel is half the scale.
      scale: made.scale * 2
    }
  }, [h, bezel, thickness])

  const fullScale = maps?.scale ?? 0
  const cap = maps?.cap ?? 0

  const setStrength = useCallback(
    (amount: number) => {
      strength.current = amount
      CHANNELS.forEach((channel, index) => {
        bends.current[index]?.setAttribute('scale', String(fullScale * amount * channel.spread))
      })
      const lit = RESTING_SHINE + (1 - RESTING_SHINE) * Math.min(Math.max(amount, 0), 1)
      shine.current?.setAttribute('slope', String(lit))
    },
    [fullScale]
  )

  const setWidth = useCallback(
    (next: number) => {
      const w = Math.max(next, cap * 2)
      width.current = w
      filterRef.current?.setAttribute('width', String(w))
      for (const map of ['d', 's']) {
        const middle = images.current.get(`${map}middle`)
        middle?.setAttribute('width', String(Math.max(w - cap * 2, 0)))
        images.current.get(`${map}right`)?.setAttribute('x', String(w - cap))
      }
    },
    [cap]
  )

  // New maps (a new height) are drawn at their starting size: put the live ones back.
  useLayoutEffect(() => {
    setStrength(strength.current)
    if (width.current > 0) setWidth(width.current)
  }, [setStrength, setWidth])

  if (!maps) return null
  const start = maps.cap * 2 + 1
  const image = (map: 'd' | 's', piece: Piece, result: string): React.JSX.Element => (
    <feImage
      ref={(element) => {
        images.current.set(`${map}${piece}`, element)
      }}
      href={(map === 'd' ? maps.displacement : maps.specular)[piece]}
      x={piece === 'left' ? 0 : piece === 'middle' ? maps.cap : maps.cap + 1}
      y="0"
      width={piece === 'middle' ? 1 : maps.cap}
      height={maps.height}
      preserveAspectRatio="none"
      result={result}
    />
  )

  return {
    id,
    setStrength,
    setWidth,
    filter: (
      <svg
        width="0"
        height="0"
        aria-hidden="true"
        focusable="false"
        style={{ position: 'absolute' }}
      >
        <filter
          ref={filterRef}
          id={id}
          x="0"
          y="0"
          width={start}
          height={maps.height}
          filterUnits="userSpaceOnUse"
          primitiveUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          {image('d', 'left', 'mapLeft')}
          {image('d', 'middle', 'mapMiddle')}
          {image('d', 'right', 'mapRight')}
          <feMerge result="map">
            <feMergeNode in="mapLeft" />
            <feMergeNode in="mapMiddle" />
            <feMergeNode in="mapRight" />
          </feMerge>
          {CHANNELS.map((channel, index) => (
            // Only filter primitives may sit in a <filter>: a fragment, not a <g>.
            <Fragment key={index}>
              <feDisplacementMap
                ref={(element) => {
                  bends.current[index] = element
                }}
                in="SourceGraphic"
                in2="map"
                xChannelSelector="R"
                yChannelSelector="G"
                result={`bent${index}`}
              />
              <feColorMatrix
                in={`bent${index}`}
                type="matrix"
                values={channel.keep}
                result={`only${index}`}
              />
            </Fragment>
          ))}
          <feBlend in="only0" in2="only1" mode="screen" result="rg" />
          <feBlend in="rg" in2="only2" mode="screen" result="bent" />
          <feColorMatrix in="bent" type="saturate" values="1.3" result="vivid" />
          {image('s', 'left', 'shineLeft')}
          {image('s', 'middle', 'shineMiddle')}
          {image('s', 'right', 'shineRight')}
          <feMerge result="rim">
            <feMergeNode in="shineLeft" />
            <feMergeNode in="shineMiddle" />
            <feMergeNode in="shineRight" />
          </feMerge>
          <feComponentTransfer in="rim" result="shine">
            <feFuncA
              ref={(element) => {
                shine.current = element
              }}
              type="linear"
              slope={RESTING_SHINE}
            />
          </feComponentTransfer>
          <feComposite in="shine" in2="vivid" operator="over" />
        </filter>
      </svg>
    )
  }
}
