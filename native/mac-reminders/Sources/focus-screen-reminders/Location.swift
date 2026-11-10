import CoreLocation
import Foundation
import MapKit

/// A fix by Wi-Fi takes a few seconds; one that hasn't come by now isn't coming.
private let locateTimeoutSeconds = 30.0

/// "granted", "denied", "restricted" or "notDetermined", the same words the EventKit modes use.
private func locationStatus(_ manager: CLLocationManager) -> String {
  switch manager.authorizationStatus {
  case .notDetermined: return "notDetermined"
  case .restricted: return "restricted"
  case .denied: return "denied"
  // macOS grants "always"; "when in use" counts the same.
  default: return "granted"
  }
}

/// Location mode (`--location`), for the weather pill. Run as its own process like calendar
/// mode, so macOS asks for Location as "Focus Screen Reminders". Requests on stdin:
///   {"id":1,"op":"requestAccess"}   shows macOS's prompt, if it hasn't been answered
///   {"id":2,"op":"locate"}          one fix; nothing keeps running between requests
///   {"id":3,"op":"place","lat":…,"lon":…}   the town at an (already rounded) position
/// and on stdout {"type":"access","status":…} at start and on every change, and the replies:
///   {"ok":true,"lat":…,"lon":…,"accuracyM":…}  {"ok":true,"place":"Tempe"|null}
///   {"ok":false,"error":"servicesOff" | "access" | "failed" | "badRequest"}
/// The position only ever goes into a reply: never a log line. The place lookup sends the
/// position it's given to Apple. Used from the main queue only.
final class LocationBridge: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private var lastStatus: String?
  /// Requests waiting for the fix under way: one fix answers them all.
  private var waiting: [Int] = []
  private var timeout: DispatchWorkItem?

  override init() {
    super.init()
    // A town's weather needs no better than a few hundred metres, which Wi-Fi gives quickly.
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    manager.delegate = self
  }

  func start() {
    reportAccess()
  }

  func handle(_ request: [String: Any]) {
    guard let id = request["id"] as? Int else { return }
    switch request["op"] as? String {
    case "requestAccess":
      manager.requestWhenInUseAuthorization()
      reply(id, ["ok": true])
    case "locate":
      locate(id)
    case "place":
      guard let lat = request["lat"] as? Double, let lon = request["lon"] as? Double,
        (-90.0...90.0).contains(lat), (-180.0...180.0).contains(lon)
      else {
        replyError(id, "badRequest")
        return
      }
      place(id, CLLocation(latitude: lat, longitude: lon))
    default:
      replyError(id, "badRequest")
    }
  }

  private func reportAccess() {
    let status = locationStatus(manager)
    guard status != lastStatus else { return }
    lastStatus = status
    emit(["type": "access", "status": status])
  }

  private func locate(_ id: Int) {
    guard CLLocationManager.locationServicesEnabled() else {
      replyError(id, "servicesOff")
      return
    }
    let status = locationStatus(manager)
    guard status == "granted" else {
      reply(id, ["ok": false, "error": "access", "status": status])
      return
    }
    waiting.append(id)
    guard waiting.count == 1 else { return }
    manager.requestLocation()
    let work = DispatchWorkItem { [weak self] in self?.answer(["ok": false, "error": "failed"]) }
    timeout = work
    DispatchQueue.main.asyncAfter(deadline: .now() + locateTimeoutSeconds, execute: work)
  }

  private func answer(_ fields: [String: Any]) {
    timeout?.cancel()
    timeout = nil
    let ids = waiting
    waiting = []
    for id in ids { reply(id, fields) }
  }

  private func place(_ id: Int, _ location: CLLocation) {
    if #available(macOS 26, *) {
      guard let request = MKReverseGeocodingRequest(location: location) else {
        replyError(id, "failed")
        return
      }
      request.getMapItems { items, error in
        DispatchQueue.main.async {
          guard error == nil else {
            replyError(id, "failed")
            return
          }
          let town = items?.first?.addressRepresentations?.cityName
          reply(id, ["ok": true, "place": town ?? NSNull()])
        }
      }
    } else {
      CLGeocoder().reverseGeocodeLocation(location) { marks, error in
        DispatchQueue.main.async {
          guard error == nil else {
            replyError(id, "failed")
            return
          }
          let mark = marks?.first
          let town = mark?.locality ?? mark?.subAdministrativeArea
          reply(id, ["ok": true, "place": town ?? NSNull()])
        }
      }
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    reportAccess()
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard !waiting.isEmpty, let fix = locations.last else { return }
    answer([
      "ok": true, "lat": fix.coordinate.latitude, "lon": fix.coordinate.longitude,
      "accuracyM": fix.horizontalAccuracy,
    ])
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    guard !waiting.isEmpty else { return }
    answer(["ok": false, "error": "failed"])
  }
}

/// Serves location requests until stdin closes.
func runLocation() -> Never {
  let bridge = LocationBridge()
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
  // CoreLocation calls its delegate through the main run loop.
  RunLoop.main.run()
  exit(0)
}
