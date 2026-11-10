/** A pill's page turn: on to what comes later (a swipe right to left), or back. */
export type Turn = 'next' | 'back'

/** Which ways there's a page to turn to. */
export interface CanTurn {
  next: boolean
  back: boolean
}

/** A press that moves this far sideways is a swipe, not a hold or a click. */
export const SLOP_PX = 8
/** How far a drag goes before letting go turns the page. */
export const DRAG_TURN_PX = 40
/** How far a trackpad swipe goes before the page turns, there and then. */
export const WHEEL_TURN_PX = 64
/** A trackpad swipe has ended, its momentum too, after this long without a wheel event. */
export const WHEEL_QUIET_MS = 160
/**
 * A new swipe's speed (px/ms) over the slowest its last one's momentum got to, to count as
 * starting afresh: picking up from a near stop, not the momentum's own wobble.
 */
const PICK_UP_RATIO = 2.5
const PICK_UP_MIN = 0.15
/** Going back the other way this far (px) in one event is a new swipe: momentum never turns. */
const REVERSE_PX = 2
/** The most the words give when there's nothing that way. */
const RUBBER_PX = 24

/**
 * Where a sideways stroke of `dx` (negative: right to left) puts the pill's words: with the
 * finger when there's a page that way, else a little, giving less the further it goes, like a
 * list pulled past its end.
 */
export function swipeOffset(dx: number, can: CanTurn): number {
  if (dx === 0 || (dx < 0 ? can.next : can.back)) return dx
  const pulled = Math.abs(dx)
  return Math.sign(dx) * RUBBER_PX * (1 - 1 / ((pulled * 0.55) / RUBBER_PX + 1))
}

/** The turn a stroke of `dx` makes once it's gone `distance`, if there's a page that way. */
export function turnFor(dx: number, can: CanTurn, distance: number): Turn | null {
  if (dx <= -distance && can.next) return 'next'
  if (dx >= distance && can.back) return 'back'
  return null
}

export interface WheelStep {
  /** Where the words are now (0 once the page has turned). */
  offset: number
  turn: Turn | null
}

/**
 * Trackpad swipes, which arrive as a stream of wheel events. The words follow the fingers and
 * the page turns as soon as the swipe has gone far enough; the rest of that swipe and its
 * momentum (macOS keeps sending events for a second or so after the fingers lift) do nothing,
 * so one swipe is one turn.
 *
 * The next swipe often starts before that momentum has died away, with no pause in the stream:
 * it counts as new when it goes back the other way, or picks up speed again after the momentum
 * had slowed right down. Speeds (px per ms) rather than distances, so events Chromium merges
 * while busy don't look like a pick-up. An up-and-down event isn't ours.
 */
export function createWheelSwipe(): {
  /** One wheel event at `time` ms; null when it's not part of a sideways swipe. */
  feed(deltaX: number, deltaY: number, time: number, can: CanTurn): WheelStep | null
} {
  let dx = 0
  let last = -Infinity
  /** The page has turned: what follows is this swipe's own tail until a new one starts. */
  let spent = false
  let spentSign = 0
  /** The fastest the tail has gone, and the slowest since then. */
  let fastest = 0
  let slowest = 0
  return {
    feed(deltaX, deltaY, time, can) {
      if (Math.abs(deltaY) > Math.abs(deltaX)) return null
      const gap = time - last
      last = time
      const speed = Math.abs(deltaX) / Math.max(gap, 4)
      if (gap > WHEEL_QUIET_MS) {
        dx = 0
        spent = false
      } else if (spent) {
        const reversed = Math.sign(deltaX) === -spentSign && Math.abs(deltaX) >= REVERSE_PX
        const pickedUp =
          slowest <= fastest / 3 &&
          speed >= Math.max(slowest * PICK_UP_RATIO, slowest + PICK_UP_MIN)
        if (speed > fastest) {
          // Still speeding up: the same swipe, carrying on. Slowing starts counting from here.
          fastest = speed
          slowest = speed
        } else {
          slowest = Math.min(slowest, speed)
        }
        if (!reversed && !pickedUp) return { offset: 0, turn: null }
        spent = false
        dx = 0
      }
      // A positive deltaX scrolls to the right: the words go left, the way the fingers did.
      dx -= deltaX
      const turn = turnFor(dx, can, WHEEL_TURN_PX)
      if (turn) {
        spent = true
        spentSign = Math.sign(deltaX)
        fastest = speed
        slowest = speed
        dx = 0
        return { offset: 0, turn }
      }
      return { offset: swipeOffset(dx, can), turn: null }
    }
  }
}
