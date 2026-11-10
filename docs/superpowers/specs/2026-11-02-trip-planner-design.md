# Trip planner: design

2026-11-02. The user's request: "I want to add a searching route from this app https://transitapp.com and incorporate into this focus screen, so I can have a more universal [way] to know when and what route to take if I'm at the specific point". Asked for the real moment: they're "at my lab, or at the gym, or a library", heading to "home or my next class", and they bring their MacBook everywhere. Later they widened where to: "stores, restaurants, friends' places, anywhere really". Mockups (fragments for the brainstorm server, kept for reference in `design/trip-planner/`): `placement.html` (none picked: the user proposed their own, below), `results.html` (B picked), `pinned.html` (A picked).

## Intent

When the user is about to leave somewhere, Focus Screen tells them when to leave and how to get where they're going next: which bus or train, where to get on and off, any transfer, the walks, and when they'll arrive. Planned on the Mac, from data the app already has, so nothing about where they are or where they're going leaves the computer (one exception, the words typed into a place search, below).

## Goals

- A search bubble at the top right, next to Customize. Clicking it grows a glass search card out of it: "Where to?", the start ("From where you are"), when ("Leave now"), and ready-made destinations (Home, the next class, saved places, recent ones).
- Picking a destination shows the best trip spelled out as timed steps, with two other ways under it.
- "Keep on screen": the search bubble grows into the trip's countdown ("Leave in 6 min · Orbit Venus · home 4:41") and stays until the user leaves.
- Destinations can be anything: Home, saved places, the next class's building, ASU buildings, Valley Metro stops, and any store, restaurant or address through Apple's place search.

## Non-goals

- Turn-by-turn walking directions, a map of the trip, or an "Open in Apple Maps" handoff (not asked for; the route card's map stays the bus's own).
- Driving, biking, scooters, rideshare.
- Fares, accessibility filters, bike racks.
- Trips outside the Phoenix area, or other agencies than Valley Metro.
- ASU's intercampus shuttles, for now (decided 11, below).
- A sound at leave time (decided 12).
- Notifications outside the Focus Screen (macOS banners, phone).
- Changing Next bus: its pill keeps its own picked stops and its "live times only" rule.

## Anti-goals (a failure even if it works)

- Where the user is, Home, saved places, the trip or the destination leaving the Mac. The only thing sent anywhere is the text typed into the search, to Apple, as described under Privacy.
- A scheduled time shown as live, or a trip shown that can't be made (its bus already gone, canceled, or a stop it skips).
- Waiting on the network to show a trip. Planning is local; only Apple's place results arrive a moment later.
- The Transit app's private API or ASU's Peak Transit tracker used, scraped or reverse-engineered in any way (the user ruled this out before; REA, installed on this Mac, is not to be used on them).
- Looping or big motion (the user gets dizzy): the bubble, card and countdown move only as the menus, pills and cards already do.
- Small or low-contrast words: everything reads from about 1 m on a 1080p monitor, on all four themes.

## Decided with the user (2026-11-02)

1. **Source: planned on the Mac.** From Valley Metro's schedule (the zip Next bus already downloads from the City of Phoenix's Open Data portal, once the user says yes in Customize › Next bus), corrected by Valley Metro's live Trip Updates (already read for Next bus). Ruled out, from research on 2026-11-02:
   - **Transit's official API** (`/v4/public/plan`): a key by application, 1,500 calls a month free, its "Powered by Transit" logo required, the exact origin and destination sent to Transit on every plan, and no sign of ASU's shuttles.
   - **Valley Metro's own planner**: no public API.
   - **Self-hosted OpenTripPlanner**: Java 25, several GB of memory, a 290 MB street map download. Too heavy beside the app.
   - **An npm router** (`minotor`, MIT, RAPTOR): possible, but the search is small enough to write here, tailored to Valley Metro's live delays, without a new dependency.
2. **Walks are estimated from distance.** Offered Apple's walking directions for the first and last walks (which would send those points to Apple); the user said "nah, let's just try planning on mac and see how it goes". See call 6 for the estimate.
3. **Built together with Codex** (OpenAI's coding agent, already installed and signed in on this Mac; the user asked for it and pointed at shakacode's "Claude Code with Codex" guide). `AGENTS.md` (committed) points Codex at CLAUDE.md. Codex writes the search itself; Claude writes its tests and everything around it, and checks Codex's work on real trips. They share `collab/trip-planner/` (a brief with who owns which files and the search's interface, and an append-only `HANDOFF.md`), like `lyrics-sync/` with ChatGPT. As played back to the user: Claude runs Codex itself (`codex exec`, in Codex's own worktree on a branch off this one), so the user doesn't pass messages between them, and Claude's tests come first, as the contract the search must pass ("it can't bend tests it didn't write", the guide's spec-first workflow). Claude merges Codex's branch back after checking it.
4. **Home is set with "Use where I am now"**, pressed once while at home. No address is typed or sent anywhere.
5. **Apple's place search for "anywhere"**, approved as a new use of Apple's services and a new helper mode: only the words typed, plus a fixed box around the Phoenix area (the same for everyone, so results are local), go to Apple. Not where the user is, the start, or the trip. The Mac's own matches come first and need nothing sent. A place found this way can be saved under the user's own name for it ("Alex's"), after which it's found on the Mac.
6. **Placement: a search bubble next to Customize, and Customize becomes a bubble too.** The user's own idea, over the three offered (a pill of its own, folded into Next class, a card in the grid): "since this is a search, just make a search icon bubble next to the customize pill, lowkey, make that customize pill turn into an icon bubble". Both are round 44 px buttons (`--hit`) at the top bar's right end, search first: a magnifying glass, and Customize's own sliders icon without its word.
7. **The card shows the best trip spelled out** (results mockup B): "Leave in 6 min" large in the accent, the arrival ("Home 4:41 · 23 min") beside it; then the steps down a line, each with its time: walk to the stop ("Walk 5 min · to Rural Rd & Terrace Rd"), the ride (the route's chip in its own colour from the schedule, "live" or "live, 1 min late" when the feed has it, the way it's headed and how many stops), where to get off, the last walk, the destination. Under a thin rule, two other ways as one line each (their chips, "leave in 11 · home 4:52"); clicking one swaps it in as the spelled-out trip. "Data: Valley Metro via City of Phoenix Open Data" in small dim type at the bottom.
8. **A trip can be kept on screen until the user leaves**, and then **the search bubble grows into its countdown** (pinned mockup A): `[home icon] Leave in 6 min · [Orbit Venus] · home 4:41`, at the top right before the Customize bubble. At leave time the border turns gold and it reads "Leave now" (like Next bus's "Due"). If the first ride goes before the user does, it reads "Missed it · next: leave in 9 min" with the next way's first chip, rather than vanishing. When the trip ends it shrinks back into the magnifying glass.
9. **Played back and not objected to** (the user answered the next question): when it leaves, where from, live or scheduled, the walks and refresh, as calls 1–6 below; and the countdown's end, call 7.
10. **Location accuracy and the monthly refresh**: see calls 7 and 14 (from the builder check, settled as builder's calls).
11. **ASU's shuttles are left out for now** ("leave shuttles out for now", after the builder check). The bundled timetable has no stop positions and no ride times between stops (ASU publishes neither), and the user's daily trips are across Tempe, which the shuttles don't serve. Next bus's Shuttle pill is unchanged. Adding them later means entering the stops' positions and estimating ride times; the search's interface shouldn't rule it out, but nothing is built for it now.
12. **At leave time the countdown just turns gold**, no sound ("just turn gold").

## My calls (played back, 2026-11-02)

1. **When.** Home, saved and searched places plan for leaving now. The next class plans backwards from its start, to arrive a few minutes early (5 by default, Customize › Trips), and the card says when to leave. A switch under the field changes it: Leave now, Leave at…, Arrive by… (a time picker; today and the next six days).
2. **From.** Where the Mac is, by default. Clicking "From where you are" turns the field into the start's search (the same sources, minus "where you are" itself when it's already the start), so tomorrow morning can be planned from Home. The start goes back to "where you are" when the card closes.
3. **Live or scheduled.** A ride whose trip is in the live feed shows its live time and "live" (with "1 min late" or "2 min early" when off by a minute or more); one the feed has canceled, or that skips the stop, isn't used. A trip beyond the feed's reach (it predicts about 30 minutes ahead) shows its timetable time and "scheduled". So does a trip within its reach that the feed doesn't mention (often one that hasn't left its first stop yet): it's used, labelled "scheduled", never "live". (This differs from Next bus on purpose: a pill showing a timetable time would look live, while a planner that dropped those trips would miss real buses at the start of their routes. Flagged as my call, not played back.) The countdown's first ride is the one that matters: "Leave in" counts to its live time when it has one.
4. **(Was: ASU's shuttles as "about" steps with the longest wait. Left out instead: decided 11.)**
5. **Walks.** Straight-line distance × 1.3 for streets, at 1.3 m/s (about 4.7 km/h, a usual walking pace). The first and last walks are at most about 15 minutes (1.2 km straight-line); a walk between stops at a transfer at most 400 m. A trip that's just a walk is a trip too ("Walk 12 min"), and wins when it's quickest; on campus, most trips to class will be this.
6. **Refresh.** While the card is open or a trip is kept on screen, and the Focus Screen can be seen (shown, not dimmed): the countdown ticks in the renderer, and live times are read once a minute (the same feed reads as Next bus, shared, not doubled). Nothing is read while the card is closed with nothing kept, or while the screen can't be seen.
7. **The kept trip ends** when the Mac has moved about 150 m from where it was planned (counted beyond the two fixes' reported accuracy, since the helper asks for about 100 m: so a fix that wobbles doesn't end it; the helper isn't changed) (the user took the MacBook and went), when its arrival time has passed, or when the user closes it (an × on its card). While a trip is kept, where the Mac is is read every 3 minutes while the Focus Screen can be seen, and when the Mac wakes.

## Further calls of mine (not played back; flagged in the hand-over)

8. **Opening the card.** Clicking the bubble, or ⌘F while the Focus Screen has focus. Esc or a click outside closes it. It grows out of the bubble like the card menus (`widgets/cardMenu`) and shrinks back into it; the field has the keyboard as it opens. Clicking or holding the countdown opens the card on the kept trip.
9. **What's listed before typing**, top to bottom: Home (with its "leave in" when it's set, or "Set Home to where you are now" when not), the next class (from the class calendars, with its building, only when Next class is on and the class is at a building in the list), saved places, then up to five recent destinations. Typing filters these and adds ASU buildings (from the list the class map downloads), Valley Metro stations and stops (from the stop list), and, a moment later (after 400 ms without typing, two or more characters), Apple's results under a quiet "From Apple Maps" heading. Each row shows its name and a short second line (a street, "Saved", "Recent", the building code, the stop's routes).
10. **Keep on screen.** A button on the spelled-out trip ("Keep on screen"), not automatic: browsing a few places mustn't pin one. One kept trip at a time; keeping another replaces it.
11. **Saved places, Home and recents** are saved in `userData/trip-places.json`: each a name, a position, an optional second line, and for Home its own field. A found place's row has "Save…" (name it; Home can be replaced from there too). Customize › Trips lists them (rename, delete), Home (set to where I am now, clear), recents (clear), how early to arrive for class, and the credit. Recents keep the last ten destinations picked, never what was typed.
12. **Ranking.** Up to three trips. The candidates are the ways to get there that leave within the next hour (or arrive by the time asked). The best is the earliest arrival; one arriving at most 2 minutes later with fewer rides or less walking beats it. The other two are the next-best by arrival that differ from it (another first ride, or another way altogether), never the same rides leaving later. At most three rides (two transfers) in a trip, at least one minute to change at the same stop, and as much as the walk between two stops.
13. **No trip.** When nothing gets there within the hour (or by the time asked): "No bus or train gets there in the next hour" with the walk's time if it's under 45 minutes, and the next time service starts when the schedule has none until then ("Service starts at 5:12 AM").
14. **The schedule.** The timetable the search reads is made from the same zip, in the same download, as the stop list (which today throws the zip away once the stop list is made). Saving the timetable bumps the stop list's revision, so a schedule saved before is downloaded again once, as before. Without a downloaded schedule, the card says so and offers the same download Customize › Next bus has (the user's yes is the same yes). The monthly refresh runs while Next bus or Trips is on (today only Next bus). Valley Metro's zip has no `calendar.txt`: which trips run on a day comes from `calendar_dates.txt` alone, and the search must handle both.
15. **Where the search runs.** In an Electron utility process (like the dictionary romaji's `worker.ts`), started when the card opens or a trip is kept and stopped after 2 minutes with neither, so the timetable's memory goes back when it's not needed.
16. **Where the Mac is** comes from the helper's location mode, shared with the weather (one helper process while either needs it, not two). Trips ask for a fix when the card opens, when a trip is kept (then as in call 7), and when "Use where I am now" is pressed. Location not allowed: the card says so in plain words, and the start falls back to picking one (as on Windows). Turning trips on (Customize › Trips, off by default like the other top-bar widgets) is what may ask macOS for Location, if the weather hasn't already.
17. **Windows and Linux.** No location and no Apple search: the bubble is there, the start must be picked (Home, a saved place, a stop), and the search lists only the Mac's own matches. The platform checks stay in their factories.
18. **Demo.** A made-up Tempe afternoon: a small timetable on real stops near ASU (Orbit Venus, Route 72, the light rail), the user "at" the Sun Devil Fitness Complex, a demo Home, a demo next class, and a few demo place results. On with `FOCUS_SCREEN_DEMO_TRIPS=1` or Develop › Demo Trips (dev builds only), like the demo buses.

## Privacy (to go into CLAUDE.md's rules with the date)

- Trips are planned on this Mac from Valley Metro's schedule and live feed (already approved hosts). Where the Mac is, the start, the destination, Home, saved places and recents never leave it, and are never logged.
- Apple's place search (MapKit's local search, through the Reminders helper's new place-search mode) gets only the words typed, after a pause in typing, and a fixed box around the Phoenix area that's the same for everyone. Approved by the user on 2026-11-02. Results are parsed as untrusted input.
- Home, saved places (names the user gives them and their positions) and recent destinations are kept in `userData/trip-places.json` only. They're cleared from Customize › Trips.
- Where the Mac is is read for trips only while the card is open or a trip is kept on screen (every 3 minutes while the Focus Screen can be seen, and on wake), and when "Use where I am now" is pressed. It stays in the main process's memory, except Home, which the user saves on purpose.

## Constraints

- CLAUDE.md applies: TypeScript strict, no `any`; IPC channels and payloads only in `src/main/ipc.ts`; the renderer never touches the network or Node; every source behind an interface with a mock; `process.platform` checked in one factory; plain CSS with the theme's variables; buttons at least 44 px; no finite CSS keyframe animations inside cards; comments explain why.
- The helper's place-search mode follows its JSON-lines rules (one object per line, exits when stdin closes; main treats malformed output as no data and restarts it if it exits). It needs no permission (searching doesn't read anything on the Mac).
- Valley Metro's schedule (checked 2026-11-02): a 7.2 MB zip, about 49 MB unzipped: 921,349 stop times, 18,576 trips, 8,101 stops, 112 routes (108 bus, 4 rail), each route with a colour; `calendar_dates.txt` only (91 days, 2026-10-26 to 2027-01-24); `transfers.txt` has 4 rows (Sky Harbor's Sky Train), so walks between stops come from distance. CLAUDE.md's "~13 MB" for the zip is now 7.2 MB.
- GTFS times can pass 24:00:00 (a trip after midnight belongs to the day before); Arizona keeps UTC−7 all year.

## Left to the builder

- The search's algorithm (RAPTOR-style rounds are the expected fit), its interface and the timetable's format on disk, agreed in `collab/trip-planner/brief.md` before Codex starts.
- The helper protocol's message shapes for place search, and whether completions (`MKLocalSearchCompleter`) or full searches serve the typed text best, within the Privacy rule.
- Icons (search, the walk, home, a saved place, recent), spacing within mockup B, the countdown's parts dropping out whole when the row runs short (as the shuttle pill's do).
- Tests for the pure parts: the timetable build (calendar_dates, after-midnight times), the search (transfers, walks, time windows, arrive-by, live delays, canceled and skipped stops, trips the feed doesn't mention), ranking, the 150 m check, the local search's matching and order.

## Done means

- Built with tests for the pure logic; `npm run typecheck`, `npm run lint` and `npm test` pass.
- A demo for offline dev.
- CLAUDE.md updated: Stack (the helper's place-search mode), the Settings paragraph (`trip-places.json`, the timetable file), Layout (`services/trips/`, the widget, `collab/trip-planner/`), the Privacy rule with the date, a Design bullet for the bubbles, card and countdown.
- `graphify update .` run.
- The user has seen it working on the Focus Screen, with a real trip from where they are.
