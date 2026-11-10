import AppKit
import MapKit

/// The camera: high enough to show the building with its neighbours for bearings, tilted so
/// Apple Maps draws buildings in 3D with their names.
private let defaultDistance = 420.0
private let pitch = 45.0

/// Map mode (`--map '{"lat":…,"lon":…,"width":…,"height":…,"dark":true}'`): one still picture
/// of the map around a building, for the Next class card. It prints one line and exits:
///   {"ok":true,"image":"<base64 JPEG>","pinX":0.5,"pinY":0.52}  (the pin as a share of the size)
///   {"ok":false,"error":"badRequest" | "noMap" | "noImage"}
/// Only the position goes to Apple Maps; it reads nothing on this Mac, so it needs no access.
func runMapSnapshot(_ json: String) -> Never {
  guard let data = json.data(using: .utf8),
    let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
    let lat = request["lat"] as? Double, let lon = request["lon"] as? Double,
    let width = request["width"] as? Double, let height = request["height"] as? Double,
    (-90.0...90.0).contains(lat), (-180.0...180.0).contains(lon),
    (100.0...1200.0).contains(width), (100.0...1200.0).contains(height)
  else {
    emit(["ok": false, "error": "badRequest"])
    exit(1)
  }
  // A connection to the window server first, or the picture comes out at 1x on a Retina Mac.
  _ = NSApplication.shared
  let dark = request["dark"] as? Bool ?? true
  let distance = min(max(request["distance"] as? Double ?? defaultDistance, 150), 3000)
  let center = CLLocationCoordinate2D(latitude: lat, longitude: lon)

  let options = MKMapSnapshotter.Options()
  options.size = NSSize(width: width, height: height)
  options.camera = MKMapCamera(
    lookingAtCenter: center, fromDistance: distance, pitch: pitch, heading: 0)
  // Set either way: someone may have told the Maps app to stay light.
  options.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
  // Building names stay (they're how you get your bearings on campus; "including" a few
  // categories would hide them), but food, shops and parking don't crowd them.
  let places = MKPointOfInterestFilter(excluding: [
    .restaurant, .cafe, .bakery, .brewery, .winery, .foodMarket, .nightlife, .store,
    .gasStation, .evCharger, .parking, .carRental, .atm, .bank, .hotel, .laundry,
  ])
  if #available(macOS 14, *) {
    let map = MKStandardMapConfiguration(elevationStyle: .realistic, emphasisStyle: .muted)
    map.pointOfInterestFilter = places
    options.preferredConfiguration = map
  } else {
    options.mapType = .mutedStandard
    options.pointOfInterestFilter = places
    options.showsBuildings = true
  }

  MKMapSnapshotter(options: options).start(with: .main) { snapshot, _ in
    guard let snapshot else {
      emit(["ok": false, "error": "noMap"])
      exit(2)
    }
    // Pictures leave out pins; point(for:) says where the building landed in this one.
    let pin = snapshot.point(for: center)
    // The full-resolution picture, not the 1x one tiffRepresentation can give.
    guard let picture = snapshot.image.cgImage(forProposedRect: nil, context: nil, hints: nil),
      let jpeg = NSBitmapImageRep(cgImage: picture).representation(
        using: .jpeg, properties: [.compressionFactor: 0.82])
    else {
      emit(["ok": false, "error": "noImage"])
      exit(3)
    }
    // AppKit counts y up from the bottom; the card places the pin down from the top.
    emit([
      "ok": true,
      "image": jpeg.base64EncodedString(),
      "pinX": pin.x / width,
      "pinY": 1 - pin.y / height,
    ])
    exit(0)
  }
  RunLoop.main.run()
  exit(0)
}
