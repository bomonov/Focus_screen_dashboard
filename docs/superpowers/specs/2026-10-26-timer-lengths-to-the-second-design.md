# Timer lengths to the second: design

2026-10-26. The user's request: "I want the timer and podometer more customizeable in term of time, up to the seconds customized", and "more like u can set ur own hour, minutes and seconds rather than pre-programmed length". They set lengths "both [on the card and in Customize], mainly on the timer card itself", picked option B (wheels, like the iPhone timer) from three mockups, and asked to "keep them [the preset lengths] as quick picks next to the wheels". The second mockup (wheels with quick picks on the card, Customize, the Timer menu) was confirmed: "that's what I pictured". Mockups: `.superpowers/brainstorm/98285-1793053161/content/timer-length.html` and `quick-picks.html` (git-ignored, on this Mac).

## Why

Today Pomodoro's focus and break, and the countdown, can only be whole minutes: preset pills (25/45/50, 5/10/15, 5/10/15/30/60) and a Custom box in Customize › Timer that takes minutes, and the same presets in the Timer menus, where nothing can be typed. The user wants any length, in hours, minutes and seconds, set mostly right on the Timer card on the Focus Screen.

## Goals

- Focus, break and countdown lengths can be anything from 1 second to 23:59:59.
- They're set mainly on the Timer card, with three wheels (hours, minutes, seconds), and also in Customize › Timer.
- The existing presets stay as quick picks next to the wheels, on the card, in Customize and in the Timer menus.
- A length set on the card is saved like any setting, so it's there next time and in Customize.

## Non-goals

- Long breaks, rounds/sessions before a long break, or any other new Pomodoro rule.
- Changing how the timer counts, chimes, auto-starts breaks or sweeps its colour.
- Changing the Stopwatch (it has no length).
- Changing the +5 min button.

## Anti-goals (a failure even if it works)

- A stray click or scroll changing the length of a session that's running or paused.
- Wheels that are fiddly with a trackpad: spinning far past the number with momentum, or needing many swipes for a big change.
- Writing settings.json on every wheel step while it spins.
- Losing anyone's saved lengths when they update (their minute values must carry over).
- Small, low-contrast numbers: everything must read from about 1 m on a 1080p monitor (CLAUDE.md).

## Decided with the user

**On the Timer card (option B).** Before Start (status idle) or after the time is up (finished), clicking the big time opens the wheels in the face's place, whichever face is chosen (ring, bar or flip digits). Three wheels: hours, minutes, seconds, each with its value large in the middle between two lines and the neighbouring values smaller and dimmer above and below, labelled hours / min / sec. In Pomodoro a Focus / Break switch above the wheels picks which length is being set (it starts on the phase the card is on). Under the wheels, the quick picks for that length as small chips (Focus: 25 · 45 · 50 min; Break: 5 · 10 · 15 min; Countdown: 5 · 10 · 15 · 30 min · 1 hour); clicking a chip turns the wheels to it, and a chip lights while the wheels match it. The buttons under it are Start and Done: Start uses the length on the wheels and starts; Done puts the face back with the new length. Countdown gets the wheels and chips without the switch. Stopwatch has nothing to open.

**In Customize › Timer.** Focus length, Break length and Countdown length each keep their preset pills; the Custom box becomes a small hours · minutes · seconds box built from the same wheels, sized for a settings row (scroll or arrow keys on each number). Picking a pill sets the box to it; turning the box to anything else un-lights the pills.

**In the Timer menus** (app menu, right-click quick menu, the Timer card's dot menu, all from `timerItems` in `src/main/menu.ts`). The presets stay. A length that isn't a preset shows as its own ticked line written like the face writes it (`1:05:30`, `1:30`), replacing "Custom (n min)". A new last item, "Set on the Timer Card…", shows the Focus Screen and opens the card's wheels on that length, since a menu can't take typing.

**Start follows the switch.** Asked whether Start with the switch on Break (while the card waits on Focus) should start the break or the focus session, the user handed it over: "just do whatever u think will give most custimzed timer and best UI u think, go ahead and build it". The call, for the most control: Start starts the phase the switch shows, at the wheels' length. Focus → Break keeps the session number; Break → Focus moves on to the next session, as a finished break does. Done only saves and keeps the card on its phase.

## My calls (the user hasn't been asked; flagged in the hand-over)

1. **Limits.** All three lengths: 1 s to 23:59:59 (today: focus 1–240 min, break 1–60 min, countdown 1–1440 min). The machine's `MAX_DURATION_SEC` (24 h) stays as the cap for +5 min.
2. **0:00:00.** The wheels can show it while turning, but it isn't a length: Start is disabled and Done (or closing) keeps the last real length.
3. **When the wheels open.** Only while the timer is idle or finished, never running or paused (anti-goal 1). While running or paused the time isn't clickable and +5 min stays as today. "Set on the Timer Card…" is disabled in the menus while running or paused.
4. **Closing.** Esc, clicking outside the card and Done all close the wheels keeping what's on them (if it's a real length). There's no separate Cancel.
5. **Saving.** The card's wheels save the length through the same settings update as Customize, once the wheels settle (not on every step; ~0.3 s after the last change, and at once on Start, Done, Esc or a chip). An idle timer shows the new length straight away (`applyConfig` already does this for idle runs).
6. **Turning a wheel.** Two-finger scroll steps one value per notch-sized amount and snaps to a value when it stops; momentum is capped so a flick moves a handful of values, not dozens. Clicking a dimmed neighbour above or below steps to it. With a wheel focused, ↑/↓ step, Page Up/Down step by 10 (5 for hours), and typing digits sets it (two digits, or one digit then a pause). Minutes and seconds wrap 59 → 0 without carrying into hours; hours wrap 23 → 0. A plain pointer press-and-drag up and down also turns it, like a picker.
7. **Accessibility.** Each wheel is a `spinbutton` with its unit in the name ("Focus hours"), `aria-valuenow`, min/max and a value text ("25 minutes"). The big time is a button when it can open the wheels ("Set focus length, 25 minutes"). With reduced motion the wheels snap without easing.
8. **Menu "Set on the Timer Card…".** For Focus or Break it switches the card to Pomodoro (and the switch to that phase) if it's on another mode; for Countdown, to Countdown. Switching mode is harmless because it's only allowed while idle or finished. If the Timer card is turned off in Widgets, the item is hidden.
9. **Quick-pick labels.** As the mockup showed: minutes under an hour as "25 min", 60 as "1 hour". The presets themselves don't change.
10. **Saved settings.** Lengths are stored in seconds (CLAUDE.md: times are seconds internally), e.g. `focusSec`, `breakSec`, `countdownSec`; a settings file saved before this, with `focusMinutes` and friends, is read once as minutes × 60 and written back in seconds. The minute fields keep being written too, rounded (at least 1), so rolling back to one of the two kept installs keeps the lengths to the minute; when both are present, the seconds win.
11. **The wheels and the run on the face.** The wheels open on the saved length, not the face's (a ready run that got +5 min before Start shows 30:00, the wheels 25:00). Done and Start on the card always leave a fresh run at the wheels' length: on a finished countdown (or Pomodoro run) Done turns "Time's up" into a ready run at the new length and Start starts one, and any +5 min added before Start is dropped. This is the card's own doing (a command that resets the run to a given length is fine); a length changed in Customize or a menu still changes only idle runs, as `applyConfig` does today.

## Constraints

- CLAUDE.md applies: TypeScript strict, no `any`; IPC channels and payloads only in `src/main/ipc.ts`; the renderer gets state from main through IPC; plain CSS with the theme's variables (accent `--accent`, words in accent `--accent-text`, greys `--text-secondary`/`--text-dim` or whatever the tokens are named); every control at least 44 px (`--hit`); readable from ~1 m; glass cards must keep the wheels readable (the smoky glass and fitted greys already handle text on glass).
- Never finite CSS keyframe animations inside cards (size containers restart them; `usePlayOnMount`).
- Motion stays small and user-driven (the user gets dizzy from big looping motion; the wheels only move when turned).
- The timer state machine stays pure and in seconds (`src/main/services/timer/machine.ts`); `TimerConfig` already holds seconds.
- `npm run typecheck`, `npm run lint`, `npm test` pass after each step; unit tests for the pure parts (settings parse + migration, length formatting, quick-pick matching, menu items, the wheel's value stepping and wrapping, the digit typing).
- No new dependencies.

## Left to the builder

- Component structure and file names (e.g. a shared wheel/spinbutton piece used by the card and by Customize's small box).
- Exact sizes, spacing and colours within the theme tokens and the mockups.
- How the card tells main which phase/mode the menu's "Set on the Timer Card…" wants (a new IPC event is fine, defined in `ipc.ts`).
- The wheel's scroll-to-step tuning, as long as anti-goal 2 holds on a Mac trackpad and a mouse wheel.
