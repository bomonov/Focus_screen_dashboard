# Adding missing verses in the Color-Code Lyrics editor: design

Date: 2026-11-05. Builds on the singer colors work (`2026-11-02-lyrics-singer-colors-design.md`, merged into main at fa4136c).

## Why

Sometimes the lyrics the app finds (LRCLIB, VocaDB, YouTube Music's panel) skip a verse. The user codes Project Sekai songs by singer in the Color-Code Lyrics window, and a missing verse leaves a hole on the Focus Screen. They look the verse up online themselves and want to add it, fix its words, and time it in the editor, easily: "add, and edit and sync the missing verse easily", "make it easier to do the timing".

Today a coded line whose text isn't among the shown lyrics is never shown (it is marked "changed" in the editor), so a verse the lyrics don't have can't appear at all.

## What the user decided

- **Add them where the song is playing** (mockup B of three; A pasted between two rows of the list, C edited the whole song as text). While the missing verse plays, the user presses "＋ Add lines at 1:24" in the toolbar, pastes the verse they found online, one line per line, and adds it. The first added line starts where they pressed; the others share out the time up to the next line. They show as "added" in the line list and as striped blocks on the waveform.
- **The app helps time them.** It listens to the verse and times it itself, with the auto-sync add-on's aligner, and easier taps fix what's off (proposed in chat; the user agreed and asked for the timing help).
- **Privacy (approved by the user on 2026-11-05, "yes, that's fine")**: to time a stretch by listening, the app writes just that stretch of the player's audio to a temporary WAV on the Mac for the few seconds the aligner needs, then deletes it. Nothing goes over the network. Until now the editor's recording never touched the disk (only the waveform outline is kept).

## Goals

1. Add one or more lines at the playhead, in the editor, while the editor's song is the one playing.
2. Added lines are the user's own: their words can be retyped, they can be removed, colored, given second voices, romanized, timed, like any coded line.
3. Added lines show on the Focus Screen in their place, colored, lit word by word like any line.
4. "Time by listening": the app times added lines (and, on request, any lines the user picks) from what it heard, word by word.
5. Easier tapping: one tap per line is enough, and a tap lands on the sound it was meant for.

## Non-goals

- Editing the words of the lyrics' own lines (that was mockup C, not picked). Only added lines' words can be changed.
- Sharing, uploading or exporting added verses. Everything stays on this Mac, like the colors ("let just do local for now").
- Fetching the missing words from anywhere. The user finds and pastes them.
- Changing auto-sync. It keeps timing the lyrics' own lines, never the added ones.
- Windows timing by listening (there's no audio tap on Windows). Adding and tapping work everywhere the editor does.

## Anti-goals (would make it a failure even if it works)

- An added verse that vanishes or shows twice when the lyrics change under it (a re-check, "Pick Other Lyrics…").
- Timing by listening that silently moves lines the user already timed by hand.
- Any audio kept on disk after a timing run, or a recording made while the editor is closed.

## How it works

### Added lines in the coding

- A coded line gets an `added?: true` mark (in `types.ts`, parsed as untrusted in `parse.ts` like the rest). An added line has no shown line to match; it is placed by its own times and its place in the coding's line order.
- Text limits, my call: at most 40 lines per add, at most 200 characters a line; blank lines and surrounding spaces in the paste are dropped. Words are split the way the editor splits any line (spaces; Japanese by `japaneseWords`).
- Its times start as a guess: the first line at the press, the rest spread up to the next coded line's start (or 30 s on, if none), words spread by `estimateWords`. They carry `guessed` (the mark the 2026-11-04 fix added), so the line turns `timed` only once its start is set (a tap on its first word, a drag, or timing by listening).
- A new edit kind adds them (for example `addLines { at: seconds, after: line index, texts: string[] }`). Main accepts it only while the editor's song is playing (its position is known), like `begin` and `addLine`. If the song has no coding yet, adding lines begins one first, in one step.
- Where they go, my call (the builder check found that plain lyrics' spread times can be a whole verse off): by the press time among the lines whose times are real (synced lyrics, auto-sync's, or timed by the user). When the lines around the press have no real time (plain lyrics that auto-sync hasn't timed and the user hasn't tapped), they go after the line selected in the list instead, and the button says so ("＋ Add lines after line 12"). Either way, ⌥↑ / ⌥↓ moves a selected added line one place, past the lyrics' own lines too (like the Bus list's order), so a misplaced verse is a few key presses from right; a `moveLine` edit, undoable.
- Retyping an added line (my call: double-click its text in the edit area, or "Edit words…" on it; Enter saves, Esc cancels) keeps its start and end, re-spreads its words, and keeps singers on words whose text didn't change (as `newWords` does).
- Removing an added line: a "Remove line" button in the edit area while an added line is selected; ⌘Z brings it back, so no confirm.

### Added lines on the Focus Screen (`apply.ts`)

- Synced lyrics: an added line is inserted at its start among the shown lines, colored, with its own word times. It is shown even while it is still a guess (my call): the user placed its first line by ear, and nothing else would show it at all. This is the one exception to "made-up times never stand in"; it applies only to lines the user added.
- Plain lyrics: added lines go in among the plain lines in the coding's order. The song turns synced on the user's times only once every line, added ones too, is timed, as today.
- If the shown lyrics come to have the verse (a re-check, or another version picked), it must never show twice. A verse pasted from a site rarely matches the lyrics letter for letter (full-width spaces, punctuation, kana for a kanji), so exact matching isn't enough. My call: after the lyrics' own lines are matched as today, an added line stands in for a shown line that sits between the same matched neighbours and is alike to it (the editor's `likeness` ≥ 0.5 from `shownLines.ts`, as "Use the new words" uses), pairing each at most once. The shown line is then not shown on its own; the added line shows with the user's own words, singers and times, since those are what they typed, checked and colored. The editor marks such a line "also in the lyrics now", and removing it brings the lyrics' own line back.
- If the lyrics change so far that none of the coding matches (`colorLyrics` gives null today), added lines aren't shown either (my call): that's a different version altogether, and its verse may be the added one in other words.
- Romaji: an added Japanese line gets romaji like any shown line (VocaDB's if it pairs, else made on this computer). The editor's romaji handles work on it as on any line.
- Auto-sync never sees added lines: `needsTiming` and the plain text it keys timings by stay the lyrics' own.

### Time by listening

- The editor's audio tap (`singers/tap.ts`) already hears the player while the window is open. While the window is open, the heard audio is kept in memory, by song time, for the song on screen (my call: mono 16 kHz, so a 5-minute song is under 20 MB), and thrown away when the window closes or the editor moves to another song.
- After an add, once the stretch from the first added line to the next line's real start has played through, the app times the added lines by itself. When the next line has no real time (plain lyrics, untimed), the stretch ends 8 s per added line past the press, at most 60 s, or where the user taps the next line's start, whichever is known first (my call: listening on into the next lines' singing would pull the last added line's end along with it). A "Time by listening" button does the same for the lines selected in the list (one or several in a row), for any lines.
- A run writes only that stretch (plus 0.5 s either side) to a temporary WAV, sends it with the lines' text to the aligner (`native/aligner/aligner.py`'s `align` op; Japanese and English through CTC, others through Whisper), and deletes the WAV when the reply comes or the run fails. The language is the song's (Japanese if the lines have kana or kanji, else English, as auto-sync guesses).
- What comes back sets the lines' start, end and word times, and marks them `timed`. Lines the aligner can't place keep their times. It never touches a line outside the selection or the added stretch.
- Lines the user already timed by hand are only re-timed when they are in the selection, i.e. when the user asked for those lines.
- It needs the auto-sync add-on (`npm run setup:aligner`, `userData/aligner`), not auto-sync's Customize switch. Without it, the button says so in plain words ("Needs the auto-sync add-on, which isn't installed on this Mac"), with the setup command only in its tooltip, as Customize does. Without recording access, or on Windows, it isn't offered.
- If the stretch hasn't been heard while the editor was open, the button asks to play it first ("Play this part once so I can hear it").
- The aligner process: whether the editor shares auto-sync's running worker or starts its own is the builder's call, as long as a timing run never waits behind a whole song of auto-sync's, and the worker is stopped once neither needs it.

### Easier tapping

- **Line taps**, my call: a "Tap: Words / Lines" switch by the timing controls. In Lines, J sets the next line's start (its first word, so the line moves whole while it's a guess) and moves on to the line after, so one tap per line times a verse; its words keep their shares. Words is today's behaviour.
- **Taps snap to sound**: a tap lands on the nearest loud onset in the waveform outline within 120 ms either way, if there is one, else where it was pressed (the waveform drag already snaps lightly to onsets; this reuses that).
- **Replay from the line before**: a button (and ⇧Space, my call) that plays from the start of the line before the selected one, so a line can be tapped again with a lead-in.

## Constraints

- All rules in CLAUDE.md hold: TypeScript strict, no `any`, IPC channels in `ipc.ts`, renderer never touches Node or files, untrusted parsing of the saved file, tests for pure logic.
- Privacy section of CLAUDE.md gets the new rule: the editor's heard audio stays in memory while it's open, and only "Time by listening" writes a stretch of it to a temporary WAV, deleted after the run (approved 2026-11-05).
- Readable from 1 m on a 1080p monitor; buttons at least 44 px tall; accent words use `--accent-text`.
- The striped "added" look on the waveform and the "added" tag in the list use a colour of their own that isn't any singer's colour (my call: the Homework purple, `--source-homework`, was used in the mockup; the builder may pick another that reads as "yours").

## Left to the builder

- The keyboard shortcut for "＋ Add lines" (⌘N was shown in the mockup).
- Exact layout of the paste box (a sheet over the line list, as in the mockup, or under the toolbar).
- How the timing run shows progress ("Timing 3 lines…") and failure ("Couldn't time these lines").
- Whether the aligner is shared with auto-sync or the editor's own (within the rule above).
- The demo (星空レター): whether it gets a missing line to add, so the feature shows offline.

## Mockups

- `design/lyrics-singers/add-verse.html` (option B picked).
