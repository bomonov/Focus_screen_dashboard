# Trip planner: the search

Shared by Claude and Codex. Read `AGENTS.md` (and through it `CLAUDE.md`) first, then this, then `HANDOFF.md`.

## Goal

When the user is about to leave somewhere, Focus Screen tells them when to leave and how to get where they're going: which bus or train, where to get on and off, any change, the walks, and when they'll arrive. It's planned on the Mac from Valley Metro's schedule and live feed, so nothing about where they are or where they're going leaves the computer. Your part is the search: given the timetable, a start, an end, a time and the live times, find every journey worth showing. Claude ranks them (up to three), adds the walk-only trip, runs the search in a utility process and draws the card.

## Who owns what

- **Codex:** `src/main/services/trips/raptor.ts`, and any new `src/main/services/trips/raptor*.ts` file other than `raptor.test.ts`.
- **Claude:** everything else, including `raptor.test.ts` (the contract, written first) and `types.ts`.

## Interface

`src/main/services/trips/types.ts` as it is now (don't edit it):

```ts
import type { LatLon } from '../transit/routeLine'

/**
 * Walking is the straight line × WALK_DETOUR (streets aren't straight) at WALK_MPS (a calm
 * pace). They cancel out at today's values, so a straight metre costs a second; they stay
 * separate so either can be tuned alone.
 */
export const WALK_MPS = 1.3
export const WALK_DETOUR = 1.3
/** The first and last walk, straight-line: 20 minutes at our pace, past which a bus is rarely worth it. */
export const ACCESS_MAX_M = 1200
/** Walking between two stops to change, straight-line. */
export const TRANSFER_MAX_M = 400
/** Least time to change at one stop: a bus pulling in a little early mustn't be missed. */
export const MIN_CHANGE_SEC = 60
export const MAX_RIDES = 3
/** How far ahead (or back, arriving) a plan looks. */
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

/** Trips of one route that make the same stops in the same order and never overtake each other. */
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
  /** Unix seconds: when to leave, or when to be there. */
  time: number
  mode: 'depart' | 'arrive'
}

/** What the live feed says about one trip; every array is indexed by pattern position. */
export interface LiveTrip {
  canceled: boolean
  /** Unix seconds; NaN = no prediction. */
  arrival: Float64Array
  /** Unix seconds; NaN = no prediction. */
  departure: Float64Array
  /** 1 where the trip no longer stops. */
  skipped: Uint8Array
}

/** Live trips by trip_id. */
export type LiveTimes = ReadonlyMap<string, LiveTrip>

export type LegEnd = { kind: 'origin' } | { kind: 'destination' } | { kind: 'stop'; stop: number }

export interface WalkLeg {
  kind: 'walk'
  from: LegEnd
  to: LegEnd
  /** Unix seconds. */
  start: number
  end: number
  /** Straight-line metres, which is what walking time is worked out from. */
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
  /** In order; walk legs under 1 m are left out. */
  legs: Leg[]
  /** When to leave the start. */
  depart: number
  arrive: number
}
```

Helpers you may use (Claude's, don't edit): `walkSeconds(straightM)` and `stopsNear(tt, at, maxM)` in `walk.ts`, `serviceDayStart(yyyymmdd)` (Arizona midnight, UTC−7) in `timetable.ts`, `distanceM(a, b)` in `../transit/routeLine.ts`. Tests build timetables with `testTimetable(spec)` (async) and place points with `near(northM, eastM)` from `testTimetable.ts`.

## The contract

`planTrips(tt: Timetable, query: PlanQuery, live: LiveTimes): Journey[]` (the stub's doc comment in `raptor.ts` says the same, shorter):

- **Which journeys.** The journeys of 1 to `MAX_RIDES` rides in the window that no other journey in the window beats (Pareto-optimal on leaving later, arriving earlier and fewer rides).
  - The window: leaving in [`time`, `time + WINDOW_SEC`] in depart mode; arriving in [`time − WINDOW_SEC`, `time`] in arrive mode. Both ends count.
  - One journey beats another when it leaves no earlier, arrives no later and has no more rides, and is better in at least one.
  - Only journeys in the window compete: a journey outside it never removes one inside it (leaving from 09:50, a journey leaving at 10:49 and in at 11:53 stays, though one leaving at 11:00, after the window, gets in at 11:28).
  - Walking otherwise isn't a Pareto criterion. Exact ties (same departure, arrival and rides) keep the journey with less total walking (metres).
  - Journeys equal in all three are returned once, with the walking tie-break above.
  - Every journey has at least one ride. Walking all the way takes no part in the search (it beats nothing and isn't returned); the ranking adds it afterwards.
- **Order.** By `depart`, then `arrive`, then the number of rides.
- **Walks.** The first walk goes straight from `query.from` to the first ride's stop (≤ `ACCESS_MAX_M` straight-line) and ends exactly at that ride's `depart`. The last goes straight from the last ride's stop to `query.to` (≤ `ACCESS_MAX_M`) and starts at its `arrive`. A walk takes `walkSeconds(metres)` of its straight-line metres. A change between two stops is one walk from `tt.transfers` (its `metres`, ≤ `TRANSFER_MAX_M`), starting at the ride's `arrive`. Walks are never chained (two walks of 225 m aren't a change of 450 m), and no walk between stops comes before the first ride or after the last: the only walk before the first ride is the straight one from the start, and the only one after the last ride the straight one to the end. Walk legs under 1 m are left out, so a journey starting at a stop has no first walk.
- **Journey times.** `depart` = the first leg's start (the first ride's `depart` minus the first walk's seconds); `arrive` = the last leg's end.
- **Changes.** At the same stop, the next ride leaves at least `MIN_CHANGE_SEC` after the arrival. Between two stops, at least the walk after it (no extra minute).
- **Service days.** A trip runs on the dates of its service. Its times count from that date's midnight (`serviceDayStart`), so 24:20 on 20261101 is 00:20 on 2 November. The search rides the runs of exactly these service dates: every Arizona day the window touches, and the day before each. (Leaving at 23:50 on 1 Nov, the window runs to 00:50 on the 2nd: 31 Oct, 1 Nov and 2 Nov.)
- **Live.** An entry in `live` belongs to one run of its trip id (a trip id runs on many dates): the run whose timetable times are nearest its predictions, if within 12 h. A trip's runs are whole days apart, so its first prediction decides. After midnight that's often the day before's run (an owl at 24:20 on 1 Nov, predicted at 00:23 on 2 Nov, is the 1st's run 3 min late), not the run of the prediction's own date. An entry 12 h or more from every run belongs to none. An entry with no predictions at all (a cancellation, skips only) belongs to the run whose first departure is nearest `query.time`. Runs an entry doesn't belong to keep their timetable times and aren't live.
  - On its run, a ride takes its departure at the board position and its arrival at the alight position from the feed where they aren't NaN, else the timetable's. `live` is true when the departure came from the feed (a live arrival alone isn't). `scheduledDepart`/`scheduledArrive` are always the timetable's.
  - In both search modes, a ride is refused if its arrival at the alighting position is before its departure from the boarding position. Equality is allowed. This rejects that position pair, not the whole run; other rides on the run can remain valid.
  - Live times can make a pattern's trips overtake each other (a late bus passed by the next); the search must still find the best, leaving and arriving.
  - A canceled run isn't ridden. A skipped position can't be boarded or left at, but is ridden through. A trip the feed doesn't mention is ridden on its timetable times.
- **Leg fields.** `pattern` indexes `tt.patterns`, `trip` its `trips`, `board`/`alight` its positions (`board < alight`; a loop visits a stop more than once, so positions, not stops, say where).

`raptor.test.ts` checks every returned journey against all of this (`planProblems`), then the exact journeys for each scenario.

## Rules

- `AGENTS.md` applies in full.
- No new dependency. No network. Never read the app's userData (`~/Library/Application Support/Focus Screen/`).
- Don't edit `raptor.test.ts` beyond removing its `describe.skip`, nor `types.ts`, nor anything else outside your files. If the contract or a test looks wrong, say so in `HANDOFF.md` with what you'd change, and wait.
- Don't commit; Claude reviews and commits.

## Done

- `npx vitest run src/main/services/trips/raptor.test.ts` passes, with the skip removed.
- `npm run typecheck && npm run lint && npm test` pass.
- A dated entry in `HANDOFF.md`: what you built, its design, how long the speed test's plans take (it doesn't print them; measure), anything you need from Claude.

## Hint

RAPTOR rounds (Delling, Pajor, Werneck 2012, "Round-Based Public Transit Routing"), range over the window's departures (rRAPTOR); only in-window journeys compete, so the first ride can only be one that has you leave the start within the window. Arrive mode is the same backwards, over the window's arrivals. The speed test times one plan each way on a 500-stop grid with 40 patterns of 100 trips and 358 live trips, after one untimed plan (anything worked out once per timetable may be cached against the `Timetable` object, e.g. a `WeakMap`); it allows 200 ms. The real schedule is ~8,000 stops, ~710 patterns and ~19,000 trips, and should plan in under 200 ms too. Describe your design in `HANDOFF.md`.
