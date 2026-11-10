import EventKit
import Foundation

/// Plenty for anyone's lists, and keeps a list reply well under the app's 1 MB line limit.
private let maxOpen = 2000
private let maxDone = 500
private let maxTitleChars = 300

/// A due date as the app wants it: a plain day, or a moment in epoch seconds.
private func due(_ components: DateComponents?) -> Any {
  guard let components, components.year != nil, components.month != nil, components.day != nil
  else { return NSNull() }
  var calendar = components.calendar ?? Calendar(identifier: .gregorian)
  // No time zone means "floating": the same wall-clock time wherever you are.
  calendar.timeZone = components.timeZone ?? TimeZone.current
  guard let date = calendar.date(from: components) else { return NSNull() }
  if components.hour != nil { return ["at": date.timeIntervalSince1970] }
  var gregorian = Calendar(identifier: .gregorian)
  gregorian.timeZone = calendar.timeZone
  let day = gregorian.dateComponents([.year, .month, .day], from: date)
  guard let year = day.year, let month = day.month, let dayOfMonth = day.day else {
    return NSNull()
  }
  return ["day": String(format: "%04d-%02d-%02d", year, month, dayOfMonth)]
}

private func item(_ reminder: EKReminder) -> [String: Any] {
  [
    "id": reminder.calendarItemIdentifier,
    "list": reminder.calendar?.calendarIdentifier ?? "",
    "title": String((reminder.title ?? "").prefix(maxTitleChars)),
    "due": due(reminder.dueDateComponents),
    "done": reminder.isCompleted,
    "completedAt": reminder.completionDate.map { $0.timeIntervalSince1970 } ?? NSNull(),
    "createdAt": reminder.creationDate.map { $0.timeIntervalSince1970 } ?? NSNull(),
  ]
}

/// Reminders mode: lists reminders and checks them off. Used from the main queue only.
final class RemindersBridge: EventKitBridge {
  init() {
    super.init(entity: .reminder)
  }

  override func handle(_ request: [String: Any]) {
    guard let id = request["id"] as? Int else { return }
    switch request["op"] as? String {
    case "list": list(id)
    case "setDone":
      guard let itemId = request["item"] as? String, let done = request["done"] as? Bool else {
        return replyError(id, "badRequest")
      }
      setDone(id, itemId: itemId, done: done)
    default: super.handle(request)
    }
  }

  private func list(_ id: Int) {
    if let failure = accessFailure() { return reply(id, failure) }
    let store = self.store
    let calendars = store.calendars(for: .reminder)
    let lists = calendars.map { ["id": $0.calendarIdentifier, "title": $0.title] }
    // An empty array would mean "every list" to EventKit.
    guard !calendars.isEmpty else {
      return reply(id, ["ok": true, "lists": lists, "items": []])
    }
    let open = store.predicateForIncompleteReminders(
      withDueDateStarting: nil, ending: nil, calendars: calendars)
    store.fetchReminders(matching: open) { openReminders in
      let since = Calendar.current.startOfDay(for: Date())
      let done = store.predicateForCompletedReminders(
        withCompletionDateStarting: since, ending: nil, calendars: calendars)
      store.fetchReminders(matching: done) { doneReminders in
        let items =
          (openReminders ?? []).prefix(maxOpen).map(item)
          + (doneReminders ?? []).prefix(maxDone).map(item)
        DispatchQueue.main.async {
          reply(id, ["ok": true, "lists": lists, "items": items])
        }
      }
    }
  }

  private func setDone(_ id: Int, itemId: String, done: Bool) {
    if let failure = accessFailure() { return reply(id, failure) }
    guard let reminder = store.calendarItem(withIdentifier: itemId) as? EKReminder else {
      return replyError(id, "notFound")
    }
    guard reminder.calendar?.allowsContentModifications ?? false else {
      return replyError(id, "readOnly")
    }
    // Completing a repeating reminder moves it on to its next date, as in the Reminders app.
    reminder.isCompleted = done
    do {
      try store.save(reminder, commit: true)
      reply(id, ["ok": true])
    } catch {
      // EventKit's message could name the reminder; the app only needs to know it failed.
      replyError(id, "failed")
    }
  }
}
