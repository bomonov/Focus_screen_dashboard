# Lyrics version picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lyrics pick the version by the singers you're playing (irony shows Nightcord's, not scop's), old saves are re-checked safely, and "Pick other lyrics…" lets the user choose any LRCLIB version by hand.

**Architecture:**

- **Matching:** `match.ts` learns who a record is credited to: the player's singers, or only names VocaDB added. `better()` ranks the singers above timing.
- **Lookup results:** they carry the versions they accepted. The cache keeps old LRCLIB saves showing while a pure re-check rule decides whether to swap them.
- **Picks:** a small store, `lyrics-picks.json`, overrides the automatic choice per song.
- **Picker:** a main-side state machine (like the cover editor's) feeds a glass list on the Focus Screen, opened from the Music menus.

**Tech Stack:** Electron + TypeScript strict, React renderer, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-22-lyrics-version-picker-design.md`

## Global Constraints

- **Network:** LRCLIB gets only title, artist, album and duration, plus the user's typed words in "Search with other words…".
- **VocaDB:** may be asked for the song's other names (title only) when "Pick other lyrics…" opens; approved by the user 2026-10-22. No other new requests, and no new hosts.
- **Code rules:**
  - All IPC channels and payload types live in `src/main/ipc.ts`.
  - The renderer never touches the network.
  - Everything read from disk, LRCLIB, VocaDB or the page is untrusted, and parsed.
  - TypeScript strict, no `any`. Named exports, small files. Comments say why.
- **Every task ends with:** `npm run typecheck`, `npm run lint` and `npm test` all pass, then a commit with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run `graphify update .` after code changes.
- **Picks:** saved per song, keyed by `songKey`, in `userData/lyrics-picks.json`. A version pick records LRCLIB's record id.
- **Offsets:** a song's offset (`lyrics-offsets.json`) is cleared when its lyrics change version, whether automatically or by a pick.
- **Look:** the picker is glass (`PeekCard`), rows at least 44 px (`var(--hit)`), readable from 1 m. Japanese shown as LRCLIB has it.
- **Copy:**
  - Menu item: "Pick Other Lyrics…" (title case, like the menu's other items).
  - Tags: "same singers", "the original", "showing now".
  - Bottom row: "Back to automatic", "Time them by listening", "Search with other words…", "No lyrics for this song".

## Review Focus

1. **The song changes while the picker is open.** The list closes (or follows the new song). A pick never lands on the next song. Test in Task 7.
2. **A picked LRCLIB record later deleted.** `/api/get/{id}` answers 404, or LRCLIB is down. The picked lyrics already saved keep showing; the song never falls back to nothing or to automatic. Test in Task 6.
3. **Lyrics are hidden, an ad is playing, or the demo player is on.** "Pick Other Lyrics…" is disabled, and `open` does nothing. Test in Task 7.
4. **Search text that is all spaces, over 200 characters, or Japanese.** It's trimmed and capped at 200; empty text is refused; Japanese searches work. Test in Task 7 (parse) and Task 5 (search).
5. **Re-checking a save that isn't from LRCLIB** (VocaDB's words, YouTube Music's, a miss). These keep today's rules; only LRCLIB-sourced finds are re-checked in place. Test in Task 3.

---

### Task 1: Credit and closer length in matching

**Files:**

- Modify: `src/main/services/lyrics/match.ts`, `src/main/services/lyrics/query.ts` (`LyricsQuery`), `src/main/services/lyrics/lrclib.ts` (`parseLrclibRecord`, `lookupAs`), `src/main/services/lyrics/chain.ts`
- Test: `src/main/services/lyrics/match.test.ts`, `src/main/services/lyrics/lrclib.test.ts`, `src/main/services/lyrics/chain.test.ts`

**Interfaces:**

- Produces:
  - `LyricsQuery.otherArtists?: readonly string[]`: VocaDB's names for the singers, judged apart from the player's own.
  - `LyricsRecord.id: number`: LRCLIB's record id, 0 when missing.
  - `type Credit = 'singers' | 'others'`, exported from `match.ts`.
  - `Candidate` gains `credit: Credit` and `record: LyricsRecord`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests** in `match.test.ts`. Fixtures are LRCLIB records copied from the real search (ids and durations from 2026-10-22):
  - `20951492` すこっぷ feat. Rid, 253, synced, first line `[00:05.44] 少し歩き疲れたんだ 少し歩き疲れたんだ`
  - `10604292` 25時、ナイトコードで。 feat. 宵崎奏&…, 251, synced, first line `[00:00.55] 少し歩き疲れたんだ`
  - `4155154` すこっぷ feat. Rid, 250, synced

  Each record has two or three lines.

```ts
const irony = {
  ...query('irony', 'Nightcord at 25:00', 251),
  coreTitle: 'アイロニ',
  otherArtists: ['すこっぷ', 'Rid']
}
it("prefers the singers' own version over the original's, in the search's order", () => {
  const best = pickBest(irony, [scop253, nightcord251, scop250], 'lrclib')
  expect(best?.record.id).toBe(10604292)
  expect(best?.credit).toBe('singers')
})
it("takes the singers' plain words over another version's timed lines", () => {
  const best = pickBest(
    irony,
    [scop250, { ...nightcord251, syncedLyrics: null, plainLyrics: '少し歩き疲れたんだ' }],
    'lrclib'
  )
  expect(best?.lyrics.kind).toBe('plain')
  expect(best?.credit).toBe('singers')
})
it('between equals, the closer length wins', () => {
  // Same singer, both synced: 1 s off beats 2 s off (both scored 10 before).
  const best = pickBest(
    query('Song', 'Singer', 200),
    [rec({ id: 1, durationSec: 202 }), rec({ id: 2, durationSec: 201 })],
    'lrclib'
  )
  expect(best?.record.id).toBe(2)
})
it('still takes a name VocaDB knows when no version by the singers exists', () => {
  expect(pickBest(irony, [scop250], 'lrclib')?.credit).toBe('others')
})
it('any words still beat an instrumental entry, even one credited to the singers', () => {
  const best = pickBest(irony, [{ ...nightcord251, instrumental: true }, scop250], 'lrclib')
  expect(best?.record.id).toBe(4155154)
})
```

In `lrclib.test.ts`, add `it('reads a record\'s id')`: `parseLrclibRecord({ id: 38885746, trackName: 'Irony', … })?.id === 38885746`, and 0 for a missing or non-integer id. Also add an end-to-end `lookupAs` test with the fake fetch that returns the three records for `q=アイロニ`: expect `found` with a first line at 0.55 s.

- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/match.test.ts src/main/services/lyrics/lrclib.test.ts`
      Expected: FAIL. `otherArtists`, `credit` and `id` don't exist, and the irony test picks 20951492.

- [ ] **Step 3: Implement the matching change.**

  In `evaluate`:
  - Compute `own = artistScore(query, record.artistName)` with the player's artist only.
  - Compute `others` against `query.otherArtists` joined with `', '`, scored the same way.
  - Accept the record when `own ≥ MIN_ARTIST` or `others ≥ MIN_ARTIST`. The no-artist path is unchanged, and applies when both the artist and `otherArtists` are empty.
  - `credit` is `'singers'` when `own ≥ MIN_ARTIST`, else `'others'`. The no-artist path gives `'others'`.
  - The score's artist term is `own` for singers, `0.7 × others` for others.
  - Replace `durationPoints` with `gap === null ? 0 : Math.max(0, 10 - 2 * gap)`.
  - Set `candidate.record = record`.

  `better(a, b)` compares in this order:
  1. Words against instrumental: the one with words wins.
  2. `credit`: singers wins.
  3. `KIND_RANK`: synced over plain.
  4. Score.

  Elsewhere:
  - `parseLrclibRecord` reads `id` as a positive integer, else 0.
  - `lookupAs`'s `judgeBy` becomes `{ ...query, coreTitle: title, artist: query.artist, otherArtists: names.artists }`, replacing the joined string.
  - `settled(best)` also counts a singers' plain answer as settled, so later steps don't trade it for an `others` synced one.
  - In `chain.ts`, `lookup` returns `renamed` when it's synced _or_ credited to the singers, before VocaDB's words.

- [ ] **Step 4: Run** `npx vitest run src/main/services/lyrics/`
      Expected: PASS, the new tests and every existing one (`coverStep`, title-only, credits, language versions).

- [ ] **Step 5: Commit**: "Lyrics: the singers' own version beats a name VocaDB added, and the closer length wins".

### Task 2: Lyrics remember their version; lookups say which versions they accepted

**Files:**

- Modify: `src/main/services/lyrics/types.ts`, `src/main/services/lyrics/parse.ts`, `src/main/services/lyrics/match.ts` (`recordLyrics`), `src/main/services/lyrics/provider.ts`, `src/main/services/lyrics/lrclib.ts` (`run`), `src/main/services/lyrics/chain.ts`, `src/main/services/lyrics/cache.ts`
- Create: `src/main/services/lyrics/versions.ts`
- Test: `src/main/services/lyrics/store.test.ts` (the cache's tests), `lrclib.test.ts`, `chain.test.ts`

**Interfaces:**

- Consumes: `Credit`, `Candidate.record` (Task 1).
- Produces:
  - In `types.ts`: `interface LyricsFrom { id: number; artist: string; durationSec: number; credit: 'singers' | 'others' }`, and each `Lyrics` variant gains optional `from?: LyricsFrom`. The type stays import-free, since the renderer compiles it.
  - In `versions.ts`: `interface LyricsVersion { id: number; title: string; artist: string; album: string; durationSec: number; credit: Credit | null; lyrics: Lyrics }`. `credit` is null when credited to neither the singers nor VocaDB's names (listed only in the picker).
  - In `versions.ts`: `sameLyrics(a: Lyrics, b: Lyrics): boolean`, true for the same kind and the same line texts, with times within 0.05 s.
  - `LookupResult` `found` gains `seen?: LyricsVersion[]`: every record the lookup accepted as the song.
  - `cache.ts`: `LOOKUP_REVISION = 4`, and `needsRecheck(key: string): boolean`.

- [ ] **Step 1: Write the failing tests.**

  `lrclib.test.ts`:
  - The irony `lookupAs` answer has `lyrics.from` equal to `{ id: 10604292, artist: '25時、ナイトコードで。 feat. …', durationSec: 251, credit: 'singers' }`.
  - Its `seen` holds all three records' versions, with scop's two `credit: 'others'`.

  `store.test.ts`:
  - `it('keeps showing LRCLIB finds from older lookups, and says they want a re-check')`: a file saved with `lookup: 3` and LRCLIB synced lyrics. `read(key)` returns it, `needsRecheck(key)` is true, and after `write(key, same)` it's false.
  - `it('still re-asks misses and VocaDB words from older lookups at once')`: unchanged behaviour, `read` gives null.
  - `it('reads back where lyrics came from, and drops an off-shape one')`: `from` survives a write and read; `from: { id: -1 }` reads as lyrics without `from`.

  `versions.test.ts` (new):
  - `sameLyrics` is true for scop's lines against scop's.
  - It's false against Nightcord's.
  - It's true with times 0.02 s apart.

- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/` — Expected: FAIL (no `from`, `seen`, `needsRecheck`, or `versions.ts`).

- [ ] **Step 3: Implement.**
  - `recordLyrics` attaches `from` for LRCLIB records.
  - `run()` keeps every accepted candidate as a `LyricsVersion`, and returns them as `seen` with the best.
  - `chain.ts` passes `seen` through.
  - `parseLyrics` reads `from` as untrusted: positive integer id, strings capped at 500, finite non-negative duration, credit one of the two. Anything off-shape drops `from` only.
  - `cache.ts`: an LRCLIB `found` with `revision < 4` (and not 2, which still expires) is no longer expired. `needsRecheck` is true for it.

- [ ] **Step 4: Run** `npx vitest run src/main/services/lyrics/` — Expected: PASS.

- [ ] **Step 5: Commit**: "Lyrics: remember which version they are; old LRCLIB saves stay up for a re-check".

### Task 3: The re-check rule (pure)

**Files:**

- Create: `src/main/services/lyrics/recheck.ts`
- Test: `src/main/services/lyrics/recheck.test.ts`

**Interfaces:**

- Consumes: `LyricsVersion`, `sameLyrics` (Task 2).
- Produces: `keepOrReplace(old: Lyrics, fresh: { lyrics: Lyrics; seen?: LyricsVersion[] }, timedByListening: boolean): 'keep' | 'replace'`

- [ ] **Step 1: Write the failing tests** (`recheck.test.ts`):
  - `it("swaps irony's saved original for the singers' own")`: old is scop's lines with no `from`; `seen` has scop (`others`) and Nightcord (`singers`); fresh is Nightcord's. Expect `'replace'`.
  - `it("keeps lyrics that were already the singers'")`: old has `from.credit === 'singers'`. Expect `'keep'`.
  - `it("keeps what it can't place")`: old's lines match nothing in `seen`. Expect `'keep'`.
  - `it('never replaces with another name\'s version')`: fresh is credited to `others`. Expect `'keep'`.
  - `it('leaves songs auto-sync has timed alone')`: `timedByListening` true. Expect `'keep'`.
  - `it('only re-checks LRCLIB finds')` (Review Focus 5): old source `vocadb` or `ytmusic`. Expect `'keep'`.
  - `it('keeps the same lyrics')`: fresh `sameLyrics` as old. Expect `'keep'`.

- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/recheck.test.ts` — Expected: FAIL (no module).

- [ ] **Step 3: Implement `keepOrReplace`.** The old version's credit is `old.from?.credit`, else the credit of the `seen` version that `sameLyrics(old, version.lyrics)`, else unknown. The result is `'replace'` only when all of these hold:
  - `!timedByListening`;
  - old is from LRCLIB;
  - the old credit is `'others'`;
  - `fresh.lyrics.from?.credit === 'singers'`;
  - `!sameLyrics(old, fresh.lyrics)`.

- [ ] **Step 4: Run it** — Expected: PASS.

- [ ] **Step 5: Commit**: "Lyrics: a re-check swaps only another name's version for the singers' own".

### Task 4: The service re-checks old saves in place, and clears a changed song's timing

**Files:**

- Modify: `src/main/services/lyrics/service.ts`
- Test: `src/main/services/lyrics/service.test.ts`

**Interfaces:**

- Consumes: `cache.needsRecheck` (Task 2) and `keepOrReplace` (Task 3).
- Produces: nothing new outside the service.

- [ ] **Step 1: Write the failing tests** (`service.test.ts`, fake provider and cache):
  - `it("shows an old save at once and swaps it for the singers' version when the re-check finds one")`:
    - Publishes the cached lyrics first.
    - After `settleMs`, publishes the fresh ones, and the cache holds them.
    - `offsets.get(key)` is 0 after it had been −0.5.
  - `it('keeps an old save when the re-check finds no better, and stops asking')`: the cache is rewritten with the old result, so `needsRecheck` turns false, and the provider was asked once.
  - `it('keeps an old save while LRCLIB is down, and asks again next time')`: provider gives `unavailable`. The lyrics stay; `needsRecheck` stays true.
  - `it('never re-checks a song auto-sync has timed')`: `autoSynced.read` returns lines, and the provider is never called.

- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/service.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement it in `follow()`'s cached path.**
  - After publishing the cached lyrics, if `cache.needsRecheck(key)` and no pick exists (Task 6 adds picks; for now there are none), schedule a background lookup after `settleMs`.
  - On `found`, `keepOrReplace(cached.lyrics, result, withAutoSync changed it)` decides:
    - `'replace'`: `cache.write(key, result)`, `offsets.set(key, 0)`, and publish if the song is still on (generation check).
    - `'keep'`: `cache.write(key, cached)`.
  - `notFound` keeps the old and writes it back.
  - `unavailable` leaves everything.

- [ ] **Step 4: Run** `npx vitest run src/main/services/lyrics/` — Expected: PASS.

- [ ] **Step 5: Commit**: "Lyrics: old saves are checked again in place, and a song's timing resets when its version changes".

### Task 5: Listing a song's versions (LRCLIB + VocaDB's names), searching, and fetching by id

**Files:**

- Modify: `src/main/services/lyrics/lrclib.ts`, `src/main/services/lyrics/chain.ts`
- Test: `lrclib.test.ts`, `chain.test.ts`

**Interfaces:**

- Consumes: `LyricsVersion` (Task 2), `evaluate` with `otherArtists` (Task 1).
- Produces:
  - `type VersionsResult = { kind: 'found'; versions: LyricsVersion[] } | { kind: 'unavailable' }`
  - `LrclibProvider.versions(query: LyricsQuery, names: SongNames | null): Promise<VersionsResult>`
  - `LrclibProvider.search(query: LyricsQuery, text: string): Promise<VersionsResult>`
  - `LrclibProvider.byId(id: number): Promise<{ kind: 'found'; version: LyricsVersion } | { kind: 'notFound' } | { kind: 'unavailable' }>`
  - `SongLyrics.versions(query): Promise<VersionsResult>`: the chain asks `vocadb.match` for names (allowed now), then `lrclib.versions`. Export the chain's return type as `SongLyrics = LyricsProvider & { versions; search; byId }`.

- [ ] **Step 1: Write the failing tests.**

  `lrclib.test.ts`:
  - `it("lists irony's versions, the singers' first, then the original, then other singers, closer length first")`: fake answers for `q=irony` and `q=アイロニ` with Nightcord (251), scop (250, 253), majiko (246) and Kano (252). Expect:
    - the ids in order `[10604292, 4155154, 20951492, 11173622, 10022160]`;
    - credits `['singers', 'others', 'others', null, null]`.
  - `it('leaves out versions in another language')`: an "Irony (English Ver.)" record is absent.
  - `it('searches the typed words alone')`: `search(q, 'アイロニ nightcord')` requests `q=アイロニ nightcord` and lists by the same order.
  - `it('fetches a picked version by its id')`: `byId(10604292)` GETs `/api/get/10604292`; 404 gives `notFound`, and 503 three times gives `unavailable`.

  `chain.test.ts`:
  - `it('asks VocaDB for the names when listing versions')`: `vocadb.match` called once, names passed through.
  - `it('lists without the names when VocaDB is down')`.

- [ ] **Step 2: Run** the two files — Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`versions` searches:** by fields (own `coreTitle` and `primaryArtist`), `q` = own bare title, then `q` = up to `MAX_OTHER_TITLES` of the names' titles. All go through `request()`, sharing the retry budget and the 10-minute answer memory.
  - **What it keeps:** every record whose title scores at least `MIN_TITLE` against the own title or any name, isn't in another language, and has lyrics.
  - **`credit`:** the record's credit when `evaluate` accepts it, else null.
  - **A listed version's `lyrics`:** the record as LRCLIB has it. It's synced whenever it has synced lines, whatever its length or version flags (the design: a pick shows its own timings, chosen knowingly), so call `recordLyrics(record, true, 'lrclib')`. Add a test: majiko's 246 s record lists as `synced`.
  - **Order:** the record `better()` would pick first, then by credit (`singers`, then `others`, then null), then by length gap. Deduplicate by `id`.
  - **`search`:** one request, `q` = text, the same filter minus the title test.
  - **`byId`:** one request, GET `/api/get/{id}`.

- [ ] **Step 4: Run** `npx vitest run src/main/services/lyrics/` — Expected: PASS.

- [ ] **Step 5: Commit**: "Lyrics: list a song's versions on LRCLIB (with VocaDB's names), search, fetch by id".

### Task 6: Picks — saved, and obeyed by the lyrics service

**Files:**

- Create: `src/main/services/lyrics/picks.ts`, `src/main/services/lyrics/picks.test.ts`
- Modify: `src/main/services/lyrics/service.ts`, `src/main/index.ts` (open the store beside `lyrics-offsets.json`)
- Test: `service.test.ts`

**Interfaces:**

- Consumes: `cache`, `offsets`, and `byId` (Task 5).
- Produces:
  - `type LyricsPick = { kind: 'version'; id: number } | { kind: 'listen' } | { kind: 'none' }`
  - `interface PickStore { get(key: string): LyricsPick | null; set(key: string, pick: LyricsPick | null): void }`
  - `openPickStore(filePath: string): PickStore` and `parsePicks(raw: unknown): Map<string, LyricsPick>`
  - `LyricsService.pick(pick: LyricsPick | null, version?: LyricsVersion): void`: for the song on screen. `null` is back to automatic.
  - `LyricsService.currentSong(): { key: string; trackId: string; query: LyricsQuery; cacheable: boolean } | null`

- [ ] **Step 1: Write the failing tests.**

  `picks.test.ts`:
  - Picks round-trip through the file.
  - `parsePicks` drops bad ids (0, −1, 1.5), unknown kinds, keys over 500 chars, and more than 5000 entries.

  `service.test.ts`:
  - `it('shows a picked version, keeps it over re-checks and automatic answers, and clears the timing')`: `pick({ kind: 'version', id }, version)`:
    - publishes its lyrics;
    - writes them to the cache;
    - sets the offset to 0;
    - stores the pick.
    - A later `needsRecheck` never triggers a lookup.
  - `it('back to automatic forgets the pick and looks the song up again')`.
  - `it('shows no lyrics for a song picked as having none')`: status `notFound`.
  - `it('turns the shown lyrics into words for auto-sync to time, when picked to time by listening')`: synced LRCLIB lyrics publish as `plain` with source `lrclib`, so `needsTiming` takes them.
  - `it("refetches a picked version whose save is gone, and keeps what it has when LRCLIB can't say")` (Review Focus 2):
    - the cache is missing, so `byId` is called and its lyrics shown;
    - `byId` gives `notFound` or `unavailable` with an older save present, so the save is shown;
    - with neither, status is `notFound` while it waits, and there's no fall-back to automatic.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `picks.ts` follows `offsets.ts`'s pattern (atomic JSON via `jsonFile`).
  - In `follow()`, a pick is consulted before the cache rules:
    - **`version`:** use the cached lyrics when `from.id` equals the pick's id, else `byId`.
    - **`none`:** `notFound`.
    - **`listen`:** cached or automatic lyrics as plain words.
  - The service takes the store and `byId` as new options.

- [ ] **Step 4: Run** `npx vitest run src/main/services/lyrics/` — Expected: PASS.

- [ ] **Step 5: Commit**: "Lyrics: picks per song (a version, time by listening, none) win over automatic".

### Task 7: The picker's state, IPC and menu item

**Files:**

- Create: `src/main/services/lyrics/picker.ts`, `src/main/services/lyrics/picker.test.ts`
- Modify: `src/main/ipc.ts`, `src/main/ipcRoutes.ts` (if routes are listed there), `src/preload/index.ts`, `src/main/menu.ts` (`musicItems`, `MenuContext.lyrics`), `src/main/index.ts`

**Interfaces:**

- Consumes:
  - `SongLyrics.versions`, `search` and `byId` (Task 5);
  - `LyricsService.pick` and `currentSong` (Task 6);
  - auto-sync's availability: installed, switched on, and on a Mac (`index.ts` already knows it for Customize).
- Produces:
  - **State:**
    ```ts
    interface PickerRow {
      id: number
      title: string
      artist: string
      album: string
      durationSec: number
      kind: 'synced' | 'plain' | 'instrumental'
      tags: ('same singers' | 'the original' | 'showing now')[]
    }
    interface LyricsPickerState {
      open: boolean
      busy: 'loading' | 'searching' | null
      song: { title: string; artist: string; durationSec: number } | null
      rows: PickerRow[]
      picked: 'automatic' | 'version' | 'listen' | 'none'
      listen: 'ready' | 'off' | 'unsupported'
      message: string | null
    }
    ```
  - **Command:** `type LyricsPickerCommand = { kind: 'open' } | { kind: 'close' } | { kind: 'pick'; id: number } | { kind: 'listen' } | { kind: 'none' } | { kind: 'automatic' } | { kind: 'search'; text: string }`
  - **Parse and factory:** `parseLyricsPickerCommand(raw: unknown): LyricsPickerCommand | null` and `createLyricsPicker(deps): { get(); subscribe(); command(c): Promise<void>; canOpen(): boolean; dispose() }`
  - **IPC channels:** `lyricsPickerGet`, `lyricsPickerChanged` and `lyricsPickerCommand`.
  - **Bridge:** `getLyricsPicker`, `onLyricsPickerChanged` and `sendLyricsPickerCommand`.
  - **Menu:** `MenuContext.lyrics.pickOther()` and `canPickOther: boolean`.

- [ ] **Step 1: Write the failing tests** (`picker.test.ts`):
  - **`open`** lists irony's rows with tags:
    - Nightcord: `['same singers']`.
    - scop: `['the original', 'showing now']` while scop's lyrics show.
    - Rows are built from `versions`.
  - **`pick`** calls `lyrics.pick({ kind: 'version', id }, version)` and closes.
  - **`automatic`**, **`none`** and **`listen`** call `lyrics.pick` with null, `{ kind: 'none' }` and `{ kind: 'listen' }`.
  - **LRCLIB down:** `unavailable` sets `message` to "Can't reach LRCLIB right now" and keeps the bottom row.
  - **Song changes while open (Review Focus 1):** `pick` after the song changed does nothing, and the picker closes.
  - **Can't open (Review Focus 3):** `canOpen()` is false with no song, an ad, hidden lyrics, or a non-cacheable (demo) provider; `open` is then a no-op.
  - **Parsing (Review Focus 4):** `parseLyricsPickerCommand`:
    - trims and caps `search` text at 200;
    - refuses empty text, and ids that aren't positive integers;
    - keeps Japanese text.
  - **`listen` availability:** `'off'` when auto-sync is installed but switched off, `'unsupported'` off the Mac.

- [ ] **Step 2: Run** `npx vitest run src/main/services/lyrics/picker.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** The picker follows `cover-motion/service.ts`'s editor pattern: state, listeners and a busy guard.
  - Add "Pick Other Lyrics…" to `musicItems` after "Reset Lyrics Timing", enabled by `canPickOther`. It feeds the app menu, the quick menu and the Music card's dot menu.
  - `index.ts` wires the picker, the IPC routes (renderer messages parsed with `parseLyricsPickerCommand`), and the menu context. It also rebuilds the menus when `canOpen()` changes.

- [ ] **Step 4: Run** `npm run typecheck && npx vitest run src/main/` — Expected: PASS.

- [ ] **Step 5: Commit**: "Lyrics: the version picker's state, IPC and the Pick Other Lyrics… menu item".

### Task 8: The glass list on the Focus Screen

**Files:**

- Create: `src/renderer/widgets/music/LyricsPicker.tsx`, `src/renderer/widgets/music/LyricsPicker.css`, `src/renderer/hooks/useLyricsPicker.ts`
- Modify: `src/renderer/widgets/NowPlaying.tsx` (mount it), `src/main/services/lyrics/pickerRows.ts` if row formatting needs a pure helper (time `4:11`, the length line)
- Test: `src/main/services/lyrics/pickerRows.test.ts` for any pure helper (no pixel tests)

**Interfaces:**

- Consumes: the bridge from Task 7, `PeekCard` (`widgets/peek/PeekCard.tsx`: `from: Box`, `keyboard`, `returnFocus`, `onClosed`, `className`, `label`).
- Produces: `<LyricsPicker />`, mounted once on the Focus Screen.

- [ ] **Step 1: Write the failing test** for any pure helper.
  - `formatLength(251) === '4:11'`.
  - `lengthNote(251, 251) === 'your song is 4:11'`.

- [ ] **Step 2: Run it** — Expected: FAIL.

- [ ] **Step 3: Implement the list**, matching the mockup (`.superpowers/brainstorm/76365-1792717944/content/wrong-lyrics-picker.html`).
  - **Opening:** it opens when `state.open` becomes true, growing from the Music card's status dot (its `getBoundingClientRect()` as `from`).
  - **Header:** "Lyrics for {title} · your song is {m:ss}".
  - **Rows:** each row is a button showing singers (bold), the tags, "title · album · synced", and the length on the right. The best guess sits first and is lit with the accent ring. Rows are at least `var(--hit)` tall, and the list scrolls when it's long.
  - **Bottom row** (pill buttons):
    - "Back to automatic", only when `picked !== 'automatic'`.
    - "Time them by listening". When `listen === 'off'` it's disabled with the hint "Turn on Auto-sync plain lyrics in Customize › Music". It's hidden when `'unsupported'`.
    - "Search with other words…", which reveals a text field (Enter searches, Esc clears it).
    - "No lyrics for this song".
  - **Feedback:** `busy` shows "Looking…", and `message` shows as one line.
  - **Closing:** Esc or a press outside closes it (`command({ kind: 'close' })`).
  - **Craft floor:** themed focus rings, no Unicode glyph icons (the check mark is an SVG), and contrast at least 4.5:1 on the glass (use `--text`, `--text-secondary`).

- [ ] **Step 4: Verify in a throwaway copy.** Use the scratch harness from the moving-parts session: `out-test` with the music adapter patched to report "irony" by "Nightcord at 25:00", 251 s.
  - Open the Music dot menu, then "Pick Other Lyrics…".
  - Screenshot the list.
  - Click Nightcord's row, then check that the lyrics switch and the first line is at 0.55 s.
  - Check "Back to automatic" and "No lyrics for this song".
  - Expected: the screenshots match the mockup's content.

- [ ] **Step 5: Commit**: "Lyrics: the version picker on the Focus Screen".

### Task 9: Docs, and the report over the user's saved songs

**Files:**

- Modify: `CLAUDE.md`. Changes:
  - The privacy list: VocaDB asked for the song's other names when "Pick other lyrics…" opens, approved 2026-10-22.
  - The settings-files sentence: `lyrics-picks.json`.
  - Layout's lyrics line: picks, versions, re-check.
  - Design: a picker bullet.
- Create (scratch, not committed): a report script in the session scratchpad.

- [ ] **Step 1: Update CLAUDE.md**, following its existing voice.

- [ ] **Step 2: Run the report.**
  - **Input:** for every file in `~/Library/Application Support/Focus Screen/lyrics/` with an LRCLIB `found` from an older lookup, rebuild a query from its key (`artist|title|seconds`).
  - **Requests:** run the new chain against the real LRCLIB and VocaDB at no more than 1 request a second, with the app's User-Agent.
  - **Output:** list each song where `keepOrReplace` says `'replace'`, with the old and new versions' artist and length.
  - Expected: irony (`nightcord at 25 00|irony|251`) is listed, scop → Nightcord. The list is handed to the user to spot-check; nothing on their Mac is changed by it.

- [ ] **Step 3: Run the full checks.** `npm run typecheck && npm run lint && npm test`, then `graphify update .`
      Expected: all pass.

- [ ] **Step 4: Commit**: "CLAUDE.md: lyrics versions, picks and the picker".
