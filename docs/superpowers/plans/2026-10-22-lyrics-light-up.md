# Lyrics Light-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Spicy-style word pops, sound-weighted guessed timings, romaji that follows along, letter-by-letter swells on held words and a softer light edge to the sung lyrics line.

**Architecture:** Pure timing and keyframe logic in two small modules beside `lyricsGlide.ts` (tested), the drawing in `SungWords` / a new `SungRomaji` in `LyricsPanel.tsx` on the existing `useSongAnimations` clock, CSS in `NowPlaying.css`. A fourth demo song (Japanese, romaji, a held word) so `npm run dev` shows all of it offline.

**Tech Stack:** React 19, TypeScript strict, Web Animations API, plain CSS, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-lyrics-light-up-design.md`

## Global Constraints

- **Read "Amendments after the builder check" at the end first:** it changes Tasks 1, 2 and 4.

- Renderer only, plus pure logic and the demo: no IPC channel, setting, network or aligner change.
- Every animation runs through `useSongAnimations` (song clock: paused with the music, re-synced on a jump > 250 ms, cancelled when the row changes).
- Reduced motion: keep the color sweeps (words and romaji); create no pop, wait-smaller, letter swell or glow animation.
- Transforms and filters only: no change to any row's layout box (the glide measures rows).
- Values: pop 97% → 106% at 0.28 s → 100% at 0.9 s, lift 0.13 em, wait 0.03 em lower; glow `drop-shadow(0 0 0.4em rgb(255 255 255 / 0.5))` at peak, 0.12 alpha at rest; held ≥ 1.2 s; strength = clamp((span − 1) / 2, 0, 1); swell rise 0.45 s, settle 1.1 s, scale 1.08 + 0.08 × strength, lift (0.1 + 0.1 × strength) em, glow blur (0.4 + 0.2 × strength) em at alpha 0.35 + 0.25 × strength; soft band 0.6 em; romaji lit `rgb(255 255 255 / 0.92)`, unlit `rgb(255 255 255 / 0.4)`.
- Weights: kanji 2, kana 1, small kana 0.5, ー 1, Hangul block 1, Latin word = vowel groups (aeiouy, silent final e dropped when another group exists), punctuation 0, every piece ≥ 1. The per-line cap in `estimateWords` is unchanged.
- No Spicy Lyrics code (AGPL-3.0). No looping animation anywhere on the lyrics.
- After each task: `npm run typecheck`, `npm run lint`, `npm test` pass; commit locally (never push) ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A Japanese line with no spaces must still wrap in a narrow card ("Full" style, small card): it's one guessed "word", so it is drawn glyph by glyph (inline-blocks can't break inside). Pinned in Task 4's wrap check and Task 2's `drawnByLetter` test.
2. Leading/trailing spaces in word texts (aligner words start with " ", guessed ones end with " ") must stay between words, not inside the transformed boxes, or words run together. Pinned in Task 2's `splitSpaces` test.
3. Seeking into the middle of a held word or a popped word lands on the right frame (fill `both`, delays from one base). Pinned in Task 4's manual check: jump to the held line mid-word.
4. Rows with romaji but no word timings (plain lyrics followed live) and rows with words but no romaji: nothing breaks, nothing sweeps that shouldn't. Pinned in Task 2's `romajiSpan` tests and Task 4's check on Monsoon Drive (plain).
5. Emoji or combining marks in a held word stay whole. Pinned in Task 2's `graphemes` test.

---

### Task 1: Guess word timings by sound, not characters

**Files:**

- Create: `src/renderer/widgets/music/wordWeights.ts`
- Create: `src/renderer/widgets/music/wordWeights.test.ts`
- Modify: `src/renderer/widgets/music/lyricsGlide.ts` (`estimateWords`: weights only)
- Modify: `src/renderer/widgets/music/lyricsGlide.test.ts` (word-timings block)

**Interfaces:**

- Produces: `soundWeight(piece: string): number`; `syllables(word: string): number`; `beats(piece: string): number`.

- [ ] **Step 1: Write the failing tests** in `wordWeights.test.ts`:

```ts
expect(syllables('through')).toBe(1)
expect(syllables('city')).toBe(2)
expect(syllables('time')).toBe(1) // silent e
expect(syllables('the')).toBe(1) // e is its only vowel
expect(syllables('rhythm')).toBe(1) // y counts
expect(beats('ありがとう')).toBe(5)
expect(beats('永遠に')).toBe(5) // 2 + 2 + 1
expect(beats('ちょっと')).toBe(3) // ち1 ょ.5 っ.5 と1
expect(beats('ラーメン')).toBe(4) // ー counts 1
expect(soundWeight('星空の下で')).toBe(8)
expect(soundWeight('city ')).toBe(2) // trailing space ignored
expect(soundWeight('사랑')).toBe(2)
expect(soundWeight('—')).toBe(1) // nothing to sound: still ≥ 1
expect(soundWeight('rock&roll')).toBe(2) // mixed: punctuation weighs 0
```

- [ ] **Step 2: Run** `npx vitest run src/renderer/widgets/music/wordWeights.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement** the three functions. `soundWeight` walks the piece in runs: CJK/kana runs by `beats`, Latin letter runs by `syllables`, Hangul blocks 1 each, digits 1 each, anything else 0; result `Math.max(1, total)`.
- [ ] **Step 4: Use it** in `estimateWords`: `const weights = tokens.map((token) => soundWeight(token))` shares the time. Today `chars` is the sum of the weights; keep the cap unchanged by computing it as the character count it was (`tokens` summed by `[...token.trim()].length`, at least 1 each) and leaving `perChar`, `longest`, `room` and `length` as they are.
- [ ] **Step 5: Update** `lyricsGlide.test.ts` "shares a line's time…": keep the first three expectations; replace the five-to-one length check with syllables: `length(3) / length(1)` ≈ 1 ("still" and "I" are one syllable each), and add `estimateWords('ありがとう 永遠に', 0, 10)` giving its two pieces equal time (both five beats).
- [ ] **Step 6: Run** `npm test` — PASS. **Commit** "Lyrics: guess word timings by how long they sound".

### Task 2: The pure parts of the light-up

**Files:**

- Create: `src/renderer/widgets/music/sungMotion.ts`
- Create: `src/renderer/widgets/music/sungMotion.test.ts`
- Modify: `src/renderer/widgets/music/lyricsGlide.ts` (`lineWords` returns whether the words are real)
- Modify: `src/renderer/widgets/music/lyricsGlide.test.ts`

**Interfaces:**

- Produces, in `lyricsGlide.ts`: `interface LineWords { words: SyncedWord[]; timed: boolean }`; `lineWords(row: GlideRow, nextStart: number | null): LineWords` (`timed` true only when the row's own words are used).
- Produces, in `sungMotion.ts`:
  - `HELD_SEC = 1.2`, `POP_SEC = 0.9`, `SWELL_SEC = 1.55`
  - `holdStrength(spanSec: number): number`
  - `isHeld(word: SyncedWord, timed: boolean): boolean`
  - `drawnByLetter(word: SyncedWord, timed: boolean): boolean` — held, or a piece with CJK in it and no space inside (can't wrap as one box)
  - `splitSpaces(text: string): { before: string; core: string; after: string }`
  - `graphemes(text: string): string[]` (`Intl.Segmenter`, granularity `grapheme`)
  - `letterTimes(word: SyncedWord, widths: readonly number[]): { start: number; end: number }[]` — the word's span shared by width, in order, touching; even shares when the widths sum to 0
  - `romajiSpan(words: readonly SyncedWord[]): { start: number; end: number } | null` — first start to last end; null for no words
  - `WORD_POP: Keyframe[]` and `letterSwell(strength: number): Keyframe[]` with the Global Constraints' values (offsets: pop peak at 0.28 / 0.9 ≈ 0.311, swell peak at 0.45 / 1.55 ≈ 0.29; ease-out into the peak, ease-in-out out of it)

- [ ] **Step 1: Write the failing tests** in `sungMotion.test.ts`:

```ts
expect(holdStrength(1)).toBe(0)
expect(holdStrength(2)).toBe(0.5)
expect(holdStrength(5)).toBe(1)
expect(isHeld({ text: 'tonight', start: 0, end: 1.2 }, true)).toBe(true)
expect(isHeld({ text: 'tonight', start: 0, end: 3 }, false)).toBe(false) // guessed never holds
expect(drawnByLetter({ text: '終わらないアニメ', start: 0, end: 1 }, false)).toBe(true)
expect(drawnByLetter({ text: 'Hello ', start: 0, end: 1 }, false)).toBe(false)
expect(splitSpaces(' line')).toEqual({ before: ' ', core: 'line', after: '' })
expect(splitSpaces('city ')).toEqual({ before: '', core: 'city', after: ' ' })
expect(graphemes('é👍🏽a')).toEqual(['é', '👍🏽', 'a'])
expect(letterTimes({ text: 'ab', start: 2, end: 5 }, [10, 20])).toEqual([
  { start: 2, end: 3 },
  { start: 3, end: 5 }
])
expect(letterTimes({ text: 'ab', start: 2, end: 4 }, [0, 0])).toEqual([
  { start: 2, end: 3 },
  { start: 3, end: 4 }
])
expect(
  romajiSpan([
    { text: 'a ', start: 1, end: 2 },
    { text: 'b', start: 2, end: 4.5 }
  ])
).toEqual({ start: 1, end: 4.5 })
expect(romajiSpan([])).toBeNull()
// The pop rises to 106% and ends at rest with a faint glow.
expect(WORD_POP[0]?.transform).toContain('scale(0.97)')
expect(WORD_POP.some((frame) => String(frame.transform).includes('scale(1.06)'))).toBe(true)
expect(String(WORD_POP.at(-1)?.filter)).toContain('0.12')
expect(
  String(
    letterSwell(1).find((f) => f.offset !== undefined && f.offset > 0 && f.offset < 1)?.transform
  )
).toContain('scale(1.16)')
```

and in `lyricsGlide.test.ts`: `lineWords(row, 5)` returns `{ words: timed, timed: true }`; the stale row returns `timed: false`; breaks and untimed rows return `{ words: [], timed: false }`.

- [ ] **Step 2: Run** `npx vitest run src/renderer/widgets/music` — FAIL.
- [ ] **Step 3: Implement** `sungMotion.ts` and the `lineWords` change; update `GlidingLyrics`' call site to `lineWords(...).words` for now (Task 4 uses `timed`).
- [ ] **Step 4: Run** `npm test`, typecheck, lint — PASS. **Commit** "Lyrics: the light-up's timings and keyframes, tested".

### Task 3: A demo song that shows it all offline

**Files:**

- Modify: `src/main/services/music/mock/player.ts` (append a fourth `DEMO_TRACKS` entry)
- Modify: `src/main/services/lyrics/provider.ts` (`LyricsProvider.romaji?`)
- Modify: `src/main/services/lyrics/mock/provider.ts` (the song, its romaji, a timed line)
- Modify: `src/main/services/lyrics/service.ts` (`romajiFor` for providers that aren't cached)
- Test: `src/main/services/lyrics/service.test.ts`, `src/main/services/music/mock/player.test.ts` (only if counts change)

**Interfaces:**

- Produces: `LyricsProvider.romaji?(query: LyricsQuery): string[] | null` — built-in romaji, one entry per line ('' for none). `romajiFor` returns it when the provider isn't cacheable and the Romaji setting is on; VocaDB is never asked for such a song.

- [ ] **Step 1: Write the failing test** in `service.test.ts` (in the `romaji` block): a provider `{ cacheable: false, lookup → synced lyrics, romaji: () => ['yoru no eki de'] }` with romaji enabled publishes `romaji: ['yoru no eki de']`, and with romaji disabled publishes `romaji: null`; the romaji store's `read` is never called.
- [ ] **Step 2: Run** it — FAIL.
- [ ] **Step 3: Implement** the optional method and the `romajiFor` branch (before the `cacheable` check).
- [ ] **Step 4: Add the song.** Track `demo:hoshizora-letter`, title `星空レター`, artist `Tempe Night Choir`, album `Desert Radio`, 196 s, no artwork. Its lyrics (written for the demo, about the desert at night): at least six Japanese lines, most with spaces between phrases and one **without spaces, long enough to wrap in "Full" at the narrowest card**; one English line whose `words` are set by hand with its last word held ≥ 2 s (for example "Stay with me tonight", "tonight" 2.8 s); an instrumental break; romaji for every Japanese line, '' for the English one. Add `romaji` to the demo provider, keyed by the same normalized title.
- [ ] **Step 5: Run** `npm test` — PASS (fix any test that counts demo tracks). **Commit** "Demo: a Japanese song with romaji and a held word".

### Task 4: Draw it: pop, soft edge, held letters, romaji follow-along

**Files:**

- Modify: `src/renderer/widgets/music/LyricsPanel.tsx` (`SungWords`, new `SungRomaji`, `GlidingLyrics` call sites)
- Modify: `src/renderer/widgets/NowPlaying.css` (`.glide__word`, new `.glide__letter`, `.lyrics__romaji--sung`)

**Interfaces:**

- Consumes: everything Task 2 produces; `useSongAnimations` and `SongTimed` as they are.
- Produces: `SungWords({ words, timed, clock })`; `SungRomaji({ text, span, clock })`.

- [ ] **Step 1: CSS.** `.glide__word` and `.glide__letter`: `display: inline-block`, `transform-origin: 50% 80%`, the gradient's stops at `calc(50% - 0.3em)` (`--text`) and `calc(50% + 0.3em)` (`--glide-unsung`), `background-size: calc(200% + 0.6em) 100%`, starting at `background-position: 100% 0`; `WORD_SWEEP` keyframes unchanged. `.lyrics__romaji--sung`: `width: fit-content`, the same band with `rgb(255 255 255 / 0.92)` / `rgb(255 255 255 / 0.4)`, clipped to text.
- [ ] **Step 2: `SungWords`.** For each word: `splitSpaces`, spaces rendered as plain text between boxes. If `drawnByLetter`, the core becomes one `.glide__letter` per grapheme inside a plain `<span>`; else one `.glide__word`. Animations (one `useSongAnimations` call, version = `words`):
  - every word box or letter: `WORD_SWEEP` over its own time (letters: `letterTimes` from their `offsetWidth`s, measured inside the items callback);
  - unless reduced motion: a held word's letters get `letterSwell(holdStrength(span))` from each letter's start for `SWELL_SEC`; every other word box gets `WORD_POP` from its start for `POP_SEC`, and a CJK piece drawn by letter gets `WORD_POP` on each letter, all at the piece's start.
- [ ] **Step 3: `SungRomaji`.** On the sung row, instead of `Romaji`, when it has text and `romajiSpan(words)` isn't null: a `.lyrics__romaji.lyrics__romaji--sung` span with `WORD_SWEEP` over that span. Every other case renders `Romaji` exactly as now.
- [ ] **Step 4: Wire `GlidingLyrics`:** pass `lineWords(...)` whole; `SungWords words timed clock`; `SungRomaji` on the sung row.
- [ ] **Step 5: Check it on screen** (throwaway copy per memory `milestone-preview-each-m.md` item 9, demo player, built `out/`): on 星空レター — pops on each word, ありがとう and 永遠に lit in equal time, romaji lighting with its line, "tonight" swelling letter by letter, the soft edge; jump to the held line mid-word and see it land right; the no-space line wraps in "Full" at the narrowest card; Low Sun Hours and Monsoon Drive (plain) unchanged apart from the pop and edge; with `Emulation.setEmulatedMedia` `prefers-reduced-motion: reduce`, only the sweeps. Screenshots kept in the scratchpad.
- [ ] **Step 6: Run** typecheck, lint, test — PASS. **Commit** "Lyrics: words pop as they light, held words swell, romaji follows, a softer edge".

### Task 5: Cost, docs, hand-over

**Files:**

- Modify: `CLAUDE.md` (the synced-lyrics bullet in Design)

- [ ] **Step 1: Measure** the GPU process (`ps -o %cpu` on the throwaway copy's GPU helper, every 2 s for 30 s, lyrics playing on Low Sun Hours) on a build of the commit before Task 1 and on the final one. Target: no more than a few points more. If it's more, drop the glow from the pop first, then measure again.
- [ ] **Step 2: CLAUDE.md:** add to the synced-lyrics bullet what each of the five does, the values that matter (pop 106%, held ≥ 1.2 s, band 0.6 em), that the demo's 星空レター shows it all, the measured cost, and why held words include ones before a pause (the aligner gives no word ends).
- [ ] **Step 3: Run** typecheck, lint, test — PASS. **Commit**, fast-forward `main` (local only), and offer `npm run install:mac`.

## Amendments after the builder check (binding; they win over the tasks above)

The spec's "Builder check" section explains why. Per task:

**Task 1** also produces `japaneseWords(text: string): string[]` in `wordWeights.ts`: the pieces of a
CJK run, from `Intl.Segmenter('ja', { granularity: 'word' })`, joined so that a segment of only
hiragana that is an ending or particle (or follows a piece ending in a kanji), and any segment that
isn't word-like (punctuation), joins the piece before; a kanji or katakana after kana starts a new
piece. Their concatenation is always the input. `estimateWords` splits each whitespace token that
contains CJK into these pieces (the space stays on the last piece) before weighting. Tests:

```ts
expect(japaneseWords('まだ終わらない夢の続きを')).toEqual(['まだ', '終わらない', '夢の', '続きを'])
expect(japaneseWords('星空の下で君を待ってた')).toEqual(['星空の', '下で', '君を', '待ってた'])
expect(japaneseWords('ずっとそばにいるよ')).toEqual(['ずっと', 'そばに', 'いるよ'])
expect(japaneseWords('終わらないアニメ')).toEqual(['終わらない', 'アニメ'])
expect(japaneseWords('夢、まだ。').join('')).toBe('夢、まだ。')
expect(estimateWords('まだ終わらない夢の続きを', 0, 30).map((w) => w.text)).toEqual([
  'まだ',
  '終わらない',
  '夢の',
  '続きを'
])
```

and the existing "sweeps Japanese without spaces evenly" test becomes "shares a Japanese line without
spaces between its words by beats, within the same cap" (the last word still ends at 5 + 8 × 0.3).

**Task 2** changes:

- `WORD_POP` becomes `wordPop(glow: PopGlow | null): Keyframe[]` and `letterSwell(strength, glow)`
  takes it too, with `interface PopGlow { peak: string; rest: string }` (CSS colors). `null`: no
  `filter` in any keyframe.
- `drawnByLetter(word, timed)` is true only for a held word, or a CJK word longer than 8 graphemes
  (so it can still wrap).
- New `popGroups(words: readonly SyncedWord[]): number[]`: the start index of the word each entry pops
  with. Latin words pop alone; consecutive timed CJK pieces pop together when `japaneseWords` of their
  joined text puts them in one word (a piece belongs to the word holding its first character). Test:
  `popGroups([{text:'待',…},{text:'って',…},{text:'た',…},{text:'夢',…},{text:'の',…}])` →
  `[0, 0, 0, 3, 3]`; `popGroups` of three English words → `[0, 1, 2]`.

**Task 4** changes:

- Pops: each group's boxes all get `wordPop(...)` from the group's first word's start; a held word's
  letters get the swell from each letter's own start instead and skip the pop.
- Glow colors come from CSS: `.glide { --pop-glow: color-mix(in srgb, var(--text) 50%, transparent);
--pop-rest: color-mix(in srgb, var(--text) 12%, transparent) }`, and on `:root[data-theme='day']`
  both are `none`. Read them with `getComputedStyle(row)` when building the animations; `none` or
  empty means `null` (no glow).
- Romaji on the sung row: lit `color-mix(in srgb, var(--text) 50%, var(--text-secondary))`, not yet lit
  `color-mix(in srgb, var(--text-secondary) 45%, transparent)`.
- Reduced motion: `useSongAnimations` as it is (all paused); just don't create pops, swells or glows.
- Step 5's check adds: a long Japanese line without spaces pops word by word; Daylight shows no glow;
  `Intl.Segmenter('ja')` returns the same pieces in the Electron renderer as in Node (evaluate it over
  CDP in the throwaway copy).
