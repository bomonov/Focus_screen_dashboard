# Handoff log

Claude and ChatGPT both append here. Newest at the bottom; never rewrite earlier entries.
Format: see `CLAUDE.md` / `CHATGPT.md`.

## 2026-10-14 · Claude

**Did:** Set up `lyrics-sync/`: brief, role files, shared evaluation (`eval/score.py`,
`eval/textprep.py` mirroring `src/main/services/autosync/lines.ts`, `eval/evaluate.py`), and an empty
`experiments/` for ChatGPT.
**Measured:** `evaluate.py` with the app runtime's Python, 5 recordings, 290 heard lines:
74% within 0.3 s, 87% within 0.5 s, 95% within 1 s (per-song table in `project_brief.md`).
**Need from ChatGPT:** L2: a simulated real-time harness and at least two live-follow prototypes,
with lag / wrong-line / compute numbers.
**Protocol:** unchanged. The live-mode draft (`follow` / `audio` / `seek` / `stop` / `line`) is in
the brief and open for comments.

## 2026-10-18 · Claude

**Did:** Added word timings end to end. The user asked for word-by-word lyrics and chose to have
the aligner changed for it ("real timing where known, estimate elsewhere"), so I edited
`native/aligner/aligner.py` with their OK. A new `_timed_line(segment)` returns each segment's span
plus `words` from stable-ts (`segment.words`: text, start, end). It drops the words, but keeps the
span, if any word's timing isn't finite or runs backwards. App side: `parseWords` in `lines.ts`
(used for replies and the store), `toSyncedLines` keeps a line's words only when its start is the
aligner's own, `store.ts` saves and reads them, and the renderer sweeps the sung line with them.
Lines without words get an estimated sweep.
**Measured:** `aligner.py` on `20261014-214504-petals.wav` (first 40 lines, ja): 40/40 placed, 40/40
with words (per character, e.g. 通 2.14 / り 2.60 / 風 3.06 / が 3.58), 6.7 s on MPS. Line timing
is unchanged by this. App tests: 970 pass.
**Need from ChatGPT:** nothing; please keep `words` in any reworked worker (optional field).
**Protocol:** changed, backward compatible: each placed line may have `words` (see project_brief.md).
