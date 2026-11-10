# Adding Missing Verses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the Color-Code Lyrics window, the user adds the lines a song's lyrics skip (pasted at the playhead), fixes their words, and times them by listening or with easier taps; the Focus Screen shows them in their place, colored and lit like any line.

**Architecture:**
- **The coding.** A coded line can carry `added: true`. Five new pure edits in `edit.ts`:
  - `addLines`, `retype`, `removeLine` and `moveLine`, sent by the page;
  - `heardTimes`, made only by main from a timing run.
- **The Focus Screen.** `colorLyrics` puts added lines in among the shown rows: synced lyrics by time, plain lyrics in coding order. An added line that is like an unmatched shown line between the same matched lines stands in for it.
  - The lyrics' own rows (colored as before) travel beside the result as `LyricsColors.own`. Auto-sync and the editor read the lyrics' own lines there.
  - Romaji is made for the rows as shown, so added lines get romaji too.
- **Time by listening.** While the window is open, the editor session keeps what it heard in a `SongRecording` (16 kHz mono, by song time). A run writes only its stretch (±0.5 s) to a temporary WAV for an aligner worker of the editor's own, deletes the WAV, and applies one `heardTimes` edit.
  - A run starts by itself once an added verse's stretch has played through, or on the button for the selected lines.
- **Easier tapping.**
  - A J tap waits in main until the waveform outline around it is heard (at most 3 s), then lands on the nearest onset within 120 ms.
  - The page adds a Words / Lines switch and Replay from the line before (⇧Space).

**Tech Stack:** Electron, TypeScript strict, React, plain CSS, Vitest. Two things that already exist:
- the Swift audio helper (the editor's existing tap);
- the auto-sync add-on's Python aligner (`native/aligner/aligner.py`, `align` op), through `createAlignerClient`.

No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-05-lyrics-added-verses-design.md` (approved by the user; read it first). Mockup: `design/lyrics-singers/add-verse.html`, option B.

## Global Constraints

- **Code rules.**
  - TypeScript strict, no `any` (`unknown` + narrowing); small files, named exports.
  - IPC channels and payload types only in `src/main/ipc.ts`. No new channel is needed: the editor's state and commands already go through `lyricsColorsGet/Changed/Command`, typed in `editorTypes.ts`.
  - The renderer never touches Node, files or the network. Files the renderer compiles stay free of runtime imports from Node or Electron: `types.ts`, `editorTypes.ts`, `added.ts`, `likeness.ts`, `listen.ts`, `apply.ts`.
- **Untrusted input.** The saved file and every page command are untrusted:
  - `parseSongColors` keeps `added` only where it's valid;
  - each reducer returns the same object when an edit is off.
- **Dependencies and network.** No new dependency and no new network host. Version pins stay: Vite 7, TypeScript < 6.1.
- **Privacy, approved by the user on 2026-11-05 ("yes, that's fine").**
  - The editor's heard audio stays in memory while its window is open, for the song on it, and is thrown away when the window closes or the editor moves to another song.
  - Only "Time by listening" writes a stretch of it (plus 0.5 s either side) to a temporary WAV for the aligner, deleted when the reply comes or the run fails.
  - No recording is made while the window is closed.
  - Nothing goes over the network.
- **Auto-sync never sees added lines.** `needsTiming`, and the plain text auto-sync keys timings by, stay the lyrics' own.
- **Limits.** At most 40 lines per add, at most 200 characters a line (whole characters). Blank lines and surrounding spaces in a paste are dropped.
- **No silent re-timing.** Time by listening never touches a line outside the selection or the added stretch. Lines already timed by hand are re-timed only when they are in the selection.
- **Platforms.** Time by listening is macOS only, and needs the auto-sync add-on (`npm run setup:aligner`), not auto-sync's Customize switch. Adding lines and tapping work everywhere the editor does.
- **Look.**
  - Readable from 1 m on a 1080p monitor. Buttons at least 44 px tall. Accent-colored words use `--accent-text`.
  - The "added" look (stripes and the left bar on the waveform and in the list, the tag) uses `--lyrics-added`, a token of the editor's own (R16): white at low opacity, `rgb(255 255 255 / 0.35)`, on the dark themes, and black at the same opacity on Daylight, whose light card white can't show on. The "added" tag is outlined in it, with the words in `--text`. Never the Homework purple (close to Rui's #BB88EE) or any singer's color.
- **Copy.** Plain words, sentence case. The exact strings are given in the tasks.
- **Tests.** Unit tests for pure logic and the main-process session; no UI pixel tests.
- **Commits and checks.**
  - Work in the worktree `.claude/worktrees/lyrics-singers`, on branch `lyrics-added-verses`. Never push.
  - After every task, `npm run typecheck`, `npm run lint` and `npm test` pass (about 2250 tests).
  - Commit messages start with `Added verses: ` and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The lyrics change under a song with an added verse.** This happens on a re-check, or when "Pick Other Lyrics…" picks another version, and the new lyrics now have the verse, letter for letter or nearly. The verse must show exactly once, with the user's words, and never vanish while the lyrics' own lines still match. Task 3 tests:
   - `an added line stands in for a like shown line, shown once`;
   - `an exact match shows the line once`;
   - `each shown line is stood in for once`.
2. **A timing run's answer arrives after things moved on.** The user edited, moved or removed the lines meanwhile, or the window switched songs. The answer lands only on lines still at the same place with the same text, and never on another song. Task 10 tests:
   - `an answer for lines that changed meanwhile leaves them be`;
   - `an answer after the window moved to another song is dropped`.
3. **The aligner fails, crashes or times out.** The temporary WAV is still deleted, no line moves, and the window says "Couldn't time these lines." Tests:
   - Task 9: `deletes the WAV when the aligner fails, and answers null`;
   - Task 10: `a failed run says so and changes nothing`.
4. **A messy paste.** Windows line endings, blank lines, full-width spaces round a line, 41 lines, or a 300-character line: lines are cleaned, or refused with a reason, never half-added. Task 11 test `pastedLines cleans a paste and refuses what's too much`; Task 1 test `refuses … more than 40 lines, a line over 200 characters`.
5. **A tap on the first listen, before the outline there is heard.** It still lands on the onset once heard, taps keep their order, and ⌘Z right after a tap undoes that tap. Task 7 tests:
   - `a tap lands on the sound it was meant for`;
   - `undo right after a tap undoes that tap`;
   - `an end waits behind its start`.

## Rulings

Where the spec and the code meet awkwardly, decided by the spec:

- **R1 · Shown rows now include added lines.**
  - *Ruling:* `colorLyrics` adds and drops rows, although the code says it never does ("the romaji still lines up by index"). The romaji is made for the rows as shown (`romajiFor` already runs on the colored lyrics). The lyrics' own rows go beside the result as `LyricsColors.own`.
  - *Why:* the Focus Screen draws rows by index, while auto-sync and the editor must keep seeing the lyrics' own lines (spec: "Auto-sync never sees added lines").
  - *Cost if wrong:* a reader of `LyricsState.lyrics` that wants the lyrics' own lines sees added ones. These readers are moved to `own` in Task 4: `needsTiming`, the editor's `shownFor`, the page's `editorLyrics` and the demo's romaji.
- **R2 · The edit carries ready-made lines, not texts.**
  - *Ruling:* the spec's example edit is `addLines { at: seconds, after, texts }`. Here the page builds the lines instead, because word splitting (`japaneseWords`, `estimateWords`) lives in the renderer. The edit is `{ kind: 'addLines'; at: <place in lines>; lines: ShownLine[] }`. Main checks each line as it checks `addLine`'s, and accepts the edit only while the editor's song is the one on (`playingThis()`, playing or paused: its position is known either way).
  - *Why:* every other line is split the same way, by the same code (`begin` and `addLine` work like this).
  - *Cost if wrong:* a placement bug in the page isn't caught by main, which checks shape, not place.
- **R3 · No combined begin and add.**
  - *Ruling:* the spec says "if the song has no coding yet, adding lines begins one first, in one step". The page already sends `begin` the moment the song plays (`useStartingColors`), and adding needs the editor's song on (playing or paused). So "＋ Add lines" is off until the coding exists, a moment after play.
  - *Why:* `begin` keeps its strict check that every line is the lyrics' own.
  - *Cost if wrong:* none visible, unless `begin` is refused. Then adding is off, as coloring is.
- **R4 · Taps wait for the outline.**
  - *Ruling:* a J tap waits in main until the outline around it is heard, at most 3 s, then snaps.
  - *Why:* audio reaches the outline 1.5 s after it's heard (`HOLD_SEC`), so on a first listen there is nothing to snap to at the moment of the tap.
  - *Cost if wrong:* on a first listen, the list shows a tap's time about 2 s late. Every other command first lets waiting taps land, so ⌘Z and edits still apply in order.
- **R5 · A run of lines in the list.**
  - *Ruling:* "lines selected in the list (one or several in a row)" needs a new selection. Shift-click in the list (and ⇧↑/⇧↓) extends the selection to a run of lines. The edit area keeps showing the focused line.
  - *Why:* today's selection is one line and words in it.
  - *Cost if wrong:* one more piece of page state.
- **R6 · The editor's own aligner worker.**
  - *Ruling:* the editor runs its own aligner process (same add-on, its own `createAlignerClient`). It starts on the first run and stops 3 minutes after its last run, or when the window closes.
  - *Why:* the worker answers one request at a time, so a shared one would make a run wait behind a whole song of auto-sync's.
  - *Cost if wrong:* a second copy of a model in memory (~1–2 GB) while both run.
- **R7 · Where the heard audio is kept.**
  - *Ruling:* `heardAudio.ts` doesn't keep audio. It only holds chunks until they're placed in the outline. The session keeps the audio in autosync's `SongRecording`, which already lays audio out by song time and counts what was heard, written where the outline is. `heardAudio.ts` stays as it is.
  - *Why:* reuse, as the brief asked.
  - *Cost if wrong:* none.
- **R8 · Second voices in a run.**
  - *Ruling:* second voices are left out of a timing run and keep their times.
  - *Why:* the aligner places lines one after another, and a voice overlaps its line.
  - *Cost if wrong:* a voice under a line timed by listening still needs its own taps.
- **R9 · When there's no coloring at all.**
  - *Ruling:* "none of the coding matches" counts only the lyrics' own coded lines. An added line that happens to match a shown line doesn't make the song colored.
  - *Why:* the spec's reason: "a different version altogether, and its verse may be the added one".
  - *Cost if wrong:* none expected.
- **R10 · Where a selected run's stretch starts.**
  - *Ruling:* it starts at the first selected line's start, even when that is a guess.
  - *Why:* it's the one time the user can see and set (tap or drag), and plain lyrics' spread starts are no anchor at all.
  - *Cost if wrong:* a run starting on a badly guessed line hears the wrong audio, and the user taps its start first.
- **R11 · Moving an added line in synced lyrics (replaced by R13; kept for the record).**
  - *Ruling:* in synced lyrics an added line shows at its own start (spec), so ⌥↑/⌥↓ there reorders the list only. It also changes where the line shows on plain lyrics.
  - *Why:* the spec places synced added lines by time.
  - *Cost if wrong:* the user expects a move to change where the line shows in synced lyrics, and has to tap it instead.
- **R12 · Letting go of J in Lines mode.**
  - *Ruling:* in Lines mode only J's press counts; letting go marks nothing.
  - *Why:* a held J in Words mode marks a word's end, which means nothing for a whole line.
  - *Cost if wrong:* none.
- **Demo.** 星空レター stays as it is: adding a line works on it like any song, offline. The spec leaves this to the builder.

Controller rulings, made on review of this plan. They override the rulings above where they disagree, and the tasks below implement them (pre-flight findings PF1–PF12 in `.superpowers/sdd/2026-11-05-lyrics-added-verses/progress.md`):

- **R13 · Moving an added line in synced lyrics changes where it shows (replaces R11).**
  - *Ruling:* ⌥↑/⌥↓ on an added line in synced lyrics moves it past its neighbour and gives it a new guessed time between its new neighbours. Its start is just after the new line before it ends, plus `MOVE_GAP_SEC` (0.1 s). Its length is kept when it fits before the new line after it starts; otherwise it's spread over the gap. A gap under 1 s keeps the length anyway. The line is marked `guessed` again (not `timed`), so the next tap or timing run places it. In plain lyrics a move only changes the order, and no times are sent.
  - *Where:*
    - Task 1: `moveLine`'s optional `start`/`end`, and the reducer re-spreading the words.
    - Task 11: `movedTimes` works the times out from the neighbours' real spans.
    - Task 12: ⌥↑/⌥↓ sends them.
    - `timesMoved` keeps the timing fix through a move (Task 1, PF2).
  - *Why:* the spec gives ⌥↑/⌥↓ so that "a misplaced verse is a few key presses from right". A move that changes nothing on the Focus Screen breaks that.
  - *Cost if wrong:* a line the user had timed and then moved needs timing again. That is expected: they moved it because its place was wrong.
- **R14 · Real times include the lyrics' own.**
  - *Ruling:* a line's time counts as real when it matches a shown line of synced lyrics (LRCLIB's, or auto-sync's once it has timed them), using that line's time. Failing that, it counts when the coded line is `timed`, using its own time. A song begun from plain lyrics that auto-sync has since timed is therefore placed by the press time, not after the selected line. The end of a timing run's stretch uses the same rule.
  - *Where:*
    - Task 8: `realSpans`, and `listenStretch` taking the lyrics' own lines.
    - Task 10: the session keeps the lyrics' own lines.
    - Task 11: `addPlace`, `addedShownLines` and `movedTimes`.
    - Task 12: passes `editorLyrics(...)`.
  - *Why:* the spec lists "synced lyrics, auto-sync's, or timed by the user" as real times. The coding's own `guessed` marks lag behind what the screen shows.
  - *Cost if wrong:* none expected. It is the spec's rule.
- **R15 · Added lines and the per-song timing fix.**
  - *Ruling:* the Focus Screen lights `syncedLineIndex(lines, position + offsetSec)` (`LyricsPanel.tsx`; `lineChanges` uses `timeSec − offsetSec`). A positive fix shows lines sooner (⌘[ "earlier" adds `OFFSET_STEP_SEC`). So a line stored at `t` lights when the position reaches `t − fix`, and an added line is stored at `press + fix` so that it lights at the press. Adding lines doesn't clear the fix.
  - *The screen's clock vs song time:* every time `realSpans` gives, and every added line's time, is on the screen's clock (`song position + fix`). Turning one back into song time, as the recording and the aligner need, is `− fix`.
  - *A run's answer* comes in song time and is stored as it comes, the way a tap is. Its lines turn `timed`, so its save clears the fix (`timesMoved`), as a tap's does today.
  - *Where:*
    - Task 11: `addedShownLines` and `addPlace` take `fixSec`.
    - Task 12: passes `lyrics.offsetSec`.
    - Task 8: `listenStretch` gives song time.
    - Task 10: cuts the recording there, and `ListenState.fixSec` carries the fix the page needs while another song plays.
  - *Tests:* Task 11 (the added line lights at the press under a 0.5 s fix); Tasks 8 and 10 (the stretch and the WAV in song time under a 0.5 s fix).
  - *Why:* otherwise an added line shows off by the fix until it's timed (found in plan review).
  - *Cost if wrong:* an added line in a song with a fix shows shifted until it's timed.
- **R16 · The "added" look is neutral.**
  - *Ruling:* the waveform's added blocks are stripes in white at low opacity, and the list's "added" tag is a white-outlined tag. Not the Homework purple, which is close to Rui's #BB88EE and would read as a singer. On Daylight the same token is black at that opacity, because white can't show on its light card.
  - *Where:* Global Constraints (Look) and Task 12.
  - *Why:* the spec says it must not be any singer's colour, and allows the builder another.
  - *Cost if wrong:* none.

---

### Task 1: Added lines in the coding

**Files:**
- Create: `src/main/services/lyrics/singers/added.ts`. The renderer compiles it, so it has no Node or Electron imports. Task 2 gives it a runtime import of `./likeness`, itself import-free, which is renderer-safe.
- Modify:
  - `src/main/services/lyrics/singers/types.ts`: `CodedLine.added`, four `ColorEdit` kinds;
  - `src/main/services/lyrics/singers/parse.ts`;
  - `src/main/services/lyrics/singers/edit.ts`: four reducers, and `newWords` refuses added lines;
  - `src/main/services/lyrics/singers/editorCommand.ts` (`EDIT_KINDS`);
  - `src/main/services/lyrics/singers/editor.ts` (`timesMoved`).
- Test: `parse.test.ts`, `edit.test.ts`, `editor.test.ts`, all in `src/main/services/lyrics/singers/`.

**Interfaces:**
- Produces, in `types.ts`:

  ```ts
  // CodedLine:
  /** The user added it ("＋ Add lines"): placed by its own times and its place in `lines`. Main lines only. */
  added?: true
  // ColorEdit gains:
  | { kind: 'addLines'; at: number; lines: ShownLine[] }      // at: a place in `lines`
  | { kind: 'retype'; line: number; shown: ShownLine }        // the line's new words, spread over its own span
  | { kind: 'removeLine'; line: number }
  /**
   * Moves an added line one place, past the block next to it. In synced lyrics the page also
   * sends its new guessed span (R13, Task 11's `movedTimes`), both or neither; plain lyrics send none.
   */
  | { kind: 'moveLine'; line: number; delta: -1 | 1; start?: number; end?: number }
  ```

- Produces, in `added.ts`:
  - `MAX_ADDED_LINES = 40`;
  - `MAX_ADDED_CHARS = 200`.
  - There is no `hasRealTime`: what counts as a real time needs the lyrics' own lines (R14), so it's Task 8's `realSpans`.

- [ ] **Step 1: Write the failing tests.**
  - **`parse.test.ts`**
    - `keeps the added mark on a main line, drops it on a second voice`.
  - **`edit.test.ts`, `addLines`.** Start from a two-line coding, with a voice under line 1 for the second test.
    - `adds lines as the user's own guesses, nobody singing`. Apply `{ kind: 'addLines', at: 1, lines: [X, Y] }`, where X and Y are `ShownLine`s and **X carries `timed: true`** (Y carries no mark). Then:
      - `lines.length === 4`;
      - `lines[1].text === X.text`;
      - `lines[1].added === true` and `lines[1].guessed === true`;
      - `lines[1].timed === undefined` (the reducer drops X's `timed`);
      - `lines[2].added === true`, `lines[2].guessed === true`, `lines[2].timed === undefined`;
      - every word's `singers === null`.
    - `moves later second voices along`: a voice with `under: 1` has `under: 3` after adding two lines at 1.
    - `refuses a place between a line and its voice, more than 40 lines, a line over 200 characters, a blank line, or words that don't spell the line`. Each returns the same object (`toBe(start)`).
  - **`edit.test.ts`, `retype`.**
    - `retypes an added line, keeping its times and the singers of unchanged words`. An added line `'あ い う'` with singers on each word, retyped to `'あ え う'`:
      - start and end are unchanged;
      - `あ ` and `う` keep their singers, and `え ` has `null`;
      - `romajiSplits` is gone;
      - `added` and `guessed` are kept.
    - `won't retype the lyrics' own line`: the same object comes back.
  - **`edit.test.ts`, `removeLine`.**
    - `removes an added line with its second voices`: later `under`s move back.
    - `won't remove the lyrics' own line`.
  - **`edit.test.ts`, `moveLine`.**
    - `moves an added line past the lyrics' own line, voices and all`. Lines `[A, A's voice, X(added), B]` with `moveLine X −1` (no times: plain lyrics) give `[X, A, A's voice, B]`, the voice's `under` re-pointed to A's new place, and X's start, end, words and marks unchanged. Then `+1` twice gives `[A, voice, B, X]`.
    - `stays put at either end, and won't move the lyrics' own lines`.
    - `re-times a moved line when the move brings times (R13)`. Lines `[A(timed, 10–14), X(added, timed, 30–34, words 'X ' 30–32 and 'x' 32–34 sung by ichika), X's voice(28–30)]`, with `{ kind: 'moveLine', line: 1, delta: -1, start: 6, end: 8 }`. The lines become `[X, X's voice, A]`, and then:
      - `lines[0].start === 6` and `lines[0].end === 8`;
      - the words are `6–7` and `7–8`: scaled into the span, each keeping its share; their singers are kept;
      - `lines[0].guessed === true` and `lines[0].timed === undefined`;
      - the voice is `under: 0` at `4–6`: moved by as much as X's start did, its length kept;
      - A is unchanged.
    - `refuses half a span or a backwards one`. `{ …, start: 6 }` alone, `{ …, start: 8, end: 6 }`, `{ …, start: -1, end: 2 }` and `{ …, start: NaN, end: 8 }` each return `toBe(start)`.
  - **`edit.test.ts`, other kinds.**
    - `newWords leaves an added line alone`.
    - `every new edit's result passes parseSongColors unchanged`, over the cases above.
  - **`editor.test.ts`** (`timesMoved`, PF2). The song has an offset of 0.5 (`offsets: { [KEY_A]: 0.5 }`), and the saved coding is `[A(timed, 9–14), B(timed, 20–25), X(added, guessed, 40–43)]`.
    - `keeps the new edit kinds`: `parseColorEditorCommand({ kind: 'edit', edit: { kind: 'moveLine', line: 0, delta: 1, start: 1, end: 2 } })` is not null.
    - `moving an added line doesn't clear the song's timing fix`. `moveLine` of line 2 by −1 with `start: 14.1, end: 17.1` (re-timed, as in synced lyrics) goes through `command`. After the save delay, `offsets.get(KEY_A) === 0.5` and `colorsOf(editor).lines[1].start === 14.1`. Then `undo`: after the save delay, `offsets.get(KEY_A) === 0.5` again.
    - `retyping an added line doesn't clear the song's timing fix`. `retype` of line 2 with the same number of words, re-spread, gives `offsets.get(KEY_A) === 0.5` after the save delay.
    - `a timing edit clears the song's offset` and `an undone timing edit counts as timing too` (existing) pass unchanged.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers`. Expected: FAIL (missing kinds and module).
- [ ] **Step 3: Implement.**
  - **`addLines`.** Check the place as `addLine` does. Use `fromShown` for each line, then reject a blank text, a text of more than `MAX_ADDED_CHARS` (`Array.from`), or more than `MAX_ADDED_LINES` lines. Delete the `timed` that `fromShown` keeps from a `ShownLine` and set the marks `{ added: true, guessed: true }`, then shift later `under`s by the count.
  - **`retype`.**
    - Only on an added main line. The text rule is the same as for `addLines`.
    - Words come from `shown.words`, pulled onto the line's own `[start, end]` the way `fromShown` pulls them.
    - Singers come through `keptSingers`.
    - Drop `romajiSplits`, keep the other marks.
  - **`removeLine` / `moveLine`.** Only on an added main line. A *block* is a main line and the voices right under it.
    - **`moveLine` with times (R13).** `start` and `end` come together or not at all. They must be finite, with `0 ≤ start < end`; otherwise the edit is refused (same object).
    - The moved line takes `[start, end]`. Each word is scaled into it, keeping its share of the old span: `start + (w − old.start) × (end − start) / (old.end − old.start)`, or spread evenly if the old span was 0.
    - The line gets `guessed: true` and loses `timed`. Its second voices move by `start − old.start`, each keeping its length, never before 0.
    - A move that can't happen (at either end) ignores the times and returns the same object.
  - **`parse.ts`.** `if (raw.added === true) line.added = true`. Then drop it from a line that turns out to be a second voice.
  - **`timesMoved` in `editor.ts`** (PF2: time changes on lines guessed before and after don't count).
    1. A different number of lines → `false`, as today.
    2. Let `B` be the time signatures of `before`'s lines that aren't `guessed`, and `A` the same for `after`. A signature is a line's start and end, and each word's start and end. When every signature in `A` is also in `B` (as multisets), it returns `false`. This covers a reorder, an R13 move (the moved line is `guessed` after), a same-count retype of a guessed line, and word edits on guessed lines.
    3. Otherwise today's index-by-index comparison, skipping a place where both lines are `guessed`.
  - **`EDIT_KINDS`** names the four kinds.
- [ ] **Step 4: Run** `npx vitest run src/main/services/lyrics/singers`. Expected: PASS.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 6: Commit.**

  ```bash
  git add src/main/services/lyrics/singers
  git commit -m "Added verses: added lines in the coding, and their edits" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 2: Likeness, shared, and stand-ins

**Files:**
- Create: `src/main/services/lyrics/singers/likeness.ts` (import-free)
- Modify:
  - `src/main/services/lyrics/singers/added.ts`: add `standIns`;
  - `src/renderer/screens/lyricsEditor/shownLines.ts`: use `likeness.ts`; behavior unchanged.
- Test: `src/main/services/lyrics/singers/likeness.test.ts` (new), `added.test.ts` (new). The existing `shownLines.test.ts` must still pass untouched.

**Interfaces:**
- Consumes: `SongColors`, as a type only. `added.ts` never imports `apply.ts`: `apply.ts` imports `added.ts` in Task 3, and the caller hands `standIns` the `matchLines` result.
- Produces, in `likeness.ts`, moved from `shownLines.ts` (main never imports renderer code, and `apply.ts` needs these):

  ```ts
  /** Two lines this alike are the same line, edited. */
  export const ALIKE = 0.5
  /** 0–1: the letters both have in order (spaces aside), against both lengths. */
  export function likeness(a: string, b: string): number
  /** Left and right items alike enough (≥ ALIKE), paired in order, each once, with the most likeness in all: left index → right index. */
  export function alikePairs(left: readonly string[], right: readonly string[]): Map<number, number>
  ```

- Produces, in `added.ts`:

  ```ts
  /**
   * Added lines that stand in for a shown line: an added main line no shown line matches exactly,
   * paired (alikePairs) with an unmatched, non-blank shown line between the same two matched
   * lines. Coded line → shown row.
   */
  export function standIns(texts: readonly string[], coding: SongColors, matches: readonly (number | undefined)[]): Map<number, number>
  ```

- [ ] **Step 1: Write the failing tests.**
  - **`likeness.test.ts`**
    - `likeness ignores spaces, full-width ones too`: `likeness('夜空に浮かぶ　小さな灯り', '夜空に浮かぶ 小さな灯り') === 1`.
    - `likeness('のばした', '伸ばした') >= ALIKE`; `likeness('まだ見ぬ明日', 'hello') < ALIKE`; `likeness('', '') === 0`.
    - `alikePairs pairs in order, each once, the most alike`: `alikePairs(['abcd', 'wxyz'], ['abce', 'wxyq', 'abcd'])` pairs `0→0` and `1→1`, never `0→2` after `1→1`.
  - **`added.test.ts`**
    - `an added line stands in for a like shown line between the same matched lines`. Coding `[A, X(added '夜空に浮かぶ 小さな灯り'), C]`, shown `['A', '夜空に浮かぶ　小さな灯り', 'C']` → `Map{1 → 1}`.
    - `never across a matched line`. Shown `['夜空に浮かぶ　小さな灯り', 'A', 'C']` → empty.
    - `each shown line once: the more alike added line wins`.
    - `an exact match isn't a stand-in`, and `the lyrics' own changed lines never stand in`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers/likeness.test.ts src/main/services/lyrics/singers/added.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Move `likeness` from `shownLines.ts` verbatim. Write the generic `alikePairs` with the same table and walk-back as `shownLines.ts`' private one.
  - `shownLines.ts`' `alikePairs(colors, shown, lines, rows)` becomes a thin wrapper over it, mapping indices.
  - `standIns` walks the gaps between consecutive matched (row, coded) pairs, as `shownLines.ts`' `gaps` does.
- [ ] **Step 4: Run** `npx vitest run src/main/services/lyrics/singers src/renderer/screens/lyricsEditor`. Expected: PASS.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `Added verses: one likeness for main and the editor, and stand-ins`.

  ```bash
  git add src/main/services/lyrics/singers src/renderer/screens/lyricsEditor/shownLines.ts
  git commit -m "Added verses: one likeness for main and the editor, and stand-ins" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 3: The Focus Screen shows added lines

**Files:**
- Modify:
  - `src/main/services/lyrics/types.ts`: `LyricsColors.own`;
  - `src/main/services/lyrics/singers/apply.ts`: `colorLyrics`, and export `onShownWords`;
  - `CLAUDE.md`: the "Singer colors on the Focus Screen" bullet.
- Test: `src/main/services/lyrics/singers/apply.test.ts`

**Interfaces:**
- Consumes:
  - `standIns` (Task 2);
  - `CodedLine.added` (Task 1).
- Produces:

  ```ts
  // LyricsColors (lyrics/types.ts):
  /**
   * The lyrics' own rows, colored as they'd be without the lines the user added: set only when
   * added lines are shown (put in, or standing in for a row). Auto-sync and the editor read these.
   */
  own?: Extract<Lyrics, { kind: 'synced' | 'plain' }>
  // apply.ts: exported, body unchanged
  export function onShownWords(coded: CodedLine, shown: SyncedLine): SyncedWord[] | null
  ```

- `colorLyrics(lyrics, coding)` keeps its signature. What it does:
  1. **Matching.** `matches = matchLines(texts, coding.lines)`. Added lines take part like any main line, so an added line whose text the lyrics now have is simply a matched line.
  2. **Nothing to color.** It returns `null` when no match is a line that isn't `added` (R9).
  3. **Stage 1, as today,** over the shown rows. Plain lyrics are not turned synced yet. This gives the own rows and their colors.
  4. **Which added lines show.** `shownAdded` is the added main lines no row matched, in coding order. `stood = standIns(texts, coding, matches)`. With `shownAdded` empty, skip to step 6: the result is exactly today's, with no `own`.
  5. **Stage 2.** Drop the rows in `stood.values()`, then put each `shownAdded` line in as its own row: its text, `timeSec` its start, its words with their own times, its singers and `romajiSplits`.
     - **Synced lyrics:** it goes before the first remaining row whose `timeSec` is later than its start. Added rows among themselves go by start, then coding order. A guessed line shows too.
     - **Plain lyrics:** it goes right after the row of the shown coded main line before it in the coding (a matched row, or an added row already put in), or first when there is none.
     - **Second voices** follow their main line's new row. Voices under an added line keep their own times.
     - Synced rows go through `inOrder`.
     - `colors.own` = stage 1's lyrics.
  6. **Plain to synced.** Plain lyrics turn synced, as today, only when every non-blank row (added ones too) shows a `timed` coded line.

- [ ] **Step 1: Write the failing tests** in `apply.test.ts`:
  - **`shows an added line at its time among synced lines, even as a guess`.** Synced `[A@10, C@30]`; coding `[A(timed), X(added, guessed, 20–24, words 'X '20–22 and 'x' 22–24 sung by ichika), C(timed)]`. Then:
    - the texts are `['A', 'X x', 'C']`;
    - `lines[1].timeSec === 20`, with X's words;
    - `colors.lines[1]` is `[['ichika'], ['ichika']]`;
    - `colors.own` is synced with the texts `['A', 'C']`.
  - **`an added line stands in for a like shown line, shown once`.** Synced `[A@10, '夜空に浮かぶ　小さな灯り'@20, C@30]`; coding `[A, X('夜空に浮かぶ 小さな灯り', added, start 21), C]`. Then:
    - there are 3 rows, `lines[1].text === X.text` and `lines[1].timeSec === 21`;
    - `colors.own`'s texts are the lyrics' own three.
  - **`an exact match shows the line once`.** The shown lyrics have X's text exactly: X is a matched row, nothing is put in, and `own` is undefined.
  - **`each shown line is stood in for once`.** Two alike added lines and one like row: one stands in, and the other is put in by time.
  - **`plain lyrics take added lines in coding order`.** Plain `['A', '', 'C']`; coding `[A, X(added), C]`. Then:
    - the lines are `['A', 'X', '', 'C']`, still plain;
    - `colors.own` is plain `['A', '', 'C']`.
  - **`plain lyrics turn synced only once the added lines are timed too`.** A and C timed and X guessed stays plain; X timed turns synced, with X at its start.
  - **`second voices follow their rows after lines are put in`.** A voice under C is `under` C's new row; a voice under X is `under` X's row, at its own times.
  - **`romaji splits follow their rows`.**
  - **`nothing shows when only an added line matches`.** A coding whose own lines all changed, and whose added line matches a shown line exactly → `null`.
  - **`a song without added lines comes out as before`.** Take one existing synced fixture and one plain fixture from `apply.test.ts` and assert their existing hard-coded expectations: the same `toEqual` literals the current tests use, never a value worked out by calling `colorLyrics` again. Also assert `expect(result.colors).not.toHaveProperty('own')` for both.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers/apply.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as described above. Rows are easiest as a list of `{ kind: 'own'; row } | { kind: 'added'; line }` entries turned into the arrays at the end.
- [ ] **Step 4: Run** `npx vitest run src/main/services/lyrics src/renderer/widgets/music`. Expected: PASS.
- [ ] **Step 5: Update `CLAUDE.md`.** Add to the "Singer colors on the Focus Screen" bullet, in its voice:
  - Lines the user added in the editor show in their place:
    - synced lyrics at their own start, even while a guess (the one exception to "made-up times never stand in", for lines the user placed by ear);
    - plain lyrics in the coding's order, turning synced only once every line, added ones too, is timed.
  - An added line like an unmatched shown line between the same matched lines (`likeness` ≥ 0.5) stands in for it, so a verse the lyrics gain never shows twice.
  - When none of the lyrics' own lines match, added lines don't show either.
  - The lyrics' own rows ride along as `colors.own` for auto-sync and the editor.
- [ ] **Step 6: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 7: Commit** `Added verses: the Focus Screen shows added lines, once`.

  ```bash
  git add src/main/services/lyrics/types.ts src/main/services/lyrics/singers/apply.ts src/main/services/lyrics/singers/apply.test.ts CLAUDE.md
  git commit -m "Added verses: the Focus Screen shows added lines, once" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 4: Main keeps reading the lyrics' own lines

**Files:**
- Modify:
  - `src/main/services/lyrics/provider.ts`: the `romaji` signature;
  - `src/main/services/lyrics/mock/provider.ts`;
  - `src/main/services/lyrics/service.ts`: `romajiFor` passes the lines; fix the "never adds" comment;
  - `src/main/services/autosync/service.ts` (`needsTiming`);
  - `src/main/services/lyrics/singers/editorTypes.ts`: `romajiLines`;
  - `src/main/services/lyrics/singers/editor.ts` (`shownFor`, `Shown`, `closedState`, the lyrics subscription);
  - `src/renderer/screens/LyricsEditor.tsx`: one call.
- Test:
  - `src/main/services/lyrics/mock/provider.test.ts`;
  - `src/main/services/lyrics/service.test.ts`;
  - `src/main/services/lyrics/singers/plainSong.test.ts`;
  - `src/main/services/lyrics/singers/editor.test.ts`.

**Interfaces:**
- Consumes: `LyricsColors.own` (Task 3).
- Produces:
  - `LyricsProvider.romaji?(query: LyricsQuery, lines: readonly string[]): string[] | null`. The demo romanizes the lines it's given, by their text, so an added line gets `''`.
  - `ColorEditorState.romajiLines: string[]`: the rows the Focus Screen shows (the lyrics' own and the added ones), which `romaji` lines up with. `[]` when closed.
  - `ColorEditorState.shownLines` now means the lyrics' own lines: `colors.own`'s texts when present, else the shown ones.
  - `needsTiming(shown, trackId)`: for plain lyrics it returns `shown.colors?.own`'s lines when that is plain, else the shown lines. Synced lyrics behave as today.

- [ ] **Step 1: Write the failing tests.**
  - **`mock/provider.test.ts`**
    - `the demo's romaji follows the lines it's given`: `romaji(query('星空レター'), [firstLine, 'まだない行'])` → `[FIRST_ROMAJI, '']`.
  - **`service.test.ts`**, in `made from a dictionary`, with a `colors` store whose coding adds `'ふたつめの星'` after the first line:
    - `an added line gets romaji made on this computer`: `madeAsked[0]` has `'ふたつめの星'` at index 1; after `made([...])`, `romaji[1]` is the made one.
  - **`service.test.ts`**
    - `the demo's romaji stays under its own lines when the user added one`.
  - **`plainSong.test.ts`**
    - `auto-sync times only the lyrics' own lines when the user added some`: `needsTiming(shown(colored.lyrics, colored.colors), 't')` equals `LINES`.
    - `a song timed through, added lines too, needs no timing` → `null`.
  - **`editor.test.ts`**
    - `the window gets the lyrics' own lines, and the shown ones the romaji is under`. Let the fake lyrics' `get()` carry `colors.own`. Then:
      - `state.shownLines` equals the own texts;
      - `state.romajiLines` equals the shown texts;
      - `begin` with the own lines is accepted.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics src/main/services/autosync`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `LyricsEditor.tsx`, the romaji call becomes `romajiByLine(working, state.romajiLines, state.romaji)`.
- [ ] **Step 4: Run** `npx vitest run src/main/services/lyrics src/main/services/autosync`. Expected: PASS.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `Added verses: auto-sync and the editor keep to the lyrics' own lines`.

  ```bash
  git add src/main/services/lyrics src/main/services/autosync/service.ts src/renderer/screens/LyricsEditor.tsx
  git commit -m "Added verses: auto-sync and the editor keep to the lyrics' own lines" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 5: The editor page reads the lyrics' own lines

**Files:**
- Modify:
  - `src/renderer/screens/lyricsEditor/shownLines.ts`: `editorLyrics`, and `gaps` leaves out stood-in rows;
  - `src/renderer/screens/lyricsEditor/editorView.ts`: `changedLines` leaves out added lines;
  - `src/renderer/screens/lyricsEditor/lineRows.ts`: `LineRow` marks.
- Test: `shownLines.test.ts`, `editorView.test.ts`, `lineRows.test.ts`

**Interfaces:**
- Consumes:
  - `standIns`, `matchLines`;
  - `LyricsColors.own`;
  - `CodedLine.added`.
- Produces:
  - `LineRow` gains `added: boolean` and `alsoInLyrics: boolean`. `alsoInLyrics` is true for an added line that a shown line matches exactly, or that stands in for one.
  - `editorLyrics(state, lyrics)` returns `lyrics.colors?.own ?? lyrics.lyrics` (checked against `state.shownLines` as today).

- [ ] **Step 1: Write the failing tests.**
  - `changedLines never marks an added line`.
  - `a shown line an added line stands in for is neither new nor offered as new words`: `newLines(...)` is `[]` and `newWordsFor(...).size === 0`, for the Task 2 example.
  - `lineRows marks added lines, and those also in the lyrics now`: stand-in → `alsoInLyrics`; exact match → `alsoInLyrics`; added alone → `added` only.
  - `editorLyrics gives the lyrics' own lines when lines were added`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/screens/lyricsEditor`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/renderer/screens/lyricsEditor`. Expected: PASS.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `Added verses: the editor's list knows added lines`.

  ```bash
  git add src/renderer/screens/lyricsEditor
  git commit -m "Added verses: the editor's list knows added lines" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 6: Main takes added lines only while their song is on, and replays with a lead-in

**Files:**
- Modify:
  - `src/main/services/lyrics/singers/editorTypes.ts`: the `replayLine` command;
  - `src/main/services/lyrics/singers/editorCommand.ts`;
  - `src/main/services/lyrics/singers/editor.ts`;
  - `src/main/services/lyrics/singers/playLine.ts`: `replaySpan`.
- Test: `src/main/services/lyrics/singers/playLine.test.ts` (new), `editor.test.ts`

**Interfaces:**
- Produces:
  - `ColorEditorCommand` gains `{ kind: 'replayLine'; line: number }`.
  - `REPLAY_LEAD_SEC = 3`.
  - `replaySpan(colors: SongColors, line: number): { start: number; end: number } | null`:
    - it plays from the start of the main line before `line`'s own main line, to `line`'s end;
    - it starts `REPLAY_LEAD_SEC` before `line` (never before 0) when there's no line before, or that line starts at or after `line`'s start;
    - `null` for no such line.
  - In `editor.ts`, `shownEditAllowed` becomes `editAllowed`. It also refuses `addLines` unless `playingThis()`: the editor's song is the one on, playing or paused (PF6). The playhead is known while paused, and pausing at the verse is natural.

- [ ] **Step 1: Write the failing tests.**
  - **`playLine.test.ts`**
    - `replays from the line before's start to the line's end`.
    - `skips second voices to the main line before`.
    - `starts 3 s early with no line before, or one out of order`.
    - `null for a line that isn't there`.
  - **`editor.test.ts`**
    - `adds lines only while its song is on`. `addLines` with another song playing (`music.play(TRACK_B)`), or with nothing on the player (no track), leaves the colors unchanged (`toBe` the coding before). With its own song paused (`playing: false`), and again playing, the lines are added: `lines.length` grows by the number sent, both times.
    - `replay plays from the line before and pauses past the line`: as `play line seeks, plays, and pauses past the end`, with the seek at the line before's start.
    - `keeps well-formed commands` gains `{ kind: 'replayLine', line: 2 }`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers`. Expected: FAIL.
- [ ] **Step 3: Implement.** `replayLine` goes through `lineWatch.play(span.start, span.end)`.
- [ ] **Step 4: Run** `npx vitest run src/main/services/lyrics/singers`. Expected: PASS.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `Added verses: lines added only while their song is on; replay with a lead-in`.

  ```bash
  git add src/main/services/lyrics/singers
  git commit -m "Added verses: lines added only while their song is on; replay with a lead-in" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 7: Taps snap to sound

**Files:**
- Create: `src/main/services/lyrics/singers/tapQueue.ts`
- Modify:
  - `src/main/services/lyrics/singers/waveform.ts`: `heardAround`;
  - `src/main/services/lyrics/singers/editor.ts`.
- Test: `tapQueue.test.ts` (new), `waveform.test.ts`, `editor.test.ts`

**Interfaces:**
- Consumes: `nearestOnset` (`waveform.ts`).
- Produces:

  ```ts
  // waveform.ts
  /** Every bucket within `withinSec` of `timeSec` (and the onset look-back before them) has been heard. False past the song's edges. */
  export function heardAround(peaks: Uint8Array, timeSec: number, withinSec: number): boolean
  // tapQueue.ts
  export const TAP_SNAP_SEC = 0.12
  export const TAP_WAIT_SEC = 3
  export type TapEdit = Extract<ColorEdit, { kind: 'tapTime' }>
  export interface TapQueue {
    push(edit: TapEdit, at: number): void          // at: epoch seconds of the press
    /**
     * Hands `apply` the taps that are ready, oldest first, stopping at the first that isn't.
     * A start is ready once the outline round it is heard: moved then to the nearest onset
     * within TAP_SNAP_SEC, else left as pressed. It is also ready TAP_WAIT_SEC after the
     * press, left as pressed. An end is ready once everything before it is. With `peaks`
     * null, or `force`, all are ready; a start is still snapped where it's heard.
     */
    flush(peaks: Uint8Array | null, now: number, apply: (edit: TapEdit) => void, force?: boolean): void
    clear(): void
    readonly size: number
  }
  export function createTapQueue(): TapQueue
  ```

- How `editor.ts` uses it:
  - `tapWord` pushes the `tapTime` edit it makes today.
  - Every other command (`removeAll` and `switchToPlaying` too), `leave()` and `close()` first flush with `force`, so waiting taps land before anything else happens.
  - `tick()` flushes without `force`.
  - The peaks passed are `session.peaks` while the tap is listening (`tapFor !== null`) and the editor's song plays, else `null`, so there is no wait without a waveform.
  - Each applied tap is its own history step, as today.

- [ ] **Step 1: Write the failing tests.**
  - **`waveform.test.ts`**
    - `heardAround`: true over heard buckets; false with one unheard bucket within reach; false past the end.
  - **`tapQueue.test.ts`.** Build peaks by hand: quiet 1s, then 200 from 10.24 s.
    - `a start waits for the outline round it, then lands on the onset`. A tap at 10.2 with the outline unheard gives no `apply`. Once heard, `apply` gets `start` within 0.02 of 10.24.
    - `lands where pressed with no onset within 120 ms`.
    - `lands where pressed after 3 s unheard`.
    - `an end waits behind its start`.
    - `no outline: applies at once, unsnapped`.
    - `force applies everything now, snapping what's heard`.
  - **`editor.test.ts`.** Give `fakeTap.hear` a level and a length.
    - `a tap lands on the sound it was meant for`. Quiet audio, then loud from song time 10.24; tap down at 10.2. Right after, the colors are unchanged. After 2 s of timers, word 0 starts within 0.02 s of 10.24.
    - `undo right after a tap undoes that tap`: the tap is pending, `undo` is sent, the colors equal the start, and `canRedo` is true.
    - `a tap lands at once where there's no waveform`: `tap.access` returns `'denied'`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/main/services/lyrics/singers`. Expected: PASS.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `Added verses: taps land on the sound they were meant for`.

  ```bash
  git add src/main/services/lyrics/singers
  git commit -m "Added verses: taps land on the sound they were meant for" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 8: Time by listening, the pure part

**Files:**
- Create: `src/main/services/lyrics/singers/listen.ts`. Import-free but for `./apply` and type imports; the renderer compiles it.
- Modify:
  - `src/main/services/autosync/recording.ts`: `heardSpans`;
  - `src/main/services/lyrics/singers/types.ts`: `HeardTime`, `heardTimes`;
  - `src/main/services/lyrics/singers/edit.ts`;
  - `src/main/services/lyrics/singers/editorCommand.ts`;
  - `src/main/services/lyrics/singers/editor.ts`: `editAllowed` refuses `heardTimes`, which only a run makes.
- Test: `src/main/services/autosync/recording.test.ts`, `listen.test.ts` (new), `edit.test.ts`, `editor.test.ts`

**Interfaces:**
- Consumes:
  - `matchLines` (`apply.ts`);
  - `onShownWords` (Task 3);
  - `Lyrics`, `SyncedLine` (`lyrics/types.ts`, types only).
- Produces:

  ```ts
  // recording.ts, SongRecording:
  /** Stretches heard so far, [from, to] in seconds, merged and in order; a tenth-second cell counts once half of it is. */
  heardSpans(): [number, number][]
  // types.ts
  export interface HeardTime { line: number; start: number; end: number; words: { start: number; end: number }[] }
  // ColorEdit gains:
  | { kind: 'heardTimes'; lines: HeardTime[] }
  // listen.ts
  export const HEARD_SHARE = 0.95
  export const LISTEN_PAD_SEC = 0.5
  export const OPEN_SEC_PER_LINE = 8
  export const OPEN_MAX_SEC = 60
  /** The lyrics' own lines with their times, as the editor reads them: `colors.own ?? lyrics` (Task 5's `editorLyrics`). */
  export type OwnLyrics = Extract<Lyrics, { kind: 'synced' | 'plain' }>
  /**
   * Where each coded line shows for real (R14), on the screen's clock (song position + the fix;
   * the Focus Screen lights `syncedLineIndex(lines, position + offsetSec)`). For a main line
   * matched (matchLines) to a row of synced `own` lyrics: that row's `timeSec`, until its last
   * word's end, or `timeSec` plus the coded line's length when the row has no words. Else, for a
   * `timed` line: its own start and end. Else null (a guess, a second voice, plain lyrics'
   * untimed lines, or `own` null and not timed).
   */
  export function realSpans(colors: SongColors, own: OwnLyrics | null): ({ start: number; end: number } | null)[]
  /** The main lines with words among places from..to (exclusive) of `lines`: second voices stay out. */
  export function listenLines(colors: SongColors, from: number, to: number): number[]
  /**
   * The stretch a run hears for `lines`, in SONG time (what the recording and the aligner use).
   * On the screen's clock it runs from the first line's real start (realSpans), or its coded
   * start when it has none (R10). It ends at the real start of the main line right after the
   * last of `lines`, when that line has one later than the start. Else it ends OPEN_SEC_PER_LINE
   * a line on, at most OPEN_MAX_SEC. Both ends then turn into song time (`− fixSec`) and are cut
   * to [0, durationSec]. Null for no lines or no room.
   */
  export function listenStretch(colors: SongColors, lines: readonly number[], durationSec: number, own: OwnLyrics | null, fixSec: number): { from: number; to: number } | null
  export function coveredShare(spans: readonly (readonly [number, number])[], from: number, to: number): number
  export function isHeard(spans: readonly (readonly [number, number])[], stretch: { from: number; to: number }): boolean   // ≥ HEARD_SHARE
  export interface HeardLine { start: number; end: number; words?: SyncedWord[] }
  /**
   * The edit a run's answer makes, on the song's clock. It covers each answered line still at its
   * place with the text it was asked with, for which `still` holds. Its words go on the answer's
   * words by their letters (onShownWords) when those spell the line out; else its own words are
   * scaled into the span, each keeping its share. Null when no line is left.
   */
  export function heardEdit(colors: SongColors, asked: readonly { index: number; text: string }[], heard: readonly (HeardLine | null)[], still: (line: CodedLine) => boolean): Extract<ColorEdit, { kind: 'heardTimes' }> | null
  ```

- **The `heardTimes` reducer.** For each entry, the line must exist, its start be ≥ 0 and its end later than its start, and its `words.length` equal the line's. Bad entries are skipped. The good ones set the line's start and end and word times (pulled onto the line in order, as parse does), set `timed` and drop `guessed`, and keep singers. No entry left → the same object. The times are stored in song time as the run gives them, as a tap's are. The lines turn `timed`, so the save clears the song's fix (`timesMoved`, R15), as a tap's does.

- [ ] **Step 1: Write the failing tests.**
  - **`recording.test.ts`**
    - `heardSpans merges what was heard`: write 1 s at 2.0 and 0.5 s at 5.0 → `[[2, 3], [5, 5.5]]`; a second write over 2.5–3.5 → `[[2, 3.5], [5, 5.5]]`.
  - **`listen.test.ts`**
    - **`realSpans`.**
      - `a timed line has its own span`: `own` null, `[A(timed, 10–14), X(added, guessed, 20–24)]` → `[{ start: 10, end: 14 }, null]`.
      - `a line matched to synced lyrics has the shown row's span (R14)`. Take a coding begun from plain lyrics, every line guessed (`L0` 10–15, `L1` 50–55), and `own` synced by auto-sync: `[{ timeSec: 11, text: 'L0', words: [{ text: 'L0', start: 11, end: 13.5 }] }, { timeSec: 21, text: 'L1' }]`. The result is `[{ start: 11, end: 13.5 }, { start: 21, end: 26 }]`: 26 is 21 plus L1's coded length of 5.
      - `plain own lyrics give nothing real`: the same coding with `own` plain `['L0', 'L1']` → `[null, null]`.
    - `listenLines leaves out second voices and empty lines`.
    - With `own` null and `fixSec` 0 unless said otherwise:
      - `the stretch ends where the next real line starts`: added lines at 84 and 93 (guessed), then C(timed) at 112.3 → `{ from: 84, to: 112.3 }`.
      - `without a real next line it ends 8 s a line on`: next line guessed, 2 lines from 50 → `{ from: 50, to: 66 }`.
      - `but never more than 60 s`: 10 lines → `to: from + 60`.
      - `a real next line before the first start counts as none`.
      - `cut at the song's end`.
      - `null for no lines`.
    - `the next line's real start can be the lyrics' own (R14)`. The added lines are at 84 and 93 (guessed), then C, which is guessed in the coding at 130–134. `own` is synced, with C's row at 112.3. The result is `{ from: 84, to: 112.3 }`.
    - `a stretch is in song time under a timing fix (R15)`. Added lines stored at 84.5 and 93.5 (pressed at 84 under a 0.5 s fix), then C(timed) at 112.8, with `fixSec` 0.5 → `{ from: 84, to: 112.3 }`. With 2 lines and no real next line, the same fix gives `{ from: 84, to: 100 }` (84.5 + 16 − 0.5).
    - `coveredShare`: `[[0, 10]]` over 5–15 → 0.5.
    - `isHeard` at 0.95.
    - `heardEdit puts words on the answer's words by their letters`.
    - `scales a line's own words into the span when the answer's words don't spell it`: the line `'灯り(あかり)'` against an answer for `'灯り'`.
    - `leaves out lines that changed since they were asked about, unplaced ones, and ones still() turns down`.
    - `null when nothing is left`.
  - **`edit.test.ts`**
    - `heardTimes sets the times and marks the lines timed, singers kept`.
    - `skips an entry whose words don't fit the line`.
    - The parse round-trip covers `heardTimes`.
  - **`editor.test.ts`**
    - `refuses heard times from the window`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/autosync/recording.test.ts src/main/services/lyrics/singers`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/main/services/autosync/recording.test.ts src/main/services/lyrics/singers`. Expected: PASS.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `Added verses: what a timing run hears, and the edit it makes`.

  ```bash
  git add src/main/services/autosync/recording.ts src/main/services/autosync/recording.test.ts src/main/services/lyrics/singers
  git commit -m "Added verses: what a timing run hears, and the edit it makes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 9: The timing run

**Files:**
- Create: `src/main/services/lyrics/singers/listenRunner.ts`
- Modify: `CLAUDE.md`:
  - **Privacy:** a new bullet after "Singer colors";
  - **Stack:** in the Color-Code Lyrics bullet, "it needs the helper, not the Python aligner" becomes "it needs the helper; only Time by listening needs auto-sync's add-on, with a worker of its own".
- Test: `src/main/services/lyrics/singers/listenRunner.test.ts`, with a real temp folder (`mkdtempSync`) and a fake `AlignerClient`.

**Interfaces:**
- Consumes:
  - `AlignerClient` (`autosync/aligner.ts`);
  - `encodeWav` (`autosync/wav.ts`);
  - `SAMPLE_RATE` (`autosync/recording.ts`);
  - `sungText` and `AlignLanguage` (`autosync/lines.ts`);
  - `HeardLine` (Task 8).
- Produces:

  ```ts
  export interface ListenAsk {
    /** The lines' text as coded; the runner takes out what isn't sung (sungText). */
    texts: string[]
    /** 16 kHz mono: the stretch with its padding. */
    samples: Int16Array
    /** Where `samples` starts in the song, in seconds. */
    clipStart: number
    language: AlignLanguage | null
  }
  export interface ListenRunner {
    readonly installed: boolean
    busy(): boolean
    /** Each line's span on the song's clock, null where it couldn't be placed; null when the run failed or the add-on isn't installed. */
    run(ask: ListenAsk): Promise<(HeardLine | null)[] | null>
    /** Stops its aligner and deletes any WAV left. */
    dispose(): void
  }
  export function createListenRunner(options: { aligner: (() => AlignerClient) | null; tempDir: string }): ListenRunner
  ```

- **What the runner does.**
  - The WAV is `<tempDir>/<randomUUID()>.wav`, deleted in `finally`.
  - Every `.wav` in `tempDir` is deleted on creation and on dispose, which clears what a crash left behind.
  - The aligner client is made on the first run and disposed on dispose. It keeps its idle stop of 3 minutes (R6).
  - Spans and words are shifted by `clipStart`. A span outside the clip becomes `null`.

- [ ] **Step 1: Write the failing tests.**
  - `writes the stretch as a WAV, asks with the sung words, and deletes the WAV after the reply`. The fake `align` checks that the file exists and that its size is `44 + 2 * samples.length`. `lines` is `['夜空に浮かぶ 小さな灯り']` for the text `'夜空に浮かぶ 小さな灯り(あかり)'`. Afterwards `readdirSync(tempDir)` is `[]`.
  - `deletes the WAV when the aligner fails, and answers null`. Covers both an `{ ok: false }` reply and a rejection.
  - `puts the answer on the song's clock`: `clipStart` 83.5 and a span `0.6–4.1` with words → `84.1–87.6`, words shifted.
  - `leaves out a span outside the stretch`.
  - `clears WAVs left behind when it starts`.
  - `without the add-on it writes nothing and answers null`.
  - `busy while a run is out`.
  - `stops its aligner when disposed`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers/listenRunner.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/main/services/lyrics/singers/listenRunner.test.ts`. Expected: PASS.
- [ ] **Step 5: Update `CLAUDE.md`'s privacy section.** A new bullet:
  - "Time by listening (approved by the user on 2026-11-05, 'yes, that's fine')".
  - The Color-Code Lyrics window keeps what its tap heard of the editor's song in memory, 16 kHz mono by song time, only while the window is open. It's thrown away when the window closes or moves to another song.
  - Only Time by listening writes a stretch of it, plus 0.5 s either side, to a temporary WAV in the app's temp folder (`focus-screen-listen`) for the auto-sync add-on's aligner, a worker of the editor's own. The WAV is deleted when the reply comes or the run fails; WAVs a crash left behind are cleared when the editor opens or closes.
  - Only line and word timings are kept. Nothing goes over the network.
- [ ] **Step 6: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 7: Commit** `Added verses: a timing run over a temporary WAV, deleted after`.

  ```bash
  git add src/main/services/lyrics/singers/listenRunner.ts src/main/services/lyrics/singers/listenRunner.test.ts CLAUDE.md
  git commit -m "Added verses: a timing run over a temporary WAV, deleted after" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 10: Time by listening in the editor session

**Files:**
- Modify:
  - `src/main/services/lyrics/singers/editorTypes.ts`;
  - `src/main/services/lyrics/singers/editorCommand.ts`;
  - `src/main/services/lyrics/singers/editor.ts`;
  - `src/main/ipc.ts`: add `ListenState` to the type re-export from `editorTypes`;
  - `src/main/index.ts`.
- Test: `src/main/services/lyrics/singers/editor.test.ts`

**Interfaces:**
- Consumes:
  - `createListenRunner` (Task 9);
  - `listenLines`, `listenStretch(colors, lines, durationSec, own, fixSec)`, `OwnLyrics`, `isHeard`, `heardEdit`, `LISTEN_PAD_SEC` (Task 8);
  - `createSongRecording` (`autosync/recording.ts`);
  - `alignLanguage` (`autosync/lines.ts`).
- Produces, in `editorTypes.ts` (re-exported through `ipc.ts` like the rest):

  ```ts
  export interface ListenState {
    /** False when auto-sync's add-on isn't installed on this Mac. */
    installed: boolean
    /** Song-time stretches heard since the window opened, in order. */
    heard: [number, number][]
    /** The lines being timed now (places in `lines`); empty while none are. */
    timing: number[]
    /** Plain words about the last run when it didn't all work. */
    note: string | null
    /**
     * The song's timing fix as the Focus Screen applies it (lit at position + fixSec), for the
     * page's `listenStretch` even while another song plays and `useLyrics` has that one's fix.
     */
    fixSec: number
  }
  // ColorEditorState:
  /** "Time by listening"; null where it isn't offered (no tap, recording not allowed, Windows). */
  listen: ListenState | null
  // ColorEditorCommand gains:
  | { kind: 'listen'; from: number; to: number }   // a run of places in `lines`, `to` exclusive
  ```

- Produces, in `editor.ts`:
  - `ColorEditorOptions.listen?: { aligner: (() => AlignerClient) | null; tempDir: string }`;
  - `NOT_HEARD_NOTE = 'Play this part once so I can hear it.'`;
  - `TIMING_FAILED_NOTE = "Couldn't time these lines."`;
  - `missedNote(missed: number, total: number): string`. One missed: `"Couldn't place 1 of these 3 lines; it keeps its times."` More: `"Couldn't place 2 of these 3 lines; they keep their times."`

- **Behavior.**
  - **Setup.**
    - `open()` makes the runner when a tap opened; `close()` disposes it.
    - `load()` makes `session.recording = createSongRecording(durationSec)` when there's a tap.
    - `tick()`'s place callback also writes the audio into it.
    - `leave()` drops it, which throws the audio away.
  - **The lyrics' own lines and the fix (R14, R15).**
    - `Shown` gains `own: OwnLyrics`: the lyrics' own lines with their times, `state.colors?.own ?? state.lyrics`, set by `shownFor`.
    - The lyrics subscription also takes a new `own` when its times change, so auto-sync timing the song shows up. `session.shown.own` is still there while another song plays.
    - `fixFor(open)` is the fix the Focus Screen applies: `lyrics.get().offsetSec` while the editor's song is on screen (`nearSongKeys`, as `hasOffset` checks), else `offsets.get(open.song.key)`.
    - Every stretch is `listenStretch(colors, lines, duration, open.shown.own, fixFor(open))`, so it's in song time, as the recording is.
  - **After an accepted `addLines` at `at` with `n` lines,** the session keeps `pending = { first: at, count: n }`.
    - It's dropped when a later step changes the number of lines or their order, and on undo, redo, `removeAll` and `leave`.
    - On each tick, while the runner isn't busy: once `isHeard(recording.heardSpans(), stretch)` for the stretch of `[first … first+count−1]`, it runs those lines with `still = (line) => !line.timed` (the user's taps win), and `pending` goes.
    - The stretch is worked out again on every tick. So a tap on the next line's start makes that line real and ends the stretch there, if it comes before the 8 s-a-line end has been heard (spec: "whichever is known first").
  - **`listen` command.**
    - It takes the lines `listenLines(colors, from, to)` and runs them with `still = () => true`. Lines the user asked for are re-timed even if timed.
    - If the stretch isn't heard, it sets the note `NOT_HEARD_NOTE` and runs nothing.
  - **A run.**
    - `asked` is each line's place and text.
    - The samples are the stretch (song time) padded by `LISTEN_PAD_SEC` on each side, kept inside the song. `clipStart` is where they start in song time. The answer comes back in song time and is stored as it is (R15).
    - The language is `alignLanguage` of all the coding's main lines.
    - `listen.timing` holds the lines while the run is out.
    - The answer is applied only if the session is still the same song: `heardEdit(history.now(), asked, answer, still)` goes through `history.apply` and `stepped`.
    - The note is set as follows:
      - failed, or nothing placed → `TIMING_FAILED_NOTE`;
      - some lines missed → `missedNote`;
      - else `null`.
  - **When listening is offered.** `listen` is `null` without a tap, or with `tap.access() === 'denied'`. `installed` is `runner.installed`, `heard` is `session.recording?.heardSpans() ?? []`, and `fixSec` is `fixFor(session)`. `closedState()` has `listen: null`.
  - **Pushing the state.** `flagsOf` includes `listen.timing`, `listen.note` and `listen.fixSec`.
- **Wiring in `index.ts`.** `createColorEditor({ …, listen: { aligner: startAligner ? () => createAlignerClient(startAligner) : null, tempDir: join(app.getPath('temp'), 'focus-screen-listen') } })`.

- [ ] **Step 1: Write the failing tests** in `editor.test.ts`, with a fake aligner whose replies the test controls, and a `mkdtempSync` temp folder:
  - `times added lines by itself once their stretch has played through`.
    - Set up: a timed coding A (10–14) and C (30–34), playing from 15. Add X and Y at place 1, from 15. Audio is heard over 15–30.
    - The aligner is asked once, with `['X …', 'Y …']`.
    - After the reply, X and Y have the answer's times plus `clipStart` (14.5), are `timed`, and are no longer `guessed`.
  - `cuts the recording in song time under a timing fix (R15)`.
    - Set up: `offsets: { [KEY_A]: 0.5 }`, with the fake lyrics' `offsetSec` 0.5, and a saved timed coding A (10.5–14.5) and C (30.5–34.5), playing from 15.
    - Add X and Y at place 1, stored from 15.5: the press at 15 plus the fix.
    - Audio is heard over 15–30 in song time only.
    - The aligner is asked once. The WAV it gets is `44 + 2 * 16 * 16000` bytes: song time 14.5–30.5, which is the screen's 15.5–30.5 less the fix, padded.
    - The reply `0.6–4.1` for X gives `colorsOf(editor).lines[1].start` close to 15.1 and `.end` close to 18.6 (song time, `clipStart` 14.5).
    - `state.listen.fixSec === 0.5` before the run. After the save delay, `offsets.get(KEY_A) === 0`: the run timed its lines, as a tap would.
  - `never re-times an added line the user tapped first`.
  - `ends an open stretch 8 s a line past the press`. In a plain coding, 2 lines are added at 50. The WAV the fake aligner gets is `44 + 2 * 17 * 16000` bytes long.
  - `times the selected lines on request, timed ones too`.
  - `asks to play the part first when it wasn't heard`: the aligner isn't called, and `state.listen.note === NOT_HEARD_NOTE`.
  - `a run never touches lines outside it`.
  - `an answer for lines that changed meanwhile leaves them be`.
  - `an answer after the window moved to another song is dropped`.
  - `a failed run says so and changes nothing`.
  - `throws the heard audio away when the window closes`: reopened, `listen.heard` is `[]`.
  - `listen is null without recording access; installed is false without the add-on`.
  - `keeps well-formed commands` gains `{ kind: 'listen', from: 1, to: 3 }`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers/editor.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/main/services/lyrics/singers`. Expected: PASS.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `Added verses: the editor times lines by listening`.

  ```bash
  git add src/main/services/lyrics/singers src/main/index.ts src/main/ipc.ts
  git commit -m "Added verses: the editor times lines by listening" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 11: The editor page's helpers for adding, runs of lines and keys

**Files:**
- Create: `src/renderer/screens/lyricsEditor/addLines.ts`
- Modify:
  - `src/renderer/screens/lyricsEditor/editorView.ts`: `editorKey`; export `codedLine`;
  - `src/renderer/screens/lyricsEditor/selection.ts`;
  - `src/renderer/screens/LyricsEditor.tsx`: pass `altKey`. The new keys are ignored until Tasks 12 and 13.
- Test: `addLines.test.ts` (new), `editorView.test.ts`, `selection.test.ts`

**Interfaces:**
- Consumes:
  - `MAX_ADDED_LINES`, `MAX_ADDED_CHARS` (Task 1);
  - `realSpans`, `OwnLyrics` (Task 8; R14);
  - `estimateWords` (`widgets/music/lyricsGlide`);
  - `ShownLine`;
  - in tests only: `applyEdit` (`edit.ts`), `colorLyrics` (`apply.ts`), `syncedLineIndex` (`lyrics/types.ts`).
- The screen's clock (R15). The Focus Screen lights `syncedLineIndex(lines, position + offsetSec)` (`LyricsPanel.tsx`). Every time here is on that clock: a press at song position `pressSec`, under the song's stored fix `fixSec`, is `pressSec + fixSec`. A line stored there lights when the playhead reaches the press.
- Produces, in `addLines.ts`:

  ```ts
  export const ADD_SPAN_SEC = 30
  export const MIN_SEC_PER_ADDED_LINE = 1
  /** The gap a moved line leaves after the line before it (R13). */
  export const MOVE_GAP_SEC = 0.1
  /** A paste as lines: split on any line break, each trimmed, blanks dropped; the problem, if it's too much. */
  export function pastedLines(text: string): { lines: string[]; problem: string | null }
  /**
   * Where lines added at a press go. `at = pressSec + fixSec`. By time: just before the first
   * main line, in the coding's order, whose real start (realSpans(colors, own)) is after `at`
   * (or at the end), when it and the main line before it (those there are) have real spans.
   * Else right after the selected line's block. Null when that's needed and nothing is selected.
   */
  export function addPlace(colors: SongColors, own: OwnLyrics | null, pressSec: number, fixSec: number, selected: number | null): { index: number; byTime: boolean } | null
  /**
   * The lines to send with `addLines`. The first starts at `pressSec + fixSec` (never before 0),
   * so it lights at the press. The rest share out the time up to the real start
   * (realSpans(colors, own)) of the line now at `index`, by length in characters. That start
   * counts only when it is at least MIN_SEC_PER_ADDED_LINE a line after the first's start; else
   * (or with no real start) the span ends ADD_SPAN_SEC after it. The span is cut at the song's
   * end on the screen's clock (`durationSec + fixSec`). Each line's words come from
   * estimateWords, pulled onto it as `startingColors` does (`codedLine`); each line is `guessed`.
   */
  export function addedShownLines(colors: SongColors, own: OwnLyrics | null, index: number, texts: readonly string[], pressSec: number, fixSec: number, durationSec: number): ShownLine[]
  /**
   * An added line's new guessed span after ⌥↑/⌥↓ (R13), to send with `moveLine`. Null unless
   * `own` is synced, `line` is an added main line, and it can move that way: plain lyrics send
   * no times.
   *
   * The neighbours are the ones it will have after the move. A neighbour's span is its real
   * span (realSpans), else, for an added line, its own coded span (it shows there in synced
   * lyrics). Lines with neither don't show, and are skipped.
   * - Start: `prev.end + MOVE_GAP_SEC`, where `prev` is the nearest neighbour before. With none
   *   before, `max(0, next.start − MOVE_GAP_SEC − length)`.
   * - `until`: `next.start`, or `endSec` with no neighbour after.
   * - The line keeps its length when it fits before `until`. Else it ends at `until` (spread
   *   over the gap). A gap under MIN_SEC_PER_ADDED_LINE keeps the length anyway, and the next
   *   tap or run places it.
   * `endSec` is the song's end on the screen's clock, `durationSec + fixSec`.
   */
  export function movedTimes(colors: SongColors, own: OwnLyrics | null, line: number, delta: -1 | 1, endSec: number): { start: number; end: number } | null
  /** An added line's new words, spread over its own start and end (estimateWords). */
  export function retypedLine(line: CodedLine, text: string): ShownLine
  ```

  - The problem texts: `'Up to 40 lines at a time.'` and `'A line can be at most 200 characters.'`
- Produces, in `editorView.ts`:
  - `editorKey`'s event gains an optional `altKey?: boolean`.
  - `EditorKey` gains:
    - `{ kind: 'addLines' }` (⌘N);
    - `{ kind: 'moveLine'; delta: -1 | 1 }` (⌥↑/⌥↓);
    - `{ kind: 'extendLines'; delta: -1 | 1 }` (⇧↑/⇧↓);
    - `{ kind: 'replayLine' }` (⇧Space).
  - Plain ↑/↓ and Space are unchanged.
- Produces, in `selection.ts`:

  ```ts
  /** The places from one line's block to the other's, `to` exclusive, either way round; `other` null is the line's own block. */
  export function lineRun(colors: SongColors, line: number, other: number | null): { from: number; to: number }
  /** Lines mode: J marks this line's first word. */
  export function lineTapTarget(colors: SongColors, cursor: TapCursor, selection: Selection | null): TapAt | null
  /** Lines mode: the next main line with words, its first word; 'done' after the last. */
  export function afterLineTap(colors: SongColors, at: TapAt): TapCursor
  ```

- [ ] **Step 1: Write the failing tests.**
  - **`pastedLines cleans a paste and refuses what's too much`.**
    - `'夜空に浮かぶ　小さな灯り\r\n\r\n　ひとつずつ 繋いでいこう \n'` → `['夜空に浮かぶ　小さな灯り', 'ひとつずつ 繋いでいこう']` with problem `null`. The inner full-width space is kept and the surrounding ones are trimmed.
    - 41 lines → the problem `'Up to 40 lines at a time.'`
    - a 201-character line → `'A line can be at most 200 characters.'`
    - `''` → `{ lines: [], problem: null }`.
  - **`addPlace`** (`own` null and `fixSec` 0 unless said otherwise).
    - A timed coding at 10, 20 and 30: `addPlace(colors, null, 25, 0, null)` → `{ index: 2, byTime: true }`.
    - Before the first line → `0`; after the last → `lines.length`.
    - All guessed with line 1 selected → `{ index: 2, byTime: false }`, or after line 1's voice when it has one.
    - A guessed neighbour → after the selected line.
    - Not by time with nothing selected → `null`.
    - `places by the press when the lyrics are now synced by auto-sync (R14)`. A coding begun from plain lyrics, every line guessed: `L0` 10–15, `L1` 50–55, `L2` 90–95. `own` is synced by auto-sync at 11, 21 and 31, with the same texts. Then:
      - `addPlace(colors, own, 25, 0, null)` → `{ index: 2, byTime: true }`;
      - the same with `own` plain `['L0', 'L1', 'L2']` and line 1 selected → `{ index: 2, byTime: false }`.
  - **`addedShownLines`** (`own` null and `fixSec` 0 unless said otherwise).
    - Three lines at 84 with the next line (timed) at 112.3: the first starts at 84, the last ends at 112.3, the shares go by length, the words spell each text, and every line is `guessed`.
    - No next line → the last ends at 114.
    - A next line 2 s on for 3 lines → the last ends at 114.
    - Cut at the song's end.
    - `the next line's real start can be the lyrics' own (R14)`. The next line is guessed in the coding at 130, and `own` is synced with its row at 112.3. The last line ends at 112.3.
  - **`an added line lights at the press under a timing fix (R15)`.**
    - Set up: `own` is synced `[A@10 (one word 10–14), C@30 (one word 30–34)]`. The coding is `[A, C]`, neither timed nor guessed (begun from auto-sync's lyrics). The fix is 0.5 and the press is at song position 20.
    - `addPlace(colors, own, 20, 0.5, null)` → `{ index: 1, byTime: true }`.
    - `const lines = addedShownLines(colors, own, 1, ['X x'], 20, 0.5, 200)`: `lines[0].start === 20.5`, and the last ends at 30 (C's row).
    - `const colored = colorLyrics(own, applyEdit(colors, { kind: 'addLines', at: 1, lines }))`, which is synced.
    - As the Focus Screen lights rows, at song position `p` the lit row is `syncedLineIndex(colored.lyrics.lines, p + 0.5)`. At `p = 20` that's 1 (X's row); at `p = 19.9` it's 0 (A).
    - With `fixSec` 0, the same press gives `lines[0].start === 20`.
  - **`movedTimes`** (R13). `own` is synced: `A@10` (one word to 14) and `B@20` (one word to 24). The coding is `[A, B, X(added, guessed, 40–43)]`, where A and B are untimed with stale coded times 9–13 and 19–23. `endSec` is 200.
    - `movedTimes(colors, own, 2, -1, 200)` → `{ start: 14.1, end: 17.1 }`: just after A's shown end, length 3 kept, and the shown times win over the coded ones.
    - With X at 40–48 (length 8, which doesn't fit before 20) → `{ start: 14.1, end: 20 }`.
    - With B's row at 14.5 (a gap under 1 s) → `{ start: 14.1, end: 17.1 }`.
    - To the top: coding `[A, X(added, 40–43)]` with `movedTimes(colors, own, 1, -1, 200)` → `{ start: 6.9, end: 9.9 }`.
    - A null result for: `own` plain; `own` null; the lyrics' own line (`line` 0); X already at the end with `delta` +1.
  - **`retypedLine`** keeps the line's start and end, and its words spell the new text inside them.
  - **`editorKey`.**
    - ⌘N → `addLines`; ⌘N in a field → `null`.
    - ⌥↑ → `moveLine −1`; ⇧↓ → `extendLines +1`.
    - ⇧Space → `replayLine`; Space → `playLine`; ↑ → `line −1`.
  - **`lineRun`** covers voices at both ends, either way round.
  - **`afterLineTap`** skips second voices and ends with `'done'`.
  - **`lineTapTarget`** is word 0 of the cursor's line, else of the selected line.
- [ ] **Step 2: Run** `npx vitest run src/renderer/screens/lyricsEditor`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/renderer/screens/lyricsEditor`. Expected: PASS.
- [ ] **Step 5: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `Added verses: the editor page's helpers for adding and keys`.

  ```bash
  git add src/renderer/screens/lyricsEditor src/renderer/screens/LyricsEditor.tsx
  git commit -m "Added verses: the editor page's helpers for adding and keys" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 12: The editor page: adding lines

**Files:**
- Create: `src/renderer/screens/lyricsEditor/AddLinesSheet.tsx`
- Modify:
  - `src/renderer/screens/LyricsEditor.tsx`, `src/renderer/screens/LyricsEditor.css`;
  - `src/renderer/screens/lyricsEditor/Toolbar.tsx`;
  - `src/renderer/screens/lyricsEditor/LineList.tsx`;
  - `src/renderer/screens/lyricsEditor/EditLine.tsx`;
  - `src/renderer/screens/lyricsEditor/Waveform.tsx`.
- Test: none of pixels. The logic is in Tasks 1–11; this task is checked by eye.

**Interfaces:**
- Consumes:
  - `pastedLines`, `retypedLine`, and, with their Task 11 signatures (R13–R15):
    - `addPlace(colors, own, pressSec, fixSec, selected)`;
    - `addedShownLines(colors, own, index, texts, pressSec, fixSec, durationSec)`;
    - `movedTimes(colors, own, line, delta, endSec)`;
  - `editorLyrics(state, lyrics)` (Task 5) as `own`. `lyrics.offsetSec` (`useLyrics`) as `fixSec`: while `state.playingThis`, the song on screen is the editor's, so that's its stored fix;
  - `LineRow.added` and `alsoInLyrics` (Task 5);
  - the `addLines`, `retype`, `removeLine` and `moveLine` (with optional `start`/`end`) edits (Task 1).

- **The "＋ Add lines" button** sits in the toolbar after the time, as mockup B shows it, outlined in the accent with `--accent-text` words.
  - Its label is `＋ Add lines at 1:24` (`formatSongTime` of the live song position, the press itself, not shifted by the fix) while `addPlace(...)?.byTime`, else `＋ Add lines after line 12` (the selected line's number from `lineRows`).
  - Its title: "Add lines the lyrics are missing (⌘N)".
  - It is off while `!state.playingThis || colors === null`. The song may be paused (PF6).
  - It is also off while `addPlace(...)` is null (not by time, nothing selected). Its title then reads "Select the line the verse comes after" (PF10), and ⌘N does nothing.
  - Pressing it, or ⌘N, freezes `pressSec` (`positionAt(music, now)`), `fixSec` (`lyrics.offsetSec`) and the place, and opens the sheet.
- **The sheet** (`AddLinesSheet`) lies over the top of the line list.
  - **Caption:** "Paste or type the missing lines, one per line." then either "The first starts at 1:24." or "They go after line 12."
  - **The field:** a textarea with the label "Missing lines".
  - **Live feedback:** the `pastedLines` problem, or "3 lines".
  - **Buttons:** Cancel, and "Add 3 lines" / "Add 1 line", off with no lines or with a problem.
  - **Keys:** ⌘Enter adds and Esc cancels.
  - **Adding** sends `{ kind: 'addLines', at: place.index, lines: addedShownLines(colors, own, place.index, lines, pressSec, fixSec, duration) }` and selects the first added line. The first line is stored at `pressSec + fixSec`, so the Focus Screen lights it at the press (R15).
- **The list.**
  - An added row has a left bar in `--lyrics-added` and the tag "added": outlined in `--lyrics-added`, its words in `--text` (R16).
  - A row that's `alsoInLyrics` adds the quiet mark "also in the lyrics now".
  - A guessed line's start and end show dim with "≈" (mockup B).
- **The waveform.** An added line's block gets 45° stripes, 6 px bands, in `--lyrics-added` (white at low opacity, R16), over its fill. With nobody singing it, the block has no fill of its own, just the stripes on the waveform's plain block.
- **The edit area**, for a selected added line:
  - `EditLine.tsx` passes `state.shownLines` to `lineRows`, not today's `[]` (PF10), so the meta can know `alsoInLyrics`. The meta adds " · added", and " · also in the lyrics now" when that's so.
  - **Edit words…**, or a double-click on its words, turns them into a one-line field labelled "The line’s words", with Save and Cancel buttons.
    - Enter or Save sends `retype` with `retypedLine`; Esc or Cancel cancels.
    - A blank text disables Save and Enter, with no message (PF10).
    - A text over 200 characters shows "A line can be at most 200 characters." and disables Save and Enter.
  - **Remove line** sends `removeLine`, with no confirmation (⌘Z brings it back). Its title, when the line is also in the lyrics: "Remove this line; the lyrics’ own line shows again".
- **Keys.** ⌥↑/⌥↓ on a selected added line sends `{ kind: 'moveLine', line, delta, ...(movedTimes(colors, own, line, delta, duration + fixSec) ?? {}) }`. So synced lyrics also get the new guessed span (R13), and plain ones get the order only. The selection follows the line.
- **The token** (R16). In `LyricsEditor.css`, `.lyrics-editor { --lyrics-added: rgb(255 255 255 / 0.35) }` and `:root[data-theme='day'] .lyrics-editor { --lyrics-added: rgb(0 0 0 / 0.35) }`, beside the existing `--editor-danger` pair. Daylight's card is light, so white can't show there. No `--source-homework` anywhere in the editor. Buttons are at least 44 px tall.

- [ ] **Step 1: Build** the above.
- [ ] **Step 2: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 3: Check by eye** in a dev run on the demo player (星空レター).
  - While it plays, press ⌘N and paste three lines (one with a full-width space and a blank line between).
  - The rows appear as "added", striped on the waveform, and the Focus Screen shows them in place.
  - Retype one: its singers stay on unchanged words. A blank text can't be saved.
  - Move one with ⌥↑/⌥↓: in the demo's synced lyrics it takes a new time between its new neighbours and the Focus Screen shows it there. Remove one; ⌘Z brings it back.
  - Pause, then add: it works. With nothing selected and no real times around the playhead, the button is off with "Select the line the verse comes after".
  - Nudge the fix with ⌘[ first, then add at a press: the Focus Screen lights the new line when the playhead reaches the press.
  - Close and reopen: everything is kept.
  - Take screenshots for the user, on Night and Daylight.
- [ ] **Step 4: Commit** `Added verses: adding, retyping, moving and removing lines in the editor`.

  ```bash
  git add src/renderer/screens
  git commit -m "Added verses: adding, retyping, moving and removing lines in the editor" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```

### Task 13: The editor page: timing, and the docs

**Files:**
- Create: `src/renderer/screens/lyricsEditor/ListenButton.tsx`
- Modify:
  - `src/renderer/screens/LyricsEditor.tsx`;
  - `src/renderer/screens/lyricsEditor/Toolbar.tsx`;
  - `src/renderer/screens/lyricsEditor/LineList.tsx`;
  - `src/renderer/screens/LyricsEditor.css`;
  - `CLAUDE.md`.
- Test: none of pixels; checked by eye.

**Interfaces:**
- Consumes:
  - `ListenState`, the `listen` command and the `replayLine` command (Tasks 6 and 10);
  - `lineRun`, `lineTapTarget`, `afterLineTap` (Task 11);
  - `listenLines`, `listenStretch(colors, lines, durationSec, own, fixSec)`, `isHeard` (Task 8);
  - `editorLyrics(state, lyrics)` (Task 5) as `own`. It's null while another song plays, so only `timed` lines count on the page then; main, which keeps the own lines, has the final say and answers `NOT_HEARD_NOTE` when it disagrees;
  - `ListenState.fixSec` (Task 10) as `fixSec`, the editor's song's fix even while another song plays.

- **Runs of lines** (R5). Shift-click in the list, or ⇧↑/⇧↓, sets the run's other end, and `lineRun` gives the run. The rows in it are highlighted. A plain click or ↑/↓ clears it.
- **Time by listening** (`ListenButton`) sits in the edit area's header row, for the run (or the selected line). It is hidden while `state.listen === null`. Its states:
  - **The add-on isn't installed:** the button is off, beside the words "Needs the auto-sync add-on, which isn’t installed on this Mac". Its title is "Set it up with: npm run setup:aligner".
  - **A run is going** (`timing.length > 0`): "Timing 3 lines…" (`role="status"`); the button is off.
  - **The stretch isn't heard:** `listenStretch(colors, listenLines(colors, run.from, run.to), duration, editorLyrics(state, lyrics), listen.fixSec)` is `null`, or `isHeard(listen.heard, stretch)` is false. Both are in song time. The button is off, beside "Play this part once so I can hear it."
  - **Otherwise** it sends `{ kind: 'listen', from: run.from, to: run.to }`. This works while the player has another song on too, since the run uses audio already heard.
  - `listen.note` shows under it.
- **The tap switch.** While Tap timing is on, a switch labelled "Tap" with Words and Lines sits by it (`aria-pressed`).
  - In Lines mode, J's press sends `tap` down for `lineTapTarget`, its release sends nothing, and the cursor moves with `afterLineTap` (R12).
  - Titles: "J marks each word" / "J marks each line’s start".
- **Replay.** "Replay from the line before" sits next to Play line, titled "Play from the line before this one, to tap it again (⇧Space)". It and ⇧Space send `replayLine` for the selected line, and are off when Play line is.
- **The hint line** adds: ⌘N add lines · ⌥↑ ⌥↓ move an added line · Shift-click lines to pick several · ⇧Space replay from the line before.

- [ ] **Step 1: Build** the above.
- [ ] **Step 2: Update `CLAUDE.md`.**
  - **The Color-Code Lyrics editor's Design bullet.** Add, in its voice and with the user's words from the spec ("add, and edit and sync the missing verse easily", mockup B):
    - "＋ Add lines at m:ss" / "after line N" with a paste sheet (40 lines, 200 characters);
    - added lines' "added" tag, stripes and "also in the lyrics now", in a neutral white (black on Daylight) that is no singer's color;
    - an added line stored at the press plus the song's timing fix, so it lights at the press;
    - retype, Remove line, ⌥↑/⌥↓ (in synced lyrics a move gives the line a new guessed time between its new neighbours);
    - what counts as a line's real time: a shown synced line's, else the user's.
    - Time by listening: after an add once the stretch has played, or for the selected run; its stretch rules; its own aligner worker; its states and words;
    - Tap Words / Lines;
    - taps snapping to an onset within 120 ms, waiting up to 3 s for the outline;
    - Replay from the line before with ⇧Space.
  - **Layout.** Add `added.ts`, `likeness.ts`, `listen.ts`, `listenRunner.ts` and `tapQueue.ts` under `lyrics/singers/`, and `addLines.ts`, `AddLinesSheet.tsx` and `ListenButton.tsx` under `screens/lyricsEditor/`.
  - **The userData list.** `lyrics-singers/` codings now hold the lines the user added.
- [ ] **Step 3: Run** `graphify update .`, then `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 4: Check by eye.**
  - **The demo**, where there's no audio, so no timing by listening: Words and Lines taps, Replay with ⇧Space, and Shift-click runs. The listen button says "Play this part once…", or isn't shown where there's no tap.
  - **On the user's Mac with the add-on,** on a real song:
    - add a verse while it plays: it is timed by itself after it plays through, with "Timing N lines…";
    - "Time by listening" on a run of synced lines;
    - `app.getPath('temp')/focus-screen-listen` ($TMPDIR, e.g. `/var/folders/…/T/focus-screen-listen`) has no `.wav` left afterwards.
  - **Without the add-on:** the button says it's needed.
  - Take screenshots for the user.
- [ ] **Step 5: Commit** `Added verses: time by listening, line taps and replay in the editor; CLAUDE.md`.

  ```bash
  git add src/renderer/screens CLAUDE.md   # graphify-out/ is git-ignored
  git commit -m "Added verses: time by listening, line taps and replay in the editor; CLAUDE.md" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  ```
