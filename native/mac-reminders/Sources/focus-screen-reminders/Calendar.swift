import CoreGraphics
import EventKit
import Foundation

/// A week of anyone's class calendars fits easily, and keeps a reply well under 1 MB.
private let maxEvents = 500
private let maxCalendars = 200
private let maxTextChars = 200
/// The app asks for today and the week after it; anything longer isn't a "next class" question.
private let maxRangeSeconds = 8.0 * 24 * 3600

private func text(_ value: String?) -> String {
  String((value ?? "").prefix(maxTextChars))
}

/// "#RRGGBB" in sRGB, or "" when the calendar has no usable color.
private func hex(_ color: CGColor?) -> String {
  guard let color, let srgb = CGColorSpace(name: CGColorSpace.sRGB),
    let converted = color.converted(to: srgb, intent: .defaultIntent, options: nil),
    let parts = converted.components, parts.count >= 3
  else { return "" }
  let byte = { (value: CGFloat) in Int((min(max(value, 0), 1) * 255).rounded()) }
  return String(format: "#%02X%02X%02X", byte(parts[0]), byte(parts[1]), byte(parts[2]))
}

/// Calendar mode (`--calendar`): which calendars there are, and the timed events in the ones
/// the app names. Nothing is ever written. Used from the main queue only.
final class CalendarBridge: EventKitBridge {
  init() {
    super.init(entity: .event)
  }

  override func handle(_ request: [String: Any]) {
    guard let id = request["id"] as? Int else { return }
    switch request["op"] as? String {
    case "calendars": calendars(id)
    case "events":
      guard let ids = request["calendars"] as? [String],
        let from = request["from"] as? Double, let to = request["to"] as? Double,
        to > from, to - from <= maxRangeSeconds
      else { return replyError(id, "badRequest") }
      events(id, calendarIds: Set(ids), from: from, to: to)
    default: super.handle(request)
    }
  }

  private func calendars(_ id: Int) {
    if let failure = accessFailure() { return reply(id, failure) }
    let list = store.calendars(for: .event).prefix(maxCalendars).map { calendar in
      [
        "id": calendar.calendarIdentifier,
        "title": text(calendar.title),
        "source": text(calendar.source?.title),
        "color": hex(calendar.cgColor),
      ]
    }
    reply(id, ["ok": true, "calendars": Array(list)])
  }

  private func events(_ id: Int, calendarIds: Set<String>, from: Double, to: Double) {
    if let failure = accessFailure() { return reply(id, failure) }
    let store = self.store
    let chosen = store.calendars(for: .event).filter { calendarIds.contains($0.calendarIdentifier) }
    // No calendars would mean "every calendar" to EventKit.
    guard !chosen.isEmpty else { return reply(id, ["ok": true, "events": []]) }
    let predicate = store.predicateForEvents(
      withStart: Date(timeIntervalSince1970: from), end: Date(timeIntervalSince1970: to),
      calendars: chosen)
    // Reading events can take a moment on a big account; keep the main queue free meanwhile.
    DispatchQueue.global(qos: .userInitiated).async {
      let found = store.events(matching: predicate)
        // A class has a time; all-day entries are holidays, deadlines and the like.
        .filter { !$0.isAllDay }
        .sorted { $0.startDate < $1.startDate }
        .prefix(maxEvents)
        .map { event -> [String: Any] in
          let start = event.startDate.timeIntervalSince1970
          return [
            // Repeating events share an item id, so each occurrence adds its start.
            "id": "\(event.calendarItemIdentifier)@\(Int(start))",
            "calendar": event.calendar?.calendarIdentifier ?? "",
            "title": text(event.title),
            "location": text(event.location),
            "start": start,
            "end": event.endDate.timeIntervalSince1970,
          ]
        }
      DispatchQueue.main.async { reply(id, ["ok": true, "events": Array(found)]) }
    }
  }
}
