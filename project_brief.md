# Focus Screen: Project Brief

## One-liner

A desktop app for **macOS and Windows** that turns an external monitor into a dedicated "productive" screen showing three things: the music you're playing, your combined to-do list, and a focus timer. No mobile versions, ever.

## Goals

1. Glanceable: everything readable from a normal sitting distance on a second monitor.
2. Live: music, lyrics, to-dos and timer update on their own without touching the screen.
3. Customizable: themes, widget layout, timer style, and data sources are all user settings.
4. Private: all data stays on the user's computer. No accounts, no servers, no telemetry.

## Non-goals (for now)

- iOS, iPadOS, Android, or any mobile OS.
- Mac App Store or Microsoft Store distribution (the App Store sandbox blocks controlling other apps).
- Playing music itself. Focus Screen only displays and controls the player that is already running.
- Hosting or reselling lyrics. Lyrics are fetched on demand from LRCLIB (or VocaDB, for songs LRCLIB hasn't got) and cached locally, as is VocaDB's romaji for Japanese songs.

## Design reference

The clickable mockup has two screens: **Focus Screen** (main display) and **Customize** (settings).
Layout: music card on the left (about 60% width), to-do and timer stacked on the right. Dark theme by default with a gold accent, rounded cards, large type.

## Core features

### A. Now playing

- Spinning disc with the album cover in the center. It spins while playing, stops on pause, and spin speed is a setting (slow, normal, still).
- Title, artist, album, player name, progress bar, elapsed and total time. Click or drag the progress bar to jump anywhere in the song.
- Controls: shuffle, previous, play/pause, next, repeat (off → all → one), lyrics toggle.
- **Lyrics**
  - Source: LRCLIB (`/api/get` with artist, track, album, and duration; `/api/search` as a fallback). When LRCLIB hasn't got the song at all, VocaDB's plain lyrics (searched by title; added 2026-10-15), which auto-sync can time.
  - For songs neither has, YouTube Music's own lyrics: the extension reads what its Lyrics tab shows (added 2026-10-17).
  - Romaji under Japanese lyrics, from VocaDB's romanization (searched by title; added 2026-10-16), with a switch in Customize › Music.
  - Synced lyrics highlight the current line. Plain lyrics scroll based on song progress.
  - "No lyrics found" falls back to a larger album-art view.
  - Lyrics offset hotkeys (±0.5 s), saved per song.
  - Local cache of lyrics per song so each song is looked up once.
  - Stretch: tap-sync mode (hotkey at each line → saves a local `.lrc` file).
  - Stretch: AI auto-sync (system audio capture → vocal separation → Whisper alignment).
- **Players by platform**

| Player | macOS | Windows |
|---|---|---|
| Spotify desktop | AppleScript (Automation permission) | System Media Transport Controls (SMTC) |
| Apple Music | AppleScript (Automation permission) | SMTC |
| YouTube Music (browser) | Stretch: browser extension → local WebSocket | SMTC, or the same extension |
| Any other app | Not supported (macOS restricts system-wide now playing) | SMTC if the app supports it |

### B. Combined to-do list

- One list merging every connected source, sorted with unfinished items first.
- **The checkbox is the source icon:** an outline icon means not done, a filled icon means done. Each source has its own icon and color.
- Checking an item writes the change back to the source (two-way sync) where the source allows it.
- Filter chips: All plus one per connected source. Header shows "N left".
- Shows the due date and a source label (for Canvas, the course code).
- Refreshes every 5 minutes and when the window regains focus.

| Source | macOS | Windows | How | Write-back |
|---|---|---|---|---|
| Canvas LMS | ✅ | ✅ | REST API + personal access token (`/api/v1/planner/items`) | ✅ via planner overrides (`marked_complete`) |
| Google Tasks | ✅ | ✅ | Google Tasks API, OAuth (desktop app, loopback redirect + PKCE) | ✅ `status: completed` |
| Apple Reminders | ✅ | ❌ | EventKit through a small Swift helper | ✅ |
| Microsoft To Do (stretch) | ✅ | ✅ | Microsoft Graph | ✅ |
| Todoist (stretch) | ✅ | ✅ | Todoist REST API | ✅ |

Canvas fallback: if personal access tokens are disabled, accept the read-only Canvas calendar feed (iCal) URL instead.

Icons: the mockup uses generic icons (graduation cap = Canvas, bell = Reminders, check circle = Google Tasks). Icons live in `assets/sources/` so they're easy to swap. Don't ship real brand logos in any build that is shared publicly.

### C. Timer

- Modes: Pomodoro (focus/break cycles with a session counter), Countdown, Stopwatch.
- Styles: ring, bar, flip digits. Stretch: sand timer.
- Direction: count down or count up.
- Focus lengths of 25, 45, or 50 minutes or custom. Break lengths of 5, 10, or 15 minutes.
- Controls: start/pause, reset, +5 min.
- Optional chime when time is up and optional auto-start of breaks.
- Timer state survives an app restart.

### D. Shell and display

- Clock and date in the top bar.
- User picks which display the Focus Screen opens on, or "floating window" mode.
- Borderless fullscreen on that display, optional always-on-top, cursor hidden while it rests on the screen.
- Keeps that display awake while running.
- Burn-in protection: the layout shifts a few pixels every few minutes.
- Idle dim: after N minutes with no music and no timer running, dim to clock plus album art.
- Global hotkeys, for example play/pause, next, start/pause timer, lyrics offset, and show/hide.
- Menu bar icon (macOS) or tray icon (Windows) with Show, Customize, Quit.

### E. Customize screen

Theme presets: Sun Devil Night, Maroon & Gold, Daylight, and OLED Dim, plus an accent color. Background options: solid, blurred album art, or the user's own photo.

The screen also covers:
- Widget on/off toggles.
- Timer, music, and display settings.
- To-do source connections (connect, disconnect, and status for each source).

Settings are saved to a local JSON file and applied live.

## Tech stack

- **Electron + TypeScript**, scaffolded with electron-vite (React renderer).
- **Native helpers** as small standalone binaries that print JSON lines to stdout:
  - `native/mac-reminders`: Swift CLI using EventKit.
  - `native/win-media`: C# (.NET) console app using `Windows.Media.Control` (SMTC).
- macOS music control through `osascript` (AppleScript) called from the main process.
- Packaging: electron-builder (`.dmg` for macOS, `.exe`/NSIS installer for Windows).

## Architecture

```
renderer (React UI)  ⇄  preload (typed, minimal bridge)  ⇄  main process
                                                          ├─ services/music   → adapters: mac-applescript, win-smtc, extension-ws
                                                          ├─ services/lyrics  → LRCLIB client + VocaDB fallback + cache + offsets
                                                          ├─ services/todos   → providers: canvas, google, apple-reminders
                                                          ├─ services/timer   → timer state machine (persisted)
                                                          ├─ services/display → window placement, power, idle, burn-in
                                                          └─ services/settings, services/secrets
```

- Every external source sits behind an interface (`MusicAdapter`, `TodoProvider`) so the UI never knows which platform or service it's talking to.
- Each provider has a **mock implementation** so the UI can be built and tested with no accounts connected.

## Privacy and security

- Secrets (Canvas token, Google refresh token) are encrypted with Electron `safeStorage` (macOS Keychain / Windows DPAPI). Never stored in plain text, never logged, never committed.
- Canvas items are the user's own academic data: they stay on this machine and are only ever sent back to Canvas itself.
- Request the minimum scopes (Google Tasks scope only, no Drive or Gmail).
- The only third-party lyrics services that receive anything are LRCLIB, which only gets song title, artist, album, and duration, and VocaDB, which only gets the song title: for lyrics only for songs LRCLIB hasn't got, and for romaji for Japanese songs while that switch is on.
- No analytics or crash reporting that phones home.

## macOS permissions to declare (Info.plist)

- `NSAppleEventsUsageDescription`: to control Spotify and Apple Music.
- `NSRemindersFullAccessUsageDescription` (and the older `NSRemindersUsageDescription`): to read and complete reminders.
- Later, only if AI auto-sync ships: system audio recording permission.

## Milestones

Each milestone ends with something visible and working.

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold + shell | App opens borderless fullscreen on a chosen display, shows clock/date and three empty cards; settings file exists |
| M1 | Timer | All three modes and three styles work; state survives restart |
| M2 | Music (dev machine's platform first) | Shows the current track from Spotify or Apple Music with working controls and a spinning disc |
| M3 | Lyrics | Synced lyrics from LRCLIB with highlighting, plain-lyrics fallback, cache, offset hotkeys |
| M4 | Google Tasks | OAuth connect, list, two-way check-off, outline/filled icons |
| M5 | Canvas | Token connect, planner items with course codes, mark complete |
| M6 | Apple Reminders | Swift helper, macOS only, hidden on Windows |
| M7 | Customize screen | All settings from the mockup, saved and applied live |
| M8 | Polish | Burn-in shift, idle dim, global hotkeys, tray/menu bar icon, packaging |
| M9 | Second platform | Same features working on the other OS (SMTC adapter or AppleScript adapter) |
| Stretch | | YouTube Music extension, tap-sync, AI auto-sync, Microsoft To Do, Todoist, weather, next class |

## Risks and open questions

- **macOS "now playing" for every app is restricted**, so the Mac version supports Spotify and Apple Music directly. Browser players need the extension.
- **Canvas personal access tokens** may be restricted by the school. Fall back to the iCal feed (read-only).
- **Google OAuth** for a personal, unverified app shows a warning screen and limits test users. That's fine for personal use.
- **LRCLIB coverage** varies, especially for YouTube uploads with messy titles. Title cleanup and duration matching help.
- **Primary dev machine:** Mac (macOS). M2 builds the AppleScript adapter first; M9 adds Windows (SMTC).
