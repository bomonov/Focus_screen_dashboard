import './LyricsEditor.css'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type {
  ColorEdit,
  ColorEditorState,
  LyricsState,
  PlaybackState,
  Settings,
  ShownLine,
  SingerRef
} from '../../main/ipc'
import type { Singer } from '../../main/services/lyrics/singers/cast'
import { applyEdit } from '../../main/services/lyrics/singers/edit'
import { sendColorEditor, useLyricsColorEditor } from '../hooks/useLyricsColorEditor'
import { useLyrics } from '../hooks/useLyrics'
import { useMusic } from '../hooks/useMusic'
import { cardGround, presetInfo } from '../theme/presets'
import { singerLookup } from '../widgets/music/singerColors'
import { AddLinesSheet } from './lyricsEditor/AddLinesSheet'
import { CastPicker } from './lyricsEditor/CastPicker'
import { EditLine } from './lyricsEditor/EditLine'
import {
  deleteAction,
  editorKey,
  shownLineAt,
  startingColors,
  type PickedBy
} from './lyricsEditor/editorView'
import { LineList } from './lyricsEditor/LineList'
import { ListenButton } from './lyricsEditor/ListenButton'
import { romajiByLine } from './lyricsEditor/lineRows'
import {
  extendRun,
  fitSelection,
  lineRun,
  pickSinger,
  selectedRange,
  stepLine,
  wholeLine,
  type Duet,
  type Selection
} from './lyricsEditor/selection'
import {
  editorLyrics,
  newLines,
  newWordsFor,
  onNewLine,
  ownRowOf,
  type NewLine
} from './lyricsEditor/shownLines'
import { PictureMenu } from './lyricsEditor/SingerBadge'
import { songCast } from './lyricsEditor/singers'
import { SongCast } from './lyricsEditor/SongCast'
import { Toolbar } from './lyricsEditor/Toolbar'
import { useAddLines } from './lyricsEditor/useAddLines'
import { useRunNote } from './lyricsEditor/useRunNote'
import { useTapping } from './lyricsEditor/useTapping'
import { decodePeaks } from './lyricsEditor/waveMath'
import { Waveform } from './lyricsEditor/Waveform'

/** Places that take typed text, where the editor's keys are just typing. */
const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function inField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || TYPING.has(target.tagName))
}

/**
 * A song with no coding yet starts from its lyrics' own lines (`editorLyrics`): their words,
 * timed as shown, nobody given anything. Sent once per song and set of lines (main ignores a
 * start whose lines aren't the song's), and again after "Remove colors" leaves the song without one.
 */
function useStartingColors(state: ColorEditorState | null, lyrics: LyricsState | null): void {
  const sent = useRef<string | null>(null)
  useEffect(() => {
    if (!state?.open || !state.song) return
    if (state.colors !== null) {
      sent.current = null
      return
    }
    // The lyrics' own lines, as `begin` checks them: never the rows of lines the user added.
    const found = editorLyrics(state, lyrics)
    if (!found || !lyrics) return
    const key = `${state.song.key}\n${lyrics.trackId ?? ''}\n${found.kind}\n${found.lines.length}`
    if (sent.current === key) return
    sent.current = key
    sendColorEditor({
      kind: 'begin',
      colors: startingColors(found.lines, state.song.durationSec, lyrics.offsetSec, found.source)
    })
  }, [state, lyrics])
}

/** The Color-Code Lyrics window's page. */
export function LyricsEditor({ settings }: { settings: Settings | null }): React.JSX.Element {
  const state = useLyricsColorEditor()
  const lyrics = useLyrics()
  const music = useMusic()
  useStartingColors(state, lyrics)
  // The singers' colors are fitted to the cards this window is drawn on.
  const ground = settings ? cardGround(settings.theme, false) : presetInfo('night').colors.card

  if (!state) return <main className="lyrics-editor" />
  if (!state.open || !state.song) {
    return (
      <main className="lyrics-editor lyrics-editor--closed">
        <p>Play a song with lyrics, then choose Color-Code Lyrics… again.</p>
      </main>
    )
  }
  // A new song starts afresh: nothing selected, no duet half-built, tap timing off.
  return (
    <Session key={state.song.key} state={state} lyrics={lyrics} music={music} ground={ground} />
  )
}

function Session({
  state,
  lyrics,
  music,
  ground
}: {
  state: ColorEditorState
  lyrics: LyricsState | null
  music: PlaybackState | null
  ground: string
}): React.JSX.Element {
  const colors = state.colors
  const [selection, setSelection] = useState<Selection | null>(null)
  // What Delete works on: the line (its block or row picked last) or the words picked in the
  // edit area.
  const [pickedBy, setPickedBy] = useState<PickedBy>('line')
  // A line the lyrics have that the coding hasn't (by its place among the shown lines), being
  // looked at: it's in the edit area as if added, and its first edit adds it.
  const [looking, setLooking] = useState<number | null>(null)
  const [duet, setDuet] = useState<Duet | null>(null)
  // The other end of a run of lines (Shift-click, ⇧↑/⇧↓); the selected line is the one edited.
  const [runEnd, setRunEnd] = useState<number | null>(null)
  const [choosing, setChoosing] = useState(false)
  // Open by default only while the song has too few singers of its own to code it with.
  const [pickerChoice, setPickerChoice] = useState<boolean | null>(null)
  const [menu, setMenu] = useState<{ singer: Singer; at: { x: number; y: number } } | null>(null)
  const addingSinger = useRef<string | null>(null)

  const extra = colors?.extra
  const hexes = useMemo(() => singerLookup(extra ?? [], ground), [extra, ground])
  const peaks = useMemo(() => decodePeaks(state.waveform), [state.waveform])

  // Lines the lyrics have now that the coding hasn't, and changed lines' new words: both come
  // from the lyrics on screen, so only while this song plays.
  const shownLyrics = editorLyrics(state, lyrics)
  const wordsOf = (row: number): ShownLine | null =>
    shownLyrics
      ? shownLineAt(
          shownLyrics.lines,
          row,
          state.song?.durationSec ?? 0,
          lyrics?.offsetSec ?? 0,
          shownLyrics.source
        )
      : null
  const fresh = colors ? newLines(colors, state.shownLines) : []
  const lookingAt = looking === null ? null : (fresh.find((line) => line.shown === looking) ?? null)
  const lookingWords = lookingAt ? wordsOf(lookingAt.shown) : null
  const adding = lookingAt && lookingWords ? { line: lookingAt, words: lookingWords } : null
  // Added, it's an ordinary line now, and the selection is already on its place. If the song
  // moved on before that, the selection was on a place, not a line: let it go.
  if (looking !== null && !adding) {
    setLooking(null)
    if (lookingAt) setSelection(null)
  }
  /** The coding the selection and the edit area work on: with the line being looked at in it. */
  const working =
    colors && adding
      ? applyEdit(colors, { kind: 'addLine', at: adding.line.place, shown: adding.words })
      : colors

  const selected = fitSelection(selection, working)
  const range = selectedRange(selected, working)
  // Lines main can time by listening: the selected line's, or the run's. Only lines in the coding.
  const runOther = runEnd !== null && colors?.lines[runEnd] ? runEnd : null
  const run = colors && selected && !adding ? lineRun(colors, selected.line, runOther) : null
  // A second voice selected on its own isn't timed (R8), and its line isn't selected: no button.
  const listenRun =
    run && (runOther !== null || colors?.lines[selected?.line ?? -1]?.under === undefined)
      ? run
      : null
  // The last run's note, while the selection is on its lines: moved off them, it's gone.
  const runNote = useRunNote(state.listen, run)
  // Only lines in the coding can be tapped or played: main has the coding, not the new line.
  const taps = useTapping({
    colors,
    selection: selected,
    ready: state.playingThis && !adding,
    playing: music?.playing ?? false,
    onLine: (line) => {
      if (!colors) return
      setSelection(wholeLine(colors, line))
      setPickedBy('line')
      setDuet(null)
      setRunEnd(null)
    }
  })
  const cast = colors ? songCast(colors) : []
  const newWordsRow =
    selected && !adding && colors
      ? newWordsFor(colors, state.shownLines).get(selected.line)
      : undefined
  const newWords = newWordsRow === undefined ? null : wordsOf(newWordsRow)
  const pickerOpen = pickerChoice ?? cast.length < 2
  const duetNow =
    duet &&
    selected &&
    range &&
    duet.line === selected.line &&
    duet.from === range.from &&
    duet.to === range.to
      ? duet.singers
      : []

  // Lines the user adds go by the screen's clock: the song's position plus its timing fix. While
  // this song plays, the fix on screen is its own.
  const add = useAddLines({
    colors,
    own: shownLyrics,
    playingThis: state.playingThis,
    music,
    fixSec: lyrics?.offsetSec ?? 0,
    durationSec: state.song?.durationSec ?? 0,
    selectedLine: adding ? null : (selected?.line ?? null)
  })
  // Main's reply has the added or moved line in place: the selection goes to it.
  if (add.arrived !== null && colors) {
    add.stopFollowing()
    setSelection(wholeLine(colors, add.arrived))
    setPickedBy('line')
    setLooking(null)
    setDuet(null)
    setRunEnd(null)
    taps.restart()
  }

  const select = (next: Selection | null): void => {
    setSelection(next)
    setPickedBy('line')
    setLooking(null)
    setDuet(null)
    setRunEnd(null)
    taps.restart()
    add.stopFollowing()
  }

  const lookAt = (line: NewLine): void => {
    const words = wordsOf(line.shown)
    if (!words) return
    select({ line: line.place, anchor: 0, focus: Math.max(0, words.words.length - 1) })
    setLooking(line.shown)
  }

  /** Every edit goes through here: one on the line being looked at adds it with it. */
  const sendEdit = (edit: ColorEdit): void => {
    const sent = adding ? onNewLine(edit, adding.line, adding.words) : edit
    if (sent) sendColorEditor({ kind: 'edit', edit: sent })
  }

  const assign = (singers: SingerRef | null): void => {
    if (!selected || !range) return
    sendEdit({ kind: 'assign', line: selected.line, from: range.from, to: range.to, singers })
  }

  const pick = (id: string): void => {
    if (!selected || !range) return
    const next = pickSinger(duet, selected.line, range, id)
    setDuet(next)
    assign(next.singers.length > 0 ? next.singers : null)
  }

  const toggleInCast = (id: string): void => {
    if (!colors) return
    const next = colors.cast.includes(id)
      ? colors.cast.filter((one) => one !== id)
      : [...colors.cast, id]
    sendEdit({ kind: 'setCast', cast: next })
  }

  // A singer just added joins the song's cast once main has given them an id, so they're ready
  // to use straight away.
  useEffect(() => {
    const name = addingSinger.current?.toLowerCase()
    if (!colors || !name) return
    const added = colors.extra.find((singer) => singer.name.toLowerCase() === name)
    if (!added) return
    addingSinger.current = null
    if (!colors.cast.includes(added.id)) {
      sendColorEditor({ kind: 'edit', edit: { kind: 'setCast', cast: [...colors.cast, added.id] } })
    }
  }, [colors])

  /** From the start of the line before, so the selected line can be tapped again from its start. */
  const replay = (): void => {
    if (!state.playingThis || !state.canSeek || !selected || adding) return
    taps.restart()
    sendColorEditor({ kind: 'replayLine', line: selected.line })
  }

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    // Keys that work a Japanese input method's word are its own: an Esc that ends one in the
    // new singer's name mustn't close the cast chooser round it.
    if (!colors || event.isComposing) return
    const key = editorKey({
      key: event.key,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      type: event.type === 'keyup' ? 'keyup' : 'keydown',
      repeat: event.repeat,
      inField: inField(event.target)
    })
    if (!key) {
      // Space plays the line here, so a focused button mustn't be pressed by it as well.
      if (event.key === ' ' && !inField(event.target)) event.preventDefault()
      if (event.key === 'Escape' && choosing && event.type === 'keydown') setChoosing(false)
      return
    }
    event.preventDefault()
    switch (key.kind) {
      case 'line':
        if (adding) {
          // From a line not in the coding yet, to the coded line just above or below it.
          const next = adding.line.place + (key.delta < 0 ? -1 : 0)
          if (colors.lines[next]) select(wholeLine(colors, next))
        } else if (selected) select(stepLine(colors, selected.line, key.delta))
        return
      case 'extendLines':
        if (selected && !adding) setRunEnd(extendRun(colors, selected.line, runOther, key.delta))
        return
      case 'playLine':
        if (!state.playingThis || adding) return
        if (!state.canSeek) window.focusScreen.sendMusicCommand({ kind: 'playPause' })
        else if (selected) sendColorEditor({ kind: 'playLine', line: selected.line })
        return
      case 'replayLine':
        replay()
        return
      case 'assign': {
        // The slots are the cast row's, as numbered on screen.
        const id = cast[key.slot]?.id
        if (id) pick(id)
        return
      }
      case 'clear': {
        // A line being looked at isn't in the coding yet: Delete only clears its words' singers.
        const row = selected && !adding ? ownRowOf(colors, selected.line, state.shownLines) : null
        const action = adding
          ? { kind: 'clear' as const }
          : deleteAction(
              colors,
              selected?.line ?? null,
              pickedBy,
              row === null ? null : wordsOf(row)
            )
        if (action?.kind === 'edit') sendEdit(action.edit)
        else if (action?.kind === 'clear') {
          setDuet(null)
          assign(null)
        }
        return
      }
      case 'undo':
      case 'redo':
        sendColorEditor({ kind: key.kind })
        return
      case 'tap':
        taps.tap(key.phase)
        return
      case 'addLines':
        add.openSheet()
        return
      case 'moveLine':
        add.moveLine(key.delta)
        return
      default: {
        // A key kind with no case here fails typecheck.
        const unhandled: never = key
        return unhandled
      }
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => onKey(event)
    window.addEventListener('keydown', listener)
    window.addEventListener('keyup', listener)
    return () => {
      window.removeEventListener('keydown', listener)
      window.removeEventListener('keyup', listener)
    }
  }, [])

  const openMenu = (singer: Singer, at: { x: number; y: number }): void => setMenu({ singer, at })
  const dropPicture = (singer: Singer, file: File): void => {
    const path = window.focusScreen.pathForFile(file)
    if (path) sendColorEditor({ kind: 'pictureFromPath', singer: singer.id, path })
  }
  const closeMenu = useCallback(() => setMenu(null), [])

  const romaji = working ? romajiByLine(working, state.romajiLines, state.romaji) : []
  const canAssign = range !== null

  return (
    <main className="lyrics-editor">
      <Toolbar
        state={state}
        music={music}
        tapOn={taps.on}
        tapMode={taps.mode}
        canPlayLine={selected !== null && !adding}
        addAt={add.canAdd ? add.placeAt : null}
        breakAt={add.canAdd ? add.breakAt : null}
        onPlayLine={() => {
          if (selected && !adding) sendColorEditor({ kind: 'playLine', line: selected.line })
        }}
        onReplay={replay}
        onAddLines={add.openSheet}
        onAddBreak={add.addBreak}
        onTapOn={taps.turnOn}
        onTapMode={taps.pickMode}
      />
      {colors ? (
        <>
          <Waveform
            colors={colors}
            selected={adding ? null : (selected?.line ?? null)}
            peaks={peaks}
            note={state.waveformNote}
            durationSec={state.song?.durationSec ?? 0}
            music={music}
            playingThis={state.playingThis}
            hexes={hexes}
            onSelect={(line) => select(wholeLine(colors, line))}
          />
          <LineList
            colors={colors}
            shownLines={state.shownLines}
            fresh={fresh}
            selected={adding ? null : (selected?.line ?? null)}
            selectedNew={adding?.line.shown ?? null}
            run={runOther === null ? null : run}
            runEnd={runOther}
            timing={state.listen?.timing ?? []}
            hexes={hexes}
            pictures={state.pictures}
            onSelect={(line) => select(wholeLine(colors, line))}
            onRunTo={(line) => {
              if (selected && !adding) setRunEnd(line)
              else select(wholeLine(colors, line))
            }}
            onSelectNew={shownLyrics ? lookAt : null}
          >
            {add.sheet && (
              <AddLinesSheet
                pressSec={add.sheet.pressSec}
                place={add.sheet.place}
                canAdd={add.canAdd}
                onAdd={add.addLines}
                onCancel={add.closeSheet}
              />
            )}
          </LineList>
          <div className="lyrics-editor__edit">
            {selected && working && (
              <EditLine
                // Another line starts afresh: an open "Add second voice…" was for the old one.
                key={adding ? `new-${adding.line.shown}` : selected.line}
                colors={working}
                shownLines={state.shownLines}
                lineIndex={selected.line}
                selection={selected}
                range={range}
                hexes={hexes}
                romaji={romaji[selected.line] ?? null}
                tapWord={taps.target?.line === selected.line ? taps.target.word : null}
                isNew={adding !== null}
                aside={
                  state.listen && listenRun ? (
                    <ListenButton
                      listen={state.listen}
                      note={runNote}
                      colors={colors}
                      run={listenRun}
                      durationSec={state.song?.durationSec ?? 0}
                      own={shownLyrics}
                    />
                  ) : null
                }
                onSelect={(next) => {
                  // Picking words on a line not in the coding yet keeps looking at it.
                  setSelection(next)
                  setPickedBy('words')
                  setDuet(null)
                  taps.restart()
                }}
                onEdit={sendEdit}
                onNewWords={
                  newWordsRow === undefined
                    ? undefined
                    : newWords && selected
                      ? () => sendEdit({ kind: 'newWords', line: selected.line, shown: newWords })
                      : null
                }
              />
            )}
            <SongCast
              cast={cast}
              hexes={hexes}
              pictures={state.pictures}
              duet={duetNow}
              choosing={choosing}
              pickerOpen={pickerOpen}
              canAssign={canAssign}
              onAssign={pick}
              onEveryone={() => {
                setDuet(null)
                assign('everyone')
              }}
              onChoose={() => setChoosing(!choosing)}
              onTogglePicker={() => setPickerChoice(!pickerOpen)}
              onMenu={openMenu}
              onDropFile={dropPicture}
            />
            {state.notice && (
              <p className="lyrics-editor__notice" role="status">
                {state.notice}
              </p>
            )}
            {(choosing || pickerOpen) && (
              <CastPicker
                extra={colors.extra}
                songCast={colors.cast}
                hexes={hexes}
                pictures={state.pictures}
                duet={duetNow}
                choosing={choosing}
                canAssign={canAssign}
                onPick={choosing ? toggleInCast : pick}
                onAddSinger={(name, color) => {
                  addingSinger.current = name
                  sendEdit({ kind: 'addSinger', name, color })
                }}
                onMenu={openMenu}
                onDropFile={dropPicture}
              />
            )}
            <p className="lyrics-editor__hint">
              <kbd>↑</kbd> <kbd>↓</kbd> lines · <kbd>Space</kbd> play line · <kbd>1</kbd>–
              <kbd>9</kbd> singers in this song · <kbd>Delete</kbd> removes an added line, puts a
              lyrics line back on its time, or clears picked words · <kbd>J</kbd> taps while Tap
              timing is on · <kbd>⌥</kbd>-click a word to split it · drag a block on the waveform to
              move its line, its edges and ticks to time them (<kbd>⌥</kbd> places them freely) ·{' '}
              <kbd>⌘Z</kbd> undo · <kbd>⌘N</kbd> add lines · <kbd>⌥↑</kbd> <kbd>⌥↓</kbd> move an
              added line · Shift-click lines to pick several · <kbd>⇧Space</kbd> replay from the
              line before
            </p>
          </div>
        </>
      ) : (
        <p className="lyrics-editor__waiting">
          {state.playingThis
            ? 'Getting the lyrics ready…'
            : `Play ${state.song?.title ?? 'the song'} to start coloring it.`}
        </p>
      )}
      {menu && (
        <PictureMenu
          singer={menu.singer}
          at={menu.at}
          hasPicture={state.pictures[menu.singer.id] !== undefined}
          onChoose={() => sendColorEditor({ kind: 'choosePicture', singer: menu.singer.id })}
          onRemove={() => sendColorEditor({ kind: 'removePicture', singer: menu.singer.id })}
          onClose={closeMenu}
        />
      )}
    </main>
  )
}
