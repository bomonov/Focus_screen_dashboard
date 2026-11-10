# Lyrics light-up, after Spicy Lyrics: design

Date: 2026-10-22. Status: approved in chat by the user ("those recommendations sound great, let's do it").

## Intent

The user saw [Spicy Lyrics](https://github.com/Spikerko/spicy-lyrics) (a Spicetify extension) and
liked how its lyrics light up as they're sung. They first thought of lighting a chunk of words at a
time, then decided the app's word-by-word light-up is right as it is, and what they want is Spicy's
**pop**: each word lifting, swelling and glowing as it lights. Asked what else would make it nicer,
they took all five of these:

1. **The pop** on each word, at Spicy's strength (mockup option C, picked over a gentler one).
2. **Better guessed timings** for lines without word timings: Japanese by how long each piece
   sounds, English by syllables, rather than by character count.
3. **Romaji follows along**: the romaji under a Japanese line lights up in step with it.
4. **Long notes hold**: a word whose light lingers swells letter by letter.
5. **A softer edge** on the light, flowing from word to word rather than restarting in each.

They insisted the **romaji line stays**: same place, same look, never removed or replaced.

The mockups (two pages, built during the conversation) are kept in `design/lyrics-light-up/`:
`word-pop.html` (A now / B gentle / C Spicy-style) and `all-five.html` (now vs all five). They're
fragments of the brainstorm tool's frame (its CSS isn't included), so they're reference, not pages.
What they do that the text below also says: one edge runs along the whole line; a held letter swells
from when the light reaches it.

## What exists now

- `GlidingLyrics` (`src/renderer/widgets/music/LyricsPanel.tsx`) draws synced lyrics. The sung row
  renders `SungWords`; every other row is plain text. `Romaji` is a plain span under each row
  (`.glide__row .lyrics__romaji`: 0.55em, regular weight, `--text-secondary`).
- `SungWords` runs one Web Animation per word (`WORD_SWEEP`: `background-position` 100% → 0% on a
  `linear-gradient(90deg, var(--text) 45%, var(--glide-unsung) 55%)` at 225% size, clipped to text)
  through `useSongAnimations`: one clock per row, started from the song's position, paused with the
  music, re-synced only on a real jump (> 250 ms), cancelled when the row changes. Under reduced
  motion it pauses the animations but still sets their current time.
- Word timings come from `lineWords` (`lyricsGlide.ts`): a row's own `words` when auto-sync timed
  them (and they spell out its text), else `estimateWords`, which splits on whitespace and shares the
  line's time by **character count**, capped at 0.3 s per CJK character and 0.11 s per other
  character (min 1 s), ending 0.15 s before the next line.
- Auto-sync's word timings (`native/aligner/ctc.py`) have **no real word ends**: each word ends where
  the next starts; the line's last word ends at its last sound + 0.3 s (capped by the next line).
  Measured on the user's 31 auto-synced songs (13,428 words): 99% of word pairs touch; median word
  0.26 s, p90 0.58 s; 229 words (1.7%) last ≥ 1.2 s, 209 of them mid-line (a word before a pause and
  a held note look the same), 20 at a line's end.

## Goals

1. **Pop.** When a word starts lighting, it rises 4 px and swells from 97% to 106% within ~0.28 s
   (ease-out), then settles to 100% and its resting place over ~0.62 s. Before its turn (only on the
   sung row) a word waits at 97% and ~0.9 px lower. A soft white glow peaks with the swell (blur
   ~12 px at full size, ~50% strength); a sung word keeps a faint glow (~12%). The pop's length is
   fixed, not tied to the word's length. A piece of Japanese (or other CJK) with no space inside is
   drawn glyph by glyph, every glyph popping in place at the piece's start: a long line never swells
   as one block, and it can still wrap (a transformed box can't break inside). This replaces the
   "cap the swell for long pieces" idea from the chat.
2. **Better guesses** (only where `estimateWords` runs, never over real word timings):
   - Japanese pieces weigh by beats: a kanji 2, a kana 1, a small kana (ぁぃぅぇぉゃゅょっ and their
     katakana) 0.5, the long-vowel mark ー 1. Spaces split pieces exactly as now.
   - Latin-script words weigh by syllables: vowel groups (a, e, i, o, u, y), at least 1 per word, with
     a silent final "e" not counted when another vowel group exists.
   - Hangul syllable blocks weigh 1 each. Anything else weighs by characters, as now. Punctuation and
     symbols weigh nothing, but every piece weighs at least 1.
   - The per-line cap (how long a line may take) stays exactly as it is now.
3. **Romaji follows along.** On the sung row, the romaji lights left to right over the same time as
   the line: from its first word's start to its last word's end. Same soft edge as the line, quieter
   than the line (as in the mockup: lit ~92% white, not yet lit ~40% white), no pop, no glow. Rows
   not being sung show romaji exactly as now (`--text-secondary`).
4. **Long notes hold.** A word on a row with **real word timings** (auto-sync) whose span is ≥ 1.2 s
   is drawn letter by letter. Each letter lights as the light reaches it and, at that moment, swells
   (rise ~0.45 s, settle ~1.1 s): up to 108% + 8% × strength and 3 + 3 × strength px up, where
   strength = clamp((span − 1 s) / 2 s, 0, 1), with a glow that grows with strength. Held words get
   the letter swell instead of the word pop. Guessed timings never count as held.
5. **Softer edge.** The edge between lit and unlit is a soft band about 0.6 em wide, the same width
   in every word, so the light looks like one soft edge moving through the line rather than a sharp
   edge restarting in each word. When a line wraps, the light carries on along the next row.

Everything else about lyrics stays: the glide, row sizes and dimming, blur with distance, break
notes, click-to-jump, "Three lines" and "Full", plain (untimed) lyrics, the romaji pairing.

## Builder check (2026-10-22): what it found and what was settled

A reviewer counted the user's lyrics cache (counts only): 217 of 256 cached synced songs are mostly
Japanese; of their 10,366 Japanese lines, **62% have no space at all** (median 11 characters), and none
of those has word timings. Auto-sync's 13,428 timed words are 13,261 Japanese tokenizer pieces averaging
1.26 characters. Settled, as calls in this design:

- **Japanese is split into words.** Wherever this design says "word" for CJK text, it means a word found
  by the browser's own Japanese word breaker (`Intl.Segmenter('ja', { granularity: 'word' })`), with
  particles, endings and punctuation joined to the word before and a new word starting at a kanji or
  katakana after kana: まだ終わらない夢の続きを → まだ · 終わらない · 夢の · 続きを; ずっとそばにいるよ → ずっと ·
  そばに · いるよ. A guessed line shares its time between those words by beats (goal 2 now matters for
  most of the user's lines), and each word pops as its light starts, like an English word.
- **Timed Japanese pops by word too.** The light still follows each timed piece, but pieces belonging
  to one word pop together at the word's start, so about one pop runs at a time, not four to seven.
- **A held letter swells from when the light reaches its start** (not its middle), so a held single
  character doesn't swell a second late.
- **The glow and the romaji follow the theme.** Glow = the theme's text color at 50% (12% at rest);
  **no glow on Daylight**, where a dark glow would smudge the letters. Romaji on the sung row: lit is
  halfway between the theme's text and secondary colors, not yet lit is the secondary color at 45%
  (on the default dark theme that's ~87% and ~34% white, close to the mockup; OLED Dim stays dim;
  Maroon & Gold's romaji stays pink).
- **Reduced motion stays as today** for the light-up (animations paused, their place set when the panel
  updates), and gets no pop, swell or glow. The romaji follow-along behaves the same way.
- **If the cost target is missed, the glow goes first.**
- **The demo is the exception to "renderer only":** its romaji comes from the demo provider directly
  (an optional `romaji` on the provider), and its timed line is built in the demo provider.

## Non-goals

- Changing how lines are timed, or lighting a chunk of words at a time (the user dropped it).
- Spicy's "breathing" interlude dots and its animated background (the app has Living album colors).
- Background-vocal rows, per-syllable timings, or any aligner change.
- Anything in Customize: no new switch. (Reduced motion is the off switch for the motion.)

## Anti-goals

- **Nothing that loops.** The user got dizzy from the animated cover's 6–8 s whole-picture loops
  (motion sickness peaks at ~0.1–0.4 Hz). Each pop and swell happens once per word; nothing on the
  lyrics repeats on a rhythm, and big things never move.
- **Nothing that feels rushed or late.** The pop starts exactly as the word's light starts.
- **No Spicy Lyrics code.** It's AGPL-3.0 and this app isn't: the look is rebuilt from scratch.
- **No layout shift.** Pops and swells are transforms and filters only; rows never reflow, and the
  glide's measured positions don't change.
- **Romaji never goes missing or moves.**

## Constraints

- Renderer only, plus pure logic beside `lyricsGlide.ts`, and the demo's own pieces in main (above):
  no IPC, settings, network or aligner change.
- Everything runs on the song clock through `useSongAnimations` (or the same mechanism): it pauses
  with the music, re-syncs on a jump, and is cancelled when the row stops being sung.
- **Reduced motion** (`prefers-reduced-motion`): the light-up and romaji follow-along as today
  (paused, their place set on updates); no pop, no wait-smaller, no letter swell, no glow animation.
- Readable from ~1 m on a 1080p screen: the glow never blurs the words' shapes.
- Cost: only the sung row animates, and about one word pops at a time. Measure the GPU process
  while lyrics play before and after; the target is no more than a few points more than now.
- Tests for pure logic (weights, syllables, beats, held-word detection), per CLAUDE.md; no pixel tests.
- `npm run dev` with no accounts must show all five: add to the demo player a song with Japanese
  lines (words written for the demo), their romaji, and one line with word timings that holds a word
  ≥ 2 s. The demo's romaji must reach the panel without VocaDB.

## Calls made in this design (not the user's words; theirs to check)

- English is timed by syllables too, not only Japanese.
- Kanji = 2 beats, small kana = 0.5: a heuristic without a dictionary, good on average.
- The per-line cap is unchanged; only how a line's time is shared changes.
- Romaji lights over the whole line's time, proportionally across its letters, not word-matched.
- Romaji never pops (a moving second line would be busy).
- Held = a real word span ≥ 1.2 s. The data can't tell a held note from a word before a pause (209
  of 229 long words are mid-line), and the light already lingers there, so both swell.
- Reduced motion keeps the color light-up and drops all motion.
- Soft band ~0.6 em; glow in the theme's text color (none on Daylight), not the accent or the cover's.
- Japanese words come from the browser's word breaker plus the joining rule above (settled after the
  builder check: without it, most of the user's lines would pop once, as a whole).

## Left to the builder

- Keyframes, easings and exact values within the ranges above, judged on screen against the mockup.
- How the soft band is drawn (for example a per-word gradient whose band is a fixed `em` width via
  `calc()` in `background-size`), and how letters of a held word are split (graphemes, so emoji and
  combining marks stay whole).
- How the romaji sweep is timed when a row has words but no romaji, or romaji but no word timings.
- The demo song's words and timings.
- Splitting the code: `SungWords` may become a small module of its own if `LyricsPanel.tsx` grows.

## Done when

- All five show in `npm run dev` on the demo songs and in the installed app on the user's songs.
- Under reduced motion only the color light-up and romaji follow-along remain.
- `npm run typecheck`, `npm run lint`, `npm test` pass, with tests for the new pure logic.
- GPU cost measured while lyrics play, reported with the before number.
- CLAUDE.md's lyrics bullet says what changed and why.
