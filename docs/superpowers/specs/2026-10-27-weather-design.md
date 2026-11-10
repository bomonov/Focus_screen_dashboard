# Weather in the top bar: design

2026-10-27. The user's request: "I want to add weather now, something to show current location". Asked what they'd be doing when they glance at it: "no need, just wanna see how the weather like is nice". So it's ambient: look up, see what it's like outside where the computer is. Nothing is decided by it. Mockups (fragments for the brainstorm server, kept for reference): `design/weather/placement.html` (A picked), `pill-words.html` (A picked), `hold-card.html` (B picked).

History: on 2026-10-15 the user picked Weather from the brief's stretch list with Open-Meteo, and it was dropped for the time being. Nothing was built.

## Goals

- A weather pill at the end of the top bar's pill row: an icon, the temperature and the place ("☀ 98° · Tempe"), for wherever the Mac is now.
- Holding it opens a glass card with today: what it's like in words, feels like, today's high and low, and the next six hours.
- Only a rounded position leaves the computer, and only while the pill can be seen.

## Non-goals

- More than today: no multi-day forecast (mockup C was offered and not picked), no alerts, radar, rain chance, wind, UV or air quality.
- A typed-in city, IP lookup, or weather on Windows (M9 is paused; the pill hides there).
- Saving the weather, the position or the place name to disk.
- Animated weather icons.

## Anti-goals (a failure even if it works)

- macOS asking for Location without the user having turned weather on.
- The precise position, or the place name, written to a log, settings or any file, or sent anywhere but as described under Privacy.
- The weather pill crowding the Next class or Next bus pill: when the row runs short, the weather pill gives way first.
- Looping or big motion (the user gets dizzy from it): the pill and card move only as the other pills and cards already do.
- Small or low-contrast words or icons: everything reads from about 1 m on a 1080p monitor, on all four themes.

## Decided with the user (2026-10-27)

1. **Source: Open-Meteo** (`https://api.open-meteo.com`), approved as a new third-party host. Free for non-commercial use, no key, data under CC BY 4.0. The credit "Weather: Open-Meteo" goes in the hold card and in Customize › Weather. Its terms (checked 2026-10-27) say its web server logs, which can hold coordinates, are kept 90 days and not shared. Apple's WeatherKit was ruled out: it needs a paid developer account.
2. **Location: the Mac's Location Services**, through a new mode of the Reminders helper (`native/mac-reminders`), approved as a native helper change. It runs disclaimed as its own app like calendar mode, so the macOS prompt names "Focus Screen Reminders". IP lookup (another company gets the IP, often a city off) and a typed city (doesn't follow the user between home and campus) were ruled out.
3. **Place name: macOS's own reverse lookup**, which sends the position to Apple, only after the Mac has moved about a kilometre from where the name was last looked up. The class map already sends a building's position to Apple Maps. (Builder's note: `CLGeocoder` is deprecated on current macOS in favour of MapKit's `MKReverseGeocodingRequest`; either is fine, both go to Apple. It's given the same rounded position Open-Meteo gets, so only a rounded position ever leaves the Mac.)
4. **Placement: its own pill after Next bus** (placement mockup A). Same height (`--hit`), border, card fill and type as the other pills, and part of the `PillRow` hold morph.
5. **Pill words: icon, temperature, place** (pill-words mockup A): `[icon] 98° · Tempe`. The temperature is bold, the place secondary after a dim `·`, like the other pills' parts.
6. **Hold card: today** (hold-card mockup B). A large icon and temperature; beside them the condition in words ("Sunny") over "Feels like 101°" and "High 101° · Low 74°"; under a thin rule, the next six hours as columns (hour, icon, temperature); "Weather: Open-Meteo" in small dim type at the bottom. It's the same glass `PeekCard` the class map and bus route use, grown out of the stretched pill while the others shrink to icon bubbles.
7. **Behaviour as played back and approved** ("all good, go ahead"): items 1–8 under "My calls".

## My calls (played back to the user and approved, 2026-10-27)

1. **Off until turned on.** `widgets.weather` defaults to false, like Next class and Next bus. It's turned on in a new Customize sidebar section, **Weather**, placed after Next bus. Turning it on is what starts the location helper and so the macOS prompt; turning it off stops the helper and all requests, and forgets the last reading and place.
2. **Units.** °F by default, with a °F / °C choice in Customize › Weather (`weather.unit: 'f' | 'c'`). Temperatures are kept in °C everywhere in main and converted at display, like times kept in seconds, so switching units needs no new request. Shown as whole degrees.
3. **How often.** One reading every 15 minutes, only while the pill can be seen: the Focus Screen shown and not dimmed (the same `setVisible` signal Next bus gets). Becoming visible with no reading, or one older than 15 minutes, reads at once. Each reading asks the helper for the position first.
4. **What's sent, and when the place is looked up.** See Privacy.
5. **Failures.** A failed read is tried again after 1, 2 and 5 minutes, then every 15. The last good reading stays on the pill for up to 60 minutes from when it was read; after that the pill shows "Weather unavailable" (dim, the setup style), and clicking it reads again at once (at most every 10 s, as Next bus's "No live bus times" does).
6. **Location off.** The pill and Customize › Weather say what's wrong in plain words:
   - not asked yet → Customize asks as weather is turned on (the pill, if it's ever shown in this state, says "Allow Location for weather");
   - denied or restricted for the app → "Turn on Location for weather", and Customize has a button that opens System Settings › Privacy & Security › Location Services;
   - Location Services off for the whole Mac → the same, worded for it;
   - no position yet (e.g. no Wi-Fi to locate by) → the pill waits, then follows the failure rules above.
   Clicking the pill in these states does the fix itself: it asks macOS (not asked yet) or opens that page of System Settings. (Changed while planning: the app has no way to open Customize at a given section, and this is one click shorter.)
7. **The prompt's name.** macOS will say "Focus Screen Reminders" wants the location, because that's the helper's app name; calendar access already works this way. The usage text says why: "Focus Screen shows the weather where you are. Only a rounded position goes to the weather service."
8. **Windows and Linux.** No location source, so the weather pill and its Customize section hide (the platform check stays in one factory). **Demo:** a mock source with a realistic Tempe day, on with `FOCUS_SCREEN_DEMO_WEATHER=1` or Develop › Demo Weather (dev builds only), like the demo buses.

## Further calls of mine (not played back; flagged in the hand-over)

9. **Icons.** Simple drawn line icons in the app's style (24-unit SVG, round caps), one per kind: clear (sun by day, moon by night), partly cloudy (sun or moon behind a cloud), cloudy, fog, drizzle and rain, snow, thunderstorm. Each kind has its own colour (sun gold, moon pale, cloud grey, rain blue, storm violet, snow white-blue), fitted per theme to at least 3:1 on the card, as `--accent-text` is fitted for words (`fitContrast` in `theme/color.ts`). Day or night comes from Open-Meteo's `is_day`, per hour for the hourly columns.
10. **Words.** The condition comes from Open-Meteo's WMO weather code, in short sentence-case words: Sunny (clear by day) / Clear (by night), Mostly clear, Partly cloudy, Cloudy, Fog, Light drizzle, Drizzle, Light rain, Rain, Heavy rain, Freezing rain, Light snow, Snow, Heavy snow, Rain showers, Snow showers, Thunderstorm, Thunderstorm with hail. An unknown code shows no words and the cloud icon.
11. **The six hours** are the next six whole hours after now (at 2:45 PM: 3 PM to 8 PM), labelled in the clock's own 12- or 24-hour format. High and low are today's in the place's own time zone.
12. **When the row runs short,** the weather pill drops its place first (as the shuttle pill drops its later parts whole), keeping icon and temperature; its stretched form while held always shows the place.
13. **The bubble** (while another pill's card is open) shows the current weather icon.
14. **Keyboard and focus** work as for the other pills: the pill is a button, Enter opens the card, Esc closes it.
15. **No place name** (the lookup failed or found nothing): the pill shows just the icon and temperature, never coordinates.
16. **The location helper process** runs while weather is on and stops when it's turned off or the app quits (stdin closes). It holds no location updates between readings; each reading is a one-off request.

## Privacy (to go into CLAUDE.md's rules with the date)

- Open-Meteo (`https://api.open-meteo.com`, its forecast endpoint only) gets the position rounded to two decimals (about 1 km) and the list of fields wanted, always in metric. Nothing else: no place name, id, unit choice or key. Only while weather is on and the pill can be seen, at most every 15 minutes plus retries and the user's clicks. Approved by the user on 2026-10-27.
- The position is read by the helper's location mode through Location Services, only while weather is on. It stays in the main process's memory: never logged, never written to settings or any file.
- The place name comes from macOS's reverse lookup (Apple) given the same rounded position, only when there's no place yet or the Mac has moved about 1 km from where the last one was looked up. Approved on 2026-10-27.
- No other host. Requests go through `services/http.ts` with its size and time limits, and anything Open-Meteo returns is parsed as untrusted input.

## Constraints

- CLAUDE.md applies: TypeScript strict, no `any`; IPC channels and payloads only in `src/main/ipc.ts`; the renderer never touches the network or Node; every external source behind an interface with a mock; `process.platform` checked in one factory; plain CSS with the theme's variables; buttons at least 44 px; no finite CSS keyframe animations inside cards.
- The helper's new mode follows its JSON-lines rules (one object per line on stdin and stdout, exits when stdin closes); main treats malformed output as no data and restarts it if it exits (`helperProcess.ts`).
- Under hardened runtime the helper needs the `com.apple.security.personal-information.location` entitlement, in `native/mac-reminders/entitlements.plist` (dev builds) and `build/entitlements.mac.plist` (inherited when it's re-signed inside the packaged app), and `NSLocationUsageDescription` (plus `NSLocationWhenInUseUsageDescription`) in its `Info.plist`. `npm run build:reminders` rebuilds the shared copy in `~/Library/Developer/FocusScreen`.
- Open-Meteo's free tier allows fewer than 10,000 calls a day; this makes at most about 100.

## Build order: the location spike first

Calendar access works through the helper's disclaimed copy, but Location goes through a different part of macOS (locationd) and hasn't been tried this way. So the first step is a throwaway check: the helper's location mode, run disclaimed from `~/Library/Developer/FocusScreen`, shows the macOS prompt naming "Focus Screen Reminders" and returns a position. If it can't, stop and ask the user before choosing a fallback (the main app asking, which names "Focus Screen" or, under `npm run dev`, Electron; the helper not disclaimed; or no weather): IP lookup and a typed city are already ruled out.

## Left to the builder

- The exact request fields, response parsing and size/time limits.
- The helper protocol's message shapes for access, position and place.
- Icon drawings and exact colours within call 9; card spacing within mockup B.
- How the pill joins `PillRow` (`PillId`, `stageClasses`, bubbles) and the drop-to-fit order, following the shuttle pill.
- Tests for the pure parts: the WMO table, °C → °F, rounding, the six-hour pick, the moved-1-km check, backoff and staleness, response parsing.

## Done means

- Built with tests for the pure logic; `npm run typecheck`, `npm run lint` and `npm test` pass.
- CLAUDE.md updated: Stack (the helper's location mode), Layout (`services/weather/`, the widget), the approved host and the location rules with the date in Privacy, a Design bullet for the pill and card.
- `graphify update .` run.
- The user has seen it working on the Focus Screen with their real location.
