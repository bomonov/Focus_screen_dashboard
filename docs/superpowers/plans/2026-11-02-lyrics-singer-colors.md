# Singer Colors in the Lyrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lyrics colored by who sings each part, made by the user in an Aegisub-like editor window with timing fixes and a waveform, and drawn on the Focus Screen with the word light in the singers' colors (a gradient where several sing).

**Architecture:**
- **Main.** A song's coding (`SongColors`) is saved per song in `userData/lyrics-singers/`. The lyrics service applies it to the shown lyrics: matched lines take the user's timing and singers. It publishes `LyricsState.colors` beside the lines.
- **Renderer.** It turns singer ids into theme-fitted colors and paints the existing word sweep with them.
- **The editor.** It's a third window, `#lyrics-editor`. Its edits go to main as commands, and a pure reducer applies them. Main owns undo, saving, Play line, tap timing, the waveform tap and the character pictures.

**Tech Stack:** Electron 44, TypeScript strict, React, plain CSS, Vitest, the existing Swift audio helper (Core Audio tap). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-02-lyrics-singer-colors-design.md` (read it first; mockups in `design/lyrics-singers/`).

## Global Constraints

- **TypeScript and IPC.** TypeScript strict, no `any`; small files, named exports. Every IPC channel and payload type is in `src/main/ipc.ts`; the renderer never touches files or the network.
- **Untrusted input.** Saved files are parsed as untrusted (anything malformed is "no colors", never a crash) and written atomically (`writeJsonFile` / `writeFileAtomic`).
- **Recording.** Only while the editor window is open; the audio stays in memory. The only thing kept is the waveform's outline (loudness peaks), per song (approved by the user on 2026-11-02).
- **Art.** No Project Sekai art is shipped, bundled or fetched. Badges are initials on the character's color, unless the user picked a picture; pictures are re-encoded copies in userData.
- **Local only.** No new host or network request.
- **Readable colors.** Singer colors on the Focus Screen are fitted to at least 3:1 against the theme's card (`fitContrast`, `MIN_ICON_CONTRAST` = 3).
- **Animations.** No finite CSS keyframe animations inside cards. The light stays on `useSongAnimations` (Web Animations).
- **Size.** Readable from about 1 m away; the editor's buttons are at least 44 px tall.
- **Windows.** No waveform there (no audio helper); the editor still works.
- **Commits and checks.**
  - Commit after each task on branch `lyrics-singers`, with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
  - After each task: `npm run typecheck`, `npm run lint`, `npm test` green.
  - At the end, `graphify update .`.

## Review Focus

1. **The lyrics change under a coding.** This happens after a re-check, another version picked, or new auto-sync timings. Lines whose text still matches keep their colors and timing; changed lines show uncolored and nothing is deleted (Task 4 test `keeps matched lines and drops changed ones`).
2. **The player reports the song a second longer or shorter.** The coding is still found, and saving doesn't leave two files (Task 3 test `finds a coding saved a second off and replaces it`).
3. **The editor is open while the player moves to another song.** Tap timing, Play line and the waveform never write into the open song from the other song's audio or position (Task 10 test `ignores taps and audio while another song plays`).
4. **A hand-edited or broken file in `lyrics-singers/`** reads as no colors, and an unknown singer id is dropped, not shown black (Task 2 tests).
5. **Pale colors on a pale theme.** Len's `#FFEE11` on the Daylight card is readable, and Shizuku's `#99EEDD` on Night isn't changed (Task 6 test `fits pale colors to the card`).

---

### Task 1: The cast

**Files:**
- Create: `src/main/services/lyrics/singers/cast.ts` (import-free; the renderer compiles it)
- Test: `src/main/services/lyrics/singers/cast.test.ts`

**Interfaces:**
- Produces: `interface Singer { id: string; name: string; color: string; group: CastGroup | 'extra' }`, `type CastGroup = 'leoneed' | 'mmj' | 'vbs' | 'wxs' | 'n25' | 'vs'`, `CAST_GROUPS: readonly { id: CastGroup; name: string }[]` (display names as in the spec's table), `CAST: readonly Singer[]` (26), `castSinger(id: string): Singer | undefined`, `initials(name: string): string`.

- [ ] **Step 1: Write the failing tests**
  - `has the 26 characters in six groups`: `CAST.length === 26`; group sizes 4,4,4,4,4,6, in the order `leoneed, mmj, vbs, wxs, n25, vs`.
  - `ids are unique lowercase names`: e.g. `ichika`, `kaito`, `meiko`.
  - `every color is #RRGGBB`.
  - `initials`: `initials('Ichika') === 'Ic'`, `initials('MEIKO') === 'ME'`, `initials('An') === 'An'`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers/cast.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `cast.ts`** with the spec's table.
  - **Check each hex** against the game's official character color (the Project SEKAI wiki's character pages list them). Note the source in a comment.
  - **If a color differs from the spec's**, use the official one and record a `Ruling:` in the ledger.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `Lyrics singers: the Project Sekai cast`.

### Task 2: The coding's types and parsing

**Files:**
- Create: `src/main/services/lyrics/singers/types.ts` (import-free)
- Create: `src/main/services/lyrics/singers/parse.ts`
- Test: `src/main/services/lyrics/singers/parse.test.ts`

**Interfaces:**
- Produces the types in `types.ts`:

  ```ts
  /** Who sings a word: singer ids in the order picked, or the song's whole cast. */
  export type SingerRef = readonly string[] | 'everyone'

  export interface CodedWord {
    /** As shown, spaces included. */
    text: string
    start: number
    end: number
    singers: SingerRef | null
  }

  export interface CodedLine {
    /** The line's text as the lyrics had it when coded: how it's matched again later. */
    text: string
    start: number
    end: number
    words: CodedWord[]
    /** A second voice sits under the main line at this index of `lines`; absent for a main line. */
    under?: number
    /** Romaji split points the user dragged, as character offsets into the line's romaji. */
    romajiSplits?: number[]
  }

  export interface SongColors {
    version: 1
    lines: CodedLine[]
    /** The song's cast, in order: who "Everyone" means. */
    cast: string[]
    /** Singers the user added (not in CAST). Ids start with "extra:". */
    extra: { id: string; name: string; color: string }[]
  }

  export const SONG_COLORS_VERSION = 1
  ```

- Produces `parseSongColors(raw: unknown, known: (id: string) => boolean): SongColors | null` in `parse.ts`.

- [ ] **Step 1: Write the failing tests** in `parse.test.ts`:
  - **`reads back what it would write`:** a two-line coding with a duet word, an "everyone" word, a second voice (`under: 0`) and an extra singer parses to an equal object.
  - **Returns `null`** for:
    - non-objects;
    - `version !== 1`;
    - `lines` that isn't an array;
    - a line whose `end < start`.
  - **`drops unknown singer ids`:** `singers: ['ichika','nobody']` becomes `['ichika']`, and `['nobody']` becomes `null`.
  - **`drops a second voice whose under isn't an earlier main line`.**
  - **`keeps word times inside their line and in order`:** a word starting before its line's start is clamped to the start, and a later word starting before the previous one is clamped to the previous start.
  - **`rejects an extra singer with a bad color`:** the singer is dropped, and so are its uses.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers/parse.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `parseSongColors`.** Narrow with `unknown` checks.
  - `known(id)` is `castSinger(id) !== undefined || extra ids`.
  - `'everyone'` is accepted as the only non-array `singers`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `Lyrics singers: the saved coding and its untrusted parsing`.

### Task 3: The store (colors, waveforms, pictures folder)

**Files:**
- Create: `src/main/services/lyrics/singers/store.ts`
- Test: `src/main/services/lyrics/singers/store.test.ts`

**Interfaces:**
- Consumes: `parseSongColors`, `nearSongKeys` (`services/lyrics/query.ts`), `writeJsonFile` (`services/jsonFile.ts`).
- Produces:

  ```ts
  export interface SongColorsStore {
    read(key: string): SongColors | null
    write(key: string, colors: SongColors): void
    /** Deletes the song's colors and its waveform. */
    remove(key: string): void
    readWaveform(key: string): Uint8Array | null
    writeWaveform(key: string, peaks: Uint8Array): void
    /** Fires with the song's key after write/remove. */
    subscribe(listener: (key: string) => void): () => void
  }
  export function openSongColorsStore(dir: string): SongColorsStore
  ```

- **File names:** `<dir>/<sha1(key)>.json` holds `{ key, colors }`, and `<dir>/waveforms/<sha1(key)>.bin` holds the raw peaks. Song keys hold `|` and any script, so they're hashed, and the file keeps the key so a hash match is confirmed.

- [ ] **Step 1: Write the failing tests** (temp dir per test):
  - `writes and reads a song's colors`.
  - `finds a coding saved a second off and replaces it`: write under `a|b|200`; then `read('a|b|201')` returns it, and a `write('a|b|201', …)` leaves exactly one json file.
  - `remove deletes colors and waveform`.
  - `a broken file reads as none`: write garbage to the hashed path, and `read` returns `null`.
  - `waveform round-trips bytes`.
  - `tells subscribers the key`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers/store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `createHash('sha1')`, `readFileSync` in try/catch, `writeJsonFile`, and `writeFileAtomic` for the `.bin` (use the helper the background photo uses).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `Lyrics singers: per-song store with a second's leeway`.

### Task 4: Applying a coding to the shown lyrics

**Files:**
- Create: `src/main/services/lyrics/singers/apply.ts`
- Modify: `src/main/services/lyrics/types.ts`: add `LyricsColors` and `colors` to `LyricsState`.
- Test: `src/main/services/lyrics/singers/apply.test.ts`

**Interfaces:**
- Consumes: `SongColors`, `Lyrics`, `SyncedLine`, `SyncedWord`.
- Produces, in `lyrics/types.ts` (import-free, so declare the shape there and have `singers/types.ts` reuse it):

  ```ts
  export interface LyricsColors {
    /** Per shown line (same index): each word's singer ids, resolved ("everyone" → the cast); null for a word nobody was given, or a line that isn't colored. */
    lines: ((string[] | null)[] | null)[]
    /** Second voices, each under a shown line. */
    voices: { under: number; words: SyncedWord[]; singers: (string[] | null)[] }[]
    /** Romaji split points per shown line, where the user set them. */
    romajiSplits: (number[] | null)[]
    extra: { id: string; name: string; color: string }[]
  }
  // In LyricsState:
  colors?: LyricsColors | null
  ```

- Produces `colorLyrics(lyrics: Lyrics, colors: SongColors): { lyrics: Lyrics; colors: LyricsColors } | null` in `apply.ts`. It returns `null` when no line matches.

- **Matching.** Shown lines are matched to coded main lines by exact text, in order: a coded line is used at most once, and never one before the last match. A synced or plain shown line that matches takes the coded `start` as `timeSec` and the coded words (`text/start/end`) as `words`. Unmatched lines stay as they were.
- **Plain lyrics** whose every non-empty line matched become `kind: 'synced'`, keeping the same `source`. Otherwise they stay plain, with colors per line.

- [ ] **Step 1: Write the failing tests**:
  - **`keeps matched lines and drops changed ones`.** The coding was made on lines A,B,C and the shown lyrics are A,B′,C. Then:
    - A and C get the coded timing and singers;
    - B′ is untouched, with `colors.lines[1] === null`;
    - nothing is thrown (the coding object is unchanged).
  - **`resolves everyone to the cast in order`.**
  - **`a duet word keeps its singers in the order picked`.**
  - **`plain lyrics fully coded become synced`.**
  - **`a second voice follows its main line`:** `voices[0].under` is the shown index of its main line. A voice whose main line didn't match is dropped.
  - **`returns null when nothing matches`.**
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers/apply.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `colorLyrics`** and add the types.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `Lyrics singers: apply a coding to the lyrics shown`.

### Task 5: The lyrics service publishes colors (and the demo has some)

**Files:**
- Modify: `src/main/services/lyrics/service.ts`
  - `LyricsServiceOptions` gains `colors?: SongColorsStore`.
  - `present()` applies `colorLyrics` after auto-sync and romaji.
  - The service subscribes to the store and re-presents the song on screen when its key changes.
- Modify: `src/main/services/lyrics/provider.ts` and `mock/provider.ts`: the demo provider gets `colors?(query: LyricsQuery): SongColors | null`. 星空レター gets a coding with two singers (`ichika`, `miku`), one duet word, one "everyone" line and one second voice.
- Modify: `src/main/index.ts`: open the store at `join(userData, 'lyrics-singers')` and pass it in.
- Test: `src/main/services/lyrics/service.test.ts`, `mock/provider.test.ts`

**Interfaces:**
- Consumes: `openSongColorsStore`, `colorLyrics`.
- Produces: `LyricsState.colors`. Every publish without colors spells out `colors: null`, so an older state's colors never linger, the same as `NO_ROMAJI`.

- [ ] **Step 1: Write the failing tests**:
  - `publishes the song's colors when it has some`;
  - `drops colors on the next song`;
  - `re-publishes when the song's colors are saved`;
  - `the demo's 星空レター comes colored`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/service.test.ts src/main/services/lyrics/mock`. Expected: FAIL.
- [ ] **Step 3: Implement.** The romaji keeps lining up with the shown lines' indices; `colorLyrics` never adds or removes lines.
- [ ] **Step 4: Run** the full suite (`npm test`). Expected: PASS.
- [ ] **Step 5: Commit** `Lyrics singers: the screen gets the song's colors`.

### Task 6: Colors for the renderer (pure)

**Files:**
- Create: `src/renderer/widgets/music/singerColors.ts`
- Test: `src/renderer/widgets/music/singerColors.test.ts`

**Interfaces:**
- Consumes: `CAST`, `castSinger`; `fitContrast`, `contrast` (`theme/color.ts`).
- Produces:

  ```ts
  /** Each id's color, fitted to 3:1 against `card`; unknown ids are left out. */
  export function singerHexes(ids: readonly string[], extra: LyricsColors['extra'], card: string): string[]
  export interface ColorPart { from: number; to: number; colors: string[] }   // word indices, `to` exclusive
  /** Runs of neighbouring words with the same singers. Words with none get no part. */
  export function colorParts(words: readonly (readonly string[] | null)[], hexes: (ids: readonly string[]) => string[]): ColorPart[]
  /** `linear-gradient(90deg, …)` evenly across `colors`; one color gives a flat two-stop gradient. */
  export function partGradient(colors: readonly string[]): string
  /** Where the romaji splits for each part: the user's points, else a sure guess, else null (gradient). */
  export function romajiCuts(romaji: string, lineText: string, parts: readonly ColorPart[], wordTexts: readonly string[], userCuts: readonly number[] | null): number[] | null
  ```

- **`romajiCuts`' guess.** Each part boundary's character position in the Japanese line, scaled to the romaji's length, snaps to the nearest space. It's "sure" only when a space is within 2 characters of that point; otherwise `null`.

- [ ] **Step 1: Write the failing tests**:
  - **`fits pale colors to the card`:**
    - `singerHexes(['len'], [], '#F4F2EE')`, the Daylight card (read the real value from `presets.ts`), gives contrast ≥ 3.
    - `singerHexes(['shizuku'], [], '#191919')` returns `#99EEDD` unchanged.
  - **`colorParts groups runs`:** `[['ichika'],['ichika'],['ichika','minori'],null]` → two parts `{0,2}` and `{2,3}`.
  - **`partGradient` with one color has two equal stops.**
  - **`romajiCuts`:**
    - the user's cuts win;
    - a clean space gives the guess;
    - no space nearby gives `null`.
- [ ] **Step 2: Run** `npx vitest run src/renderer/widgets/music/singerColors.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `Lyrics singers: theme-fitted singer colors and parts`.

### Task 7: Drawing the colors on the Focus Screen

**Files:**
- Modify: `src/renderer/widgets/music/LyricsPanel.tsx`:
  - `LyricsPanel` takes `colors: LyricsColors | null`;
  - `GlidingLyrics` passes each row's parts;
  - `RowWords` takes `paint`;
  - `SungRomaji` and `Romaji` take segments.
- Modify: `src/renderer/widgets/music/lyricsGlide.ts`: `GlideRow` gains `singers?: (string[] | null)[]` and `voices?: GlideVoice[]`; `syncedRows` carries them.
- Modify: `src/renderer/widgets/NowPlaying.css`: the colored sweep and faint rows.
- Modify: `src/renderer/widgets/music/lyricsView.ts`: `lyricsCaption` adds "colors by you" when colors are shown.
- Modify: wherever `LyricsPanel` is used, to pass `state.colors`.
- Test: `lyricsGlide.test.ts`, `lyricsView.test.ts`

**Interfaces:**
- Consumes: `colorParts`, `partGradient`, `singerHexes`, `romajiCuts`, `LyricsColors`.
- Produces: `interface GlideVoice { words: SyncedWord[]; singers: (string[] | null)[] }` and `voicesNow(row: GlideRow, nowSec: number): number[]` (indices of the row's voices being sung).

How the color rides on the sweep (decided):
- **Two background layers on each word box**, both clipped to text.
  - **Top layer:** the existing sweep gradient, but its lit side is `transparent` and its unsung side the card color at about 60%.
  - **Bottom layer:** the part's `partGradient`, sized to the part's measured width and positioned at minus the word's offset within the part, so a duet's gradient runs across the whole part.
  - `WORD_SWEEP` becomes `wordSweep(partPosition: string): Keyframe[]`, which animates only the top layer's position (`backgroundPosition: '100% 0, <partPosition>'` → `'0% 0, <partPosition>'`).
- **Rows that aren't being sung** use the same bottom layer with the top layer held at the unsung side, so they're faint in their singers' colors. Rows without colors keep today's look, untouched.
- **Second voices** render as a smaller row inside the main row's element, under its words. They light on their own words' times through the same `RowWords`, so two rows light at once, and the glide's measured row height includes them.
- **Romaji** is split at `romajiCuts`: each piece gets its part's colors. Where `romajiCuts` is `null`, the romaji gets one gradient of the line's singers in order.

- [ ] **Step 1: Write the failing tests**:
  - `syncedRows carries each line's singers and voices` (lyricsGlide.test.ts);
  - `voicesNow lists the voices sung at a time`;
  - `the caption says colors by you` (lyricsView.test.ts).
- [ ] **Step 2: Run** `npx vitest run src/renderer/widgets/music`. Expected: FAIL.
- [ ] **Step 3: Implement** as decided above.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Check by eye** in a throwaway preview copy (temporary userData, the demo player) that 星空レター shows the colors, the duet gradient, "everyone" and the second voice, on Night and Daylight.
  - Then **measure** the GPU-process and renderer CPU while the record spins and the colored song plays, against an uncolored song, the way the light-up work was measured.
  - If the colored song costs more than about 2 points, record a `Ruling:` with the numbers and keep the cheaper variant (for example, the bottom layer only on the sung row).
- [ ] **Step 6: Commit** `Lyrics singers: colored lyrics and duet gradients on the Focus Screen`.

### Task 8: Edits, undo and the editor's starting point (pure)

**Files:**
- Create: `src/main/services/lyrics/singers/edit.ts`
- Test: `src/main/services/lyrics/singers/edit.test.ts`

**Interfaces:**
- Consumes: `SongColors`, `CodedLine`, `SingerRef`.
- Produces:

  ```ts
  export type ColorEdit =
    | { kind: 'assign'; line: number; from: number; to: number; singers: SingerRef | null }
    | { kind: 'lineTime'; line: number; start?: number; end?: number }
    | { kind: 'wordTime'; line: number; word: number; start?: number; end?: number }
    | { kind: 'splitWord'; line: number; word: number; at: number }      // at: character index
    | { kind: 'makeVoice'; line: number; from: number; to: number }
    | { kind: 'addVoice'; line: number; text: string }
    | { kind: 'setCast'; cast: string[] }
    | { kind: 'addSinger'; name: string; color: string }
    | { kind: 'romajiSplits'; line: number; splits: number[] | null }
  export function applyEdit(colors: SongColors, edit: ColorEdit): SongColors
  export interface EditHistory { now(): SongColors; apply(edit: ColorEdit): SongColors; undo(): SongColors | null; redo(): SongColors | null; canUndo(): boolean; canRedo(): boolean }
  export function createEditHistory(start: SongColors, limit?: number): EditHistory   // limit 200
  ```

- **The starting coding** is built in the renderer (Task 13), where `japaneseWords` and `estimateWords` live, and sent with the editor's `begin` command. Main runs it through `parseSongColors`, so it's never trusted.

- [ ] **Step 1: Write the failing tests**:
  - **assign** sets words `from..to` (exclusive end) and leaves others alone; `null` clears them.
  - **lineTime** keeps `end > start` and moves the words that fall outside it to its edges.
  - **wordTime** keeps word order: a start before the previous word's start is clamped.
  - **splitWord** at 2 of `始まる` gives `始ま` + `る`, sharing the time by length and keeping the singers.
  - **makeVoice:**
    - moves the chosen words into a new line with `under` set to the line's index and their own times;
    - strips one pair of surrounding brackets `(…)` or `（…）` from the voice's text;
    - leaves the main line without them.
  - **addVoice** adds a voice line under `line`, its words split on spaces, timed across the main line's span.
  - **addSinger** gives an id `extra:<slug>` and won't duplicate a name.
  - **Everyone needs a cast of two or more:** assigning `'everyone'` with a smaller cast is a no-op.
  - **History:**
    - `apply` then `undo` gives the start back;
    - `redo` reapplies it;
    - a new `apply` clears redo;
    - it keeps at most `limit`.
  - **Every result passes `parseSongColors` unchanged** (property-style over the cases above).
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers/edit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `Lyrics singers: edits and undo`.

### Task 9: The waveform's outline (pure)

**Files:**
- Create: `src/main/services/lyrics/singers/waveform.ts`
- Test: `src/main/services/lyrics/singers/waveform.test.ts`

**Interfaces:**
- Produces:

  ```ts
  /** Loudness peaks, one byte per bucket of PEAK_SEC; 0 means not heard yet. */
  export const PEAK_SEC = 0.02
  export function emptyPeaks(durationSec: number): Uint8Array
  /** Adds audio heard at `songTimeSec` (16-bit mono or interleaved, `rate` Hz) into `peaks`. Returns whether anything changed. */
  export function addPeaks(peaks: Uint8Array, songTimeSec: number, samples: Int16Array, rate: number, channels: number): boolean
  /** The nearest sudden rise in loudness within `withinSec` of `timeSec`, or null. */
  export function nearestOnset(peaks: Uint8Array, timeSec: number, withinSec: number): number | null
  ```

- **Peak value:** the max absolute sample in the bucket, scaled to 1..255. A heard silence stores 1, so it's told apart from "not heard". The rate and channels come from what the audio helper's stream reports (read `autosync/protocol.ts`).

- [ ] **Step 1: Write the failing tests**:
  - `emptyPeaks(10)` has 500 zeros;
  - a loud burst at 2.0 s fills buckets 100.. with high values;
  - silence stores 1;
  - audio past the end is ignored;
  - `nearestOnset` finds the burst's start within 0.1 s, and `null` beyond `withinSec`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers/waveform.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `Lyrics singers: the waveform outline`.

### Task 10: The editor session in main

**Files:**
- Create: `src/main/services/lyrics/singers/editor.ts`
- Create: `src/main/services/lyrics/singers/editorTypes.ts` (import-free: state and commands, re-exported from `ipc.ts`)
- Test: `src/main/services/lyrics/singers/editor.test.ts`

**Interfaces:**
- Consumes:
  - `SongColorsStore`, `createEditHistory`, `applyEdit`, `parseSongColors`;
  - `emptyPeaks` and `addPeaks`;
  - the lyrics service (`currentSong()`, `get()`);
  - music (`get()`, `subscribe`, `command`);
  - `songTimeAt` (`autosync/capture.ts`);
  - `OffsetStore`;
  - a tap opener (Task 11).
- Produces, in `editorTypes.ts`:

  ```ts
  export interface ColorEditorState {
    open: boolean
    song: { key: string; title: string; artist: string; durationSec: number } | null
    /** False when the player has moved to another song: timing and recording wait. */
    playingThis: boolean
    /** Another song is on and has lyrics, so "Switch to the song playing now" can show. */
    canSwitch: boolean
    colors: SongColors | null
    /** The lyrics' own lines, for marking "changed" lines (coded text not among them). */
    shownLines: string[]
    romaji: string[] | null
    canUndo: boolean
    canRedo: boolean
    /** base64 peaks; null when there's no waveform (no helper, no access, Windows). */
    waveform: string | null
    waveformNote: string | null   // plain words when there's none, e.g. "Recording isn't allowed…"
    canSeek: boolean
    /** Singer pictures as data URLs, by id. */
    pictures: Record<string, string>
  }
  export type ColorEditorCommand =
    | { kind: 'begin'; colors: unknown }            // the renderer's starting coding, parsed in main
    | { kind: 'edit'; edit: ColorEdit }
    | { kind: 'undo' } | { kind: 'redo' }
    | { kind: 'playLine'; line: number }
    | { kind: 'tap'; phase: 'down' | 'up'; line: number; word: number }
    | { kind: 'switchToPlaying' }
    | { kind: 'removeAll' }
    | { kind: 'choosePicture'; singer: string }
    | { kind: 'pictureFromPath'; singer: string; path: string }
    | { kind: 'removePicture'; singer: string }
  ```

- Produces, in `editor.ts`: `createColorEditor(options): { state(): ColorEditorState; subscribe(...); open(): void; close(): void; command(c: ColorEditorCommand): void; dispose(): void }`.

Behavior (from the spec):
- **Opening.** `open()` takes the song on screen (`lyrics.currentSong()`) and loads its colors. With no saved colors, it waits for the renderer's `begin`.
- **Saving.**
  - Edits are saved 500 ms after the last one.
  - A save that changed any time clears the song's offset (`offsets.set(key, 0)`).
  - `removeAll` deletes the song's file and waveform.
- **Play line.** It seeks to the line's start, plays if paused, and pauses once the position passes the line's end. Watch music state; don't use a bare timer, which a seek would break. It's off when `!canSeek` or `!playingThis`.
- **Tap timing.** `tap` uses the main process's clock and the music state's position (`positionAt`):
  - `down` sets the word's start;
  - `up`, more than 0.15 s after its down, sets the word's end.
- **The waveform.** While open and `playingThis`, the tap's audio goes into `addPeaks` at `songTimeAt`. Peaks are saved every 5 s and on close, and pushed to the windows at most twice a second.
- **When the player moves to another song,** `playingThis` turns false and taps, Play line and audio are ignored until the song comes back. It never switches by itself; `switchToPlaying` saves, then opens the new song.

- [ ] **Step 1: Write the failing tests** (fake music, fake store, fake clock, fake tap):
  - `opens on the song on screen with its saved colors`;
  - `saves half a second after the last edit, once`;
  - `a timing edit clears the song's offset`;
  - `ignores taps and audio while another song plays`;
  - `play line seeks, plays, and pauses past the end`;
  - `tap down and up time a word`;
  - `switchToPlaying saves and moves to the new song`;
  - `removeAll deletes colors and waveform`;
  - `begin with garbage is ignored`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers/editor.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `Lyrics singers: the editor session (saving, play line, tap timing)`.

### Task 11: The waveform tap and the character pictures

**Files:**
- Create: `src/main/services/lyrics/singers/tap.ts`: opens its own audio helper process for the player's apps (`audioHelper` + `createAudioHelperClient`, as Prepare's second helper does) and closes it with the editor.
- Create: `src/main/services/lyrics/singers/pictures.ts`
- Modify: `src/main/index.ts`: wire the editor with the tap and pictures (macOS only for the tap, decided in the one platform check).
- Modify: `src/preload/index.ts`: `pathForFile(file: File): string` via `webUtils.getPathForFile`, for dropping a picture onto a badge.
- Test: `src/main/services/lyrics/singers/pictures.test.ts`

**Interfaces:**
- Produces: `openSingerTap(): { start(bundles: string[]): Promise<StartResult>; stop(): void; onAudio(listener): () => void; access(): CaptureAccess | null; dispose(): void } | null`. It's `null` on Windows or when the helper isn't built.
- Produces:

  ```ts
  export interface SingerPictures {
    all(): Record<string, string>            // id → PNG data URL
    choose(win: BrowserWindow | null, id: string): Promise<{ ok: true } | { ok: false; message: string }>
    fromPath(id: string, path: string): { ok: true } | { ok: false; message: string }
    remove(id: string): void
    subscribe(listener: () => void): () => void
  }
  export function openSingerPictures(dir: string): SingerPictures
  ```

- **Pictures.** Each is re-encoded as a PNG, longer side 256 px (`fitWithin` from `backgroundPhoto.ts`), at `<dir>/pictures/<sha1(id)>.png`.
  - Sources over 60 MB, or ones that don't decode, are refused with plain words, as for the background photo.
  - The id must be a known singer.

- [ ] **Step 1: Write the failing tests** for `pictures`. Mock `nativeImage` the way `backgroundPhoto.test.ts` does:
  - `refuses an unknown singer`;
  - `refuses a picture that won't decode`;
  - `keeps a re-encoded copy and lists it`;
  - `remove deletes it`.
- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/singers/pictures.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules and the wiring.
  - When the tap's `access()` isn't granted, the editor's `waveformNote` says: "Recording isn't allowed, so there's no waveform. Allow Focus Screen Audio in System Settings › Privacy & Security › Screen & System Audio Recording."
  - On Windows it says: "There's no waveform on Windows yet."
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Lyrics singers: the waveform tap and character pictures`.

### Task 12: The window, IPC and menus

**Files:**
- Create: `src/main/services/display/lyricsEditorWindow.ts`: a copy of the `customizeWindow.ts` pattern, titled "Color-Code Lyrics", loading view `'lyrics-editor'`, min size 900×600.
- Modify: `src/main/paths.ts` (`RendererView`), `src/renderer/main.tsx`, `src/renderer/App.tsx` (`View` gains `'lyrics-editor'`).
- Modify: `src/main/ipc.ts`:
  - channels `lyricsColorsGet`, `lyricsColorsChanged`, `lyricsColorsCommand`;
  - API `getLyricsColorEditor()`, `onLyricsColorEditorChanged()`, `sendLyricsColorEditorCommand()`, `pathForFile()`.
- Modify: `src/preload/index.ts`.
- Modify: `src/main/menu.ts`:
  - `MenuContext.lyrics` gains `colorCode(): void` and `canColorCode: boolean`;
  - a "Color-Code Lyrics…" item right after "Pick Other Lyrics…", in the same item list the app menu, right-click menu and Music card's dot menu share.
- Modify: `src/main/index.ts`: create the window controller. `canColorCode` is true when a song with lyrics is on, and the menus refresh when that changes, like "Pick Other Lyrics…".
- Test: `src/main/menu.test.ts` (or the file that tests the Music items)

**Interfaces:**
- Consumes: `createColorEditor` (Task 10).
- Produces: IPC as above; `createLyricsEditorWindowController(focus): { open(): void; close(): void; getWindow(): BrowserWindow | null; onChange(...) }`. Closing the window calls the editor's `close()`.

- [ ] **Step 1: Write the failing tests**:
  - `the music items have Color-Code Lyrics after Pick Other Lyrics`;
  - `it's off without a song with lyrics`.
- [ ] **Step 2: Run** `npx vitest run src/main/menu.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The editor's state is pushed to the editor window and to nothing else. The Focus Screen gets the colors through `LyricsState` (Task 5).
- [ ] **Step 4: Run** `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Lyrics singers: the Color-Code Lyrics window and menu item`.

### Task 13: The editor's pure helpers (renderer)

**Files:**
- Create: `src/renderer/screens/lyricsEditor/editorView.ts`
- Test: `src/renderer/screens/lyricsEditor/editorView.test.ts`

**Interfaces:**
- Consumes: `japaneseWords`, `estimateWords` (`widgets/music/`), `SongColors`, `ColorEdit`.
- Produces:

  ```ts
  /** The coding a song starts from: its shown lines as words (as the Focus Screen splits them), timed as shown, nobody assigned. */
  export function startingColors(lines: readonly SyncedLine[] | readonly string[], durationSec: number): SongColors
  /** Lines in the coding whose text isn't among the shown lines (marked "changed" in the list). */
  export function changedLines(colors: SongColors, shown: readonly string[]): Set<number>
  /** A drag or shift-click across words, as an inclusive-exclusive range. */
  export function wordRange(anchor: number, focus: number): { from: number; to: number }
  export type EditorKey =
    | { kind: 'line'; delta: -1 | 1 } | { kind: 'playLine' } | { kind: 'assign'; slot: number }
    | { kind: 'clear' } | { kind: 'undo' } | { kind: 'redo' } | { kind: 'tap'; phase: 'down' | 'up' } | null
  /** The editor's keys: ↑/↓ lines, Space play line, 1–9 the cast row's slots, Delete clears, ⌘Z/⇧⌘Z, J taps. Typing in a field is never a key. */
  export function editorKey(event: { key: string; metaKey: boolean; shiftKey: boolean; type: 'keydown' | 'keyup'; repeat: boolean; inField: boolean }): EditorKey
  ```

- **Plain lyrics** get each line spread over the song by length: the first line at 5% of the song, the last ending at 95%. The user times them from there.

- [ ] **Step 1: Write the failing tests**:
  - **`startingColors`:**
    - keeps line and word text exactly as shown;
    - Japanese lines without spaces are split like the Focus Screen;
    - the times are in order;
    - `singers` are all `null`;
    - the result passes `parseSongColors`.
  - **`changedLines`** marks only lines missing from the shown lyrics.
  - **`wordRange`** works both directions.
  - **`editorKey`:**
    - Space → playLine;
    - `2` → assign slot 1;
    - ⇧⌘Z → redo;
    - J keydown → tap down; J keyup → tap up; J repeat → null;
    - anything in a field → null.
- [ ] **Step 2: Run** `npx vitest run src/renderer/screens/lyricsEditor/editorView.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `Lyrics singers: the editor's starting coding, ranges and keys`.

### Task 14: The editor's screen (renderer)

**Files:**
- Create: `src/renderer/screens/LyricsEditor.tsx`, `src/renderer/screens/LyricsEditor.css`
- Create: `src/renderer/screens/lyricsEditor/Toolbar.tsx`, `Waveform.tsx`, `LineList.tsx`, `EditLine.tsx`, `CastPicker.tsx`, `SongCast.tsx`, `SingerBadge.tsx`
- Create: `src/renderer/hooks/useLyricsColorEditor.ts`: an IPC subscription, like `useSettings`.
- Test: none of pixels. The behavior is in Tasks 8–13; this task is checked by eye.

**Interfaces:**
- Consumes: Tasks 6, 12, 13; `CAST`, `CAST_GROUPS`, `initials`.

Layout and behavior follow mockup A (`design/lyrics-singers/editor.html`) and the spec's "The editor":
- **Toolbar:**
  - Play line;
  - the time;
  - Tap timing (an on/off that arms J);
  - Undo/Redo;
  - "Remove colors for this song…", which asks first;
  - the "Play {song} to time it" note and the "Switch to the song playing now" button when `!playingThis`.
- **Waveform** (canvas):
  - peaks;
  - main lines as blocks in their parts' gradients on the top lane, second voices on a second lane;
  - word ticks;
  - the playhead.
  - Dragging a block's edges sends `lineTime`, and dragging a tick sends `wordTime`, snapped to `nearestOnset` within 0.08 s unless Option is held.
  - Pinch or ⌘ + scroll zooms; scrolling pans.
  - With `waveform === null`, `waveformNote` shows in its place, and blocks and ticks still draw on a blank lane.
- **Line list:** number, start, end, who (badges), the colored text. "Changed" lines are marked. The selected line is highlighted, and clicking selects.
- **Edit line:**
  - the selected line big, as word pieces; drag or Shift-click selects a range;
  - Option-click between two letters sends `splitWord`;
  - "Make second voice" shows while a range is selected;
  - "Add second voice…" opens an inline text field;
  - the romaji under it, with a handle at each cut (from `romajiCuts`) to drag, which sends `romajiSplits`.
- **Song cast row** (`SongCast`): the song's cast in order, numbered 1–9 for the keys, with "Everyone" (off below two) and an add button that opens the cast.
- **Cast picker:**
  - the six groups;
  - a badge per character: picture or initials on the color;
  - clicking assigns the selection (several clicks while the same range is selected build a duet in the order clicked);
  - right-click gives "Choose Picture…" and "Remove Picture";
  - dropping an image file sends `pictureFromPath` with `pathForFile`;
  - "Add singer…" opens a name field and a color picker.
- **Badges** are at least 44 px where they're buttons, and every button has an accessible name ("Ichika", "Choose a picture for Ichika").
- **Theme:** the editor uses the theme's tokens like Customize does.

- [ ] **Step 1: Build the screen** from the components above.
- [ ] **Step 2: Run** `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 3: Check by eye** in a throwaway preview copy with the demo player, on 星空レター:
  - open "Color-Code Lyrics…";
  - select a range and assign two singers: the Focus Screen shows the duet gradient live;
  - make a second voice;
  - tap-time a word;
  - undo and redo;
  - close and reopen: everything is kept.
  - Capture screenshots for the user.
- [ ] **Step 4: Commit** `Lyrics singers: the Color-Code Lyrics editor`.

### Task 15: Docs and graph

**Files:**
- Modify: `CLAUDE.md`:
  - **Stack:** the editor window and its audio tap.
  - **Layout:** `lyrics/singers/` and `screens/lyricsEditor/`.
  - **The settings/userData file list:** `lyrics-singers/` (per-song colors, `waveforms/`, `pictures/`).
  - **Privacy:** recording while the editor is open, only peaks kept, approved 2026-11-02; no character art shipped.
  - **Design:** a bullet for the colored lyrics and one for the editor.
- [ ] **Step 1: Write** the CLAUDE.md changes in the file's own voice (plain words, the user's quotes, dates).
- [ ] **Step 2: Run** `graphify update .` and `npm run typecheck && npm run lint && npm test`. Expected: all pass.
- [ ] **Step 3: Commit** `Lyrics singers: CLAUDE.md`.
