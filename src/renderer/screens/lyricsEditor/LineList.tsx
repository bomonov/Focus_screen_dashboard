import { useEffect, useRef } from 'react'
import type { CodedLine, SongColors } from '../../../main/ipc'
import { formatSongTime } from '../../widgets/music/musicView'
import { partGradient, type SingerLookup } from '../../widgets/music/singerColors'
import { cueTime, lineParts, lineRows, lineSingers, textPieces } from './lineRows'
import { EveryoneCircle, SingerCircle } from './SingerBadge'
import { listEntries, type NewLine } from './shownLines'
import { singerById } from './singers'

/** Words in their singers' colors: one is plain colored text, several a gradient across the run. */
export function Painted({
  text,
  colors
}: {
  text: string
  colors: readonly string[] | null
}): React.JSX.Element {
  if (!colors || colors.length === 0) return <span>{text}</span>
  if (colors.length === 1) return <span style={{ color: colors[0] }}>{text}</span>
  return (
    <span className="painted-gradient" style={{ backgroundImage: partGradient(colors) }}>
      {text}
    </span>
  )
}

/** A line's start or end: as a cue sheet writes it, or dim and to the second (≈1:33) when it's a guess. */
function LineTime({ line, sec }: { line: CodedLine; sec: number }): React.JSX.Element {
  if (!line.guessed) return <span className="line-list__mono">{cueTime(sec)}</span>
  return <span className="line-list__mono line-list__mono--guess">≈{formatSongTime(sec)}</span>
}

/**
 * Every line of the song, in order, second voices indented under their line: its number, start,
 * end, who sings it and its words in their colors. "Changed" marks a line whose text the lyrics
 * no longer have; lines the lyrics have that the coding hasn't sit where they're sung, marked
 * "new", uncolored until the user colors them; lines the user added are marked "added", and
 * "also in the lyrics now" once the lyrics have them too, and lines being timed by listening
 * "timing…". Clicking a row selects it; Shift-clicking one runs the selection on to it, and the
 * run's rows are lit too. Anything given as children (the "＋ Add lines" box) lies over the top
 * of the rows.
 */
export function LineList({
  colors,
  shownLines,
  fresh,
  selected,
  selectedNew,
  run,
  runEnd,
  timing,
  hexes,
  pictures,
  onSelect,
  onRunTo,
  onSelectNew,
  children
}: {
  colors: SongColors
  shownLines: readonly string[]
  /** Shown lines the coding hasn't got. */
  fresh: readonly NewLine[]
  selected: number | null
  /** The shown line of a new line being looked at, when one is. */
  selectedNew: number | null
  /** A run of lines picked with Shift (places, `to` exclusive), the selected line among them. */
  run: { from: number; to: number } | null
  /** The run's other end, kept in view as ⇧↑/⇧↓ moves it. */
  runEnd: number | null
  /** Lines being timed by listening now. */
  timing: readonly number[]
  hexes: SingerLookup
  pictures: Record<string, string>
  onSelect: (line: number) => void
  /** Shift-click: the run reaches from the selected line to this one. */
  onRunTo: (line: number) => void
  /** Null while its song isn't playing: a new line's words come from the lyrics on screen. */
  onSelectNew: ((line: NewLine) => void) | null
  children?: React.ReactNode
}): React.JSX.Element {
  const rows = lineRows(colors, shownLines)
  const entries = listEntries(colors, fresh)
  const selectedRow = useRef<HTMLLIElement>(null)
  const endRow = useRef<HTMLLIElement>(null)
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, selectedNew])
  useEffect(() => {
    endRow.current?.scrollIntoView({ block: 'nearest' })
  }, [runEnd])
  const busy = new Set(timing)

  return (
    <div className="line-list">
      <div className="line-list__head" aria-hidden="true">
        <span>#</span>
        <span>Start</span>
        <span>End</span>
        <span>Who</span>
        <span>Lyrics</span>
      </div>
      <ol className="line-list__rows" role="listbox" aria-label="Lines" aria-multiselectable="true">
        {entries.map((entry) => {
          if (entry.kind === 'new') {
            const isSelected = entry.line.shown === selectedNew
            return (
              <li
                key={`new-${entry.line.shown}`}
                ref={isSelected ? selectedRow : undefined}
                role="option"
                aria-selected={isSelected}
                aria-disabled={onSelectNew === null}
                className="line-list__row line-list__row--new"
                title={onSelectNew ? undefined : 'Play the song to color its new lines'}
                onClick={() => onSelectNew?.(entry.line)}
              >
                <span />
                <span />
                <span />
                <span className="line-list__who">
                  <span className="visually-hidden">nobody yet</span>
                </span>
                <span className="line-list__text">
                  {entry.line.text}
                  <span className="line-list__changed">new</span>
                </span>
              </li>
            )
          }
          const row = rows[entry.index]
          const line = colors.lines[entry.index]
          if (!row || !line) return null
          const who = lineSingers(line, colors.cast)
          const pieces = textPieces(
            line.words.map((word) => word.text),
            lineParts(line, colors.cast, hexes)
          )
          const isSelected = row.index === selected
          const inRun = run !== null && row.index >= run.from && row.index < run.to
          const isBusy = busy.has(row.index)
          return (
            <li
              key={row.index}
              ref={isSelected ? selectedRow : row.index === runEnd ? endRow : undefined}
              role="option"
              aria-selected={isSelected || inRun}
              aria-busy={isBusy || undefined}
              className={`line-list__row${row.voice ? ' line-list__row--voice' : ''}${row.added ? ' line-list__row--added' : ''}${inRun && !isSelected ? ' line-list__row--run' : ''}`}
              onClick={(event) => (event.shiftKey ? onRunTo : onSelect)(row.index)}
            >
              <span className="line-list__mono">{row.number ?? ''}</span>
              <LineTime line={line} sec={line.start} />
              <LineTime line={line} sec={line.end} />
              <span className="line-list__who">
                {who.ids.map((id) => {
                  const singer = singerById(id, colors.extra)
                  if (!singer) return null
                  return (
                    <SingerCircle
                      key={id}
                      singer={singer}
                      hex={hexes([id])[0] ?? singer.color}
                      picture={pictures[id]}
                      small
                    />
                  )
                })}
                {who.everyone && <EveryoneCircle hexes={hexes(colors.cast)} small />}
                <span className="visually-hidden">
                  {[
                    ...who.ids.map((id) => singerById(id, colors.extra)?.name ?? ''),
                    ...(who.everyone ? ['everyone'] : [])
                  ]
                    .filter((name) => name !== '')
                    .join(', ') || 'nobody yet'}
                </span>
              </span>
              <span className="line-list__text">
                {row.voice && (
                  <span className="line-list__voice-mark" aria-label="Second voice: ">
                    ↳{' '}
                  </span>
                )}
                {row.instrumental && (
                  <span className="line-list__break">
                    <span aria-hidden="true">♪ </span>Music break
                  </span>
                )}
                {pieces.map((piece, i) => (
                  <Painted key={i} text={piece.text} colors={piece.colors} />
                ))}
                {row.changed && <span className="line-list__changed">changed</span>}
                {row.added && !row.instrumental && <span className="line-list__added">added</span>}
                {row.alsoInLyrics && (
                  <span className="line-list__also">also in the lyrics now</span>
                )}
                {isBusy && <span className="line-list__also">timing…</span>}
              </span>
            </li>
          )
        })}
      </ol>
      {children}
    </div>
  )
}
