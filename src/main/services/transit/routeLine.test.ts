import { describe, expect, it } from 'vitest'
import {
  AFTER_STOP_M,
  BEFORE_STOP_M,
  decodeLine,
  distanceM,
  encodeLine,
  fitBox,
  frameStretch,
  isLoop,
  lineDistances,
  mercatorX,
  mercatorY,
  placeBefore,
  placeInOrder,
  placeOnLine,
  pointAlong,
  projector,
  simplifyLine,
  sliceLine,
  WHOLE_LINE_M,
  type LatLon
} from './routeLine'

/** A straight line north from Mill & University, a point every ~11 m. */
const NORTH: LatLon[] = Array.from({ length: 101 }, (_, i) => [33.42 + i * 0.0001, -111.94])

describe('simplifyLine', () => {
  it('keeps a straight line’s ends only', () => {
    expect(simplifyLine(NORTH, 5)).toEqual([NORTH[0], NORTH[100]])
  })

  it('keeps the corners of an L', () => {
    const corner: LatLon = [33.43, -111.94]
    const l: LatLon[] = [[33.42, -111.94], [33.425, -111.94], corner, [33.43, -111.93]]
    expect(simplifyLine(l, 5)).toEqual([l[0], corner, l[3]])
  })

  it('drops a wiggle under the tolerance and keeps one over it', () => {
    const small: LatLon[] = [
      [33.42, -111.94],
      [33.425, -111.94003],
      [33.43, -111.94]
    ]
    expect(simplifyLine(small, 8)).toHaveLength(2)
    const big: LatLon[] = [
      [33.42, -111.94],
      [33.425, -111.9395],
      [33.43, -111.94]
    ]
    expect(simplifyLine(big, 8)).toHaveLength(3)
  })
})

describe('encodeLine and decodeLine', () => {
  it('round-trips to about a metre', () => {
    const line: LatLon[] = [
      [33.4225691, -111.9398594],
      [33.4204812, -111.9261391]
    ]
    expect(encodeLine(line)).toEqual([33.42257, -111.93986, 33.42048, -111.92614])
    expect(decodeLine(encodeLine(line))).toEqual([
      [33.42257, -111.93986],
      [33.42048, -111.92614]
    ])
  })

  it('refuses anything that isn’t a line', () => {
    expect(decodeLine(null)).toBeNull()
    expect(decodeLine([33.4, -111.9])).toBeNull()
    expect(decodeLine([33.4, -111.9, 33.5])).toBeNull()
    expect(decodeLine([33.4, -111.9, 'x', -111.9])).toBeNull()
    expect(decodeLine([95, -111.9, 33.5, -111.9])).toBeNull()
    expect(decodeLine(new Array(20_002).fill(1))).toBeNull()
  })
})

describe('placeOnLine', () => {
  it('finds a stop beside the line, how far along and how far off', () => {
    // 50 m along, ~19 m east of the line.
    const place = placeOnLine(NORTH, [33.42 + 0.00045, -111.9398])
    expect(place?.along).toBeCloseTo(49.8, 0)
    expect(place?.offset).toBeCloseTo(18.6, 0)
  })

  it('takes the earliest pass on a loop that comes back to its first stop', () => {
    const loop: LatLon[] = [
      [33.42, -111.94],
      [33.425, -111.94],
      [33.425, -111.935],
      [33.42, -111.935],
      [33.42, -111.94]
    ]
    expect(placeOnLine(loop, [33.42, -111.94])?.along).toBe(0)
  })
})

/** Up Mill Ave, round a block, and back down Mill: ~2.2 km up, ~3.4 km down. */
const TWICE: LatLon[] = [
  [33.41, -111.94],
  [33.43, -111.94],
  [33.43, -111.935],
  [33.431, -111.935],
  [33.431, -111.94],
  [33.4, -111.94]
]

describe('placeInOrder', () => {
  const UP: LatLon = [33.42, -111.9399]
  const ROUND: LatLon = [33.4305, -111.9375]
  const DOWN: LatLon = [33.42, -111.9401]

  it('puts a stop on the pass down a street that serves it, not the first one by', () => {
    const [up, round, down] = placeInOrder(TWICE, [UP, ROUND, DOWN])
    expect(up).toBeCloseTo(1106, -1)
    expect(round).toBeCloseTo(2444, -1)
    // Back down Mill, past the block: 3.25 km to the corner, then 1.2 km south.
    expect(down).toBeCloseTo(4467, -1)
    // Alone, the nearest pass is the way up.
    expect(placeOnLine(TWICE, DOWN)?.along).toBeCloseTo(1106, -1)
  })

  it('keeps stops close together on their pass, though they land a little out of order', () => {
    // Two bays ~10 m apart, the second a touch before the first on the path.
    const [first, second] = placeInOrder(TWICE, [UP, [33.4199, -111.9399]])
    expect(first).toBeCloseTo(1106, -1)
    expect(second).toBeCloseTo(1095, -1)
  })

  it('starts a loop at its first stop and ends it there', () => {
    const loop: LatLon[] = [
      [33.42, -111.94],
      [33.425, -111.94],
      [33.425, -111.935],
      [33.42, -111.935],
      [33.42, -111.94]
    ]
    const total = lineDistances(loop).at(-1) ?? 0
    const [start, , end] = placeInOrder(loop, [
      [33.42, -111.94],
      [33.425, -111.9375],
      [33.42, -111.94]
    ])
    expect(start).toBe(0)
    expect(end).toBeCloseTo(total, 6)
  })

  it('leaves out a stop with no pass after the one before, and goes on from there', () => {
    // Round the block again after the way down: the path doesn't go back there.
    const places = placeInOrder(TWICE, [UP, ROUND, DOWN, ROUND, [33.405, -111.9401]])
    expect(places[3]).toBeNull()
    expect(places[4]).toBeCloseTo(6126, -1)
  })
})

describe('placeBefore', () => {
  const onMill: LatLon = [33.415, -111.94]

  it('puts a bus on the pass that comes up to the stop it’s heading to', () => {
    // Heading for a stop on the way up (1.1 km along), or one down Mill past the block (6.1 km).
    expect(placeBefore(TWICE, onMill, 1106)?.along).toBeCloseTo(553, -1)
    expect(placeBefore(TWICE, onMill, 6126)?.along).toBeCloseTo(5021, -1)
    // Heading for the block: the way down is still to come, so it's on the way up.
    expect(placeBefore(TWICE, onMill, 2444)?.along).toBeCloseTo(553, -1)
    // Not said: the earliest.
    expect(placeBefore(TWICE, onMill, null)?.along).toBeCloseTo(553, -1)
  })

  it('keeps a bus parked at a transit center’s bay on the way in, not the way out past it', () => {
    // North to the bay, round the center's loop, and out west past the bay 11 m off.
    const center: LatLon[] = [
      [33.41, -111.94],
      [33.42, -111.94],
      [33.42, -111.938],
      [33.4199, -111.938],
      [33.4199, -111.9405],
      [33.43, -111.9405]
    ]
    expect(placeBefore(center, [33.4201, -111.94], 1106)?.along).toBeCloseTo(1106, -1)
  })

  it('takes the earliest when no pass comes before the stop it’s heading to', () => {
    // South of the way up's start, only the way down: the feed and the path disagree.
    expect(placeBefore(TWICE, [33.405, -111.94], 1106)?.along).toBeCloseTo(6126, -1)
  })
})

describe('isLoop', () => {
  it('knows a path that ends where it starts', () => {
    const loop: LatLon[] = [
      [33.42, -111.94],
      [33.425, -111.94],
      [33.425, -111.935],
      [33.4201, -111.9401]
    ]
    expect(isLoop(loop)).toBe(true)
    expect(isLoop(NORTH)).toBe(false)
    expect(isLoop([[33.42, -111.94]])).toBe(false)
  })
})

describe('pointAlong and sliceLine', () => {
  const total = lineDistances(NORTH).at(-1) ?? 0

  it('walks along the line, clamped to its ends', () => {
    expect(pointAlong(NORTH, -5)).toEqual(NORTH[0])
    expect(pointAlong(NORTH, total + 5)).toEqual(NORTH[100])
    const middle = pointAlong(NORTH, total / 2)
    expect(middle?.[0]).toBeCloseTo(33.425, 5)
  })

  it('cuts a stretch cleanly at both ends', () => {
    const piece = sliceLine(NORTH, 100, 300)
    expect(distanceM(piece[0] as LatLon, piece.at(-1) as LatLon)).toBeCloseTo(200, 0)
    expect(sliceLine(NORTH, 300, 100)).toEqual([])
  })
})

describe('frameStretch', () => {
  it('shows a short route whole', () => {
    expect(frameStretch(9_000, 3_000)).toEqual([0, 9_000])
  })

  it('shows where a long route’s bus comes from and goes, sliding at the ends', () => {
    expect(frameStretch(40_000, 20_000)).toEqual([20_000 - BEFORE_STOP_M, 20_000 + AFTER_STOP_M])
    expect(frameStretch(40_000, 1_000)).toEqual([0, BEFORE_STOP_M + AFTER_STOP_M])
    expect(frameStretch(40_000, 39_000)).toEqual([40_000 - BEFORE_STOP_M - AFTER_STOP_M, 40_000])
    expect(WHOLE_LINE_M).toBeLessThan(BEFORE_STOP_M + AFTER_STOP_M + 4_000)
  })
})

describe('fitBox and projector', () => {
  it('fits the points with room to spare, in the picture’s shape', () => {
    const box = fitBox(NORTH, 2, 0.1)
    if (!box) throw new Error('no box')
    expect(box.north).toBeGreaterThan(33.43)
    expect(box.south).toBeLessThan(33.42)
    const width = mercatorX(box.east) - mercatorX(box.west)
    const height = mercatorY(box.south) - mercatorY(box.north)
    expect(width / height).toBeCloseTo(2, 6)
  })

  it('grows to give one point the room it asks for, keeping the shape and the rest', () => {
    const top = NORTH[100] as LatLon
    const plain = fitBox(NORTH, 2, 0.1)
    const roomy = fitBox(NORTH, 2, 0.1, { point: top, above: 0.2, below: 0.05, aside: 0.3 })
    if (!plain || !roomy) throw new Error('no box')
    const [x, y] = projector(roomy, [0, 0], [1, 1])(top)
    expect(y).toBeCloseTo(0.2, 6)
    expect(x).toBeGreaterThanOrEqual(0.3)
    const width = mercatorX(roomy.east) - mercatorX(roomy.west)
    const height = mercatorY(roomy.south) - mercatorY(roomy.north)
    expect(width / height).toBeCloseTo(2, 6)
    // Only ever grown: what fitted before still fits.
    expect(roomy.north).toBeGreaterThan(plain.north)
    expect(roomy.south).toBeLessThanOrEqual(plain.south)
    // A point with room enough already changes nothing.
    const middle = NORTH[50] as LatLon
    expect(fitBox(NORTH, 2, 0.1, { point: middle, above: 0.2, below: 0.2, aside: 0.2 })).toEqual(
      plain
    )
  })

  it('never zooms in past a few blocks', () => {
    const box = fitBox([[33.42, -111.94]], 1, 0)
    if (!box) throw new Error('no box')
    expect(distanceM([box.south, box.west], [box.north, box.west])).toBeGreaterThan(850)
  })

  it('puts the box’s corners where the picture says, and its middle in the middle', () => {
    const box = fitBox(NORTH, 1.5, 0.1)
    if (!box) throw new Error('no box')
    const place = projector(box, [0, 0], [1, 1])
    expect(place([box.north, box.west])).toEqual([0, 0])
    const [x, y] = place([box.south, box.east])
    expect(x).toBeCloseTo(1, 9)
    expect(y).toBeCloseTo(1, 9)
    const [mx] = place([33.425, (box.east + box.west) / 2])
    expect(mx).toBeCloseTo(0.5, 9)
    // A line north on the map goes up the picture.
    expect(place(NORTH[100] as LatLon)[1]).toBeLessThan(place(NORTH[0] as LatLon)[1])
  })
})
