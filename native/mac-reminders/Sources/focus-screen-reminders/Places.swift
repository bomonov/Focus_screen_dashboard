import Foundation
import MapKit

/// Apple answers in a second or two; a search still going by now isn't coming back.
private let searchTimeoutSeconds = 10.0
/// The app keeps eight, the ones named like what was typed first: Apple ranks by nearness to
/// the box's middle (west Phoenix), so "Tempe Marketplace" can come 11th. All of Apple's go.
private let maxResults = 25
/// The app never sends more; anything longer isn't one of its searches.
private let maxTextCharacters = 100

/// One search under way. Used from the main queue only.
private final class PlaceSearch {
  /// Set once the search is answered, so a late reply and the timeout never both answer.
  var answered = false
}

/// Searches not yet answered, and whether stdin has closed: a search asked for just before it
/// closed is still answered (at most 10 s later), then the helper exits. Main queue only.
private var searchesUnderWay = 0
private var inputClosed = false

private func exitIfDone() {
  if inputClosed && searchesUnderWay == 0 { exit(0) }
}

private func searchRegion(_ box: [String: Any]) -> MKCoordinateRegion? {
  guard let south = box["south"] as? Double, let west = box["west"] as? Double,
    let north = box["north"] as? Double, let east = box["east"] as? Double,
    south < north, west < east, (-90.0...90.0).contains(south), (-90.0...90.0).contains(north),
    (-180.0...180.0).contains(west), (-180.0...180.0).contains(east)
  else { return nil }
  return MKCoordinateRegion(
    center: CLLocationCoordinate2D(latitude: (south + north) / 2, longitude: (west + east) / 2),
    span: MKCoordinateSpan(latitudeDelta: north - south, longitudeDelta: east - west))
}

/// The row's second line: the street and the town ("E Rio Salado Pkwy, Tempe"), or the town
/// alone when the name already says the street (an address's does).
private func placeDetail(_ name: String, _ mark: MKPlacemark) -> String {
  var parts: [String] = []
  if let street = mark.thoroughfare, !street.isEmpty, !name.contains(street) {
    parts.append(street)
  }
  if let town = mark.locality, !town.isEmpty { parts.append(town) }
  return parts.joined(separator: ", ")
}

private func placeResult(_ item: MKMapItem) -> [String: Any]? {
  guard let name = item.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty
  else { return nil }
  // `placemark` is the one place MapKit gives the street apart from the number; it's deprecated
  // from macOS 26 but still answers there.
  let mark = item.placemark
  let coordinate = mark.coordinate
  guard CLLocationCoordinate2DIsValid(coordinate) else { return nil }
  return [
    "name": name, "detail": placeDetail(name, mark),
    "lat": coordinate.latitude, "lon": coordinate.longitude,
  ]
}

private func search(_ id: Int, _ text: String, _ region: MKCoordinateRegion) {
  let request = MKLocalSearch.Request()
  request.naturalLanguageQuery = text
  request.region = region
  request.resultTypes = [.pointOfInterest, .address]
  if #available(macOS 15, *) {
    // Only places inside the box: a chain's name shouldn't answer from another state.
    request.regionPriority = .required
  }
  let localSearch = MKLocalSearch(request: request)
  let state = PlaceSearch()
  searchesUnderWay += 1
  let timeout = DispatchWorkItem {
    guard !state.answered else { return }
    state.answered = true
    localSearch.cancel()
    replyError(id, "failed")
    searchesUnderWay -= 1
    exitIfDone()
  }
  DispatchQueue.main.asyncAfter(deadline: .now() + searchTimeoutSeconds, execute: timeout)
  localSearch.start { response, error in
    DispatchQueue.main.async {
      guard !state.answered else { return }
      state.answered = true
      timeout.cancel()
      // MKError's description could carry the words searched for: it's never printed.
      if error == nil, let response {
        let results = response.mapItems.prefix(maxResults).compactMap(placeResult)
        reply(id, ["ok": true, "results": results])
      } else {
        replyError(id, "failed")
      }
      searchesUnderWay -= 1
      exitIfDone()
    }
  }
}

private func handlePlaceRequest(_ request: [String: Any]) {
  guard let id = request["id"] as? Int else { return }
  guard request["op"] as? String == "search",
    let raw = request["text"] as? String,
    let box = request["box"] as? [String: Any],
    let region = searchRegion(box)
  else {
    replyError(id, "badRequest")
    return
  }
  let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !text.isEmpty, text.count <= maxTextCharacters else {
    replyError(id, "badRequest")
    return
  }
  search(id, text, region)
}

/// Place-search mode (`--places`), for trip destinations beyond the Mac's own (a store, a
/// restaurant, an address). Requests on stdin, one per line:
///   {"id":1,"op":"search","text":"Tempe Marketplace","box":{"south":…,"west":…,"north":…,"east":…}}
/// and on stdout the replies:
///   {"ok":true,"results":[{"name":"Tempe Marketplace","detail":"E Rio Salado Pkwy, Tempe","lat":…,"lon":…}]}
///   {"ok":false,"error":"failed" | "badRequest"}
/// Only the words typed and the box (a fixed one around Phoenix, the same for everyone) go to
/// Apple, through MapKit's local search: never a position. The words are never printed or
/// logged. It reads nothing on this Mac and needs no access, so it sends no access line. Serves
/// searches until stdin closes, then exits once the ones under way are answered.
func runPlaces() -> Never {
  // The app keeps the last of a helper's stderr for its log, and frameworks write there now and
  // then; nothing that could hold the words searched for may land in it.
  freopen("/dev/null", "w", stderr)
  Thread.detachNewThread {
    while let line = readLine(strippingNewline: true) {
      guard let data = line.data(using: .utf8),
        let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      else { continue }
      DispatchQueue.main.async { handlePlaceRequest(request) }
    }
    DispatchQueue.main.async {
      inputClosed = true
      exitIfDone()
    }
  }
  // MapKit answers through the main run loop.
  RunLoop.main.run()
  exit(0)
}
