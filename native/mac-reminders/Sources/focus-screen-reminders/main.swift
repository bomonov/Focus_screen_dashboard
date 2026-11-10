// The Apple Reminders and Calendar helper for Focus Screen. It runs in one of two modes:
// reminders (the default) or calendar (`--calendar`), each in its own process, so the app
// starts only what's turned on. A third, `--map '<json>'`, makes one map picture for the Next
// class card and exits (see MapSnapshot.swift), a fourth, `--route-map '<json>'`, one flat
// map for the Next bus route card (RouteMapSnapshot.swift), and a fifth, `--haptics`, plays the
// trackpad's tick when a timer wheel lands on 0 (Haptics.swift); none of them reads anything on
// the Mac. A sixth, `--location`, runs as its own process like calendar mode and finds where the
// Mac is for the weather pill (Location.swift). A seventh, `--places`, searches Apple's places
// for the trip card with only the words typed and a fixed Phoenix-area box (Places.swift); it
// reads nothing on the Mac either.
//
// Requests come in on stdin, one JSON object per line:
//   reminders: {"id":1,"op":"list"}  {"id":2,"op":"setDone","item":"…","done":true}
//   calendar:  {"id":1,"op":"calendars"}  {"id":2,"op":"events","calendars":["…"],"from":…,"to":…}
//   both:      {"id":3,"op":"requestAccess"}
// and everything goes out on stdout, one JSON object per line:
//   {"type":"access","status":"granted"}  at start and whenever the access setting changes
//   {"type":"changed"}                    something changed in Reminders or Calendar
//   {"type":"reply","id":1,"ok":true,…}   the answer to request 1
// It exits when stdin closes, so it never outlives the app.
import Foundation

// No Reminders or Calendar access is involved, so it needn't run as its own process for macOS.
if let flag = CommandLine.arguments.firstIndex(of: "--map"),
  flag + 1 < CommandLine.arguments.count
{
  runMapSnapshot(CommandLine.arguments[flag + 1])
}
if let flag = CommandLine.arguments.firstIndex(of: "--route-map"),
  flag + 1 < CommandLine.arguments.count
{
  runRouteMapSnapshot(CommandLine.arguments[flag + 1])
}

if CommandLine.arguments.contains("--haptics") {
  runHaptics()
}

// `--places` must stay above runAsOwnProcessIfPossible() and never run disclaimed. As its own
// process it would be "Focus Screen Reminders", which holds the Location grant the weather pill
// and the trip card asked for, and MapKit's search could then use where the Mac is to answer.
// The privacy rule says Apple gets only the words typed and the fixed Phoenix-area box; run as
// the app's child it has no Location grant to draw on.
if CommandLine.arguments.contains("--places") {
  runPlaces()
}

runAsOwnProcessIfPossible()

// Location access, like Calendar's, is asked for as this app.
if CommandLine.arguments.contains("--location") {
  runLocation()
}

let bridge: EventKitBridge =
  CommandLine.arguments.contains("--calendar") ? CalendarBridge() : RemindersBridge()
bridge.start()

Thread.detachNewThread {
  while let line = readLine(strippingNewline: true) {
    guard let data = line.data(using: .utf8),
      let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { continue }
    DispatchQueue.main.async { bridge.handle(request) }
  }
  DispatchQueue.main.async { exit(0) }
}

// EventKit's change notices need a running main run loop, not just the main queue.
RunLoop.main.run()
