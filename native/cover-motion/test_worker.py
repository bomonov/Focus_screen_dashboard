"""Tests for worker.py's image maths (no SAM needed).

Run with the runtime's Python:
  "$HOME/Library/Application Support/Focus Screen/cover-motion/.venv/bin/python" -I -B \
    native/cover-motion/test_worker.py -v
"""

import os
import sys
import unittest

import numpy as np

# -I leaves the script's folder off the path, and the folder's name can't be a package name.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from worker import combine, default_size, emitters, hit_index, pin_and_move, plate, size_options, weight_map  # noqa: E402

S = 768


def square(x: int, y: int, side: int) -> np.ndarray:
    mask = np.zeros((S, S), bool)
    mask[y:y + side, x:x + side] = True
    return mask


def synthetic_cover() -> tuple[np.ndarray, np.ndarray]:
    """A smooth sky above y=400, busy ground below, and a white blob part straddling the line."""
    rng = np.random.default_rng(1)
    cover = np.zeros((S, S, 3), np.uint8)
    # A soft vertical gradient: smooth, like a sky.
    cover[:400, :, 0] = 120
    cover[:400, :, 1] = (150 + np.arange(400) // 8)[:, None]
    cover[:400, :, 2] = 230
    cover[400:] = rng.integers(0, 255, (S - 400, S, 3), dtype=np.uint8)
    yy, xx = np.mgrid[0:S, 0:S]
    blob = (xx - 384) ** 2 + (yy - 400) ** 2 < 90**2
    cover[blob] = 250
    return cover, blob


class WorkerMaths(unittest.TestCase):
    def setUp(self) -> None:
        self.cover, self.blob = synthetic_cover()
        self.gray = self.cover.mean(-1).astype(np.uint8)

    def test_moves_toward_the_open_side(self) -> None:
        move, pinned = pin_and_move(self.gray, self.blob, 0)
        self.assertLess(move[1], -0.5)  # up, into the smooth sky
        self.assertGreater(pinned[1], 400)  # hangs off the busy ground
        flipped, _ = pin_and_move(self.gray, self.blob, 4)  # half a turn: the other way
        self.assertGreater(flipped[1], 0.5)
        right, _ = pin_and_move(self.gray, self.blob, 2)  # a quarter turn clockwise from up
        self.assertGreater(right[0], 0.5)

    def test_surge_is_still_at_its_pin_and_moves_most_at_its_far_end(self) -> None:
        move, pinned = pin_and_move(self.gray, self.blob, 0)
        w = weight_map(self.blob, "surge", move, pinned, np.zeros((S, S), bool))
        self.assertLess(w[488, 384, 0], 20)  # the bottom edge, at the pin
        self.assertGreater(w[315, 384, 0], 200)  # the top, the far end

    def test_protected_pixels_and_their_margin_never_move(self) -> None:
        move, pinned = pin_and_move(self.gray, self.blob, 0)
        guard = np.zeros((S, S), bool)
        guard[330:370, 300:340] = True
        w = weight_map(self.blob, "surge", move, pinned, guard)
        self.assertEqual(int(w[330:370, 300:340, 0].max()), 0)
        # Everything within 12 px of it (straight-line distance, so the corners round off).
        yy, xx = np.mgrid[0:S, 0:S]
        dx = np.maximum(np.maximum(300 - xx, xx - 339), 0)
        dy = np.maximum(np.maximum(330 - yy, yy - 369), 0)
        near = np.hypot(dx, dy) <= 12
        self.assertEqual(int(w[near, 0].max()), 0)
        # Further out it moves again.
        self.assertGreater(int(w[330:370, 200:280, 0].max()), 0)

    def test_spray_leaves_from_the_open_side(self) -> None:
        move, pinned = pin_and_move(self.gray, self.blob, 0)
        points = emitters(self.blob, move)
        self.assertGreater(len(points), 10)
        self.assertLessEqual(len(points), 200)
        for x, y in points:
            self.assertFalse(self.blob[y, x])
            self.assertLess(y, 400)

    def test_the_plate_only_changes_under_bobbing_parts(self) -> None:
        out = plate(self.cover, [self.blob])
        far = np.ones((S, S), bool)
        far[300:500, 284:484] = False
        self.assertTrue(np.array_equal(out[far], self.cover[far]))


class Clicks(unittest.TestCase):
    """What a click cuts out: SAM gives three nested cuts, and clicks add to or carve a part."""

    def test_sizes_run_small_to_large_without_specks_whole_covers_or_repeats(self) -> None:
        speck = square(0, 0, 20)  # 0.07%: smaller than anything worth moving
        piece = square(0, 0, 100)  # 1.7%
        twin = square(0, 0, 101)  # the same piece again, near enough
        everything = square(0, 0, 740)  # 93%: most of the cover
        head = square(0, 0, 300)  # 15%
        options = size_options([everything, head, piece, speck, twin])
        self.assertEqual([round(float(m.mean()), 3) for m in options], [0.017, 0.153])

    def test_with_nothing_in_range_the_nearest_is_kept_so_it_can_be_refused(self) -> None:
        options = size_options([square(0, 0, 20), square(0, 0, 10)])
        self.assertEqual(len(options), 1)
        self.assertEqual(int(options[0].sum()), 400)

    def test_a_click_starts_on_the_smallest_cut_that_is_more_than_a_fleck(self) -> None:
        fleck, hair, head = square(0, 0, 40), square(0, 0, 80), square(0, 0, 300)  # 0.3%, 1.1%, 15%
        self.assertEqual(default_size([fleck, hair, head]), 1)
        self.assertEqual(default_size([hair, head]), 0)
        # All flecks: the biggest of them.
        self.assertEqual(default_size([square(0, 0, 36), fleck]), 1)

    def test_clicks_apply_in_order_onto_the_starting_mask(self) -> None:
        left, right, middle = square(0, 0, 200), square(400, 0, 200), square(100, 0, 400)
        both = combine(None, [(left, True), (right, True)])
        self.assertEqual(int(both.sum()), 2 * 200 * 200)
        carved = combine(None, [(left, True), (right, True), (middle, False)])
        self.assertEqual(int(carved.sum()), 2 * 100 * 200)  # the outer halves of each
        # A later add puts back what an earlier carve took.
        self.assertTrue(combine(None, [(left, True), (middle, False), (right, True)])[100, 450])
        base = square(600, 600, 100)
        self.assertTrue(combine(base, [(left, True)])[650, 650])

    def test_the_part_under_a_click_is_the_topmost_one_there(self) -> None:
        under, over = square(0, 0, 300), square(100, 100, 100)
        self.assertEqual(hit_index([under, over], (150, 150)), 1)
        self.assertEqual(hit_index([under, over], (20, 20)), 0)
        self.assertEqual(hit_index([under, over], (700, 700)), -1)
        self.assertEqual(hit_index([under], (767.9, 0.2)), -1)


if __name__ == "__main__":
    unittest.main()
