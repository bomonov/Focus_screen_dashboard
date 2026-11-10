# Trip Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A search bubble at the top right of the Focus Screen that plans a trip from where the Mac is to anywhere in the Phoenix area, on Valley Metro's buses and trains, planned on the Mac, and keeps a picked trip's countdown on screen until the user leaves.

**Architecture:** The schedule download that already makes Next bus's stop list also makes a compact timetable (`transit-timetable.bin`). A RAPTOR search over it (written by Codex against Claude's tests) runs in an Electron utility process, fed the live Trip Updates Next bus already reads. A main-process trip service holds the start, the destination, the plans and the kept trip, and pushes them to the renderer, which draws the bubble, the glass search card (mockup B) and the countdown (mockup A). Destinations come from the Mac (Home, saved places, recents, the next class, buildings, stops) and from Apple's place search through a new `--places` mode of the Reminders helper.

**Tech Stack:** Electron + TypeScript (strict) + React, Vitest, plain CSS, Swift (MapKit `MKLocalSearch`) in `native/mac-reminders`, Codex CLI 0.166.0 (`codex exec`) for the search.

**Spec:** `docs/superpowers/specs/2026-11-02-trip-planner-design.md`

## Global Constraints

- CLAUDE.md is binding: TypeScript strict, no `any` (`unknown` + narrowing); IPC channels and payload types only in `src/main/ipc.ts`; the renderer never touches the network or Node; every source behind an interface with a mock; `process.platform` checked only in factories; plain CSS with theme variables; buttons ≥ 44 px (`--hit`); no finite CSS keyframe animations inside cards; comments explain why; times in seconds internally.
- No new npm dependency, network host or helper mode beyond those approved: Apple's place search (`--places`, approved 2026-11-02) is the only new one.
- Apple's place search gets only the typed text (≥ 2 characters, after 400 ms without typing) and the fixed `PHOENIX_AREA` box. Never a position, the start, the destination or the trip.
- Positions, place names, Home, saved places, recents and search text are never logged (not in `console.*`, not in error messages).
- Walks: straight-line × 1.3 at 1.3 m/s; first/last walk ≤ 1,200 m straight-line; transfer walk between stops ≤ 400 m; ≥ 60 s to change at the same stop; ≤ 3 rides; a 1-hour window.
- Results: up to 3; best = earliest arrival, beaten by one arriving ≤ 2 min later with fewer rides or less walking; the other two differ from it (not the same rides later).
- Live: a ride the feed has shows its live time and "live"; canceled trips and skipped stops aren't used; a trip the feed doesn't mention is used as "scheduled".
- Kept trip ends: moved > 150 m beyond the two fixes' accuracy; arrival passed; closed. At leave time the countdown turns gold ("Leave now"), no sound.
- ASU shuttles are left out. Next bus's own behaviour doesn't change.
- `npm run typecheck`, `npm run lint` and `npm test` pass after every task; commit after every task on `claude/trip-planner`, message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push. Never commit `.impeccable/` or `.superpowers/`.
- Run `graphify query` before reading code broadly; `graphify update .` after code changes.

## Review Focus

1. **Nowhere near a stop** (Home 2 km from any stop, or the destination is): the card shows the walk-only trip when it's ≤ 45 min, else "No bus or train gets there in the next hour", never an empty card. Test in Task 6.
2. **Late at night, service over:** "No bus or train gets there in the next hour · Service starts at 5:12 AM", from the first departure after the window. Test in Task 6.
3. **Location denied, off, or no fix in 45 s when the card opens:** the start says so in plain words and becomes "Pick a start" with Home and saved places, not a spinner forever. Test in Task 11.
4. **No schedule yet, or one saved before the timetable existed:** the card says so and offers the download; an old stop list is downloaded again once. Tests in Tasks 7 and 11.
5. **The places helper missing, failing or sending junk:** the Mac's own matches still show; Apple's heading just doesn't appear. Tests in Task 9.

---

## File Structure

New, `src/main/services/trips/` (Claude unless marked):

- `types.ts`: shared types (timetable, query, journey, place, state, commands) and the constants above.
- `walk.ts`: walking seconds, stops near a point, walk-only journey.
- `timetable.ts`: build a `Timetable` from the schedule zip; `serviceDayStart`.
- `timetableFile.ts`: encode/decode the timetable to one binary file.
- `testTimetable.ts`: a small builder for synthetic timetables, for tests only.
- `raptor.ts`: **Codex**. `planTrips`. (`raptor.test.ts`: Claude, written first.)
- `live.ts`: Trip Updates → `LiveTimes`.
- `rank.ts`: pick up to three; the "no trip" words' data.
- `describe.ts`: a journey with names and colours for the screen.
- `kept.ts`: the kept trip's phase; "moved away".
- `places.ts`: `trip-places.json` (Home, saved, recents).
- `localSearch.ts`: the Mac's own matches.
- `applePlaces.ts` + `placesHelper.ts`: Apple's place search through the helper.
- `messages.ts`, `worker.ts`, `client.ts`, `process.ts`: the search's utility process.
- `service.ts`, `parse.ts`, `mock.ts`: the trip service, command parsing, the demo.

New elsewhere:

- `src/main/services/weather/sharedLocation.ts`: one location helper for weather and trips.
- `native/mac-reminders/Sources/focus-screen-reminders/Places.swift`.
- `src/renderer/hooks/useTrips.ts`; `src/renderer/widgets/trips/` (`TripBubble.tsx`, `TripCard.tsx`, `TripSteps.tsx`, `PlaceRows.tsx`, `tripView.ts`, `Trips.css`); `src/renderer/screens/customize/TripsSection.tsx`.
- `collab/trip-planner/brief.md`, `collab/trip-planner/HANDOFF.md`.

Modified: `transit/stopList.ts` (revision), `transit/valleyMetro.ts` (download returns both), `transit/service.ts` (saves the timetable, shares live reads), `calendar/classMap.ts` (buildings with positions), `weather/location.ts` (accuracy), `settings/schema.ts`, `ipc.ts`, `preload/index.ts`, `index.ts`, `menu.ts`, `native/.../main.swift`, `widgets/TopBar.tsx` + `.css`, `screens/FocusScreen.tsx`, `screens/Customize.tsx`, `CLAUDE.md`.

---

### Task 1: Types, walking and the test timetable

**Files:**

- Create: `src/main/services/trips/types.ts`, `walk.ts`, `walk.test.ts`, `testTimetable.ts`

**Interfaces:**

- Consumes: `LatLon` (`[lat, lon]` tuple) and `distanceM(a, b)` from `transit/routeLine.ts`.
- Produces (in `types.ts`):

```ts
export const WALK_MPS = 1.3
export const WALK_DETOUR = 1.3
export const ACCESS_MAX_M = 1200
export const TRANSFER_MAX_M = 400
export const MIN_CHANGE_SEC = 60
export const MAX_RIDES = 3
export const WINDOW_SEC = 3600

export interface TimetableRoute {
  id: string
  short: string
  long: string
  /** "591769" without "#"; "" when the schedule gives none */
  color: string
  textColor: string
  /** GTFS route_type: 3 bus, 0 light rail/streetcar, 1/2 rail */
  type: number
}
export interface Pattern {
  route: number // index into routes
  direction: number // 0/1, -1 unknown
  headsign: string
  stops: Uint32Array // stop indexes in visiting order (a stop may repeat)
  trips: string[] // trip_ids, by first departure; none overtakes another anywhere
  service: Uint16Array // per trip: index into services
  /** [arrival, departure] per trip per position, seconds after the service day's midnight (may pass 86400): times[(t * stops.length + p) * 2] */
  times: Int32Array
}
export interface Timetable {
  version: string
  stops: { ids: string[]; names: string[]; lat: Float64Array; lon: Float64Array }
  routes: TimetableRoute[]
  patterns: Pattern[]
  /** per service: the yyyymmdd dates it runs, ascending */
  services: Int32Array[]
  /** stop i's walkable neighbours (≤ TRANSFER_MAX_M, not itself): to[start[i] .. start[i+1]) */
  transfers: { start: Uint32Array; to: Uint32Array; metres: Uint16Array }
}
export interface PlanQuery {
  from: LatLon
  to: LatLon
  time: number
  mode: 'depart' | 'arrive'
}
export interface LiveTrip {
  canceled: boolean
  arrival: Float64Array
  departure: Float64Array
  skipped: Uint8Array
}
export type LiveTimes = ReadonlyMap<string, LiveTrip>
export type LegEnd = { kind: 'origin' } | { kind: 'destination' } | { kind: 'stop'; stop: number }
export interface WalkLeg {
  kind: 'walk'
  from: LegEnd
  to: LegEnd
  start: number
  end: number
  metres: number
}
export interface RideLeg {
  kind: 'ride'
  pattern: number
  trip: number
  tripId: string
  board: number
  alight: number // positions in the pattern
  depart: number
  arrive: number // unix s, live where known
  scheduledDepart: number
  scheduledArrive: number
  live: boolean
}
export type Leg = WalkLeg | RideLeg
export interface Journey {
  legs: Leg[]
  depart: number
  arrive: number
}
```

(`LiveTrip` arrays are indexed by pattern position; `NaN` = no prediction. `Journey.depart` is when to leave the start; walk legs under 1 m are left out.)

- Produces (in `walk.ts`): `walkSeconds(straightM: number): number` (round(m × 1.3 / 1.3)); `stopsNear(tt: Timetable, at: LatLon, maxM: number): { stop: number; metres: number }[]` (nearest first); `walkOnly(from: LatLon, to: LatLon, query: PlanQuery): Journey` (one walk leg; depart mode starts at `time`, arrive mode ends at `time`).
- Produces (in `testTimetable.ts`): `near(northM: number, eastM: number): LatLon` (a point that far from 33.4242, −111.9281, Tempe); `testTimetable(spec: TestSpec): Timetable` where `TestSpec = { stops: Record<string, LatLon>; routes: { id: string; trips: { id: string; dates?: number[]; stops: [stop: string, time: string][] }[] }[] }` (times "HH:MM" or "HH:MM:SS", may pass 24:00; `dates` defaults to `[20261102]`; it groups trips into patterns and fills `transfers` with the same rules as Task 2). It builds through Task 2's builder once that exists; in this task it builds directly.

- [ ] **Step 1: Write the failing tests** in `walk.test.ts`: `walkSeconds(1000) === 1000`; `stopsNear` returns only stops within the limit, nearest first; `walkOnly` in depart mode has `depart === time`, `arrive === time + walkSeconds(distance)`, in arrive mode `arrive === time`; `testTimetable` puts two trips with the same stops in one pattern ordered by first departure, and fills `transfers` for two stops 300 m apart but not 500 m apart.
- [ ] **Step 2: Run them:** `npx vitest run src/main/services/trips/walk.test.ts` → FAIL (missing module).
- [ ] **Step 3: Write `types.ts`, `walk.ts`, `testTimetable.ts`.**
- [ ] **Step 4: Run them** → PASS; then `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** "Trips: types, walking, a test timetable".

### Task 2: The timetable from the schedule zip, and its file

**Files:**

- Create: `src/main/services/trips/timetable.ts`, `timetable.test.ts`, `timetableFile.ts`, `timetableFile.test.ts`
- Modify: `src/main/services/trips/testTimetable.ts` (build via `buildTimetable` from a `zipOf` schedule)

**Interfaces:**

- Consumes: `readZipDirectory`, `zipEntryChunks`, `ZipError` (`transit/zip.ts`), `eachCsvRow` (`transit/csv.ts`), `zipOf` (`transit/testFixtures.ts`).
- Produces: `buildTimetable(zip: Uint8Array): Promise<Timetable>` (throws `ZipError` when it isn't a schedule); `serviceDayStart(date: number): number` (Arizona midnight of yyyymmdd in unix s: `Date.UTC(y, m - 1, d) / 1000 + 7 * 3600`); `encodeTimetable(tt: Timetable, downloadedAt: number): Uint8Array`; `decodeTimetable(bytes: Uint8Array): { timetable: Timetable; downloadedAt: number } | null` (null for anything malformed, never throws). File layout: `FSTT1\n`, u32 LE header length, JSON header (strings, routes, pattern metadata, services, array table), then each typed array 8-byte aligned.

- [ ] **Step 1: Write the failing tests** in `timetable.test.ts` with a `zipOf` schedule (routes with `route_color`, trips, stop_times, stops, `calendar_dates.txt`, **no** `calendar.txt`): services come from `calendar_dates` (`exception_type` 1 adds, 2 removes); with a `calendar.txt` too, its weekdays between `start_date`/`end_date` count and `calendar_dates` adjusts them; "25:10:00" becomes 90600; a trip that would overtake another at a middle stop lands in another pattern; two stops 350 m apart are each other's transfer, 450 m apart are not; route colours are kept; `serviceDayStart(20261102) === 1793602800`. In `timetableFile.test.ts`: round trip equals the input (typed arrays compared element-wise); a truncated file, a wrong magic and a header naming arrays past the end all give null.
- [ ] **Step 2: Run them** → FAIL.
- [ ] **Step 3: Implement.** One pass per file; stop_times sorted by trip then `stop_sequence`; patterns keyed by route + direction + headsign + stop list; within a pattern sort trips by first departure and split off any trip whose times at some position aren't ≥ the trip before it.
- [ ] **Step 4: Run them** → PASS. Then a size check (not committed): bundle a scratch script with esbuild (as in the route-card note) that builds the timetable from the real zip at `/private/tmp/claude-501/-Users-kenny-Desktop-focus-screen/ca286563-4907-4ec5-82f3-210199789a0c/scratchpad/gtfs-download/googletransit.zip` and prints build seconds, file bytes and pattern count. Expected: under ~10 s, under ~15 MB. Note the numbers in the commit message.
- [ ] **Step 5: Commit** "Trips: the timetable from Valley Metro's schedule".

### Task 3: The search's contract and the Codex brief

**Files:**

- Create: `src/main/services/trips/raptor.test.ts`, `src/main/services/trips/raptor.ts` (stub: `export function planTrips(): Journey[] { throw new Error('Not built yet') }` with the real signature), `collab/trip-planner/brief.md`, `collab/trip-planner/HANDOFF.md`

**Interfaces:**

- Produces: `planTrips(tt: Timetable, query: PlanQuery, live: LiveTimes): Journey[]`: every journey Pareto-optimal on (later depart, earlier arrive, fewer rides) that leaves in `[time, time + WINDOW_SEC]` (depart mode) or arrives in `[time − WINDOW_SEC, time]` (arrive mode); walk-only isn't its job (Task 6 adds it).

- [ ] **Step 1: Write `raptor.test.ts`** with `testTimetable` and `near`; every scenario asserts exact `depart`/`arrive` and the legs' kinds, patterns and positions:
  - `direct ride`: start 300 m from A, end 200 m from C; trips A 10:00 → C 10:20 and A 10:30 → C 10:50; at 09:50 depart mode → first journey departs 09:55, boards at A 10:00, arrives 10:20 + 200 s; the 10:30 trip appears too (later departure), nothing earlier than 09:50.
  - `same-stop change needs a minute`: R1 reaches B 10:10:00; R2 leaves B 10:10:30 and 10:15 → uses 10:15.
  - `walking change between stops`: B to B′ 300 m → the change takes 300 s; a stop 450 m away isn't used.
  - `first walk limit`: a stop 1,300 m from the start isn't boarded.
  - `service days`: a trip whose dates don't include the day isn't used; a trip at 24:20 on 20261101 is used at 00:20 on Nov 2.
  - `live delay`: a `LiveTrip` with departure at A +120 s → `depart`/`arrive` shift, `live: true`, `scheduledDepart` the timetable's.
  - `canceled and skipped`: a canceled trip isn't used; a trip skipping C can't be left at C.
  - `pareto`: a 1-ride trip arriving 10:40 and a 2-ride trip arriving 10:30 both come back; a 1-ride trip leaving earlier and arriving later than another 1-ride trip doesn't.
  - `arrive by`: deadline 10:45 → the latest-leaving journey arriving by 10:45 is in the result, none arrive after 10:45.
  - `at most three rides`: reachable only with four → `[]`.
  - `window`: a trip leaving 70 min after `time` isn't included.
  - `loop`: board a pattern at its first visit of a stop, leave at a later stop, with the stop appearing twice.
  - `speed`: a synthetic timetable of 500 stops on a grid, 40 patterns × 100 trips, plans in under 200 ms.
- [ ] **Step 2: Run it** → every scenario FAILS on the stub ("Not built yet"); typecheck passes.
- [ ] **Step 3: Write `collab/trip-planner/brief.md`**: the goal (one paragraph from the spec's intent), ownership (Codex: `src/main/services/trips/raptor.ts` and any new `src/main/services/trips/raptor*.ts` other than the test; Claude: everything else, including `raptor.test.ts`), the interface (paste the `types.ts` block above and the `planTrips` contract), the rules (AGENTS.md; no new dependency; don't edit `raptor.test.ts` or `types.ts`, ask in HANDOFF.md instead; no network; never read userData), done = `npx vitest run src/main/services/trips/raptor.test.ts` passes and `npm run typecheck && npm run lint` pass, and "RAPTOR rounds (Delling, Pajor, Werneck 2012), range over the window's departures; note your design in HANDOFF.md". `HANDOFF.md` gets its first dated entry from Claude.
- [ ] **Step 4: Commit** "Trips: the search's tests and the Codex brief" (the stub keeps `npm test` red only for `raptor.test.ts`; mark that file `describe.skip` in this commit and note that Codex removes the skip).

### Task 4: Codex writes the search (runs while Tasks 5–10 go on)

**Files:** Codex: `src/main/services/trips/raptor.ts`; Claude: the merge.

- [ ] **Step 1: Make Codex's worktree:** `git worktree add .claude/worktrees/trip-search-codex -b codex/trip-search claude/trip-planner`, then `npm install` in it.
- [ ] **Step 2: Start Codex in the background** (Bash `run_in_background`), from the trip-planner worktree:

```bash
codex exec -s workspace-write -C .claude/worktrees/trip-search-codex -o /private/tmp/claude-501/-Users-kenny-Desktop-focus-screen/ca286563-4907-4ec5-82f3-210199789a0c/scratchpad/codex-search-last.md "Read AGENTS.md, then collab/trip-planner/brief.md and HANDOFF.md, and do the task in the brief: implement planTrips in src/main/services/trips/raptor.ts so raptor.test.ts passes (remove its describe.skip). Don't commit. Append your HANDOFF.md entry when done."
```

- [ ] **Step 3: When it exits, review:** `git -C .claude/worktrees/trip-search-codex status --short` shows only `raptor.ts` (and `raptor*.ts`), `raptor.test.ts` (the skip removed, nothing else) and `HANDOFF.md`; read the diff in full; run `npm run typecheck && npm run lint && npm test` there. If anything fails or strays from the brief, resume Codex once with the specific problem (`codex exec resume --last …`), else fix it in Claude's own follow-up commit and say so in HANDOFF.md.
- [ ] **Step 4: Commit in Codex's worktree** "Trips: the search (RAPTOR), written by Codex", then merge into `claude/trip-planner` (`git merge --no-ff codex/trip-search`).
- [ ] **Step 5: Check it on the real schedule** with a scratch esbuild script (not committed): from near the Sun Devil Fitness Complex (33.4206, −111.9312) to Tempe Marketplace (33.4307, −111.8995) and to Mesa Riverview (33.4357, −111.8742) at 16:15 on a weekday, printing each trip's legs with stop and route names and the time taken. Expected: plausible routes (Orbit, 72, light rail) and under 200 ms a plan. Note what it printed in HANDOFF.md.

### Task 5: Live times from Trip Updates

**Files:** Create `src/main/services/trips/live.ts`, `live.test.ts`

**Interfaces:**

- Consumes: `FeedTrip` (`transit/gtfsRealtime.ts`: `tripId`, `canceled`, `stops[]` with `stopId`, `stopSequence`, `arrival/departure {time, delay}`, `relationship`).
- Produces: `liveTimes(tt: Timetable, trips: readonly FeedTrip[]): LiveTimes` and `tripIndex(tt: Timetable): Map<string, { pattern: number; trip: number }>` (built once per timetable, cached in a `WeakMap`).

- [ ] **Step 1: Failing tests:** a delay at position 2 carries on to later positions without updates (GTFS-RT's rule) but not earlier ones; an absolute `time` wins over `delay`; `relationship: 'skipped'` sets `skipped`; a canceled trip comes back `canceled: true`; an update for a stop the trip makes twice goes to the visit its `stopSequence` names (the one nearest in order when there's none); unknown trip ids are left out.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS, `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** "Trips: live times from Valley Metro's feed".

### Task 6: Ranking, walk-only and "no trip"

**Files:** Create `src/main/services/trips/rank.ts`, `rank.test.ts`

**Interfaces:**

- Produces: `rankTrips(candidates: readonly Journey[], mode: 'depart' | 'arrive'): Journey[]` (≤ 3); `planAll(tt, query, live, plan = planTrips): Journey[]` = rank of `planTrips` ∪ `walkOnly` (walk-only only when its walk ≤ 45 min); `noTrip(tt: Timetable, query: PlanQuery): { walkSec: number | null; serviceStarts: number | null }` (walk if ≤ 45 min; the first departure from any stop within `ACCESS_MAX_M` of the start after the window, null if none in the next 24 h). "Same rides" = same sequence of (pattern, board, alight).

- [ ] **Step 1: Failing tests:** depart mode: earliest arrival first; one arriving 2 min later with one ride fewer beats it, 3 min later doesn't; one arriving 1 min later with 400 m less walking beats it; the other two never share the best's rides; three at most. Arrive mode: latest departure first. Walk-only wins when quickest; isn't offered past 45 min. **Review Focus 1:** a start 2 km from any stop with the destination 30 min's walk away → just the walk-only trip; 50 min's walk away → `[]` and `noTrip` gives `walkSec: null`. **Review Focus 2:** at 01:30 with the first trip at 05:12 → `noTrip(...).serviceStarts` is 05:12 that day.
- [ ] **Step 2–4:** FAIL → implement (`planTrips` injected so the tests don't need Codex's search) → PASS.
- [ ] **Step 5: Commit** "Trips: ranking, walking trips and no-trip".

### Task 7: The schedule download makes the timetable; live reads are shared

**Files:**

- Modify: `src/main/services/transit/stopList.ts` (`STOP_LIST_REVISION = 4`, doc line "4 the trip planner's timetable"), `transit/valleyMetro.ts`, `transit/service.ts`, `transit/service.test.ts`, `src/main/index.ts` (the option's new name)

**Interfaces:**

- Produces: `downloadSchedule(fetchJson, fetchBinary, now): Promise<{ stopList: StopList; timetable: Timetable }>` (replaces `downloadStopList`; both from one zip). `TransitServiceOptions.downloadSchedule` replaces `downloadStopList`. The service writes `transit-timetable.bin` (`encodeTimetable`) beside `transit-stops.json`, deletes it in `remove()`, and gains:
  - `timetablePath(): string | null` (null when not saved),
  - `wantLive(on: boolean): void` (trips' reason to read the feed: reads while `(active() || wanted) && visible`, where today's `active()` needs picked stops),
  - `liveTrips(): { trips: FeedTrip[]; updatedAt: number | null }`,
  - `onLive(listener: () => void): () => void` (after each read),
  - `setTripsOn(on: boolean): void` (the monthly refresh runs while Next bus or Trips is on).

- [ ] **Step 1: Failing tests** in `service.test.ts`: a download saves both files; `remove()` deletes both; a saved stop list with revision 3 is downloaded again once even with Next bus off when Trips is on; with no picked stops and `wantLive(true)` + visible the feed is read once a minute and `onLive` fires, and stops when `wantLive(false)`; Next bus's own pill state is unchanged by `wantLive` (the same `arrivals`). **Review Focus 4** (service half): `timetablePath()` is null for a revision-3 list.
- [ ] **Step 2–4:** FAIL → implement → PASS; update `index.ts` to pass `downloadSchedule`.
- [ ] **Step 5: Commit** "Next bus: the schedule download makes the trip timetable too".

### Task 8: The search's process

**Files:** Create `src/main/services/trips/messages.ts`, `worker.ts`, `client.ts`, `client.test.ts`, `process.ts`, `describe.ts`, `describe.test.ts`

**Interfaces:**

- `describe.ts` produces the screen's trip (all strings and unix seconds, no indexes):

```ts
export interface TripStep {
  kind: 'walk'
  start: number
  end: number
  minutes: number
  toName: string | null
}
export interface TripRide {
  kind: 'ride'
  routeName: string
  short: string
  color: string
  textColor: string
  rail: boolean
  headsign: string
  fromName: string
  toName: string
  depart: number
  arrive: number
  stops: number
  live: boolean
  delayMin: number | null
}
export interface TripPlan {
  leave: number
  arrive: number
  steps: (TripStep | TripRide)[]
  rides: number
  walkM: number
}
export function describeJourney(tt: Timetable, j: Journey): TripPlan
```

(`routeName` via `routeName()` from `transit/stopList.ts`; `delayMin` rounds to whole minutes, null when 0 or not live; `toName` null for the destination.)

- `messages.ts`: `PlanRequest = { kind: 'plan'; id: number; query: PlanQuery; feed: FeedTrip[] }`, `PlanReply = { kind: 'planned'; id: number; plans: TripPlan[]; noTrip: { walkSec: number | null; serviceStarts: number | null } | null } | { kind: 'failed'; id: number }`.
- `worker.ts`: reads the timetable path from `process.argv[2]` (decode once), answers `plan` with `planAll` + `describeJourney`.
- `client.ts`: `export interface TripPlanner { plan(query: PlanQuery, feed: FeedTrip[]): Promise<PlanReply | null>; dispose(): void }` and `createTripPlanner({ start(): PlannerProcess; idleMs?: number; timeoutMs?: number }): TripPlanner` (idle 120 s, timeout 10 s; replies parsed as untrusted; `PlannerProcess` shaped like romaji's `MakerProcess`). `process.ts`: `forkPlanner(modulePath: string, timetablePath: string): PlannerProcess`.

- [ ] **Step 1: Failing tests:** `describe.test.ts` (names, colours, minutes, "rail" for route_type 0/1/2, `delayMin`); `client.test.ts` with a fake process: starts on first plan, reuses it, stops after idle, restarts after exit, a malformed reply or a timeout resolves null, replies to an old id are dropped.
- [ ] **Step 2–4:** FAIL → implement → PASS. In `index.ts` import the worker as `import tripWorkerPath from './services/trips/worker?modulePath'` (as romaji does); check `npm run build` puts it under `out/main`.
- [ ] **Step 5: Commit** "Trips: the search in a process of its own".

### Task 9: Places: saved, local search, Apple's search

**Files:**

- Create: `src/main/services/trips/places.ts`, `places.test.ts`, `localSearch.ts`, `localSearch.test.ts`, `applePlaces.ts`, `applePlaces.test.ts`, `placesHelper.ts`, `native/mac-reminders/Sources/focus-screen-reminders/Places.swift`
- Modify: `native/mac-reminders/Sources/focus-screen-reminders/main.swift` (dispatch `--places` before `runAsOwnProcessIfPossible()`; header comment), `src/main/services/calendar/classMap.ts` (+ test)

**Interfaces:**

- `types.ts` gains: `Place = { id: string; kind: 'home' | 'saved' | 'recent' | 'class' | 'building' | 'stop' | 'apple'; name: string; detail: string; lat: number; lon: number }` and `PHOENIX_AREA = { south: 33.1, west: -112.7, north: 33.9, east: -111.5 }`.
- `places.ts`: `openPlaces(path: string): PlacesStore` with `read(): { home: Place | null; saved: Place[]; recents: Place[] }`, `setHome(at: LatLon)`, `clearHome()`, `save(place: Place, name: string): Place`, `rename(id, name)`, `remove(id)`, `addRecent(place)` (front, deduped by id or ≤ 25 m, keep 10), `clearRecents()`. Malformed file → empty; names ≤ 60 chars.
- `classMap.ts` gains `buildings(): Promise<{ key: string; code: string | null; name: string; lat: number; lon: number }[]>` (the school's list: ASU's table or the school's OpenStreetMap map) and `position(location: string): Promise<{ name: string; code: string | null; room: string | null; lat: number; lon: number } | null>` (the same exact-match rules as `place()`).
- `localSearch.ts`: `searchLocal(text: string, sources: { home: Place | null; saved: Place[]; recents: Place[]; nextClass: Place | null; buildings: Place[]; stops: Place[] }): Place[]` (word-start match, case and accents ignored; order: home, next class, saved, recents, buildings by code then name, stops; at most 12).
- `applePlaces.ts`: `export interface ApplePlaces { search(text: string): Promise<Place[]>; stop(): void }` and `createApplePlaces(start: StartHelper): ApplePlaces`, sending exactly `{ op: 'search', text, box: PHOENIX_AREA }` (text trimmed, ≤ 100 chars); replies `{ ok: true, results: [{ name, detail, lat, lon }] }` parsed as untrusted (≤ 8 kept, positions inside the box only); anything else → `[]`. `placesHelper.ts`: `placesHelper(path): StartHelper | null` (args `['--places']`, like `locationHelper`).
- `Places.swift`: `runPlaces()` reads JSON lines; `search` → `MKLocalSearch.Request` with `naturalLanguageQuery`, `region` from `box`, `resultTypes = [.pointOfInterest, .address]`; replies with name, a short detail (thoroughfare, locality), coordinate; errors → `{"ok":false,"error":"failed"}`; never logs the text. Exits when stdin closes.

- [ ] **Step 1: Failing tests:** `places.test.ts` (round trip, recents dedupe and cap, bad file → empty); `localSearch.test.ts` ("coor" finds COOR first, "rural" finds the stop "Rural Rd & Terrace Rd", "home" finds Home, order as above); `applePlaces.test.ts` (the request carries only `op`, `text`, `box`; **Review Focus 5:** a reply with junk entries keeps the good ones, a non-JSON line, a helper that exits, or a 10 s silence give `[]`); `classMap.test.ts` (`position('Tempe - COOR195')` gives COOR's position, unknown gives null).
- [ ] **Step 2–4:** FAIL → implement → PASS. Then `npm run build:reminders` and a manual check: `printf '{"id":1,"op":"search","text":"Tempe Marketplace","box":{"south":33.1,"west":-112.7,"north":33.9,"east":-111.5}}\n' | ~/Library/Developer/FocusScreen/'Focus Screen Reminders.app'/Contents/MacOS/focus-screen-reminders --places` prints a reply with Tempe Marketplace near 33.43, −111.90.
- [ ] **Step 5: Commit** "Trips: places, local search and Apple's place search".

### Task 10: One location helper for weather and trips; the kept trip's rules

**Files:**

- Create: `src/main/services/weather/sharedLocation.ts`, `sharedLocation.test.ts`, `src/main/services/trips/kept.ts`, `kept.test.ts`
- Modify: `src/main/services/weather/location.ts` (+ test: `LocateResult` ok gains `accuracyM: number`, default 100 when missing), `src/main/index.ts` (weather's `startLocation` from the shared one)

**Interfaces:**

- `sharedLocation(start: () => LocationSource): () => LocationSource`: each call returns a handle on one underlying source (started on the first handle, stopped when the last handle's `stop()` runs); `onAccess` listeners are per handle.
- `kept.ts`: `keptPhase(plan: TripPlan, now: number): { kind: 'leaveIn'; minutes: number } | { kind: 'leaveNow' } | { kind: 'missed' } | { kind: 'over' }` (leaveIn while `floor((leave − now) / 60) ≥ 1`; leaveNow until the first ride departs (a walk-only trip: until `arrive`); missed after the first ride departs; over after `arrive`); `movedAway(from: { at: LatLon; accuracyM: number }, to: same): boolean` (distance > 150 + both accuracies).

- [ ] **Step 1: Failing tests:** two handles share one start; the source stops only after both stop; `keptPhase` at leave − 6 min 30 s → leaveIn 6, at leave − 30 s → leaveNow, after the first ride's depart → missed, after arrive → over; `movedAway` false at 200 m with 100 m accuracies, true at 400 m.
- [ ] **Step 2–4:** FAIL → implement → PASS; weather's service tests still pass unchanged.
- [ ] **Step 5: Commit** "Trips: shared location and the kept trip's rules".

### Task 11: The trip service

**Files:** Create `src/main/services/trips/service.ts`, `service.test.ts`, `parse.ts`, `parse.test.ts`, `mock.ts`

**Interfaces:**

- `types.ts` gains:

```ts
export type TripWhen = { kind: 'now' } | { kind: 'depart' | 'arrive'; time: number }
export type TripFrom = { kind: 'here' } | { kind: 'place'; place: Place }
export interface TripState {
  supported: { location: boolean; appleSearch: boolean }
  schedule: 'ready' | 'missing' | 'downloading'
  /** null while nobody needs where the Mac is */
  here: {
    status: 'locating' | 'found' | 'denied' | 'servicesOff' | 'failed'
    name: string | null
  } | null
  from: TripFrom
  to: Place | null
  when: TripWhen
  plans: TripPlan[] | null // null: nothing asked yet, or planning
  noTrip: { walkSec: number | null; serviceStarts: number | null } | null
  planning: boolean
  kept: { to: Place; plan: TripPlan; missed: boolean } | null
  home: Place | null
  saved: Place[]
  recents: Place[]
  nextClass: (Place & { title: string; start: number }) | null
  arriveEarlyMin: number
  demo: boolean
}
export type TripCommand =
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'plan'; to: Place; from: TripFrom; when: TripWhen }
  | { kind: 'keep'; index: number }
  | { kind: 'unkeep' }
  | { kind: 'setHomeHere' }
  | { kind: 'clearHome' }
  | { kind: 'save'; place: Place; name: string }
  | { kind: 'rename'; id: string; name: string }
  | { kind: 'remove'; id: string }
  | { kind: 'clearRecents' }
  | { kind: 'downloadSchedule' }
  | { kind: 'requestAccess' }
  | { kind: 'openLocationSettings' }
```

- `service.ts`: `createTripService(options: { settings; transit: Pick<TransitService, 'timetablePath' | 'wantLive' | 'liveTrips' | 'onLive' | 'download' | 'get' | 'search'>; planner: (timetablePath: string) => TripPlanner; location: (() => LocationSource) | null; places: PlacesStore; apple: (() => ApplePlaces) | null; classes: { next(): Promise<(Place & { title: string; start: number }) | null> }; buildings(): Promise<Place[]>; demo: TripsDemo | null; now?: () => number })` → `{ get(); subscribe(l); command(c: TripCommand); searchLocal(text: string): Promise<Place[]>; searchApple(text: string): Promise<Place[]>; setVisible(v: boolean); refresh(); hasDemo; isDemoEnabled(); setDemoEnabled(on); dispose() }`. Rules: `open` asks for a fix (or a fresh one older than 60 s) and `wantLive(true)`; `close` with nothing kept → `wantLive(false)`, location released, `from` back to here; a class destination plans `arrive` at `start − arriveEarlyMin × 60`; a plan replans on each `onLive` while open or kept; `keep` stores `plans[index]` with the fix it was planned from; while kept and visible: a fix every 180 s and on `refresh()` (wake), `movedAway` → kept null; `keptPhase` over → kept null; missed → replan the same trip from the current start and keep the new best with `missed: true`; `addRecent` on each plan of a non-recent place; nothing logs positions or names.
- `parse.ts`: `parseTripCommand(raw: unknown): TripCommand | null` (places re-checked: strings ≤ 200 chars, finite positions in range).
- Without a location source (Windows, or the helper isn't built), `from` starts as Home when it's set, else `{ kind: 'here' }` with `here.status: 'failed'` so the card shows "Pick a start".
- `mock.ts`: `export interface TripsDemo { planner: TripPlanner; location: () => LocationSource; apple: () => ApplePlaces; home: Place; nextClass: Place & { title: string; start: number } }` (the demo's planner runs `planAll` in-process on its own timetable, so no file or process is needed) and `demoTrips(now: () => number): TripsDemo`, with a demo timetable made by `testTimetable` on real stop names near ASU (Orbit Venus via Rural Rd & Terrace Rd, Route 72, the light rail at Veterans Way/College Ave), the Mac at the Sun Devil Fitness Complex (33.4206, −111.9312), Home near Apache Blvd & McClintock Dr, a next class at BYENG, and Apple results for "trader", "target", "chipotle".

- [ ] **Step 1: Failing tests** (fake timers, fake planner/location/places/transit): opening asks once for a fix and turns live reads on, closing turns them off; a class destination is planned arrive-by start − 5 min; a live read replans while open, not while closed with nothing kept; keep → kept set; a fix 400 m away → kept cleared; arrival passed → cleared; missed → replanned with `missed: true`; **Review Focus 3:** a `denied` or `failed` fix sets `here.status` and leaves `plans` null with `from` still `here` (the card offers picking); **Review Focus 4:** no timetable → `schedule: 'missing'`, `downloadSchedule` calls `transit.download()`; `searchApple` with text under 2 characters doesn't call the helper; `parse.test.ts` rejects bad shapes.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** "Trips: the trip service and its demo".

### Task 12: Settings, IPC and wiring

**Files:** Modify `src/main/services/settings/schema.ts` (+ test), `src/main/ipc.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/menu.ts`

**Interfaces:**

- Settings: `widgets.trips: boolean` (default false); `trips: { arriveEarlyMin: number }` (default 5, 0–30, whole minutes), with `TripSettings`, `defaultTripSettings()`, `parseTripSettings`, `SettingsPatch.trips`.
- IPC (in `IpcChannel`): `tripsGet: 'trips:get'` (invoke → `TripState`), `tripsChanged: 'trips:changed'` (event), `tripsCommand: 'trips:command'` (send `TripCommand`), `tripsSearch: 'trips:search'` (invoke `[string]` → `Place[]`), `tripsSearchApple: 'trips:search-apple'` (invoke `[string]` → `Place[]`, the string sliced to 100). `FocusScreenApi`: `getTrips()`, `onTripsChanged(l)`, `sendTripCommand(c)`, `searchPlaces(text)`, `searchApplePlaces(text)`.
- `index.ts`: the shared location (Task 10), `placesHelper(remindersHelperPath)` on macOS, the planner from `forkPlanner(tripWorkerPath, path)`, `classes.next()` from the calendar's next event with `classMap.position`, `setVisible` with weather's, `refresh` on wake, `dispose`; `FOCUS_SCREEN_DEMO_TRIPS=1`; `openPrivacyPane('Privacy_LocationServices', 'trips')` for `openLocationSettings`. `menu.ts`: `demoTrips` like `demoWeather` ("Demo Trips").

- [ ] **Step 1: Failing test** in `schema.test.ts`: defaults (`widgets.trips` false, `arriveEarlyMin` 5) and clamping (−3 → 0, 45 → 30, "x" → 5).
- [ ] **Step 2–4:** FAIL → implement → PASS; `npm run typecheck` checks the IPC types end to end.
- [ ] **Step 5: Commit** "Trips: settings, IPC and wiring".

### Task 13: The bubbles and the countdown

**Files:**

- Create: `src/renderer/hooks/useTrips.ts`, `src/renderer/widgets/trips/tripView.ts`, `tripView.test.ts`, `TripBubble.tsx`, `Trips.css`
- Modify: `src/renderer/widgets/TopBar.tsx` (a `trips: React.ReactNode` prop rendered in `top-bar__actions` before Customize; Customize becomes an icon bubble: the same sliders SVG, `aria-label="Customize"`, `title="Customize"`, no word), `TopBar.css` (round 44 px bubbles at `--hit`), `src/renderer/screens/FocusScreen.tsx` (renders `<TripBubble />` when `widgets.trips` and not editing; ⌘F opens the card)

**Interfaces:**

- `useTrips(): TripState | null` (like `useWeather`).
- `tripView.ts`: `leaveWords(plan: TripPlan, now: number): string` ("Leave in 6 min", "Leave now"); `countdownParts(kept: TripState['kept'], now: number): { lead: string; chip: { text: string; color: string; textColor: string } | null; tail: string; due: boolean } | null` ("Leave in 6 min" · chip · "home 4:41"; due → gold; missed → lead "Missed it", tail "next: leave in 9 min"; over → null); `chipColors(color: string, textColor: string): { bg: string; fg: string }` (the route's own colours, `#`-prefixed, falling back to `--surface-raised`/`--text` when empty).
- `TripBubble.tsx`: the magnifying glass bubble; with a kept trip, the countdown pill in its place (FLIP on width like `pillMorph.ts`), gold border when `due`; click or hold opens the card (Task 14) on the kept trip.

- [ ] **Step 1: Failing tests** in `tripView.test.ts`: the words at 6 min 30 s, 30 s, after depart (missed), after arrive (null); the destination tail uses the place's name in lower case for Home ("home 4:41") and its own name otherwise ("Trader Joe's 4:52"); chip colours fall back.
- [ ] **Step 2–4:** FAIL → implement → PASS. Look at it under `npm run dev` in a throwaway copy with a temporary userData and `FOCUS_SCREEN_DEMO_TRIPS=1` (never quit the installed app without asking); screenshot both bubbles and a kept trip's countdown.
- [ ] **Step 5: Commit** "Trips: the search and Customize bubbles, and the countdown".

### Task 14: The search card

**Files:** Create `src/renderer/widgets/trips/TripCard.tsx`, `TripSteps.tsx`, `PlaceRows.tsx` (+ CSS in `Trips.css`); modify `TripBubble.tsx`

**Interfaces:**

- Consumes: `PeekCard` (`widgets/peek/PeekCard.tsx`, `from` = the bubble's box, `keyboard`, `focus` = the field), `useTrips`, `window.focusScreen.searchPlaces` / `searchApplePlaces` / `sendTripCommand`.
- `TripCard`: the field ("Where to?"), "From where you are · {name}" (click → the start's search), "Leave now" (click → Leave now / Leave at… / Arrive by…: a time and day picker, today + 6 days); before typing, `PlaceRows` with Home ("Set Home to where you are now" when unset), the next class, saved, recents; typing → `searchPlaces` at once, `searchApplePlaces` after 400 ms without typing and ≥ 2 characters, under "From Apple Maps"; a row's "Save…" names it. Picking → `plan`; the result is mockup B: "Leave in 6 min" large in `--accent-text`, "Home 4:41 · 23 min", `TripSteps` (times on the left, a line with dots, walk steps dotted grey, ride steps the route's chip + "live" / "live, 1 min late" / "scheduled", "toward {headsign} · {n} stops", "Get off at …"), two others as one line each (click swaps), "Keep on screen" (sends `keep`), "Data: Valley Metro via City of Phoenix Open Data". States: `schedule: 'missing'` → the download offer; `here.status` denied/servicesOff → "Turn on Location to plan from here" + a button (`requestAccess` / `openLocationSettings`) and the start becomes "Pick a start"; `noTrip` → its words ("No bus or train gets there in the next hour", "Walk 38 min", "Service starts at 5:12 AM"); `planning` → the last plans dimmed, never a blank card. Esc closes; `open`/`close` commands sent as it opens and closes.

- [ ] **Step 1:** Build it against the demo (`FOCUS_SCREEN_DEMO_TRIPS=1` in the throwaway copy); check every state above by sending commands from the demo.
- [ ] **Step 2:** Check readability from ~1 m on all four themes (screenshots), contrast of chips and dim text (≥ 4.5:1 words, 3:1 icons), keyboard: Tab order field → rows → trip → others → Keep, Enter picks, Esc closes.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test`.
- [ ] **Step 4: Commit** "Trips: the search card".

### Task 15: Customize › Trips

**Files:** Create `src/renderer/screens/customize/TripsSection.tsx`; modify `src/renderer/screens/Customize.tsx` (section `{ id: 'trips', label: 'Trips' }` after Weather)

- [ ] **Step 1:** The section: the on switch (`widgets.trips`; turning it on may ask for Location, worded so), Home (where it is by name or "Not set", "Set to where I am now", "Clear"), saved places (rename inline, delete), "Clear recent places", "Arrive early for class" (0–30 min stepper), the schedule's state (shared with Next bus: "Uses Valley Metro's schedule from Next bus" + the download button when missing), the privacy line ("Trips are planned on this Mac. Only what you type into the search goes to Apple Maps, never where you are.") and the credit.
- [ ] **Step 2:** Check it in the throwaway copy; `npm run typecheck && npm run lint && npm test`.
- [ ] **Step 3: Commit** "Trips: Customize section".

### Task 16: Documentation, graph and the user's check

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1:** CLAUDE.md: Stack (the helper's `--places` mode, approved 2026-11-02; the search's utility process; built with Codex), the Settings paragraph (`trip-places.json`, `transit-timetable.bin`; the zip is now ~7 MB), Layout (`services/trips/`, `widgets/trips/`, `collab/trip-planner/`, `AGENTS.md`), Privacy (the spec's Privacy section, with the date), a Design bullet (bubbles, card, countdown, from the spec), the checklist ("Stretch: Trip planner").
- [ ] **Step 2:** `graphify update .`; `npm run typecheck && npm run lint && npm test` (report the count).
- [ ] **Step 3:** Ask the user to look: the throwaway copy with their real location and schedule (with their OK), a real trip from where they are to Home or a place they pick; screenshots into `design/trip-planner/preview.png`.
- [ ] **Step 4: Commit** "Trips: CLAUDE.md, preview". Then ask the user whether to merge into main and install; do neither without their word.
