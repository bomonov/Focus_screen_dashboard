import { Fragment, useCallback, useId, useLayoutEffect, useMemo, useRef } from 'react'
import { CHANNELS, toDataUrl } from './glassPieces'
import { PANEL_PIECES, panelMaps, type PanelPiece } from './liquidGlass'

export interface PanelGlass {
  id: string
  filter: React.JSX.Element
  /** The panel's size in px; every frame if need be, and its corners stay the same. */
  setSize(width: number, height: number): void
}

/** How much the rim lights up: a menu's glass is quieter than a lifted lens. */
const SHINE = 0.55

interface PanelImages {
  corner: number
  displacement: Record<PanelPiece, string>
  specular: Record<PanelPiece, string>
  scale: number
}

/**
 * Made maps by radius, bezel and thickness. Encoding the sixteen PNGs takes 10–20 ms, which a
 * menu opening each time would spend before its first frame; they only change with the rem.
 */
const made = new Map<string, PanelImages | null>()
/** A few sizes is plenty: one per window size the rem has been since. */
const KEEP = 4

function panelImages(r: number, bezel: number, thickness: number): PanelImages | null {
  const key = `${r}:${bezel.toFixed(2)}:${thickness.toFixed(2)}`
  const kept = made.get(key)
  if (kept !== undefined) return kept
  let images: PanelImages | null = null
  if (r >= 2) {
    const maps = panelMaps(r, bezel, thickness)
    const c = maps.corner
    const url = (pixels: Uint8ClampedArray, piece: PanelPiece): string =>
      toDataUrl(
        pixels,
        piece === 'top' || piece === 'bottom' ? 1 : c,
        piece === 'left' || piece === 'right' ? 1 : c
      )
    const urls = (pixels: Record<PanelPiece, Uint8ClampedArray>): Record<PanelPiece, string> =>
      Object.fromEntries(PANEL_PIECES.map((piece) => [piece, url(pixels[piece], piece)])) as Record<
        PanelPiece,
        string
      >
    images = {
      corner: c,
      displacement: urls(maps.displacement),
      specular: urls(maps.specular),
      // feDisplacementMap moves by scale × (channel − ½), so a full channel is half the scale.
      scale: maps.scale * 2
    }
  }
  if (made.size >= KEEP) made.delete(made.keys().next().value ?? '')
  made.set(key, images)
  return images
}

/** Makes the maps ahead of time (when the page is idle), so the first opening is quick too. */
export function preparePanelGlass(radius: number, bezel: number, thickness: number): void {
  panelImages(Math.round(radius), bezel, thickness)
}

/**
 * An SVG filter for `backdrop-filter: url(#id)` that frosts what's behind a rounded panel, bends
 * it at the rim and lights the rim, like Apple's menus. Its maps are made once per radius and cut
 * like a nine-slice image, so the panel can change size every frame (a submenu unfolding).
 */
export function usePanelGlass(
  radius: number,
  bezel: number,
  thickness: number,
  blur: number
): PanelGlass | null {
  // useId gives ":r1:"; colons would need escaping inside url(#…).
  const id = `panel${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const r = Math.round(radius)
  const filterRef = useRef<SVGFilterElement | null>(null)
  /** feImages by map ('d' displacement, 's' specular) and piece, to move as the size changes. */
  const images = useRef(new Map<string, SVGFEImageElement | null>())
  const size = useRef({ width: 0, height: 0 })

  const maps = useMemo(() => panelImages(r, bezel, thickness), [r, bezel, thickness])

  const corner = maps?.corner ?? 0

  /** Moves the pieces to fit a size of at least two corners and a middle. */
  const place = useCallback(
    (w: number, h: number) => {
      const c = corner
      size.current = { width: w, height: h }
      filterRef.current?.setAttribute('width', String(w))
      filterRef.current?.setAttribute('height', String(h))
      const boxes: Record<PanelPiece, [number, number, number, number]> = {
        topLeft: [0, 0, c, c],
        top: [c, 0, w - 2 * c, c],
        topRight: [w - c, 0, c, c],
        left: [0, c, c, h - 2 * c],
        right: [w - c, c, c, h - 2 * c],
        bottomLeft: [0, h - c, c, c],
        bottom: [c, h - c, w - 2 * c, c],
        bottomRight: [w - c, h - c, c, c]
      }
      for (const map of ['d', 's']) {
        for (const piece of PANEL_PIECES) {
          const image = images.current.get(`${map}${piece}`)
          if (!image) continue
          const [x, y, pw, ph] = boxes[piece]
          image.setAttribute('x', String(x))
          image.setAttribute('y', String(y))
          image.setAttribute('width', String(pw))
          image.setAttribute('height', String(ph))
        }
      }
    },
    [corner]
  )

  // Called every frame, but each change makes Chromium rebuild the filter: only on a change.
  const setSize = useCallback(
    (width: number, height: number) => {
      const w = Math.max(width, corner * 2 + 1)
      const h = Math.max(height, corner * 2 + 1)
      if (w !== size.current.width || h !== size.current.height) place(w, h)
    },
    [corner, place]
  )

  // New maps (a new radius) are drawn at their starting size: put the live one back.
  useLayoutEffect(() => {
    const { width, height } = size.current
    if (width > 0) place(Math.max(width, corner * 2 + 1), Math.max(height, corner * 2 + 1))
  }, [corner, place])

  if (!maps) return null
  const start = maps.corner * 2 + 1
  const pieces = (map: 'd' | 's'): React.JSX.Element[] =>
    PANEL_PIECES.map((piece) => (
      <feImage
        key={piece}
        ref={(element) => {
          images.current.set(`${map}${piece}`, element)
        }}
        href={(map === 'd' ? maps.displacement : maps.specular)[piece]}
        x="0"
        y="0"
        width="1"
        height="1"
        preserveAspectRatio="none"
        result={`${map}${piece}`}
      />
    ))

  return {
    id,
    setSize,
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
          height={start}
          filterUnits="userSpaceOnUse"
          primitiveUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          {/* Frosted first, then bent: the rim shows the blur a little further in. */}
          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation={blur}
            edgeMode="duplicate"
            result="soft"
          />
          {/* The middle bends nothing; the pieces only cover the rim. */}
          <feFlood floodColor="rgb(128,128,128)" result="flat" />
          {pieces('d')}
          <feMerge result="map">
            <feMergeNode in="flat" />
            {PANEL_PIECES.map((piece) => (
              <feMergeNode key={piece} in={`d${piece}`} />
            ))}
          </feMerge>
          {CHANNELS.map((channel, index) => (
            // Only filter primitives may sit in a <filter>: a fragment, not a <g>.
            <Fragment key={index}>
              <feDisplacementMap
                in="soft"
                in2="map"
                scale={maps.scale * channel.spread}
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
          <feColorMatrix in="bent" type="saturate" values="1.6" result="vivid" />
          {pieces('s')}
          <feMerge result="rim">
            {PANEL_PIECES.map((piece) => (
              <feMergeNode key={piece} in={`s${piece}`} />
            ))}
          </feMerge>
          <feComponentTransfer in="rim" result="shine">
            <feFuncA type="linear" slope={SHINE} />
          </feComponentTransfer>
          <feComposite in="shine" in2="vivid" operator="over" />
        </filter>
      </svg>
    )
  }
}
