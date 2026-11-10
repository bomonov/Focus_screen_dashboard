import EventKit
import Foundation

/// How often to look at the access setting; macOS doesn't announce changes to it.
private let accessPollSeconds = 2.0
/// EventKit announces a burst of changes for one edit (and for iCloud syncing).
private let changeSettleSeconds = 0.5

/// "granted", "denied", "restricted" or "notDetermined".
func accessStatus(_ entity: EKEntityType) -> String {
  let status = EKEventStore.authorizationStatus(for: entity)
  switch status {
  case .notDetermined: return "notDetermined"
  case .restricted: return "restricted"
  case .denied: return "denied"
  default:
    // 3 is full access (called "authorized" before macOS 14). Write-only access (4) can't
    // read anything, so it counts as denied.
    return status.rawValue == 3 ? "granted" : "denied"
  }
}

/// What both modes share: one kind of EventKit access, followed as it changes, and the store's
/// change notices. Subclasses answer their own requests. Used from the main queue only.
class EventKitBridge {
  let entity: EKEntityType
  private(set) var store = EKEventStore()
  private var lastStatus: String
  private var observer: NSObjectProtocol?
  private var pendingChange: DispatchWorkItem?

  init(entity: EKEntityType) {
    self.entity = entity
    lastStatus = accessStatus(entity)
  }

  func start() {
    emit(["type": "access", "status": lastStatus])
    watchStore()
    Timer.scheduledTimer(withTimeInterval: accessPollSeconds, repeats: true) { [weak self] _ in
      self?.checkAccess()
    }
  }

  /// Requests the subclass doesn't know; every mode can ask for access.
  func handle(_ request: [String: Any]) {
    guard let id = request["id"] as? Int else { return }
    if request["op"] as? String == "requestAccess" {
      requestAccess(id)
    } else {
      replyError(id, "badRequest")
    }
  }

  /// The reply to send when access isn't granted, or nil when it is.
  func accessFailure() -> [String: Any]? {
    let status = accessStatus(entity)
    return status == "granted" ? nil : ["ok": false, "error": "access", "status": status]
  }

  private func checkAccess() {
    let status = accessStatus(entity)
    guard status != lastStatus else { return }
    lastStatus = status
    // A store made before access was given can stay blind; start over with a fresh one.
    if status == "granted" {
      store = EKEventStore()
      watchStore()
    }
    emit(["type": "access", "status": status])
  }

  private func watchStore() {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = NotificationCenter.default.addObserver(
      forName: .EKEventStoreChanged, object: store, queue: .main
    ) { [weak self] _ in
      self?.storeChanged()
    }
  }

  private func storeChanged() {
    pendingChange?.cancel()
    let work = DispatchWorkItem { emit(["type": "changed"]) }
    pendingChange = work
    DispatchQueue.main.asyncAfter(deadline: .now() + changeSettleSeconds, execute: work)
  }

  private func requestAccess(_ id: Int) {
    let entity = self.entity
    let finish: (Bool, Error?) -> Void = { [weak self] _, _ in
      DispatchQueue.main.async {
        self?.checkAccess()
        reply(id, ["ok": true, "status": accessStatus(entity)])
      }
    }
    if #available(macOS 14.0, *) {
      if entity == .event {
        store.requestFullAccessToEvents(completion: finish)
      } else {
        store.requestFullAccessToReminders(completion: finish)
      }
    } else {
      store.requestAccess(to: entity, completion: finish)
    }
  }
}
