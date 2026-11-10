# AGENTS.md

Instructions for Codex (and any agent that reads AGENTS.md) working in Focus Screen.

## Read CLAUDE.md first

`CLAUDE.md` is this project's full set of instructions: the stack, the layout, the architecture rules, the security and privacy rules, the code style and the design. Read all of it before any task. It binds you exactly as it binds Claude; where it says "Claude" or "the agent", read it as you. `project_brief.md` has the milestones.

Some parts of CLAUDE.md are about Claude Code only and don't apply to you: `.claude/skills`, `.claude/settings.json`, its plugins and hooks, and the Claude desktop app's tools. Everything else does.

## Rules worth repeating

- **The user's data stays out of your reach.** Never read `~/Library/Application Support/Focus Screen/` (settings, Canvas items, homework, `secrets.json`, the transit stop list) or `~/Library/Developer/FocusScreen/autosync-samples`, and never read or print an OAuth client JSON or any token. Tests use the fixtures in the repo.
- **No new network host, dependency or native-helper mode** without the user's OK. If a task seems to need one, stop and say so in your reply instead of adding it.
- **Never call, scrape or reverse-engineer** the Transit app's (transitapp.com) private API or ASU's Peak Transit shuttle tracker. Never print, log or commit Valley Metro's live feed address: it holds a published API key.
- **Checks:** `npm run typecheck`, `npm run lint` and `npm test` must all pass before you report a task done. Add unit tests for pure logic (Vitest, next to the file: `foo.ts` → `foo.test.ts`).
- **Git is local only.** Never push. Work in the worktree and branch the task gives you, and commit only when the task says to.
- **graphify:** the `graphify` command is installed. When `graphify-out/graph.json` exists, run `graphify query "<question>"` before reading code broadly.

## Working with Claude

The user sometimes has Claude (Claude Code) and you work on the same feature. Then the task names a shared folder (for example `collab/<topic>/`) holding:

- `brief.md`: the goal, who owns which files, and the interface between the two halves;
- `HANDOFF.md`: an append-only log. Read it before starting, and add a dated entry when you finish (what you did, the commit, what's left, anything you need from Claude).

Edit only the files the brief says you own. If the shared interface needs to change, write the change you want in `HANDOFF.md` and wait for it to be agreed, rather than editing the other side's files.
