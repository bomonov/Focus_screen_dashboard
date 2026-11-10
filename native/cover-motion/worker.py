"""Cuts covers into moving parts for the animated cover (Focus Screen).

A JSON-lines worker: one request per line on stdin, one reply per line on stdout; it exits when
stdin closes. Main sends file paths inside the app's own cover-motion folder and reads back what
was written there. Nothing here touches the network: SAM 2.1 is loaded from the runtime that
native/cover-motion/setup.sh installed (FOCUS_COVER_RUNTIME).

Requests:
  {"op":"prepare","id":N,"cover":PATH}
      loads SAM and reads the cover, so the first click is as quick as the rest; replies {}
  {"op":"cut","id":N,"cover":PATH,"base":PATH|null,
   "strokes":[{"point":[x,y],"add":bool,"size":int|null}, ...],"out":PATH}
      a part from its clicks, in order: each one's cut (SAM's sizes for it, smallest first;
      null starts on the default, a size past the last wraps round) added to or carved from
      the base mask (or nothing); writes the mask (0/255 PNG) to out; replies
      {"area": share of the cover, "sizes": [the size each click used]}
  {"op":"hit","id":N,"point":[x,y],"masks":[PATH,...]}
      replies {"index": the last of the masks under the point (the one drawn on top), or -1}
  {"op":"build","id":N,"cover":PATH,"parts":[{"mask":PATH,"kind":K,"turn":0-7,"out":PATH}],
   "protected":[PATH,...],"plate":PATH}
      writes each part's weight map (R motion weight, G how far along from its pinned side,
      B its feathered mask) and, when a part bobs, the plate (the cover with what's under the
      bobbing parts filled in); replies {"plate": bool, "parts":[{"move","center","emitters",
      "color"}, ...]}
"""

import json
import os
import sys

import cv2
import numpy as np

S = 768
# Text, logos and faces never move: nothing within this of them, and full motion only past twice it.
PROTECT_MARGIN = 12
# Surge and Sway bend a band this wide round their part, so its edge moves out over what's next to
# it instead of tearing from it.
BEND_RADIUS = 20
RING = 12
MAX_EMITTERS = 200
# A click's cuts: under the smallest is a speck, over the largest is most of the cover (main
# refuses the same), and two cuts this alike are one choice.
MIN_PIECE = 0.002
MAX_PIECE = 0.8
SAME_CUT = 0.9
# A click starts on the smallest cut at least this big: smaller ones are a highlight or a strand,
# and SAM's largest is nearly always the whole character or the whole background (checked on
# the user's covers, 2026-10-22).
START_PIECE = 0.005
MAX_STROKES = 8


def disc(radius: int) -> np.ndarray:
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))


def feather(mask: np.ndarray, sigma: float) -> np.ndarray:
    return np.clip(cv2.GaussianBlur(mask.astype(np.float32), (0, 0), sigma), 0, 1)


def smoothstep(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def centroid(mask: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(mask)
    return np.array([xs.mean(), ys.mean()], np.float32)


def pin_and_move(gray: np.ndarray, mask: np.ndarray, turn: int) -> tuple[np.ndarray, np.ndarray]:
    """Which way a part moves, and the point it's pinned at.

    A part hangs off the busy, detailed side it's attached to (a head, a hull, the sea) and
    moves toward the open side (sky, background): the pin is the centroid of the ring round the
    part, weighted by how much detail is there. `turn` (eighths of a full turn, clockwise on the
    picture) is the user's correction; the pin stays opposite wherever the motion points.
    """
    ring = (cv2.dilate(mask.astype(np.uint8), disc(RING)) > 0) & ~mask
    g = gray.astype(np.float32)
    detail = cv2.GaussianBlur(np.hypot(cv2.Sobel(g, cv2.CV_32F, 1, 0), cv2.Sobel(g, cv2.CV_32F, 0, 1)), (0, 0), 6)
    ys, xs = np.nonzero(ring)
    weights = detail[ys, xs] + 1e-3
    pinned = np.array([np.average(xs, weights=weights), np.average(ys, weights=weights)], np.float32)
    middle = centroid(mask)
    move = middle - pinned
    length = float(np.hypot(*move))
    move = move / length if length > 1e-3 else np.array([0.0, -1.0], np.float32)
    if turn % 8 == 0:
        return move, pinned
    angle = (turn % 8) * np.pi / 4
    cos, sin = np.cos(angle), np.sin(angle)
    turned = np.array([move[0] * cos - move[1] * sin, move[0] * sin + move[1] * cos], np.float32)
    return turned, middle - turned * max(length, 1.0)


def weight_map(mask: np.ndarray, kind: str, move: np.ndarray, pinned: np.ndarray, protected: np.ndarray) -> np.ndarray:
    """A part's weight map, H×W×3 uint8: R how much it moves, G how far along from its pin, B its
    feathered mask (what a bobbing part is drawn with)."""
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    projection = (xx - pinned[0]) * move[0] + (yy - pinned[1]) * move[1]
    inside = projection[mask]
    low, high = float(inside.min()), float(inside.max())
    along = np.clip((projection - low) / max(high - low, 1.0), 0, 1)

    if kind in ("surge", "sway"):
        reach = feather(cv2.dilate(mask.astype(np.uint8), disc(BEND_RADIUS)), 10)
        weight = smoothstep(along) * reach
    elif kind == "flutter":
        weight = feather(mask, 3) * along**2
    elif kind == "bob":
        weight = feather(mask, 0.8)
    else:  # drift, twinkle, spray
        weight = feather(mask, 3)

    if protected.any():
        guard = cv2.dilate(protected.astype(np.uint8), disc(PROTECT_MARGIN)) > 0
        distance = cv2.distanceTransform((~guard).astype(np.uint8), cv2.DIST_L2, 5)
        weight = weight * smoothstep(distance / PROTECT_MARGIN)

    out = np.zeros((S, S, 3), np.uint8)
    out[..., 0] = np.round(weight * 255)
    out[..., 1] = np.round(along * 255)
    out[..., 2] = np.round(feather(mask, 0.8) * 255)
    return out


def emitters(mask: np.ndarray, move: np.ndarray) -> list[tuple[int, int]]:
    """Where spray leaves a part: the ring round it on the side it moves toward, furthest out."""
    ring = (cv2.dilate(mask.astype(np.uint8), disc(RING)) > 0) & ~mask
    ys, xs = np.nonzero(ring)
    middle = centroid(mask)
    ahead = (xs - middle[0]) * move[0] + (ys - middle[1]) * move[1]
    keep = ahead > 0
    xs, ys, ahead = xs[keep], ys[keep], ahead[keep]
    order = np.argsort(-ahead)[:MAX_EMITTERS]
    return [(int(xs[i]), int(ys[i])) for i in order]


def plate(cover: np.ndarray, bob_masks: list[np.ndarray]) -> np.ndarray:
    """The cover with what's under its bobbing parts filled in, so a lifted part leaves no hole."""
    hidden = np.zeros(cover.shape[:2], np.uint8)
    for mask in bob_masks:
        hidden |= cv2.dilate(mask.astype(np.uint8), disc(4))
    if not hidden.any():
        return cover.copy()
    return cv2.inpaint(cover, hidden * 255, 7, cv2.INPAINT_TELEA)


def part_color(cover: np.ndarray, mask: np.ndarray) -> list[int]:
    """The part's own light: the mean of its brightest tenth (spray drops are drawn in it)."""
    pixels = cover[mask].astype(np.float32)
    brightness = pixels.mean(-1)
    top = pixels[brightness >= np.percentile(brightness, 90)]
    return [int(round(c)) for c in top.mean(0)]


def size_options(masks: list[np.ndarray]) -> list[np.ndarray]:
    """A click's cuts to choose from, smallest first, without specks, near-whole covers or
    repeats. When none is in range, the one nearest it, so main can say what was wrong."""
    areas = [float(m.mean()) for m in masks]
    order = sorted(range(len(masks)), key=lambda i: areas[i])
    kept: list[np.ndarray] = []
    for i in order:
        if not MIN_PIECE <= areas[i] <= MAX_PIECE:
            continue
        if kept:
            last = kept[-1]
            if (masks[i] & last).sum() > SAME_CUT * (masks[i] | last).sum():
                continue
        kept.append(masks[i])
    if kept or not masks:
        return kept
    nearest = min(range(len(masks)), key=lambda i: MIN_PIECE - areas[i] if areas[i] < MIN_PIECE else areas[i] - MAX_PIECE)
    return [masks[nearest]]


def default_size(options: list[np.ndarray]) -> int:
    return next((i for i, m in enumerate(options) if m.mean() >= START_PIECE), len(options) - 1)


def combine(base: np.ndarray | None, cuts: list[tuple[np.ndarray, bool]]) -> np.ndarray:
    """A part from its clicks in order: each adds its cut or carves it out, so a later click wins."""
    mask = base.copy() if base is not None else np.zeros((S, S), bool)
    for cut, add in cuts:
        if add:
            mask |= cut
        else:
            mask &= ~cut
    return mask


def hit_index(masks: list[np.ndarray], point: tuple[float, float]) -> int:
    x = min(max(int(round(point[0])), 0), S - 1)
    y = min(max(int(round(point[1])), 0), S - 1)
    return next((i for i in range(len(masks) - 1, -1, -1) if masks[i][y, x]), -1)


def read_mask(path: str) -> np.ndarray:
    image = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if image is None or image.shape != (S, S):
        raise ValueError("a mask is missing or the wrong size")
    return image > 127


def read_cover(path: str) -> np.ndarray:
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("the cover can't be read")
    return cv2.cvtColor(cv2.resize(image, (S, S), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)


class Segmenter:
    """SAM 2.1, loaded on first use (a few seconds) and kept while the worker runs. The cover's
    image embedding is kept too: it's most of SAM's work (about 0.6 s), and each click after
    it only costs the prompt (about 10 ms)."""

    def __init__(self, runtime: str) -> None:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        import torch
        from transformers import Sam2Model, Sam2Processor

        self.torch = torch
        model_dir = os.path.join(runtime, "models", "sam2.1-hiera-base-plus")
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.processor = Sam2Processor.from_pretrained(model_dir, local_files_only=True)
        self.model = Sam2Model.from_pretrained(model_dir, local_files_only=True).to(self.device).eval()
        self.read: tuple[str, int] | None = None
        self.embeddings = None
        self.sizes = None

    def embed(self, path: str) -> None:
        """Reads the cover once; the editor writes a fresh one when it opens, so a changed file
        is read again."""
        from PIL import Image

        stamp = (path, os.stat(path).st_mtime_ns)
        if stamp == self.read:
            return
        inputs = self.processor(images=Image.fromarray(read_cover(path)), return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            self.embeddings = self.model.get_image_embeddings(inputs["pixel_values"])
        self.sizes = inputs["original_sizes"]
        self.read = stamp

    def options(self, path: str, point: list[float]) -> list[np.ndarray]:
        """SAM's three cuts for one click (a strand, a piece, the whole thing), as size_options."""
        self.embed(path)
        prompt = self.processor(input_points=[[[point]]], input_labels=[[[1]]], original_sizes=self.sizes, return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            outputs = self.model(
                input_points=prompt["input_points"],
                input_labels=prompt["input_labels"],
                image_embeddings=self.embeddings,
                multimask_output=True,
            )
        masks = self.processor.post_process_masks(outputs.pred_masks.cpu(), self.sizes)
        return size_options([m.numpy() > 0 for m in masks[0][0]])


def point_in(raw: object) -> list[float]:
    if not (isinstance(raw, list) and len(raw) == 2 and all(isinstance(v, (int, float)) for v in raw)):
        raise ValueError("a click isn't a point")
    x, y = float(raw[0]), float(raw[1])
    if not (0 <= x <= S and 0 <= y <= S):
        raise ValueError("a click is off the cover")
    return [x, y]


def cut(segmenter: Segmenter, request: dict) -> dict:
    strokes = request["strokes"]
    if not isinstance(strokes, list) or not 1 <= len(strokes) <= MAX_STROKES:
        raise ValueError("a part takes 1 to 8 clicks")
    base = read_mask(request["base"]) if request.get("base") else None
    cuts, sizes = [], []
    for stroke in strokes:
        options = segmenter.options(request["cover"], point_in(stroke.get("point")))
        if not options:
            raise ValueError("nothing there to cut out")
        size = stroke.get("size")
        size = default_size(options) if size is None else int(size) % len(options)
        cuts.append((options[size], bool(stroke.get("add"))))
        sizes.append(size)
    mask = combine(base, cuts)
    cv2.imwrite(request["out"], mask.astype(np.uint8) * 255)
    return {"area": float(mask.mean()), "sizes": sizes}


def hit(request: dict) -> dict:
    point = point_in(request["point"])
    return {"index": hit_index([read_mask(path) for path in request["masks"]], (point[0], point[1]))}


def build(request: dict) -> dict:
    cover = read_cover(request["cover"])
    gray = cv2.cvtColor(cover, cv2.COLOR_RGB2GRAY)
    protected = np.zeros((S, S), bool)
    for path in request.get("protected", []):
        protected |= read_mask(path)
    parts, bobbing = [], []
    for part in request["parts"]:
        mask = read_mask(part["mask"])
        if not mask.any():
            raise ValueError("a part's mask is empty")
        move, pinned = pin_and_move(gray, mask, int(part["turn"]))
        weights = weight_map(mask, part["kind"], move, pinned, protected)
        cv2.imwrite(part["out"], weights[..., ::-1])
        if part["kind"] == "bob":
            bobbing.append(mask)
        middle = centroid(mask)
        parts.append({
            "move": [float(move[0]), float(move[1])],
            "center": [float(middle[0]), float(middle[1])],
            "emitters": [list(p) for p in emitters(mask, move)] if part["kind"] == "spray" else [],
            "color": part_color(cover, mask),
        })
    if bobbing:
        filled = plate(cover, bobbing)
        cv2.imwrite(request["plate"], cv2.cvtColor(filled, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92])
    return {"plate": bool(bobbing), "parts": parts}


def reply(message: dict) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def main() -> None:
    runtime = os.environ.get("FOCUS_COVER_RUNTIME", "")
    segmenter = None
    for line in sys.stdin:
        try:
            request = json.loads(line)
        except ValueError:
            continue
        if not isinstance(request, dict):
            continue
        rid = request.get("id")
        try:
            if request.get("op") == "prepare":
                segmenter = segmenter or Segmenter(runtime)
                segmenter.embed(request["cover"])
                reply({"type": "reply", "id": rid, "ok": True})
            elif request.get("op") == "cut":
                segmenter = segmenter or Segmenter(runtime)
                reply({"type": "reply", "id": rid, "ok": True, **cut(segmenter, request)})
            elif request.get("op") == "hit":
                reply({"type": "reply", "id": rid, "ok": True, **hit(request)})
            elif request.get("op") == "build":
                reply({"type": "reply", "id": rid, "ok": True, **build(request)})
            else:
                reply({"type": "reply", "id": rid, "ok": False, "error": "unknown op"})
        except Exception as error:  # noqa: BLE001 - any failure is one failed request, never the worker
            reply({"type": "reply", "id": rid, "ok": False, "error": str(error)[:200]})


if __name__ == "__main__":
    main()
