// A bus route's path for the route card: simplified once, when the stop list is made, then
// cut at the picked stop and framed for the map. Pure, so it's tested alone.

/** [latitude, longitude] in degrees. */
export type LatLon = readonly [number, number]

/** A box on the map, in degrees. */
export interface MapBox {
  north: number
  south: number
  east: number
  west: number
}

/** Metres per degree of latitude, and of longitude at the equator. */
const M_PER_DEG_LAT = 110_574
const M_PER_DEG_LON = 111_320

/** Flat metres around `origin`: plenty accurate across a city. */
function flatFrom(origin: LatLon): (point: LatLon) => [number, number] {
  const scale = Math.cos((origin[0] * Math.PI) / 180) * M_PER_DEG_LON
  return ([lat, lon]) => [(lon - origin[1]) * scale, (lat - origin[0]) * M_PER_DEG_LAT]
}

export function distanceM(a: LatLon, b: LatLon): number {
  const [x, y] = flatFrom(a)(b)
  return Math.hypot(x, y)
}

/** How far a point is from the segment a→b, in the same flat units. */
function offsetFrom(
  [px, py]: [number, number],
  [ax, ay]: [number, number],
  [bx, by]: [number, number]
): number {
  const dx = bx - ax
  const dy = by - ay
  const length = Math.hypot(dx, dy)
  if (length === 0) return Math.hypot(px - ax, py - ay)
  return Math.abs(dy * (px - ax) - dx * (py - ay)) / length
}

/** Douglas–Peucker: drops the points that bend the line by less than `toleranceM`. */
export function simplifyLine(points: readonly LatLon[], toleranceM: number): LatLon[] {
  const first = points[0]
  if (!first || points.length < 3) return [...points]
  const xy = points.map(flatFrom(first))
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const spans: [number, number][] = [[0, points.length - 1]]
  for (let span = spans.pop(); span; span = spans.pop()) {
    const [start, end] = span
    const a = xy[start] as [number, number]
    const b = xy[end] as [number, number]
    let far = 0
    let at = -1
    for (let i = start + 1; i < end; i++) {
      const offset = offsetFrom(xy[i] as [number, number], a, b)
      if (offset > far) {
        far = offset
        at = i
      }
    }
    if (at !== -1 && far > toleranceM) {
      keep[at] = 1
      spans.push([start, at], [at, end])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}

/** Five decimals is about a metre: as fine as a bus route needs, and small to keep. */
const round5 = (value: number): number => Math.round(value * 1e5) / 1e5

/** A line as it's saved: lat, lon, lat, lon… */
export function encodeLine(points: readonly LatLon[]): number[] {
  return points.flatMap(([lat, lon]) => [round5(lat), round5(lon)])
}

/** More than any simplified bus route has; a saved line past it isn't one of ours. */
export const MAX_LINE_POINTS = 5000

const isLat = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 85
const isLon = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 180

/** A saved line, read back with the same care as anything from outside; null if it isn't one. */
export function decodeLine(raw: unknown): LatLon[] | null {
  if (!Array.isArray(raw) || raw.length < 4 || raw.length % 2 !== 0) return null
  if (raw.length > MAX_LINE_POINTS * 2) return null
  const points: LatLon[] = []
  for (let i = 0; i < raw.length; i += 2) {
    const lat: unknown = raw[i]
    const lon: unknown = raw[i + 1]
    if (!isLat(lat) || !isLon(lon)) return null
    points.push([lat, lon])
  }
  return points
}

export function isPosition(raw: unknown): raw is [number, number] {
  return Array.isArray(raw) && raw.length === 2 && isLat(raw[0]) && isLon(raw[1])
}

/** Metres from the start of the line to each of its points. */
export function lineDistances(line: readonly LatLon[]): number[] {
  const distances = [0]
  for (let i = 1; i < line.length; i++) {
    const previous = distances[i - 1] ?? 0
    distances.push(previous + distanceM(line[i - 1] as LatLon, line[i] as LatLon))
  }
  return distances
}

/** Ends this close are one place: the simplified path may stop a little short of its start. */
const LOOP_ENDS_M = 300

/** A loop (an Orbit) ends where it starts: its last stretch comes round to its first stops. */
export function isLoop(line: readonly LatLon[]): boolean {
  const first = line[0]
  const last = line.at(-1)
  if (line.length < 3 || !first || !last) return false
  return distanceM(first, last) < LOOP_ENDS_M
}

export interface LinePlace {
  /** Metres along the line from its start. */
  along: number
  /** Metres between the point and the line. */
  offset: number
}

/** Places about as close as the closest are the same street: another pass down it, say. */
const TIE_M = 25

/**
 * Where a point is on the line. A loop passes its first stop again at its end: of the places
 * about as close as the closest (within `tieM`), the earliest is taken, so the whole loop is
 * still ahead of someone waiting at its first stop.
 */
export function placeOnLine(
  line: readonly LatLon[],
  point: LatLon,
  tieM = TIE_M
): LinePlace | null {
  return closePasses(line, point, tieM)[0] ?? null
}

/** Stops close together (bays, a corner's two sides) can land a little out of order. */
const BACK_M = 30

/**
 * Where stops are on the line, in metres along it, given in the order a trip makes them: each
 * on the first close pass at or after the stop before it. A route down the same street twice
 * then has each stop on the pass that serves it, and a loop's first stop is still at its start.
 * null for a stop with no close pass after the one before.
 */
export function placeInOrder(line: readonly LatLon[], stops: readonly LatLon[]): (number | null)[] {
  let reached = 0
  return stops.map((stop) => {
    const next = closePasses(line, stop).find((pass) => pass.along >= reached - BACK_M)
    if (!next) return null
    reached = Math.max(reached, next.along)
    return next.along
  })
}

/** A bus this little past the stop it's said to be at is still at it. */
const AT_STOP_M = 60

/**
 * Where a bus is on the line, given how far along it is the stop it's at or heading to (the live
 * feed says which): on a street the line runs down twice, the close pass that comes up to that
 * stop. Without one (or with none before it), the earliest close pass.
 */
export function placeBefore(
  line: readonly LatLon[],
  point: LatLon,
  nextAlong: number | null
): LinePlace | null {
  const passes = closePasses(line, point)
  const upTo =
    nextAlong === null ? [] : passes.filter((pass) => pass.along <= nextAlong + AT_STOP_M)
  return upTo.at(-1) ?? passes[0] ?? null
}

/** The passes about as close as the closest, in order along the line. */
function closePasses(line: readonly LatLon[], point: LatLon, tieM = TIE_M): LinePlace[] {
  const passes = passesBy(line, point)
  const closest = Math.min(...passes.map((pass) => pass.offset))
  return passes.filter((pass) => pass.offset <= closest + tieM)
}

/** Each time the line passes by the point, in order along it. */
function passesBy(line: readonly LatLon[], point: LatLon): LinePlace[] {
  if (line.length < 2) return []
  const toFlat = flatFrom(point)
  const xy = line.map(toFlat)
  const distances = lineDistances(line)
  const places: LinePlace[] = []
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = xy[i - 1] as [number, number]
    const [bx, by] = xy[i] as [number, number]
    const dx = bx - ax
    const dy = by - ay
    const length2 = dx * dx + dy * dy
    // The point itself is at (0, 0) in its own flat frame.
    const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length2))
    const offset = Math.hypot(ax + t * dx, ay + t * dy)
    const start = distances[i - 1] ?? 0
    places.push({ along: start + t * ((distances[i] ?? start) - start), offset })
  }
  // Each pass by the point is a dip in the offset; along one straight pass there's only one.
  return places.filter(
    (place, i) =>
      place.offset <= (places[i - 1]?.offset ?? Infinity) &&
      place.offset <= (places[i + 1]?.offset ?? Infinity)
  )
}

/** The point `along` metres from the line's start (clamped to its ends). */
export function pointAlong(line: readonly LatLon[], along: number): LatLon | null {
  const distances = lineDistances(line)
  const first = line[0]
  if (!first) return null
  if (along <= 0) return first
  for (let i = 1; i < line.length; i++) {
    const end = distances[i] ?? 0
    if (along <= end) {
      const start = distances[i - 1] ?? 0
      const t = end === start ? 0 : (along - start) / (end - start)
      const [aLat, aLon] = line[i - 1] as LatLon
      const [bLat, bLon] = line[i] as LatLon
      return [aLat + t * (bLat - aLat), aLon + t * (bLon - aLon)]
    }
  }
  return line[line.length - 1] ?? null
}

/** The stretch of the line between two distances along it, cut cleanly at both ends. */
export function sliceLine(line: readonly LatLon[], from: number, to: number): LatLon[] {
  const distances = lineDistances(line)
  const start = pointAlong(line, from)
  const end = pointAlong(line, to)
  if (!start || !end || to <= from) return []
  const inside = line.filter((_, i) => {
    const at = distances[i] ?? 0
    return at > from && at < to
  })
  return [start, ...inside, end]
}

/** A whole route this short fits on the card readably: the Orbits, a crosstown hop. */
export const WHOLE_LINE_M = 14_000
/** Past that: this much of where the bus comes from, and of where it goes on to. */
export const BEFORE_STOP_M = 4_000
export const AFTER_STOP_M = 8_000

/** Which stretch of the line the card frames, in metres along it. */
export function frameStretch(total: number, stopAlong: number): [number, number] {
  if (total <= WHOLE_LINE_M) return [0, total]
  let from = stopAlong - BEFORE_STOP_M
  let to = stopAlong + AFTER_STOP_M
  // Near an end of the line, the window slides along rather than shrinking.
  if (from < 0) {
    to = Math.min(total, to - from)
    from = 0
  }
  if (to > total) {
    from = Math.max(0, from - (to - total))
    to = total
  }
  return [from, to]
}

/** Web Mercator, as Apple Maps draws it: 0–1 across the world, y down. */
export const mercatorX = (lon: number): number => (lon + 180) / 360
export function mercatorY(lat: number): number {
  const phi = (lat * Math.PI) / 180
  return (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2
}
const fromMercatorX = (x: number): number => x * 360 - 180
const fromMercatorY = (y: number): number =>
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI

/** Never closer than this across: a few blocks, so a short stretch still shows its streets. */
const MIN_SPAN_M = 900

/** Room one point needs on the picture, as shares of its height (above, below) and width. */
export interface PointRoom {
  point: LatLon
  above: number
  below: number
  aside: number
}

/**
 * The map box around these points with `padding` (a share of each side) to spare, widened to
 * the picture's shape (`aspect` = width / height). Mercator keeps shapes, so a box with the
 * picture's shape in Mercator units fills the picture exactly. With `room`, the box also grows
 * until that point has its room on every side (a pin stands above its spot, say).
 */
export function fitBox(
  points: readonly LatLon[],
  aspect: number,
  padding: number,
  room?: PointRoom
): MapBox | null {
  if (points.length === 0 || !(aspect > 0)) return null
  const xs = points.map(([, lon]) => mercatorX(lon))
  const ys = points.map(([lat]) => mercatorY(lat))
  let left = Math.min(...xs)
  let right = Math.max(...xs)
  let top = Math.min(...ys)
  let bottom = Math.max(...ys)
  const centerLat = fromMercatorY((top + bottom) / 2)
  // How many Mercator units a metre is, here.
  const unitsPerM = 1 / (M_PER_DEG_LON * 360 * Math.cos((centerLat * Math.PI) / 180))
  const minSpan = MIN_SPAN_M * unitsPerM
  const cx = (left + right) / 2
  const cy = (top + bottom) / 2
  const width = Math.max(right - left, minSpan) * (1 + 2 * padding)
  const height = Math.max(bottom - top, minSpan) * (1 + 2 * padding)
  left = cx - width / 2
  right = cx + width / 2
  top = cy - height / 2
  bottom = cy + height / 2

  // Grows the box about its middle to the picture's shape: every point moves toward the middle,
  // so room already made is kept.
  const toShape = (): void => {
    const w = right - left
    const h = bottom - top
    if (w / h < aspect) {
      const grow = (h * aspect - w) / 2
      left -= grow
      right += grow
    } else {
      const grow = (w / aspect - h) / 2
      top -= grow
      bottom += grow
    }
  }
  toShape()
  if (room) {
    const px = mercatorX(room.point[1])
    const py = mercatorY(room.point[0])
    // Each edge moves out just far enough for the point's share from it to be the room asked.
    if ((py - top) / (bottom - top) < room.above)
      top = (py - room.above * bottom) / (1 - room.above)
    if ((bottom - py) / (bottom - top) < room.below) {
      bottom = (py - room.below * top) / (1 - room.below)
    }
    if ((px - left) / (right - left) < room.aside)
      left = (px - room.aside * right) / (1 - room.aside)
    if ((right - px) / (right - left) < room.aside) {
      right = (px - room.aside * left) / (1 - room.aside)
    }
    toShape()
  }
  return {
    north: fromMercatorY(top),
    south: fromMercatorY(bottom),
    west: fromMercatorX(left),
    east: fromMercatorX(right)
  }
}

/**
 * Turns a position into its place on the picture (0–1 across and down), given where the box's
 * corners landed on it (the helper says; a flat map is linear in Mercator between them).
 */
export function projector(
  box: MapBox,
  northWest: readonly [number, number],
  southEast: readonly [number, number]
): (point: LatLon) => [number, number] {
  const x0 = mercatorX(box.west)
  const x1 = mercatorX(box.east)
  const y0 = mercatorY(box.north)
  const y1 = mercatorY(box.south)
  return ([lat, lon]) => [
    northWest[0] + ((mercatorX(lon) - x0) / (x1 - x0)) * (southEast[0] - northWest[0]),
    northWest[1] + ((mercatorY(lat) - y0) / (y1 - y0)) * (southEast[1] - northWest[1])
  ]
}
