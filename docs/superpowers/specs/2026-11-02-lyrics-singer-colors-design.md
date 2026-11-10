# Singer colors in the lyrics: design

Date: 2026-11-02. Status: draft for the user's review.

## Intent

The user is a Project Sekai fan and wants this "for myself and project sekai fan". They want lyrics color-coded by who is singing, like the fan color-coded lyrics videos they pointed to: reiya's "NEO ― Unit/Sekai Leaders × Hatsune Miku | COLOR CODED Lyrics" (youtu.be/fCzW24lNwiQ). That style has:
- a row of the singers, each in their own color;
- every lyric part in its singer's color, in kanji, romaji and English.

The user's own words:
- They want to make the coding themselves "in a whole different tab, not customize tab".
- Characters get a "colorful palette chibi logo".
- Lyrics are color-coded as they run.
- "if there are more than 1 person singing, make a gradient lyrics sync runner based on their color".

Songs mix three cases:
- whole lines swap between singers;
- a singer joins or takes over partway through a line ("between the line they add a singer");
- everyone sings at once.

Making the coding means:
- **Afterwards, not live:** "selecting words and picking a character", like Aegisub (aegisub.org).
- **Timing too:** "both, I want to fix timing too".

Sharing coded songs with other fans is for later: "let just do local for now. that function is something in the future for ppl like pjsk sekai like I do".

## What the user picked

- **On the Focus Screen: mockup A** (`design/lyrics-singers/focus-screen-colors.html`; "A is great").
  - Every line is in its singer's color: faint until it's sung, full color as the word-by-word light runs through it.
  - A part sung by several singers shows a gradient across their colors. It spans the whole shared part, and the light reveals it as it runs.
  - The romaji line under it takes the same colors.
  - B (white lyrics, only the light colored) and C (tints plus a row of who's singing now) were turned down.
- **The editor: mockup A** (`design/lyrics-singers/editor.html`; "A looks good"). It's laid out like Aegisub, in a window of its own:
  - **Top:** a toolbar (play line, time, tap timing) and the waveform of the song, with each line drawn as a block in its singers' colors and white ticks where words start.
  - **Middle:** every line in a list (number, start, end, who, the colored lyrics), with the line being edited highlighted.
  - **Bottom:** the line being edited, big, with its words as pieces to select, and under it the whole cast in six groups (the five units and the Virtual Singers), each character a round badge.
  - B (one line at a time, cast on the side) was turned down.
- **Recording for the waveform is approved** ("the recording is fine", 2026-11-02).
  - The song's sound is recorded only while the editor is open.
  - It's kept in memory and thrown away when the editor closes.
  - This is a new case beside auto-sync's recording and goes into CLAUDE.md's privacy section with the date.
- **Local only for now:** nothing is shared, uploaded or downloaded.

## Goals

1. **Color-coded lyrics on the Focus Screen.**
   - Each part of a line is shown in its singer's color, as in mockup A.
   - The word-by-word light (`RowWords`) runs in that color.
   - Where several sing, the light is a gradient across their colors, left to right in the order the user picked them.
   - It works the same in "Three lines" and the full list.
2. **An editor of its own (not Customize) to say who sings what.**
   - Select words in a line (drag across them, Shift-click), then click one or more characters.
   - One character means a solo; several mean they sing together; the cast's "Everyone" means all the song's singers.
   - A line can change singers at any word, which covers the three cases above.
3. **Fixing timing in the editor.**
   - Line start and end, and each word's start, by dragging on the waveform.
   - Also by tapping a key in time while the song plays, like Aegisub's karaoke timing.
   - Play line, and arrows to move between lines.
   - The user's timing wins over LRCLIB's and auto-sync's for that song.
4. **Two lyrics at once** (the user said yes, 2026-11-02). A backing line under the main one, call-and-response, or an echo sung over the main line is a line of its own: a "second voice" with its own times and singers, overlapping the main line in time.
5. **Character badges.**
   - Every character has a round badge in their official color. The user can drop in their own picture (a chibi) for any character, which then shows in the badge.

## Non-goals (for now)

- Sharing, importing or exporting coded songs, including Aegisub `.ass` files. This is later; the saved format should make it easy, see "Saving".
- English translation lines. The app shows Japanese and romaji today.
- A "who's singing now" row on the Focus Screen (mockup C, turned down).
- Windows support for the waveform recording. The recording uses the macOS audio helper; elsewhere the editor works without a waveform.

## Anti-goals

- Shipping, bundling or downloading Project Sekai's official art.
  - The chibi pictures belong to SEGA and Colorful Palette. The app draws plain badges, and only the user's own pictures, kept in userData, ever replace them.
  - Never fetch character art from a wiki or the game.
- Colors that can't be read: a light color like Len's yellow on the Daylight theme, or a dark one on a dark theme.
- The color work costing the Focus Screen noticeable GPU or CPU while a song plays. Today the light costs nothing measurable; keep it close to that.
- Losing the user's coding when the lyrics change under it: a re-check, another version picked, or new auto-sync timings.

## The cast

Built in: the 26 Project Sekai characters with their official image colors, in six groups. The builder checks each hex against the game's official character color before shipping; these are from memory.

| Group | Characters (color) |
|---|---|
| Leo/need | Ichika `#33AAEE`, Saki `#FFDD44`, Honami `#EE6666`, Shiho `#BBDD22` |
| MORE MORE JUMP! | Minori `#FFCCAA`, Haruka `#99CCFF`, Airi `#FFAACC`, Shizuku `#99EEDD` |
| Vivid BAD SQUAD | Kohane `#FF6699`, An `#00BBDD`, Akito `#FF7722`, Toya `#0077DD` |
| Wonderlands×Showtime | Tsukasa `#FFBB00`, Emu `#FF66BB`, Nene `#33DD99`, Rui `#BB88EE` |
| 25-ji, Nightcord de. | Kanade `#BB6688`, Mafuyu `#8888CC`, Ena `#CCAA88`, Mizuki `#DDAACC` |
| Virtual Singers | Miku `#33CCBB`, Rin `#FFCC11`, Len `#FFEE11`, Luka `#FFBBCC`, MEIKO `#DD4444`, KAITO `#3366CC` |

My calls:
- **Extra singers.** "Add singer…" makes one with a name and a color, for other songs or a character not listed. Built-in names and colors can't be changed, but a built-in character's picture can.
- **One Miku.** The Virtual Singers are one character each, whichever unit's version sings: one Miku, one color.
- **The song's cast comes first.** Characters already used in the song open at the top of the cast, so a song is quick to finish.
- **Badges with no picture** show the character's initials, two letters, on their color.
- **Pictures** are any PNG, JPG or HEIC the user picks (from the badge's right-click menu, or dropped onto it). They're kept re-encoded in userData (`lyrics-singers/pictures/`), never the original file, like the background photo.

## On the Focus Screen (my calls within mockup A)

- **Colors stay readable on every theme.** Each singer color is fitted to at least 3:1 against the theme's card, the way the weather colors are (`--weather-*`, presets.ts). It's darkened on Daylight and lightened on a dark theme only as far as needed, so Len stays yellow, just a readable one.
- **Unsung parts** use the same colors, faint, the way unsung lines are faint today. Past and far lines are dimmer and blurred as now.
- **A shared part's gradient** runs across the whole part, not each word. The light reveals it word by word, so the lit edge of a duet moves through the gradient.
- **Romaji takes its line's colors.** This needs new work: today romaji reaches the renderer as one string per line and `SungRomaji` lights it in one sweep.
  - Where the line has one singer, it's that color.
  - Where the line changes singers, the romaji is split where the singers change. The split is automatic when it's sure:
    - romaji made on the Mac can carry kuromoji's word boundaries;
    - VocaDB's romaji is matched by kana sounds, like the line pairing in `romaji.ts`.
  - In the editor, the romaji line sits under the Japanese, with the split shown as a handle. The user can drag it to fix it, and that fix is saved with the song.
  - A line that's neither sure nor fixed gets a gradient of the line's singers in order. (Builder-check answer, my call.)
- **A second-voice line** shows directly under the main line it overlaps (my call).
  - It's a little smaller, in its own singers' colors, and lit on its own timing.
  - Both rows glide together, and the window opens a row's height for it.
  - Two rows can be lit at once, and the line glide's "one sung row" becomes "the rows sung now".
- **A song with no coding** looks exactly as today.
- **The lyrics' source line** adds "colors by you" when a song has coding.

## The editor

- **When the music moves on, the editor stays on its own song** (builder-check answer, my call).
  - The colors can still be changed.
  - Play line, tap timing and the waveform recording pause, with a quiet note "Play {song} to time it". They come back by themselves when that song plays again.
  - The waveform keeps what it had.
  - The editor never follows the player to another song on its own. A "Switch to the song playing now" button does that on the user's click.
- **The song's cast.** A row at the top of the edit area holds who sings in this song (my call, from the builder check).
  - The user sets it once, for example the six singers of NEO.
  - The cast below opens with those characters first.
  - "Everyone" means that row and stays live: adding a singer to the song's cast later adds them to every "Everyone" part.
  - It's saved as "everyone", and an export would write out the names at that moment.
  - "Everyone" can't be picked until the song's cast has at least two singers.
- **Opening it.**
  - It's "Color-Code Lyrics…" in the Music menus: the app menu, the right-click quick menu and the Music card's dot menu.
  - It opens for the song playing now, in a normal window on the main screen, like Customize, with the Focus Screen showing the coding live as it's made.
  - Off while nothing plays, or when the song has no lyrics.
- **Its parts are mockup A's:** toolbar, waveform, line list, and the edit area with the cast. Keyboard:
  - ↑/↓ move between lines;
  - Space plays the selected line;
  - a number key, or the cast's own key hints, assigns while words are selected;
  - Delete clears the selected words' singers;
  - ⌘Z / ⇧⌘Z undo and redo.
- **Second voice** (my call).
  - A bracketed part of a line, like "(echo)", can be split off into a second-voice line: select it, then "Make second voice".
  - "Add second voice…" adds a line with typed words under the selected line.
  - On the waveform, second-voice lines get a second lane of blocks under the main one, timed the same way.
- **Selecting.**
  - Words are the same pieces the Focus Screen lights. Japanese without spaces is split by `japaneseWords`, the browser's own word breaker.
  - Several words may be selected in a run, across the line.
  - A piece that's split wrong can be split further at a letter (my call: Option-click between letters) so a singer can come in mid-word.
- **The waveform** fills in as the song plays while the editor is open; it's only of the parts heard so far.
  - Lines show as blocks in their singers' colors, and word starts as ticks.
  - Dragging a block's edges or a tick changes the timing; dragging snaps lightly to the nearest loud onset.
  - Zoom with pinch or ⌘ + scroll.
- **Tap timing.** While on, each press of the timing key (my call: J) during playback sets the next word's start. Holding it marks the word's end. This is Aegisub's karaoke tapping.
- **Playing.**
  - Play line seeks the player to the line's start and pauses at its end. Players can seek: the YouTube Music extension's seek, and AppleScript's player position.
  - A player that can't seek gets Play and Pause only.
- **Saving.**
  - Every change is saved about half a second after it settles; there's no Save button.
  - Closing the window keeps everything.
  - "Remove colors for this song" (asks first) deletes the song's file.

## Recording for the waveform

Approved by the user on 2026-11-02.
- The audio helper's tap (the auto-sync helper) records only the music player's process, and only while the editor window is open.
- The audio stays in memory and is thrown away when the editor closes.
- The waveform's outline is kept per song (the user said "save the waveform too", 2026-11-02), so the next opening shows the waveform at once without playing it all again.
  - It's loudness peaks only, a few kilobytes, enough to draw it and nothing that can be played back.
  - It's kept in `userData/lyrics-singers/waveforms/` and goes with the song's colors: "Remove colors for this song" deletes it too.
  - Parts heard later fill in what's missing.
- If auto-sync's add-on isn't installed, the waveform still works: it uses only the helper, not the Python aligner. If the helper isn't allowed to record, the editor works without a waveform, and says so in plain words.

## Saving (my calls)

- **Where:** one JSON file per song in `userData/lyrics-singers/`, keyed by the song like the timing fixes (`nearSongKeys`: a second longer or shorter matches), written atomically (`jsonFile.ts`), parsed as untrusted on read.
- **What it holds:**
  - the lyric lines' text it was made on;
  - per line, its start and end, its words' starts and ends, and each word's singers in order;
  - second-voice lines with the main line they sit under. Lines may overlap in time, and words keep their order within each line;
  - the extra singers used;
  - a format version, so a later export can be the same file.
- **When the shown lyrics change** (a re-check, another version picked, new auto-sync timings):
  - The coding stays with the text it was made on.
  - Lines whose text matches exactly keep their coding.
  - Lines that changed show uncoded on the Focus Screen, and are marked "changed" in the editor's line list so the user can redo them.
  - Nothing is thrown away.
- **Timing precedence:** the user's timing wins over LRCLIB, auto-sync and the per-song timing fix. Saving timing in the editor clears that song's timing fix (`lyrics-offsets.json`), since the user's own times replace it.

## Constraints

- Everything is local. No new third-party host; the coding never leaves the Mac.
- IPC channels and their types are in `src/main/ipc.ts`; the renderer never touches files.
- A mock and demo: the demo song 星空レター gets a demo coding with two singers, a duet part and an "everyone" line, so `npm run dev` shows it offline.
- No finite CSS keyframe animations inside cards (CLAUDE.md); the light stays on `useSongAnimations`.
- Readable from about 1 m away; buttons at least 44 px in the editor's toolbar and cast.

## Left to the builder

- How `RowWords`' sweep carries color: per-word gradients, a mask over a colored layer, or another way. Measure GPU and CPU against today, as for the light-up work.
- The waveform's drawing (canvas), its zoom levels and the onset-snapping method.
- The exact keyboard map beyond what's above.
- How the editor and the Focus Screen share the coding live: main pushes the song's coding to both windows.
- The editor window's size and where it remembers its place.
