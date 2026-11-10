# Lyrics Auto-Sync: Project Brief

## One-liner

Focus Screen shows lyrics with the line being sung highlighted. For songs where LRCLIB only has **plain** lyrics (words, no timings), Focus Screen works the timings out itself by listening to the song on this Mac. **The goal now: make that sync work on the very first play**, not only from the second play on.

Two AI assistants work on this at the same time: **Claude** (Claude Code, rules in `CLAUDE.md`) and **ChatGPT** (rules in `CHATGPT.md`). This brief is shared by both. The parent folder's `../CLAUDE.md` and `../project_brief.md` describe the whole Focus Screen app.

## What I want

1. **Synced on the first listen.** When a song with plain lyrics starts playing, the highlighted line should follow the singing from the first play. If it can't be exact, it should trail by as little as possible (target: the highlight moves to a line within ~0.5 s of the singer starting it).
2. **Accurate.** Saved timings: at least 90% of line starts within 0.5 s of when the line is sung, for Japanese **and** English songs. Today's offline aligner is at 87% on the first five recordings, but 65% across all 25 (2026-10-19; some answer keys are shifted for the uploads played, see HANDOFF).
3. **Fast and light.** Runs on my MacBook (Apple M5, 24 GB) next to everything else. Use the Apple GPU (MPS) where it helps. No fans screaming for a whole song.
4. **Private.** Everything stays on my Mac. Audio is never saved past timing it, never uploaded, never sent to any server.
5. **Honest.** Plain lyrics are better than wrong timings. If a result isn't good enough, show plain lyrics.

## Non-goals

- Downloading audio from YouTube Music or any streaming service (the app only hears what plays).
- Sending audio or lyrics to a cloud service, or adding a new lyrics provider, unless I approve it first. (Approved 2026-10-15: VocaDB, title only, for songs LRCLIB hasn't got.)
- Windows (Focus Screen's Windows version is paused).
- Changing how songs that LRCLIB already has timings for work (most songs: 31 of 35 in my history).

## How it works today

| Step | Where | What happens |
|---|---|---|
| 1. Need | `src/main/services/autosync/service.ts` | A song is picked for auto-sync only if it has words but no timings (LRCLIB's plain lyrics, or VocaDB's when LRCLIB hasn't got the song), and Customize › Music › "Auto-sync plain lyrics" is on. |
| 2. Hear | `native/mac-audio/` (Swift, "Focus Screen Audio.app") | A Core Audio **process tap** records only the music player (Safari's WebKit GPU process for YouTube Music, Chrome, Music, Spotify). 16 kHz mono int16, ~100 ms chunks, each stamped with the epoch time of its first sample. It asks macOS for "System Audio Recording" as itself. |
| 3. Place | `src/main/services/autosync/capture.ts`, `recording.ts` | Each chunk is placed on the **song's own timeline** using the player's reported position, so pauses and seeks don't matter. Chunks are held 1.5 s and dropped near seeks, pauses and song changes. Unheard parts stay silent (exact zeros). The recording is done when the song reaches its end (or is left) with ≥85% heard, or at 97% heard. |
| 4. Align | `native/aligner/aligner.py` (Python worker) | **Since 2026-10-19:** English and Japanese songs use CTC forced alignment with local wav2vec2 models (`ctc.py`: wav2vec2-large-960h-lv60-self, reazon japanese-wav2vec2-base-rs35kh), about 2–6 s per song with word timings, under 2 s model load. Other languages, unknown ones and songs CTC can't place fall back to Whisper **large-v3-turbo** via **stable-ts** `align()` (a one-line patch moves Whisper's DTW to the CPU before float64), 10–80 s per song. |
| 5. Clean text | `src/main/services/autosync/lines.ts` | Before aligning: bracketed asides (alternate readings, romaji) and decorations (→ ～ ♪ quotes) are stripped, and translation or romaji lines under each Japanese line ("companions") are skipped and later given their sung line's time + 0.01 s. |
| 6. Check | `lines.ts` → `toSyncedLines` | The result is rejected if more than 15% of lines are unplaced, run backwards, pile onto the line before, or are pinned to the song's end. Gaps ≥ 5 s get a ♪ break line. |
| 7. Keep | `src/main/services/autosync/store.ts` | Only the line timings are saved, in `~/Library/Application Support/Focus Screen/lyrics-autosync/`, keyed by the song and a hash of the plain text. The temporary WAV is deleted. |
| 8. Show | `src/main/services/lyrics/service.ts`, renderer | From then on the song shows as "Synced lyrics · Auto-synced (estimate)", and ⌘[ / ⌘] nudge the timing per song. |

**The gap:** steps 4–8 happen after the song has been heard, so the first play shows plain lyrics (scrolling by song progress), and only later plays are synced.

### The worker protocol (shared contract)

`native/aligner/aligner.py` talks one JSON object per line over stdin/stdout, and exits when stdin closes. The app runs it as `<runtime>/.venv/bin/python -I aligner.py` with `FOCUS_ALIGNER_RUNTIME=<runtime>`, where the runtime is `~/Library/Application Support/Focus Screen/aligner` (`.venv` + `models/large-v3-turbo.pt`, installed by `native/aligner/setup.sh`).

```text
→ {"id":1,"op":"load"}
→ {"id":2,"op":"align","wav":"/abs/path.wav","lines":["sung line", …],"language":"ja"|"en"|"ko"|"zh"|null}
← {"type":"ready"}
← {"type":"reply","id":2,"ok":true,"lines":[{"start":12.3,"end":15.1,"words":[…]}|null, …],"language":"ja","seconds":21.4}
← {"type":"reply","id":2,"ok":false,"error":"…"}
```

Since 2026-10-18 each placed line may also carry `words` (optional, so older replies still
parse): `[{"text":" line","start":12.9,"end":15.1}, …]` in order, as Whisper heard them, spaces
included (per character for Japanese). It's left out when any word's timing is unusable. The app
keeps a line's words only when the line stands where the aligner placed it, saves them with the
timings, and lights the sung line word by word with them.


**Draft for first-play sync (not built yet):** a live mode that follows the singing as it plays. Proposed shape, open to change by agreement in `HANDOFF.md`:

```text
→ {"id":3,"op":"follow","lines":["sung line", …],"language":"ja","durationSec":197}
→ {"op":"audio","songTime":42.10,"pcm":"<base64 16 kHz mono int16 LE>"}     (about every 100 ms, in song time)
→ {"op":"seek","songTime":80.0}     → {"op":"stop"}
← {"type":"line","index":7,"start":41.85,"confidence":0.8}    (line 7 started at 41.85 s, decided now)
```

The app already knows the song time of every chunk (step 3) and can feed it live.

## Results so far (measured on my own recordings)

Ground truth is LRCLIB's own synced lyrics for songs that have them. They're recorded through the app, aligned from the plain text, and compared line by line. Run it with:

```sh
"$HOME/Library/Application Support/Focus Screen/aligner/.venv/bin/python" lyrics-sync/eval/evaluate.py
```

| Song | Language | Within 0.3 s | Within 0.5 s | Within 1 s | Median error |
|---|---|---|---|---|---|
| Scared of the Dark | English | 90% | 95% | 95% | 100 ms |
| Gunjo Sanka | Japanese (+ translations, romaji) | 73% | 95% | 96% | 150 ms |
| Hibana -Reloaded- | Japanese + English | 84% | 93% | 98% | 160 ms |
| Petals | Japanese | 67% | 82% | 94% | 260 ms |
| NEO | Japanese | 39% | 45% | 90% | 590 ms (late) |
| **All 290 heard lines** | | **74%** | **87%** | **95%** | |

Live test: "Tondemo Wonderz" (Japanese, 73 dense lines, plain-only on LRCLIB) was "almost perfect" on the second play.

Lessons learned (don't repeat them):

- Start timing only after the **whole** song was heard. Unheard parts make the aligner pile lines at the end.
- LRCLIB text has **unsung extras** (bracketed readings, romaji, translation lines). Feeding them to the aligner wrecks it: Gunjo Sanka went from 5% to 96% within 1 s once they were removed.
- The user's earlier wav2vec2 engine (`../Lyrics engine/lyrics-sync-engine`, English-only) matched Whisper on English (92% within 0.3 s), but can't do Japanese at all.
- Demucs vocal separation didn't help Whisper here. A fixed −0.1 s correction didn't help overall.
- stable-ts on CPU takes 4–16 min per song; on MPS (with the DTW patch) it takes 10–40 s.

## Evaluation rules

- Every idea is measured with the scripts in `lyrics-sync/eval/` (`score.py` metrics) on the recordings in `~/Library/Developer/FocusScreen/autosync-samples/`. Each recording is a WAV plus a JSON with title, player, coverage and LRCLIB's lyrics.
- For first-play (live) ideas, measure **lag**: feed a recording in simulated real time (chunk by chunk, no peeking ahead) and record when each line was announced. Report how far behind the true line start each announcement came (median, 90th percentile), how often the wrong line was lit, and CPU/GPU time per minute of audio.
- More recordings: in a dev build, Develop › "Record Songs for Auto-sync Tests" saves each fully heard song with its lyrics. Songs with LRCLIB timings are the ones that can be scored.
- **The recordings are my copyrighted music. Never upload them, paste them, or send them anywhere.**

## Constraints

- macOS 27 on Apple M5 (arm64), 24 GB. Python 3.12 runtime at `~/Library/Application Support/Focus Screen/aligner/.venv` (torch 2.14.1, openai-whisper 20250625, stable-ts 2.19.1, soundfile, transformers 4.57.6 and its tokenizers/safetensors/huggingface-hub). Pinned in `native/aligner/requirements.txt`; `fetch_models.py` downloads the CTC models at pinned revisions with sha256 checks.
- Model weights live in the runtime's `models/` folder, never in the repo. Anything new to download (models, packages) needs my OK first. Say the size.
- At run time the aligner makes **no network requests**.
- Nothing goes in `~/Desktop` that's big or runs a helper: it's iCloud-synced (see `../CLAUDE.md`).
- Focus Screen's own rules apply (`../CLAUDE.md`): TypeScript strict, typecheck/lint/tests must pass, no secrets in files.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| L1 | Shared evaluation | `eval/evaluate.py` reproduces the table above. **Done.** |
| L2 | Live-follow research | A prototype in `experiments/` follows the singing on the recordings in simulated real time, with lag and wrong-line numbers for at least two approaches (e.g. streaming CTC forced alignment, Whisper on a sliding window). |
| L3 | Pick an approach | I choose, based on the numbers. Anything needing a new download is approved. |
| L4 | Worker live mode | `aligner.py` implements the agreed live protocol, with a script that tests it on the recordings. |
| L5 | App integration | The app feeds live audio to the worker on the first play, lights lines as they're announced, and still saves the offline timing at the end. Tests pass. |
| L6 | Live test | First play of a plain-lyrics song follows the singing on my screen. |
| P1 | Prepared playlists | Customize › Music › "Prepare playlist" plays a YouTube Music playlist muted; songs that need timing play to the end and get timed, the rest are skipped. Built 2026-10-15 (helper mute verified by ear); waiting on a real run. |

## Who does what

- **ChatGPT**: the Python side. Research and prototypes in `lyrics-sync/experiments/`, and the aligner worker in `native/aligner/` (live mode, accuracy improvements).
- **Claude**: the app side (`src/`, `native/mac-audio/`), the shared evaluation in `lyrics-sync/eval/`, checking ChatGPT's numbers independently, and wiring the winner into Focus Screen.
- **Both**: write in `lyrics-sync/HANDOFF.md`: what changed, what was measured, what you need from the other. Protocol changes are agreed there before either side builds them.
