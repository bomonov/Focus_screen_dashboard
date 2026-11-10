import { useLayoutEffect, useRef, useState } from 'react'
import type { ColorEdit } from '../../../main/ipc'
import type { ColorPart } from '../../widgets/music/singerColors'
import { Painted } from './LineList'
import {
  evenCuts,
  pointerCut,
  romajiSpaces,
  sameCuts,
  settlePending,
  stepCut,
  type PendingCuts
} from './romajiHandles'

/** The romaji's words and spaces, each with where it starts. */
function tokens(romaji: string): { text: string; at: number; space: boolean }[] {
  const found: { text: string; at: number; space: boolean }[] = []
  const pattern = /\s|\S+/gu
  for (const match of romaji.matchAll(pattern)) {
    found.push({ text: match[0], at: match.index, space: /\s/u.test(match[0]) })
  }
  return found
}

/** Which part a place in the romaji is in: a cut is where the next part starts. */
function partAt(cuts: readonly number[], at: number): number {
  return cuts.filter((cut) => cut <= at).length
}

/** A handle being dragged: which one, where the cuts were when it was taken, and where they are. */
interface Held {
  handle: number
  from: number[]
  cuts: number[]
}

/**
 * The line's romaji under it, each part in its singers' colors, with a handle on the space
 * where each part after the first starts. Dragged (or moved with ← →), a handle saves the
 * line's split; a split nothing was sure of shows dashed handles to start from.
 *
 * Each handle is one element for as long as the line shows, laid over the text and moved to
 * its space by script: one drawn inside its space would be a new element at every space it
 * crossed, letting go of the pointer it was dragged by and of the keyboard's focus.
 */
export function RomajiLine({
  romaji,
  lineIndex,
  parts,
  partNames,
  cuts,
  userSet,
  onEdit
}: {
  romaji: string
  lineIndex: number
  parts: readonly ColorPart[]
  /** Who sings each part, for the handles' names. */
  partNames: readonly string[]
  /** Where the parts start: the user's, else a sure guess; null when nothing's sure. */
  cuts: readonly number[] | null
  userSet: boolean
  /** Sends an edit (a line not in the coding yet is added with it). */
  onEdit: (edit: ColorEdit) => void
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const handles = useRef<(HTMLSpanElement | null)[]>([])
  const held = useRef<Held | null>(null)
  const [dragged, setDragged] = useState<number[] | null>(null)
  // A move just saved, shown until main's answer brings new cuts, so a second ← or → steps on
  // from it (`base` is the cuts it was made from: once they change, the answer has come).
  const [kept, setKept] = useState<PendingCuts | null>(null)

  const split = parts.length >= 2
  const placed = !split ? null : cuts ? [...cuts] : evenCuts(romaji, parts.length - 1)
  // Dropped, not just skipped, once main's cuts move on: the same cuts coming back later (an
  // Undo) must show what's saved, not this old move.
  const pending = settlePending(kept, cuts)
  if (pending !== kept) setKept(pending)
  const shown = split ? (dragged ?? pending?.cuts ?? placed) : null

  // Each handle onto its space, before the frame is drawn and again when the text reflows.
  useLayoutEffect(() => {
    const text = box.current
    if (!text || !shown) return
    const place = (): void => {
      const origin = text.getBoundingClientRect()
      shown.forEach((at, i) => {
        const handle = handles.current[i]
        const space = text.querySelector<HTMLElement>(`[data-at="${at}"]`)
        if (!handle || !space) return
        const rect = space.getBoundingClientRect()
        handle.style.left = `${rect.left + rect.width / 2 - origin.left}px`
        handle.style.top = `${rect.top - origin.top}px`
        handle.style.height = `${rect.height}px`
      })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(text)
    return () => observer.disconnect()
  })

  const save = (splits: number[] | null): void =>
    onEdit({ kind: 'romajiSplits', line: lineIndex, splits })
  const keep = (next: number[]): void => {
    setKept({ base: cuts, cuts: next })
    save(next)
  }
  /** Where the spaces are drawn now, to find the one a dragged handle is over. */
  const measured = (): { at: number; x: number }[] =>
    Array.from(box.current?.querySelectorAll<HTMLElement>('[data-at]') ?? []).map((element) => {
      const rect = element.getBoundingClientRect()
      return { at: Number(element.dataset.at), x: rect.left + rect.width / 2 }
    })
  /** A drag let go, by release or by losing the pointer: saved when it moved. Runs once a drag. */
  const finish = (): void => {
    const drag = held.current
    if (!drag) return
    held.current = null
    setDragged(null)
    if (!sameCuts(drag.cuts, drag.from)) keep(drag.cuts)
  }

  if (!split) {
    return (
      <p className="romaji-line">
        <Painted text={romaji} colors={parts[0]?.colors ?? null} />
      </p>
    )
  }
  if (!shown) {
    // No spaces to split at: the line's singers as one gradient, as the Focus Screen draws it.
    return (
      <p className="romaji-line">
        <Painted text={romaji} colors={parts.flatMap((part) => part.colors)} />
      </p>
    )
  }

  const spaces = romajiSpaces(romaji)
  return (
    <div className="romaji-line__wrap">
      <div ref={box} className={`romaji-line__text${cuts ? '' : ' romaji-line__text--unsure'}`}>
        <p className="romaji-line">
          {tokens(romaji).map((token) =>
            token.space ? (
              <span key={token.at} className="romaji-line__space" data-at={token.at}>
                {token.text}
              </span>
            ) : (
              <Painted
                key={token.at}
                text={token.text}
                colors={parts[partAt(shown, token.at)]?.colors ?? null}
              />
            )
          )}
        </p>
        {shown.map((at, i) => (
          <span
            // By place in the line, never by where it sits: it stays the same element as it moves.
            key={i}
            ref={(element) => {
              handles.current[i] = element
            }}
            className="romaji-line__handle"
            role="slider"
            tabIndex={0}
            aria-label={`Where ${partNames[i + 1] || 'the next part'} starts in the romaji`}
            aria-valuemin={0}
            aria-valuemax={romaji.length}
            aria-valuenow={at}
            aria-valuetext={`before “${romaji.slice(at).trim().split(/\s/u)[0] ?? ''}”`}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              const next = stepCut(shown, i, spaces, event.key === 'ArrowLeft' ? -1 : 1)
              if (next) keep(next)
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              // Held back from the press by preventDefault, so given here: the arrows work next.
              event.currentTarget.focus()
              event.currentTarget.setPointerCapture(event.pointerId)
              held.current = { handle: i, from: [...shown], cuts: [...shown] }
              setDragged([...shown])
            }}
            onPointerMove={(event) => {
              const drag = held.current
              if (!drag || drag.handle !== i) return
              const next = pointerCut(drag.cuts, i, measured(), event.clientX)
              if (!next) return
              drag.cuts = next
              setDragged(next)
            }}
            onPointerUp={finish}
            onLostPointerCapture={finish}
            onPointerCancel={() => {
              held.current = null
              setDragged(null)
            }}
          />
        ))}
      </div>
      {!cuts && (
        <span className="romaji-line__note">
          Not sure where the singers change in the romaji: drag a handle to set it.
        </span>
      )}
      {userSet && (
        <button
          type="button"
          className="lyrics-editor__button lyrics-editor__button--quiet"
          onClick={() => save(null)}
        >
          Place automatically
        </button>
      )}
    </div>
  )
}
