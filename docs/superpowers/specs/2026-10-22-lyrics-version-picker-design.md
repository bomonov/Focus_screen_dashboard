# The right lyrics: better automatic matches, and picking another version by hand

Date: 2026-10-22. Status: design, awaiting the user's approval.

## Why

The user mostly looks at Focus Screen to sing along with the lyrics; the timer and to-dos are for their friends. When lyrics are wrong, the one part they use breaks.

Their example is "irony" by Nightcord at 25:00, a cover of scop's アイロニ. It has been completely out of time, and they had nudged its timing −0.5 s, which couldn't help.

What happened: YouTube Music calls it "irony" by "Nightcord at 25:00", and LRCLIB lists it as 「アイロニ」 by 「25時、ナイトコードで。」. The first lookup found nothing. The chain then asked VocaDB for the song's other names (`lookupAs`) and searched LRCLIB for アイロニ.

That search returned both Nightcord's own version (251 s, four copies) and scop's original (すこっぷ feat. Rid, 250 s and 253 s). `evaluate` gave them the same score, for two reasons:

- **Artist:** Nightcord's records match the player's own singer, and scop's records match a name VocaDB added. Both score 0.9.
- **Length:** a gap of 0 s and a gap of 1–2 s earn the same 10 points.

On a tie the first record wins (`better`). In LRCLIB's order, scop's came first. Scop's timings, in another arrangement, were then cached for good.

The user wants both: **fix it automatically, but let me pick if it's wrong.**

Their saved lyrics today, 455 songs:

| What was saved | Songs |
|---|---|
| Synced lyrics from LRCLIB | 298 |
| Plain words, no timing (59 of these have since been auto-synced) | 98 |
| Nothing found | 57 |
| Marked instrumental | 2 |

How many of the 298 are the wrong version can't be counted without listening.

## Goals

1. **Better automatic choice between versions of the same song.**
   - When several LRCLIB records are the song, the one credited to the singers the player names beats one credited only to names VocaDB added (the original's producer or singers).
   - That holds **even when the player's singers' version has only plain words and the other is synced** (the user's call, "untimed right singers": irony shows an original's timing can be completely off for a cover of the same length). Those words show untimed until auto-sync times them, where it's on.
   - When no version credited to the player's singers exists, today's rules stand: a 歌ってみた cover within 2 s still takes the original's timing (`coverStep`).
   - Between equals, the closer length wins, by actual seconds rather than the current 0–2 s / 2–5 s steps.
   - Applies everywhere `evaluate`/`better` and the chain's ordering decide, but matters most in `lookupAs`, where the player's artist and VocaDB's names are joined into one string today.
2. **Old saved lyrics get the better choice without the user doing anything.**
   - Songs whose saved lyrics came from LRCLIB under an older lookup are looked up once more the next time they play.
   - The old lyrics stay on screen until the new answer arrives.
   - If LRCLIB can't be reached, the old ones simply stay.
   - The new answer replaces the old only when it's credited to the player's singers and the old version wasn't. The old version is known by matching its lines against the records found; if it can't be told, the old stays.
   - Songs auto-sync has timed are left alone: their timings come from the user's own recording.
3. **"Pick other lyrics…" by hand (the user chose placement B):**
   - **Where:** an item in the Music card's dot menu and in the right-click quick menu. It is only there when a song is playing, and not for the demo player's built-in songs. Nothing extra shows on the Focus Screen itself.
   - **What opens:** a glass list (like the Next bus list, `BusListCard` on `PeekCard`) of the LRCLIB versions of the song. Each row shows the singers, title, album, length next to the playing song's length, and synced or plain. The best guess is first.
   - **Row tags:** "same singers" (credited to the player's singers), "the original" (credited only to VocaDB's names for the song), and "showing now" (the lyrics currently shown).
   - **Picking a row:** switches the lyrics at once, and the app remembers the pick for that song.
   - **Bottom row, besides the versions:**
     - **Back to automatic:** shown only after a pick; it forgets the pick.
     - **Time them by listening:** the words shown are timed by auto-sync instead, as it does for plain lyrics. Only there when auto-sync is installed and on; otherwise the row says how to turn it on.
     - **Search with other words…:** a text field in the list; LRCLIB is searched for what's typed, and the results are listed the same way.
     - **No lyrics for this song:** the song shows no lyrics from then on, until "Back to automatic".
4. **A pick always wins** over the automatic choice and its re-checks, until the user goes back to automatic.

## Non-goals

These are next, separately, after this piece:

- The 57 songs where nothing is found.
- The 39 with words but no timing.

Out entirely:

- Editing lyrics text or timing line by line.
- Picking among VocaDB's or YouTube Music's words: the list is LRCLIB's versions, plus the words currently shown.
- Uploading anything to LRCLIB. The user declined that before, even opt-in, for auto-synced timings.
- Picks syncing between Macs.

## Anti-goals (would make this a failure even if it works)

- The common case needing the picker. Automatic matching has to be the thing that fixes irony; the picker is for leftovers.
- Re-checking old saves making a right song wrong.
  - Before release, run the new lookup over the user's saved songs (their song keys, with the requests the app itself would make, at a polite pace).
  - List every song whose lyrics would change, with old and new versions.
  - The user spot-checks a sample. Changes from "same singers" to "same singers" with a different length are the ones to look at.
- Anything new on screen while lyrics are right. The picker lives in menus.
- Lyrics vanishing while a re-check is in flight, or because LRCLIB is down.

## Constraints

- **Privacy:** LRCLIB gets only what it gets today (title, artist, album, duration), plus, only when the user types in "Search with other words…", the typed words.
  - VocaDB may be asked for the song's other names when the user opens "Pick other lyrics…", so versions under other titles show up (アイロニ for "irony"). It gets the title only, as its romaji and fallback lookups already send. **Approved by the user on 2026-10-22**; CLAUDE.md's list of allowed requests is to say so.
  - No new hosts. Picks stay on this Mac.
- **Platforms:** works on any platform (lyrics aren't Mac-only). "Time them by listening" is Mac-only like auto-sync and hides elsewhere.
- **Code:** all IPC channels and payloads in `src/main/ipc.ts`; the renderer never talks to the network. Everything read from disk or LRCLIB is untrusted, as today. TypeScript strict, tests for the pure parts: scoring and tie-breaks, the re-check rule, the pick store, parsing.
- **Saved files:** picks are saved per song in `userData`, beside `lyrics-offsets.json`, keyed by `songKey`. A pick of an LRCLIB version records LRCLIB's record id, so it can be fetched again with `/api/get/{id}` if the cache file goes. CLAUDE.md lists the new file with the others.
- **Look:** the list is glass, like the menus and the bus list, readable from about 1 m, rows at least 44 px tall. Japanese titles and singers shown as LRCLIB has them.

## Decided

| Decision | Who decided |
|---|---|
| Both automatic and by hand | User |
| The list's contents and bottom row as shown in the mockup (`.superpowers/brainstorm/…/wrong-lyrics-picker.html`; the user said "everything is spot on") | User |
| "Pick other lyrics…" in the dot menu and right-click menu, nothing on the lyrics themselves (option B) | User |
| A pick wins until "Back to automatic" | User |
| The player's singers' version wins even with plain words only, over another version's timed lines | User, after the builder check |
| VocaDB asked for the song's other names when the list opens | User, after the builder check |
| "Back to automatic" itself | My call, which the user accepted in the playback |

### My calls (not discussed with the user)

- **Offsets:** a song's saved timing nudge (`lyrics-offsets.json`) is cleared when its lyrics change version, automatically or by a pick. A nudge belongs to the version it was set for; irony's −0.5 s means nothing for Nightcord's timings.
- **Re-check scope:** the re-check is one revision bump of the lookup (`LOOKUP_REVISION` 3 → 4). It re-asks LRCLIB-sourced saves from older revisions once each, as each song next plays; never a sweep of all 455 at once. Misses and VocaDB words already re-ask on a bump, as today.
- **"The original" tag:** it means credited only to VocaDB's names and not the player's singers. It doesn't claim to know which recording came first.
- **When LRCLIB can't be reached:** if the list can't be filled, it says so in one line and still offers the bottom row.
- **Re-checks are conservative** (Goal 2): they only swap a version not by the player's singers for one that is, and skip auto-synced songs, so a song that's right today can't turn wrong. That's also why the pre-release run over the saved songs (Anti-goals) can be a rough report built from their song keys, which lack the album and full credits, rather than an exact replay.
- **A pick shows the record as LRCLIB has it:** its own timings, even when it's more than 3 s off or a live or sped-up version. The row shows its length beside the song's, so the user chooses knowingly, and the timing nudge is there for small offsets.
- **Versions in another language are left out of the list**: they're never the song's words.

## Left to the builder

- How the scoring change is weighted, as long as the tests pin the outcomes:
  - the player's singers beat VocaDB-only names;
  - a closer length beats a further one;
  - nothing that matches today stops matching.
- How the list gets its versions: re-running the searches the lookup already made (LRCLIB's 10-minute answer memory helps), or keeping the candidates from the last lookup.
- How the list opens and closes: grown from the dot like the menus, or from the Music card like the bus list. Its exact layout, within the mockup's content.
- How the switch to new lyrics looks on screen (the glide restarting at the current line is fine).
- How the re-check keeps old lyrics shown while it runs.
- The order of the work, and the plan's tasks.
