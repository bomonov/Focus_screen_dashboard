import {
  forwardRef,
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import type {
  LyricsColors,
  LyricsStyle,
  PlaybackState,
  RomajiSource,
  SyncedLine,
  SyncedWord,
  Track
} from '../../../main/ipc'
import { canSeek, positionAt, seekEnd } from '../../../main/services/music/types'
import { springEasing } from '../tabBarMotion'
import { useAnchoredNow } from '../../hooks/useAnchoredNow'
import { useLineClock } from '../../hooks/useLineClock'
import { useCardGround } from '../../theme/cardGround'
import { useCoverColors } from '../../hooks/useCoverPalette'
import { AlbumInkSwitch } from './AlbumInkSwitch'
import { albumInks, lineInk, showsAlbumInk, wordInk } from './albumInk'
import { placeholderCover } from './cover'
import { syncedLineIndex } from '../../../main/services/lyrics/types'
import {
  breakSpan,
  GLIDE,
  GLIDE_SEC,
  glideDelayMs,
  glides,
  lineWords,
  plainRows,
  rowDistance,
  seekTarget,
  syncedRow,
  syncedRows,
  voiceLight,
  type GlideRow
} from './lyricsGlide'
import {
  colorsShown,
  lineChanges,
  lyricsCaption,
  type AutoSyncProgress,
  type ShownLyrics
} from './lyricsView'
import {
  drawnByLetter,
  letterBoxes,
  holdStrength,
  isHeld,
  letterSwell,
  letterTimes,
  popGroups,
  POP_SEC,
  romajiSpan,
  splitSpaces,
  SWELL_SEC,
  wordPop,
  type PopGlow
} from './sungMotion'
import {
  partStyle,
  pieceSpan,
  romajiPieces,
  rowPaint,
  singerLookup,
  singersInOrder,
  wordParts,
  type ColorPart,
  type RomajiPiece,
  type SingerLookup
} from './singerColors'
import { hasCjk } from './wordWeights'

interface LyricsPanelProps {
  state: PlaybackState
  track: Track
  /** null while the lookup runs. */
  lyrics: ShownLyrics | null
  /** Romaji under each line (same index; '' under a line without), or null. */
  romaji: string[] | null
  /** Whose the romaji is, for the caption (the demo's own says nothing). */
  romajiFrom: RomajiSource | null
  offsetSec: number
  /** Synced: a three-line window, the sung line in the middle. Full: more of the text. */
  style: LyricsStyle
  /** Set while auto-sync is timing these (plain) lyrics. */
  autoSync: AutoSyncProgress | null
  /** Plain lyrics: the line live sync says is being sung (an index into their lines), if any. */
  liveLine: number | null
  /** Who sings what, when the user colored this song; null draws it as always. */
  colors: LyricsColors | null
  /** Sung lines in the cover's colors (timed lyrics the user hasn't colored by singer). */
  albumInk: boolean
}

export function LyricsPanel({
  state,
  track,
  lyrics,
  romaji,
  romajiFrom,
  offsetSec,
  style,
  autoSync,
  liveLine,
  colors,
  albumInk
}: LyricsPanelProps): React.JSX.Element {
  const hasRomaji = romaji?.some((line) => line !== '') ?? false
  // Fitted to the cards as they are now (the theme, glass over a picture), once per song and theme.
  const ground = useCardGround()
  const hexes = useMemo(
    () => (colors ? singerLookup(colors.extra, ground) : null),
    [colors, ground]
  )
  // The cover's colors, read only where they could show; the stand-in label's until then.
  const inkable = showsAlbumInk(lyrics?.kind ?? null, colorsShown(colors))
  const cover = useCoverColors(inkable ? track.artwork : null)
  const { artist, album, title } = track
  const inks = useMemo(() => {
    if (cover) return albumInks(cover.lively, ground)
    const label = placeholderCover(artist, album, title)
    return albumInks([label.base, label.band, label.dot], ground)
  }, [cover, artist, album, title, ground])
  // A line is clicked: the song jumps to it, where the song can be jumped around in at all.
  const onSeek = canSeek(track)
    ? (timeSec: number): void =>
        window.focusScreen.sendMusicCommand({
          kind: 'seek',
          positionSec: Math.min(seekTarget(timeSec, offsetSec), seekEnd(track))
        })
    : null
  return (
    <div
      className="lyrics"
      role="region"
      aria-label="Lyrics"
      style={{ '--ink-ground': ground } as CSSProperties}
    >
      {inkable && <AlbumInkSwitch on={albumInk} inks={inks} />}
      {lyrics?.kind === 'synced' ? (
        <SyncedLyrics
          state={state}
          lines={lyrics.lines}
          romaji={romaji}
          offsetSec={offsetSec}
          style={style}
          onSeek={onSeek}
          colors={colors}
          hexes={hexes}
          inks={inkable && albumInk ? inks : null}
        />
      ) : lyrics?.kind === 'plain' && liveLine !== null ? (
        <LivePlainLyrics
          lines={lyrics.lines}
          romaji={romaji}
          index={liveLine}
          style={style}
          colors={colors}
          hexes={hexes}
        />
      ) : lyrics?.kind === 'plain' ? (
        <PlainLyrics
          state={state}
          track={track}
          lines={lyrics.lines}
          romaji={romaji}
          colors={colors}
          hexes={hexes}
        />
      ) : (
        <div className="lyrics__lines">
          <p className="lyrics__line lyrics__line--current lyrics__line--waiting">
            Looking up lyrics…
          </p>
        </div>
      )}
      <span className="lyrics__caption">
        {lyricsCaption(
          lyrics,
          offsetSec,
          autoSync,
          hasRomaji ? (romajiFrom ?? 'vocadb') : null,
          colorsShown(colors)
        )}
      </span>
    </div>
  )
}

/**
 * Text in its singers' colors (a duet's as a gradient across the whole run of it). Faint the
 * way any line off the sung one is, by its row; `sung` gives it the light, for SungRomaji.
 */
const Tint = forwardRef<
  HTMLSpanElement,
  { colors: readonly string[]; sung?: boolean; children: React.ReactNode }
>(function Tint({ colors, sung = false, children }, ref) {
  const { blend, style } = partStyle(colors)
  const classes = ['lyrics__tint']
  if (blend) classes.push('lyrics__tint--blend')
  if (sung) classes.push('lyrics__tint--sung')
  return (
    <span ref={ref} className={classes.join(' ')} style={style as CSSProperties}>
      {children}
    </span>
  )
})

/** A line's romaji, smaller, under it: in the line's colors (piece by piece) when it has them. */
function Romaji({
  text,
  pieces = null,
  ink = null
}: {
  text: string | null | undefined
  pieces?: RomajiPiece[] | null
  /** A sung line's album colors, across the romaji's words (not its box). */
  ink?: readonly string[] | null
}): React.JSX.Element | null {
  if (!text) return null
  return (
    <span className="lyrics__romaji">
      {pieces ? (
        pieces.map((piece, k) => (
          <Tint key={k} colors={piece.colors}>
            {piece.text}
          </Tint>
        ))
      ) : ink ? (
        <span
          className="lyrics__romaji-ink"
          style={{ '--ink-line': lineInk(ink, true) } as CSSProperties}
        >
          {text}
        </span>
      ) : (
        text
      )}
    </span>
  )
}

function SyncedLyrics({
  state,
  lines,
  romaji,
  offsetSec,
  style,
  onSeek,
  colors,
  hexes,
  inks
}: {
  state: PlaybackState
  lines: SyncedLine[]
  romaji: string[] | null
  offsetSec: number
  style: LyricsStyle
  onSeek: ((timeSec: number) => void) | null
  colors: LyricsColors | null
  hexes: SingerLookup | null
  /** The album's colors for the sung lines, or null for the text color. */
  inks: readonly string[] | null
}): React.JSX.Element {
  const changes = useMemo(
    () => lineChanges(lines, offsetSec, colors?.voices),
    [lines, offsetSec, colors]
  )
  const now = useLineClock(state.playing ? state.positionAt : null, state.positionSec, changes)
  const rows = useMemo(() => syncedRows(lines, romaji, colors), [lines, romaji, colors])
  const nowSec = positionAt(state, now) + offsetSec
  const current = syncedRow(lines, syncedLineIndex(lines, nowSec))
  const { positionSec, positionAt: readAt, playing } = state
  const durationSec = state.track?.durationSec ?? 0
  const clock = useMemo<LyricsClock>(
    () => ({ positionSec, readAt, playing, offsetSec, durationSec }),
    [positionSec, readAt, playing, offsetSec, durationSec]
  )
  return (
    <GlidingLyrics
      rows={rows}
      current={current}
      style={style}
      onSeek={onSeek}
      clock={clock}
      nowSec={nowSec}
      hexes={inks ? null : hexes}
      inks={inks}
    />
  )
}

/** Where the song is, for things that move with it between line changes (a break's note). */
interface LyricsClock {
  positionSec: number
  /** Epoch seconds when positionSec was read; it runs on from there while playing. */
  readAt: number
  playing: boolean
  offsetSec: number
  durationSec: number
}

/** Plain lyrics on their first play, with the line live sync says is being sung lit. */
function LivePlainLyrics({
  lines,
  romaji,
  index,
  style,
  colors,
  hexes
}: {
  lines: string[]
  romaji: string[] | null
  index: number
  style: LyricsStyle
  colors: LyricsColors | null
  hexes: SingerLookup | null
}): React.JSX.Element {
  const rows = useMemo(() => plainRows(lines, romaji, colors), [lines, romaji, colors])
  return <GlidingLyrics rows={rows} current={index} style={style} onSeek={null} hexes={hexes} />
}

/** The glide spring as an easing a CSS transition can run (off the main thread). */
const GLIDE_EASING = springEasing(GLIDE, GLIDE_SEC)

/** An eighth note. */
function NoteArt(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <ellipse cx="8.6" cy="17.6" rx="4.3" ry="3.3" transform="rotate(-22 8.6 17.6)" />
      <rect x="11.5" y="3.4" width="1.9" height="14.4" rx="0.9" />
      <path d="M12.6 3.4c1.9 2.2 6.4 2.7 6.6 7.3.1 1.4-.5 2.6-1.3 3.4.4-.9.5-1.8.3-2.7-.6-2.4-3-3.1-5.6-4z" />
    </svg>
  )
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/** Lyrics time (song seconds plus the per-song offset) at this moment. */
function lyricNow(clock: LyricsClock): number {
  const ran = clock.playing ? Math.max(0, Date.now() / 1000 - clock.readAt) : 0
  return clock.positionSec + ran + clock.offsetSec
}

/** Something to animate from `start` to `end` in lyrics time. */
interface SongTimed {
  element: Element
  keyframes: Keyframe[]
  start: number
  end: number
}

/**
 * Keeps keyframe animations in step with the song while `active`: each runs from its start to
 * its end in lyrics time, paused with the music. The player reports its position now and then;
 * only a real jump (a seek) moves them. `version` changes when the items do (a new line).
 *
 * They all share one clock, starting at the earliest item (or now, if the song hasn't reached it
 * yet), and later items wait with a delay:
 * play() rewinds an animation whose time is before 0 (or past its end) back to 0, so later
 * starts can't be negative times, and a finished one is never told to play again.
 */
function useSongAnimations(
  items: () => SongTimed[],
  clock: LyricsClock | null,
  active: boolean,
  version: unknown
): void {
  const running = useRef<{ version: unknown; base: number; list: Animation[] } | null>(null)
  useLayoutEffect(() => {
    const stop = (): void => {
      running.current?.list.forEach((animation) => animation.cancel())
      running.current = null
    }
    if (!active || !clock) return stop()
    const now = lyricNow(clock)
    // Made again when the song is (or is moved back to) before the clock's start: a second
    // voice is on while its main line is sung, before its own first word, and must wait for it.
    const made = running.current
    if (!made || made.version !== version || now < made.base - 0.25) {
      stop()
      const timed = items()
      // Never ahead of the song, so the clock can't start early and run the light before it's due.
      const base = Math.min(now, ...timed.map((item) => item.start))
      running.current = {
        version,
        base,
        list: timed.map(({ element, keyframes, start, end }) =>
          element.animate(keyframes, {
            delay: (start - base) * 1000,
            duration: Math.max(1, (end - start) * 1000),
            fill: 'both',
            easing: 'linear'
          })
        )
      }
    }
    const current = running.current
    if (!current) return
    const { base, list } = current
    const at = Math.max(0, (now - base) * 1000)
    const moving = clock.playing && !reducedMotion.matches
    for (const animation of list) {
      if (Math.abs(Number(animation.currentTime ?? 0) - at) > 250) animation.currentTime = at
      // Paused music, or no motion wanted: it shows how far along it is, still.
      if (moving && animation.playState === 'paused') animation.play()
      if (!moving && animation.playState === 'running') animation.pause()
    }
  })
  // Forgotten as well as cancelled: React (in development) mounts a component twice, and the
  // second mount must make its animations again rather than keep the cancelled ones.
  useEffect(
    () => () => {
      running.current?.list.forEach((animation) => animation.cancel())
      running.current = null
    },
    []
  )
}

const NOTE_FILL: Keyframe[] = [{ transform: 'translateY(100%)' }, { transform: 'none' }]
/** The solid note moves the other way inside its window, so it stays put while the edge rises. */
const NOTE_ART: Keyframe[] = [{ transform: 'translateY(-100%)' }, { transform: 'none' }]

/**
 * An intro or instrumental break: one note that fills up from the bottom as the break goes by,
 * full just as the singing comes back. Two copies of the note: a faint one, and a solid one
 * shown through a window whose top edge rises, both moved by transforms (off the main thread).
 */
function BreakNote({
  span,
  state,
  clock
}: {
  span: { start: number; end: number } | null
  /** 'now': the break being played; 'done' already past; 'ahead' still to come. */
  state: 'now' | 'done' | 'ahead'
  clock: LyricsClock | null
}): React.JSX.Element {
  const fill = useRef<HTMLSpanElement>(null)
  const art = useRef<HTMLSpanElement>(null)
  useSongAnimations(
    () =>
      span && fill.current && art.current
        ? [
            { element: fill.current, keyframes: NOTE_FILL, ...span },
            { element: art.current, keyframes: NOTE_ART, ...span }
          ]
        : [],
    clock,
    state === 'now' && span !== null,
    span
  )
  return (
    <span className={`glide__note glide__note--${state}`} aria-label="Instrumental">
      <span className="glide__note-base">
        <NoteArt />
      </span>
      <span ref={fill} className="glide__note-fill">
        <span ref={art} className="glide__note-art">
          <NoteArt />
        </span>
      </span>
    </span>
  )
}

/** A word lighting up as it's sung: its bright half slides across it. */
const WORD_SWEEP: Keyframe[] = [{ backgroundPosition: '100% 0' }, { backgroundPosition: '0% 0' }]

/**
 * The light over a part several sing: only the top layer (the veil) slides off; the colors under
 * it stay at `partPosition`, so the duet's gradient runs on across the part as it's revealed.
 * (One singer's words take WORD_SWEEP, their light a single layer in their color.)
 */
function wordSweep(partPosition: string): Keyframe[] {
  return [
    { backgroundPosition: `100% 0, ${partPosition}` },
    { backgroundPosition: `0% 0, ${partPosition}` }
  ]
}

/** A duet word box's own place in its part's colors, measured by RowWords. */
const BLEND_SWEEP = wordSweep('var(--part-x, 0px) 0')
/** A duet romaji piece's colors span the piece itself. */
const TINT_SWEEP = wordSweep('0 0')

/** Sets a style property only when it changes, so measuring again costs no restyle. */
function setStyle(element: HTMLElement, name: string, value: string | null): void {
  if (element.style.getPropertyValue(name) === (value ?? '')) return
  if (value === null) element.style.removeProperty(name)
  else element.style.setProperty(name, value)
}

/** The pop's glow in the theme's text color, from CSS; none on Daylight, where it would smudge. */
function popGlow(element: Element): PopGlow | null {
  const style = getComputedStyle(element)
  const peak = style.getPropertyValue('--pop-glow').trim()
  const rest = style.getPropertyValue('--pop-rest').trim()
  return peak && rest && peak !== 'none' && rest !== 'none' ? { peak, rest } : null
}

/** How a word is drawn: one box, or one per letter (held, or Japanese too long to wrap whole). */
interface WordShape {
  before: string
  core: string
  after: string
  letters: { text: string; boxed: boolean }[] | null
  /** Letters that may wrap between them (Japanese); a held English word stays in one piece. */
  wraps: boolean
}

/**
 * A row's words as boxes that can move, the spaces between them kept outside: drawn the same on
 * every row, so a line wraps the same whether it's sung or not. On the sung row (given a clock)
 * each word lights from left to right with a soft edge, pops as its light starts (the pieces of a
 * Japanese word together), and a held word swells letter by letter as the light reaches each one.
 * All on the song's clock, none of it looping; reduced motion keeps the light and drops the motion.
 */
function RowWords({
  words,
  timed,
  clock,
  paint = null,
  quiet = false,
  ink = null
}: {
  words: SyncedWord[]
  timed: boolean
  clock: LyricsClock | null
  /** The words' parts in their singers' colors, when the user colored them. */
  paint?: ColorPart[] | null
  /** Lit without the pops and swells (a second voice): quieter than its main line, like romaji. */
  quiet?: boolean
  /** The album's colors, run across the line and lit like the plain light (sung lines only). */
  ink?: readonly string[] | null
}): React.JSX.Element {
  const boxes = useRef<(HTMLSpanElement | null)[][]>([])
  const shapes = useMemo(
    () =>
      words.map((word): WordShape => {
        const { before, core, after } = splitSpaces(word.text)
        return {
          before,
          core,
          after,
          letters: drawnByLetter(word, timed) ? letterBoxes(core) : null,
          wraps: hasCjk(core)
        }
      }),
    [words, timed]
  )
  const groups = useMemo(() => popGroups(words), [words])
  // Each word's part (an index into paint, -1 for none) and each part's colors.
  const partOf = useMemo(() => {
    const of = words.map(() => -1)
    paint?.forEach((part, n) => {
      for (let i = part.from; i < part.to; i++) of[i] = n
    })
    return of
  }, [words, paint])
  // A word nobody sings, in a colored row, is in the text color (partStyle of no colors).
  const styles = useMemo(
    () => (paint ? [...paint.map((part) => partStyle(part.colors)), partStyle([])] : []),
    [paint]
  )
  const styleOf = (i: number): { blend: boolean; style: Record<string, string> } | undefined =>
    styles[partOf[i] ?? -1] ?? styles.at(-1)
  const wordBoxes = (i: number): HTMLSpanElement[] =>
    (boxes.current[i] ?? [])
      .slice(0, shapes[i]?.letters?.length ?? 1)
      .filter((part): part is HTMLSpanElement => part instanceof HTMLSpanElement)

  // A part's colors run across all its boxes as one: each box shows its own stretch of them,
  // by the part's width and where the box starts in it (the boxes' widths, spaces left out, so
  // a part that wraps runs on from one line to the next). Measured after every render, as the
  // lyrics' size can change (Three lines or Full); only what changed is written.
  useLayoutEffect(() => {
    if (!paint) return
    // Only a duet's gradient is laid across its part; one singer's color needs no measuring.
    const blends = paint.filter((part) => part.colors.length > 1)
    const measured = blends.map((part) => {
      const elements: HTMLSpanElement[] = []
      for (let i = part.from; i < part.to; i++) elements.push(...wordBoxes(i))
      return { elements, widths: elements.map((element) => element.offsetWidth) }
    })
    for (const { elements, widths } of measured) {
      const total = widths.reduce((sum, width) => sum + width, 0)
      let at = 0
      elements.forEach((element, k) => {
        setStyle(element, '--part-width', `${total}px`)
        setStyle(element, '--part-x', `${-at}px`)
        at += widths[k] ?? 0
      })
    }
    partOf.forEach((part, i) => {
      if ((paint[part]?.colors.length ?? 0) > 1) return
      for (const element of wordBoxes(i)) {
        setStyle(element, '--part-width', null)
        setStyle(element, '--part-x', null)
      }
    })
  })
  // The album's colors run across the whole line as one: each box shows its own stretch of them,
  // by where it starts in the line (boxes' widths, spaces left out, so a wrapped line runs on).
  useLayoutEffect(() => {
    const elements = words.flatMap((_, i) => wordBoxes(i))
    if (!ink) {
      for (const element of elements) setStyle(element, '--ink', null)
      return
    }
    const widths = elements.map((element) => element.offsetWidth)
    const total = widths.reduce((sum, width) => sum + width, 0) || 1
    let at = 0
    elements.forEach((element, k) => {
      const width = widths[k] ?? 0
      setStyle(element, '--ink', wordInk(ink, at / total, (at + width) / total))
      at += width
    })
  })
  useSongAnimations(
    () => {
      const motion = !reducedMotion.matches && !quiet
      const first = boxes.current[0]?.[0]
      const glow = first ? popGlow(first) : null
      return words.flatMap((word, i) => {
        const sweep = styleOf(i)?.blend ? BLEND_SWEEP : WORD_SWEEP
        const parts = wordBoxes(i)
        if (parts.length === 0) return []
        const widths = parts.map((part) => part.offsetWidth)
        const times = parts.length > 1 ? letterTimes(word, widths) : [word]
        const held = isHeld(word, timed)
        const popAt = words[groups[i] ?? i]?.start ?? word.start
        return parts.flatMap((element, k): SongTimed[] => {
          const time = times[k] ?? word
          const items: SongTimed[] = [
            { element, keyframes: sweep, start: time.start, end: time.end }
          ]
          if (!motion) return items
          if (held) {
            const keyframes = letterSwell(holdStrength(word.end - word.start), glow)
            items.push({ element, keyframes, start: time.start, end: time.start + SWELL_SEC })
          } else {
            items.push({ element, keyframes: wordPop(glow), start: popAt, end: popAt + POP_SEC })
          }
          return items
        })
      })
    },
    clock,
    clock !== null,
    // New colors (another theme) remake the light, picking up where the song is.
    paint ?? words
  )
  const keep =
    (i: number, k: number) =>
    (element: HTMLSpanElement | null): void => {
      ;(boxes.current[i] ??= [])[k] = element
    }
  const boxClass = (i: number): string => {
    const painted = styleOf(i)
    if (!painted) return ink ? 'glide__word glide__word--ink' : 'glide__word'
    return `glide__word ${painted.blend ? 'glide__word--blend' : 'glide__word--solo'}`
  }
  const boxStyle = (i: number): CSSProperties | undefined =>
    styleOf(i)?.style as CSSProperties | undefined
  return (
    <>
      {shapes.map((shape, i) => (
        <Fragment key={i}>
          {shape.before}
          {shape.letters ? (
            <span className={`glide__letters${shape.wraps ? ' glide__letters--wrap' : ''}`}>
              {shape.letters.map((letter, k) =>
                letter.boxed ? (
                  <span key={k} ref={keep(i, k)} className={boxClass(i)} style={boxStyle(i)}>
                    {letter.text}
                  </span>
                ) : (
                  <Fragment key={k}>{letter.text}</Fragment>
                )
              )}
            </span>
          ) : (
            <span ref={keep(i, 0)} className={boxClass(i)} style={boxStyle(i)}>
              {shape.core}
            </span>
          )}
          {shape.after}
        </Fragment>
      ))}
    </>
  )
}

/**
 * The sung row's romaji, lighting from left to right over the line's time, quieter than it. In
 * a colored line each piece lights over its own part's words, in that part's colors.
 */
function SungRomaji({
  text,
  span,
  clock,
  pieces = null,
  words,
  ink = null
}: {
  text: string
  span: { start: number; end: number }
  clock: LyricsClock
  pieces?: RomajiPiece[] | null
  /** The line's words, for when each piece lights. */
  words: SyncedWord[]
  /** The album's colors, uncovered by the light (they stay put; only the veil over them slides). */
  ink?: readonly string[] | null
}): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const pieceRefs = useRef<(HTMLSpanElement | null)[]>([])
  const version = useMemo(() => ({ span, pieces, words }), [span, pieces, words])
  useSongAnimations(
    () => {
      if (!pieces)
        return ref.current ? [{ element: ref.current, keyframes: WORD_SWEEP, ...span }] : []
      return pieces.flatMap((piece, k): SongTimed[] => {
        const element = pieceRefs.current[k]
        const time = pieceSpan(words, piece.from, piece.to)
        const keyframes = piece.colors.length > 1 ? TINT_SWEEP : WORD_SWEEP
        return element && time ? [{ element, keyframes, ...time }] : []
      })
    },
    clock,
    true,
    version
  )
  // The light is on an inline span: across a romaji line that wraps, it runs on from one row to
  // the next, rather than lighting every row at the same place.
  return (
    <span className="lyrics__romaji">
      {pieces ? (
        pieces.map((piece, k) => (
          <Tint
            key={k}
            ref={(element) => {
              pieceRefs.current[k] = element
            }}
            colors={piece.colors}
            sung
          >
            {piece.text}
          </Tint>
        ))
      ) : (
        <span
          ref={ref}
          className={`lyrics__romaji-light${ink ? ' lyrics__romaji--ink' : ''}`}
          style={ink ? ({ '--ink-line': lineInk(ink, true) } as CSSProperties) : undefined}
        >
          {text}
        </span>
      )}
    </span>
  )
}

/**
 * Lyrics after Apple Music's: the sung line lit and a touch larger, the rest dimmer (and, further
 * off, softly blurred) with distance. On the next line every row moves up on a spring, those
 * below the sung one a beat apart, like a ripple. Only `--glide-y` changes for that; each row's
 * transition (its own delay) runs the move, so nothing is stepped from script.
 */
function GlidingLyrics({
  rows,
  current,
  style,
  onSeek,
  clock = null,
  nowSec = null,
  hexes = null,
  inks = null
}: {
  rows: GlideRow[]
  current: number
  style: LyricsStyle
  onSeek: ((timeSec: number) => void) | null
  /** Synced lyrics: where the song is, so a break's note can fill as it goes. */
  clock?: LyricsClock | null
  /** Synced lyrics: the lyrics time this was drawn at, for the second voices being sung. */
  nowSec?: number | null
  /** The song's singer colors on this theme, when the user colored it. */
  hexes?: SingerLookup | null
  /** The album's colors: the sung line takes them as it's lit, the lines before keep them. */
  inks?: readonly string[] | null
}): React.JSX.Element {
  const songEnd = (clock?.durationSec ?? 0) + (clock?.offsetSec ?? 0)
  // Recomputed only when the rows or the song's length change, so nothing restarts midway.
  const spans = useMemo(() => rows.map((_, i) => breakSpan(rows, i, songEnd)), [rows, songEnd])
  const words = useMemo(
    () =>
      rows.map((row, i) =>
        lineWords(row, rows.slice(i + 1).find((later) => later.timeSec !== null)?.timeSec ?? null)
      ),
    [rows]
  )
  const romajiSpans = useMemo(() => words.map((line) => romajiSpan(line.words)), [words])
  const paints = useMemo(
    () =>
      hexes
        ? rows.map((row, i) => rowPaint(row, words[i] ?? { words: [], timed: false }, hexes))
        : null,
    [rows, words, hexes]
  )
  const box = useRef<HTMLDivElement>(null)
  const [offsetPx, setOffsetPx] = useState(0)
  // How far the sung line last moved: one or two lines on ripple, a jump moves all at once.
  const [last, setLast] = useState({ current, step: 0 })
  if (current !== last.current) setLast({ current, step: current - last.current })

  // Measured, not computed: lines wrap, so only the layout knows where the sung one is.
  // Measured again whenever the box changes size (going fullscreen, the window resizing).
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const measure = (): void => {
      const row = element.querySelector<HTMLElement>(`[data-row="${current}"]`)
      if (!row) return
      // Three lines: the sung one in the middle. Full: higher, with more of what's next.
      const anchor = element.clientHeight * (style === 'full' ? 0.34 : 0.5)
      setOffsetPx(anchor - (row.offsetTop + row.offsetHeight / 2))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [current, rows, style])

  const glide = { '--glide-y': `${offsetPx}px`, '--glide-easing': GLIDE_EASING } as CSSProperties
  return (
    <div ref={box} className={`glide glide--${style}`} style={glide}>
      {rows.map((row, i) => {
        // A second voice lights with its main row, and on its own while it's sung outside the
        // row's time; then its row is lifted to the sung row's brightness.
        const light = clock
          ? voiceLight(row, i === current, nowSec)
          : { lit: [] as number[], lifted: false }
        const classes = ['glide__row']
        if (row.text === null) classes.push('glide__row--break')
        if (!glides(i, current)) classes.push('glide__row--far')
        if (light.lifted) classes.push('glide__row--voice-sung')
        // Sung, in the album's colors; the sung row lights into them, later rows wait in white.
        const ink = inks && i <= current ? inks : null
        if (inks && i < current) classes.push('glide__row--inked')
        const props = {
          className: classes.join(' '),
          'data-row': i,
          'data-distance': rowDistance(i, current),
          style: { transitionDelay: `${glideDelayMs(i, current, last.step)}ms` },
          'aria-current': i === current ? ('true' as const) : undefined
        }
        const paint = paints?.[i] ?? null
        const plainColors = paint?.parts?.[0]?.colors
        const content =
          row.text === null ? (
            <BreakNote
              span={spans[i] ?? null}
              state={i === current ? 'now' : i < current ? 'done' : 'ahead'}
              clock={clock}
            />
          ) : (
            <>
              {words[i]?.words.length ? (
                <RowWords
                  words={words[i]?.words ?? []}
                  timed={words[i]?.timed ?? false}
                  clock={i === current ? clock : null}
                  paint={paint?.parts ?? null}
                  ink={ink}
                />
              ) : plainColors ? (
                // Plain lyrics have no words to light: lit, like every row, by its distance.
                <Tint colors={plainColors}>{row.text || '\u00a0'}</Tint>
              ) : row.coded ? (
                // All of a colored line went to its second voice, drawn under it on its own.
                '\u00a0'
              ) : (
                row.text || '\u00a0'
              )}
              {i === current && clock && row.romaji && romajiSpans[i] ? (
                <SungRomaji
                  text={row.romaji}
                  span={romajiSpans[i]}
                  clock={clock}
                  pieces={paint?.romaji ?? null}
                  words={words[i]?.words ?? []}
                  ink={ink}
                />
              ) : (
                <Romaji
                  text={row.romaji}
                  pieces={paint?.romaji ?? null}
                  ink={i < current ? ink : null}
                />
              )}
              {row.voices?.map((voice, v) => {
                const lit = light.lit.includes(v)
                return (
                  <span key={v} className={`glide__voice${lit ? ' glide__voice--sung' : ''}`}>
                    <RowWords
                      words={voice.words}
                      timed
                      clock={lit ? clock : null}
                      paint={paint?.voices[v] ?? null}
                      quiet
                    />
                  </span>
                )
              })}
            </>
          )
        const timeSec = row.timeSec
        // Lines repeat (choruses) and never reorder, so the position is the identity.
        return onSeek && timeSec !== null ? (
          <button key={i} type="button" tabIndex={-1} onClick={() => onSeek(timeSec)} {...props}>
            {content}
          </button>
        ) : (
          <p key={i} {...props}>
            {content}
          </p>
        )
      })}
    </div>
  )
}

/** No timestamps: the whole text drifts up as the song plays, from first line to last. */
function PlainLyrics({
  state,
  track,
  lines,
  romaji,
  colors,
  hexes
}: {
  state: PlaybackState
  track: Track
  lines: string[]
  romaji: string[] | null
  colors: LyricsColors | null
  hexes: SingerLookup | null
}): React.JSX.Element {
  const now = useAnchoredNow(state.playing ? state.positionAt : null, state.positionSec)
  const progress =
    track.durationSec > 0 ? Math.min(1, positionAt(state, now) / track.durationSec) : 0
  const style = { '--progress': progress } as CSSProperties

  return (
    <div className="lyrics__scroller">
      <div className="lyrics__plain" style={style}>
        {lines.map((line, index) => {
          // Plain text has no words to line the singers up with: one gradient of the line's.
          const singers = colors?.lines[index]
          const parts = hexes ? wordParts(singers ?? undefined, 0, false, hexes) : null
          const text = romaji?.[index]
          const pieces =
            parts && hexes && text
              ? romajiPieces(
                  text,
                  { text: line, words: [], parts, colors: hexes(singersInOrder(singers ?? [])) },
                  colors?.romajiSplits[index] ?? null
                )
              : null
          return (
            // Lines repeat (choruses) and never reorder, so the position is the identity.
            <p key={index} className="lyrics__plain-line">
              {parts?.[0] ? (
                <Tint colors={parts[0].colors}>{line || '\u00a0'}</Tint>
              ) : (
                line || '\u00a0'
              )}
              <Romaji text={text} pieces={pieces} />
            </p>
          )
        })}
      </div>
    </div>
  )
}
