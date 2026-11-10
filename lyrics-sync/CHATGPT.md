# CHATGPT.md (lyrics-sync)

You are **ChatGPT**, working on Focus Screen's lyrics auto-sync **at the same time as Claude** (Claude Code). Read `project_brief.md` (this folder) first: it explains what the user wants, how the engine works today, what has been measured, and the lessons learned. If you're Codex or another agent that reads `AGENTS.md`, treat this file as your `AGENTS.md`.

## Your role

You own the **Python side**: making the aligner better, and above all making lyrics sync on the **first play** (milestones L2–L4 in the brief).

- `lyrics-sync/experiments/**`: your research and prototypes. One subfolder per idea (e.g. `experiments/ctc-live/`, `experiments/whisper-window/`), each with a short `README.md`: what it does, how to run it, and its results.
- `native/aligner/**`: the app's Python worker (`aligner.py`), `setup.sh`, `requirements.txt`. Changes here ship in the app, so keep the protocol (below) working at all times.

## Not yours (Claude's): read, don't edit

- `src/**`: the Focus Screen app (TypeScript, Electron).
- `native/mac-audio/**`: the Swift audio-capture helper.
- `lyrics-sync/eval/**`: the shared scoring. You can import it and propose changes in `HANDOFF.md`, but don't change how things are scored. Results must stay comparable.
- The parent folder's `CLAUDE.md`, `project_brief.md`, `package.json` and config files.

## The worker protocol is a contract

The app talks to `native/aligner/aligner.py` with the JSON-lines protocol in `project_brief.md`. The `load` / `align` ops must keep working exactly as described. For first-play sync, a draft `follow` / `audio` / `seek` / `stop` / `line` protocol is there too. If you want it different, propose it in `HANDOFF.md` and wait until Claude agrees before building it. Claude builds the app side against the same contract at the same time.

## Rules (from the user and the app's privacy and security rules)

- **Everything stays on the Mac.** At run time the aligner makes no network requests, and audio never leaves the computer.
- **The recordings** in `~/Library/Developer/FocusScreen/autosync-samples/` are the user's copyrighted music: use them locally, never upload, paste or share them, and don't delete or rename them.
- **Downloads need the user's OK first:** models, packages, datasets. Say what and how big. Weights go in a runtime's `models/` folder or under `~/Library/Developer/FocusScreen/`, never in the repo and never in `~/Desktop` (iCloud-synced).
- **Never read or print secrets or personal data:** `~/Library/Application Support/Focus Screen/secrets.json`, `settings.json`, the to-do data, or any `client_secret*.json`.
- **Don't break the current runtime** at `~/Library/Application Support/Focus Screen/aligner/.venv`, which the app uses. Experiment in your own environment (e.g. `~/Library/Developer/FocusScreen/experiments-venv`), and change the app runtime only together with `native/aligner/requirements.txt` and `setup.sh`.
- The machine is an Apple M5 (macOS 27, 24 GB). Prefer MPS (Apple GPU) where it helps. Whisper's DTW needs the float64-on-CPU patch shown in `aligner.py`.
- Plain lyrics beat wrong timings: report failures honestly, never hide bad lines by spreading them evenly.

## How to measure (always the shared way)

- Use `lyrics-sync/eval/score.py` (`load_sample`, `ground_truth_samples`, `heard_mask`, `score`) and `textprep.py` (the app's text cleanup). Baseline: `python lyrics-sync/eval/evaluate.py` with the aligner runtime's Python (see the brief). Overall: 74% / 87% / 95% within 0.3 / 0.5 / 1 s.
- **For live (first-play) prototypes:**
  - Feed each recording chunk by chunk in song order, with no peeking ahead, and log when each line is announced (the "decision time").
  - Report the median and 90th-percentile lag behind the true line start, the wrong-line rate, and seconds of compute per minute of audio.
  - Also try a few seeks (jumping to another spot) to show it recovers.
- Run all ground-truth recordings, not just a good one.

## HANDOFF.md entries

Append, never rewrite. One entry per meaningful step:

```markdown
## 2026-10-15 14:20 · ChatGPT

**Did:** …
**Measured:** (command and numbers)
**Need from Claude:** … (or "nothing")
**Protocol:** unchanged | proposed change: …
```

## Good first steps

1. Run `eval/evaluate.py` and confirm you get the baseline table.
2. Build a "simulated real-time" harness in `experiments/` that replays a recording chunk by chunk and scores announced lines for lag and wrong lines.
3. Try at least two live approaches. Two ideas:
   - **Streaming CTC forced alignment** (online Viterbi or score following over the lyric tokens). For Japanese, use a multilingual CTC model with romanization, or a Japanese character model.
   - **Whisper or stable-ts on a sliding window** of recent audio, constrained to the next few unsung lines.
4. Write up the numbers in `HANDOFF.md` so the user can pick (milestone L3).
