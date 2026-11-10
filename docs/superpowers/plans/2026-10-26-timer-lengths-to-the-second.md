# Timer lengths to the second: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Focus, break and countdown lengths settable to the second (1 s to 23:59:59), mainly with hour/minute/second wheels on the Timer card, also in Customize, with the old presets as quick picks.

**Architecture:** Lengths move from minutes to seconds in settings (minute copies kept for rollback). A pure `lengths.ts` holds limits, quick picks and labels for main and renderer. A new timer command `useLength` lets the card start or reset a run at a given length and phase. A wheel spinbutton (pure stepping math + React component) serves both the card's editor and Customize's compact box. The Timer menus gain clock-style custom lines and "Set on the Timer Card…", which main delivers to the card as a new IPC event.

**Tech Stack:** Electron, TypeScript strict, React, plain CSS, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-timer-lengths-to-the-second-design.md`

## Global Constraints

- Lengths: whole seconds, 1 to 86 399 (23:59:59) for focus, break and countdown.
- Saved settings: `timer.focusSec`, `timer.breakSec`, `timer.countdownSec`; `focusMinutes`/`breakMinutes`/`countdownMinutes` still written, rounded, at least 1, within the old limits (240, 60, 1440), and never read when the seconds are valid.
- Defaults: 1500, 300, 600.
- Quick picks (seconds): focus 1500, 2700, 3000; break 300, 600, 900; countdown 300, 600, 900, 1800, 3600. Labels "25 min", "1 hour".
- The wheels open only while the timer is idle or finished, never in Stopwatch.
- Start in the editor starts the phase the Focus/Break switch shows (the user's delegated call, 2026-10-26); Done keeps the card's phase.
- No new dependencies. IPC only through `src/main/ipc.ts`. Controls ≥ 44 px (`--hit`). Theme tokens only. No finite CSS keyframes inside cards.
- `npm run typecheck`, `npm run lint`, `npm test` green after each task; commit after each task (local only, never push).

## Review Focus

1. A settings file from before this change (minutes only, including a countdown of 1440 min) keeps its lengths: read as seconds, 1440 min clamped to 23:59:59.
2. A run that's running or paused is never changed by the editor, a menu item or a stray `useLength` command.
3. Switching Break → Focus with Start advances the session like a finished break does; Focus → Break keeps it.
4. Wheels wrap (59 → 0, 23 → 0) without carrying, and typing two digits fast sets a value; a slow second digit starts over.
5. The card's editor doesn't write settings on every wheel step (saves after it settles, at once on Start/Done/Esc/chip).

---

### Task 1: Settings in seconds

**Files:** Modify `src/main/services/settings/schema.ts`, `src/main/services/timer/machine.ts` (`timerConfig`), and every `focusMinutes`/`breakMinutes`/`countdownMinutes` use outside tests (`menu.ts`, `TimerSection.tsx` only to keep compiling until Tasks 5–6); tests `schema.test.ts`, `machine.test.ts`, `service.test.ts`.

**Produces:** `TimerSettings` with `focusSec`, `breakSec`, `countdownSec` (and the three rollback minute fields); `TIMER_LENGTH_LIMITS = { min: 1, max: 86399 }` (replaces `TIMER_LIMITS`).

- [ ] Failing tests in `schema.test.ts`: defaults are 1500/300/600; `{ focusSec: 90 }` reads 90; `{ focusMinutes: 45 }` (no seconds) reads 2700; `{ countdownMinutes: 1440 }` reads 86399; `{ focusSec: 0 }` and `{ focusSec: 1.5 }` fall back to the minutes or the default; parsed output carries `focusMinutes: 2` for `focusSec: 90`, `breakMinutes: 60` for `breakSec: 86399` (old limit), at least 1 for `focusSec: 20`.
- [ ] Run, watch them fail; implement; run green; update machine/service tests to the seconds fields; full suite, typecheck, lint; commit.

### Task 2: Lengths helpers

**Files:** Create `src/main/services/timer/lengths.ts` (pure, no imports) and `lengths.test.ts`.

**Produces:** `MAX_LENGTH_SEC`, `FOCUS_PICKS`, `BREAK_PICKS`, `COUNTDOWN_PICKS`, `splitLength(sec) → { hours, minutes, seconds }`, `joinLength(parts) → number`, `pickLabel(sec)` ("25 min", "1 hour", "2 hours", else the clock label), `clockLabel(sec)` ("1:05:30", "25:00", "1:30", "0:05"), `spokenLength(sec)` ("1 hour 5 minutes 30 seconds", "25 minutes", "1 second").

- [ ] Failing tests for each; implement; green; commit.

### Task 3: The `useLength` timer command

**Files:** `src/main/services/timer/types.ts`, `parse.ts`, `machine.ts` and their tests.

**Produces:** `{ kind: 'useLength'; phase: PomodoroPhase; durationSec: number; start: boolean }`.

- [ ] Failing tests: parse accepts the exact shape, rejects 0, 86 400, fractions, other phases, a non-boolean start; machine: idle Pomodoro focus s2 + `useLength(break, 420, start)` → running break s2 at 420 from `now`; idle break s2 + `useLength(focus, 60, start)` → running focus s3; s4 break → focus wraps to s1; same phase keeps the session; `start: false` → idle at that length; finished countdown + `useLength(focus, 90, false)` → idle countdown 90 (phase stays 'focus'); running or paused → unchanged; stopwatch → unchanged.
- [ ] Implement; green; commit.

### Task 4: Wheel math

**Files:** Create `src/renderer/widgets/timer/wheelMath.ts` + test.

**Produces:** `stepWheel(value, delta, max)` (wraps over 0..max), `scrollToSteps(carry, deltaPx, deltaMode)` → `{ steps, carry }` (pixel deltas: one step per `WHEEL_STEP_PX`, each event's contribution capped so a flick moves a handful; line/page deltas: one step per line), `typeDigit(typed, digit, max, sinceLastSec)` → `{ value, typed }` (a second digit within 1 s appends if ≤ max, else starts over with the new digit).

- [ ] Failing tests (wrap both ways, carry across events, the cap, line mode, typing two digits, slow second digit, "7" then "9" for hours (79 > 23 → 9)); implement; green; commit.

### Task 5: The card's length editor

**Files:** Create `src/renderer/widgets/timer/LengthWheel.tsx` (one spinbutton column, sizes `card` and `row`), `LengthWheels.tsx` (three columns, hours/min/sec), `TimerLengthEditor.tsx` + CSS (`LengthWheels.css`, additions to `Timer.css`); modify `Timer.tsx`, `src/main/ipc.ts` + `src/preload/index.ts` (event `timerEditLength`), a hook `useTimerEditRequests`.

**Consumes:** Tasks 1–4. **Produces:** `LengthWheels` (`valueSec`, `onChange`, `size`, `label`) for Task 6; IPC event `timerEditLength: { length: 'focus' | 'break' | 'countdown' }` for Task 7.

- [ ] The face becomes a button ("Set focus length, 25 minutes") while idle or finished and not Stopwatch; clicking opens the editor in the face's place: Focus/Break switch in Pomodoro (starts on the card's phase), wheels, quick-pick chips (lit when matching), Start (disabled at 0:00:00) and Done. Esc, Done and a press outside the card close it keeping the lengths. Edits save through `updateSettings({ timer: { …Sec } })` 300 ms after the last change and at once on Start/Done/Esc/chip; Start sends `useLength(switch phase, length, true)`; Done sends `useLength(card phase, its length, false)`. If the run starts elsewhere (hotkey) while open, the editor closes.
- [ ] Wheels: two-finger scroll and mouse wheel (non-passive listener), pointer drag, clicking the dim neighbours, ↑/↓, Page Up/Down (±10, hours ±5), Home/End, digits. `role="spinbutton"`, name "Focus hours", value text "25 minutes". Reduced motion: no easing. Readable from 1 m: centre value at the face's time size scale.
- [ ] Check in the running app (dev build) across ring/bar/flip, Pomodoro/Countdown, glass on and off; typecheck, lint, tests; commit.

### Task 6: Customize › Timer

**Files:** `src/renderer/screens/customize/TimerSection.tsx`, `controls.tsx` (replace `MinutesGroup` with `LengthGroup`), `customizeView.ts` (+ test; drop `parseMinutes` and the minute presets), `Customize.css`.

- [ ] Each length: its quick-pick pills, then a compact `LengthWheels size="row"`; a pill lights when equal; turning the box saves after it settles. Check in the running app; typecheck, lint, tests; commit.

### Task 7: Menus

**Files:** `src/main/menu.ts` (+ test if present), `src/main/index.ts`.

- [ ] `lengthItems`: picks (pickLabel), a ticked disabled `clockLabel` line when the length isn't a pick, a separator, "Set on the Timer Card…" (hidden when the Timer card is off in Widgets, disabled while running or paused). `MenuContext.timerEdit: { shown: boolean; enabled: boolean; open(length) }`; main shows and focuses the Focus Screen, selects the matching mode if needed, and sends `timerEditLength`. The app menu is rebuilt when the timer's editability changes. Tests for the items; typecheck, lint, tests; commit.

### Task 8: Docs and graph

- [ ] CLAUDE.md: the timer lengths in the Design section (editor, wheels, picks, Start follows the switch), settings in seconds. `graphify update .`; commit.
