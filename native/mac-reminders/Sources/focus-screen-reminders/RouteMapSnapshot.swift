import AppKit
import MapKit

/// Route map mode
/// (`--route-map '{"north":…,"south":…,"east":…,"west":…,"width":…,"height":…,"dark":true}'`):
/// one flat picture of the map inside a box, for the Next bus route card. The app draws the
/// bus's path on it itself, so only the box goes to Apple Maps. It prints one line and exits:
///   {"ok":true,"image":"<base64 JPEG>","northWest":[0,0],"southEast":[1,1]}
///     (where the box's corners landed, as shares of the size)
///   {"ok":false,"error":"badRequest" | "noMap" | "noImage"}
/// It reads nothing on this Mac, so it needs no access.
func runRouteMapSnapshot(_ json: String) -> Never {
  guard let data = json.data(using: .utf8),
    let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
    let north = request["north"] as? Double, let south = request["south"] as? Double,
    let east = request["east"] as? Double, let west = request["west"] as? Double,
    let width = request["width"] as? Double, let height = request["height"] as? Double,
    (-85.0...85.0).contains(north), (-85.0...85.0).contains(south), south < north,
    (-180.0...180.0).contains(west), (-180.0...180.0).contains(east), west < east,
    // A city's buses, never more: about 200 km across at most.
    north - south <= 2, east - west <= 2,
    (100.0...1200.0).contains(width), (100.0...1200.0).contains(height)
  else {
    emit(["ok": false, "error": "badRequest"])
    exit(1)
  }
  // A connection to the window server first, or the picture comes out at 1x on a Retina Mac.
  _ = NSApplication.shared
  let dark = request["dark"] as? Bool ?? true
  let northWest = CLLocationCoordinate2D(latitude: north, longitude: west)
  let southEast = CLLocationCoordinate2D(latitude: south, longitude: east)
  let topLeft = MKMapPoint(northWest)
  let bottomRight = MKMapPoint(southEast)

  let options = MKMapSnapshotter.Options()
  options.size = NSSize(width: width, height: height)
  // The app sized the box to the picture's shape, so the box fills it exactly.
  options.mapRect = MKMapRect(
    x: topLeft.x, y: topLeft.y,
    width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y)
  options.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
  // Flat and quiet: streets and their names for bearings, nothing competing with the route.
  if #available(macOS 14, *) {
    let map = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: .muted)
    map.pointOfInterestFilter = .excludingAll
    options.preferredConfiguration = map
  } else {
    options.mapType = .mutedStandard
    options.pointOfInterestFilter = .excludingAll
    options.showsBuildings = false
  }

  MKMapSnapshotter(options: options).start(with: .main) { snapshot, _ in
    guard let snapshot else {
      emit(["ok": false, "error": "noMap"])
      exit(2)
    }
    // Where the corners really landed: the app lines the route up by them.
    let nw = snapshot.point(for: northWest)
    let se = snapshot.point(for: southEast)
    guard let picture = snapshot.image.cgImage(forProposedRect: nil, context: nil, hints: nil),
      let jpeg = NSBitmapImageRep(cgImage: picture).representation(
        using: .jpeg, properties: [.compressionFactor: 0.82])
    else {
      emit(["ok": false, "error": "noImage"])
      exit(3)
    }
    // AppKit counts y up from the bottom; the app's pictures count it down from the top.
    emit([
      "ok": true,
      "image": jpeg.base64EncodedString(),
      "northWest": [nw.x / width, 1 - nw.y / height],
      "southEast": [se.x / width, 1 - se.y / height],
    ])
    exit(0)
  }
  RunLoop.main.run()
  exit(0)
}
