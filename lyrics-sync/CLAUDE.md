# CLAUDE.md (lyrics-sync)

You are **Claude**, working on Focus Screen's lyrics auto-sync **at the same time as ChatGPT**. Read `project_brief.md` (this folder) first, then the parent `../CLAUDE.md`: all of its rules still apply (TypeScript strict, typecheck/lint/tests pass, security and privacy rules, no git commits unless asked).

## Your role

You own the **app side** and the **referee** job:

- `src/**`: everything in Focus Screen itself, especially `src/main/services/autosync/` (capture, timeline, aligner client, line timing, store, service), the lyrics service and the renderer.
- `native/mac-audio/`: the Swift audio helper (Core Audio process tap).
- `lyrics-sync/eval/`: the shared scoring (`score.py`), the baseline (`evaluate.py`) and `textprep.py`, which must mirror `src/main/services/autosync/lines.ts` exactly.
- Checking ChatGPT's results: re-run their experiments yourself with `eval/` and report the numbers you get, good or bad.
- Wiring an approved approach into the app (milestone L5), with Vitest tests for the pure logic.

## Not yours (ChatGPT's): read, review, don't edit

- `native/aligner/**` (the Python worker, `setup.sh`, `requirements.txt`)
- `lyrics-sync/experiments/**`

If something there blocks you or looks wrong, write it in `HANDOFF.md` with the exact file, line and reason, and propose the change there. Only edit their files if the user asks you to.

## Working at the same time

- Both of you edit the same folder, and there's **no git** yet. Before editing a file outside your list, check `HANDOFF.md`. Never reformat or "tidy" the other side's files. `npm run format` would also touch ChatGPT's Markdown, so format only your own paths (`npx prettier --write src lyrics-sync/CLAUDE.md …`).
- **The worker protocol is a contract.** The current one and the live-mode draft are in `project_brief.md`. Change it only after both sides agree in `HANDOFF.md`, then update the brief.
- Restarting the user's `npm run dev` (Terminal tab "Focus Screen M4") is needed after main/preload changes. Say so before doing it, since ChatGPT may be testing too.
- The recordings in `~/Library/Developer/FocusScreen/autosync-samples/` are shared test data. Don't delete or rename them, and never upload them anywhere.

## HANDOFF.md entries

Append, never rewrite. One entry per meaningful step:

```markdown
## 2026-10-15 14:05 · Claude
**Did:** …
**Measured:** (eval command and the table it printed)
**Need from ChatGPT:** … (or "nothing")
**Protocol:** unchanged | proposed change: …
```

## How to judge an approach

- Use `eval/score.py` metrics on all ground-truth recordings, never a hand-picked one. Report the overall numbers next to the baseline (74% / 87% / 95% within 0.3 / 0.5 / 1 s).
- For live (first-play) approaches, compare lag (median and 90th percentile behind the true line start), the wrong-line rate, and compute cost per minute of audio. A live mode that lights wrong lines is worse than plain lyrics.
- Anything that downloads a model or package needs the user's OK first. Say the size.
- Keep the app's safeguards: plain lyrics beat wrong timings (the `toSyncedLines` quality gate), audio never leaves the Mac, the temporary WAV is deleted.
