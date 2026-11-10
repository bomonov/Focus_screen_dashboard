# Layered Animated Cover, Phase 1: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Covers the user hand-picks parts on come alive in layers. Each part (wave, hair, sky, boat, spray…) gets its own looping motion, and everything else stays the cover's own pixels.

**Architecture:**

- **A Python worker on the Mac** (SAM 2.1, OpenCV) cuts parts out from clicks. It writes per-part weight maps and a filled-in "plate" for each cover into `userData/cover-motion/<key>/`, once.
- **Main** keeps a recipe per cover, keyed by a perceptual hash, and pushes a ready-to-draw scene to the renderer.
- **The renderer animates it live in WebGL** inside the existing `AnimatedCover`, on an 8 s loop, only while music plays.
- **Customize gets an editor** to click parts and pick their motion, with a live preview.
- Automatic part-finding is **phase 2, its own plan**, written after this ships: it starts with a model trial on the user's covers.

**Tech Stack:**

- Electron, TypeScript (strict), React, WebGL 1, Vitest.
- Python 3.12 with torch 2.14.1, transformers 5.3.0 (`Sam2Model`) and opencv-python-headless 5.0.0.93.
- SAM 2.1 `facebook/sam2.1-hiera-base-plus` (Apache-2.0, ungated).

**Spec:** `docs/superpowers/specs/2026-10-21-layered-animated-cover-design.md` (approved by the user 2026-10-21).
**Approved look:** `~/Library/Developer/FocusScreen/ai-cover-test/out/wave-layers-150.gif`, from `scripts/animate_layers.py` and `scripts/seg.py` (the spike; read them for the math).

## Global Constraints

- **CLAUDE.md applies in full:**
  - the renderer never touches Node or files;
  - every IPC channel and payload type lives in `src/main/ipc.ts`;
  - helper output is untrusted, so anything off-shape is no data;
  - `npm run typecheck`, `npm run lint` and `npm test` pass after every task;
  - comments explain why;
  - commit locally after each task, and never push.
- **Loop and strength:**
  - The loop is **8 s**, and every motion's period divides it.
  - The default strength is **1.5**.
  - Strength scales distances and speeds, **never periods**.
- **The approved motions at strength 1.0** (all distances at 768 px):

  | Kind    | Motion                                                                                                     |
  | ------- | ---------------------------------------------------------------------------------------------------------- |
  | Surge   | 16 px, once per loop                                                                                       |
  | Flutter | 2.5 px, twice per loop                                                                                     |
  | Sway    | 10 px, once per loop (my value: "gentler than Surge")                                                      |
  | Drift   | 4 px/s, two offsets crossfaded every 4 s                                                                   |
  | Bob     | 2–3 px lift and ±0.8° tilt, periods 4 s or 8/3 s                                                           |
  | Spray   | ~90 drops per loop; life 1.4–2.4 s; vx 35–85 px/s; vy −70 to −20 px/s; gravity 55 px/s²; radius 1.1–2.8 px |
  | Twinkle | brightness ±20%, twice per loop                                                                            |

- **Analysis size:** 768×768. The cover is centre-cropped to a square, as the renderer's `object-fit: cover` does.
- **At most 6 parts** per cover (WebGL 1 sampler budget: cover + plate + 6 weight maps ≤ 8 units).
- **Where things live:**
  - The runtime is in `~/Library/Application Support/Focus Screen/cover-motion` (`.venv`, `models/`), installed by `npm run setup:covers`. It is never in the repo or the bundle.
  - Only `native/cover-motion/worker.py` ships, under `Resources/cover-motion/`.
- **Network:** covers never leave the Mac. Only the setup script downloads anything: the Python packages, and SAM from Hugging Face with `HF_HUB_DISABLE_TELEMETRY=1`.
- **Platform:** Mac only. Elsewhere, and whenever the runtime is missing, the feature hides.
- **When it draws:**
  - only while music plays;
  - nothing while paused;
  - still under `prefers-reduced-motion`;
  - glow, sheen and sparkle keep working, and a cover with no recipe looks exactly as today.
- **The user's hand-picked parts win:** the editor runs no text or face detection.
- **Protected areas** (used by phase 2; built now as worker input) are text, logos and faces:
  - their pixels never move;
  - motion fades to 0 across **12 px**;
  - the Surge/Sway bend band (**20 px** radius) never reaches into them.

## Review Focus

1. **The song changes while the editor is open:** the editor keeps editing the cover it opened with, and Save writes to that cover's key, not the new song's. (Task 6 test.)
2. **A non-square or late-arriving cover** (a YouTube 16:9 thumbnail, or artwork arriving after the track): it's cropped the same way for the key, the worker and the renderer, and a recipe is looked up again when the artwork arrives. (Task 4 and Task 6 tests.)
3. **The worker is missing, crashed or slow** (the first SAM load takes ~10 s): the editor shows Loading, then a clear error, and never hangs. Playing a saved recipe never needs the worker. (Task 5 test.)
4. **A corrupt or future-version recipe file:** it's treated as no recipe, the cover keeps the glow only, and nothing crashes. (Task 2 test.)
5. **A click that selects nearly nothing or nearly everything** (under 0.2% or over 80% of the cover): the part is refused with "That's too small to move" or "That's most of the cover", and nothing is added. (Task 6 test.)

---

### Task 1: Settings for moving parts

**Files:**

- Modify: `src/main/services/settings/schema.ts` (the `MusicSettings` interface, `defaultMusicSettings`, `parseMusicSettings`)
- Modify: `src/main/services/settings/schema.test.ts`
- Modify: `src/renderer/screens/customize/customizeView.test.ts` (the `music` fixture)

**Interfaces:**

- Produces:
  - `MusicSettings.movingParts: boolean` (default `true`);
  - `MusicSettings.motionStrength: number` (default `1.5`, clamped to 0.5–2.5, steps of 0.1);
  - exported constant `DEFAULT_MOTION_STRENGTH = 1.5`.

- [ ] **Step 1: Write the failing test** in `schema.test.ts`:

```ts
it('fills in moving parts and clamps motion strength', () => {
  expect(parseSettings({}).music.movingParts).toBe(true)
  expect(parseSettings({}).music.motionStrength).toBe(1.5)
  expect(parseSettings({ music: { movingParts: false } }).music.movingParts).toBe(false)
  expect(parseSettings({ music: { motionStrength: 9 } }).music.motionStrength).toBe(2.5)
  expect(parseSettings({ music: { motionStrength: 0.1 } }).music.motionStrength).toBe(0.5)
  expect(parseSettings({ music: { motionStrength: '2' } }).music.motionStrength).toBe(1.5)
})
```

- [ ] **Step 2:** Run `npx vitest run src/main/services/settings/schema.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement it** with the file's existing `bool` and number-range helpers (copy how `timer.focusMinutes` is clamped). Add both fields to the round-trip fixture in `schema.test.ts` and to `customizeView.test.ts`'s `music`.
- [ ] **Step 4:** Run `npm run typecheck && npx vitest run src/main/services/settings src/renderer/screens/customize`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -am "Settings: moving parts on/off and motion strength (1.5 by default)"`

---

### Task 2: Recipes (main, pure)

A recipe is what the user decided for one cover: which parts move, and how. It's kept on disk and is untrusted when read back.

**Files:**

- Create: `src/main/services/cover-motion/recipe.ts`
- Test: `src/main/services/cover-motion/recipe.test.ts`
- Modify: `src/main/ipc.ts` (re-export the types)

**Interfaces:**

- Produces, in `recipe.ts`:
  - `MOTION_KINDS = ['surge','flutter','sway','drift','bob','spray','twinkle'] as const`
  - `type MotionKind`
  - `LOOP_SEC = 8`, `MAX_PARTS = 6`, `RECIPE_VERSION = 1`, `ANALYSIS_PX = 768`
  - `interface RecipePart { id: string; kind: MotionKind; flip: boolean }`. `id` is the part's mask file stem, matching `/^p[0-9]{1,3}$/`.
  - `interface CoverRecipe { version: 1; source: 'hand'; parts: RecipePart[] }`
  - `parseRecipe(raw: unknown): CoverRecipe | null`
  - `withPart(recipe, part)`, `withoutPart(recipe, id)`, `withKind(recipe, id, kind)`, `flipped(recipe, id)`. All pure; `withPart` returns the same recipe when it already holds `MAX_PARTS` parts.

- [ ] **Step 1: Write the failing tests:**

```ts
describe('parseRecipe', () => {
  const ok = { version: 1, source: 'hand', parts: [{ id: 'p1', kind: 'surge', flip: false }] }
  it('reads a good recipe', () => expect(parseRecipe(ok)).toEqual(ok))
  it('drops a future version, unknown kinds, bad ids and too many parts', () => {
    expect(parseRecipe({ ...ok, version: 2 })).toBeNull()
    expect(parseRecipe({ ...ok, parts: [{ id: 'p1', kind: 'spin', flip: false }] })).toBeNull()
    expect(parseRecipe({ ...ok, parts: [{ id: '../x', kind: 'surge', flip: false }] })).toBeNull()
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, kind: 'bob', flip: false }))
    expect(parseRecipe({ ...ok, parts: seven })).toBeNull()
    expect(parseRecipe('nonsense')).toBeNull()
  })
})
it('edits a recipe without mutating it', () => {
  const r = parseRecipe({ version: 1, source: 'hand', parts: [] })!
  const one = withPart(r, { id: 'p1', kind: 'sway', flip: false })
  expect(r.parts).toHaveLength(0)
  expect(withKind(one, 'p1', 'flutter').parts[0]?.kind).toBe('flutter')
  expect(flipped(one, 'p1').parts[0]?.flip).toBe(true)
  expect(withoutPart(one, 'p1').parts).toHaveLength(0)
})
```

- [ ] **Step 2:** Run `npx vitest run src/main/services/cover-motion/recipe.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `recipe.ts`, then re-export `CoverRecipe`, `RecipePart` and `MotionKind` from `ipc.ts`'s `export type {…}` block.
- [ ] **Step 4:** Run the tests and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/main/services/cover-motion src/main/ipc.ts && git commit -m "Cover motion: recipes, parsed as untrusted"`

---

### Task 3: The loop's clock (renderer, pure)

Every value the shader and the spray pass need at time `t` comes from here, so seamlessness is tested once.

**Files:**

- Create: `src/renderer/widgets/music/coverParts/timeline.ts`
- Test: `src/renderer/widgets/music/coverParts/timeline.test.ts`

**Interfaces:**

- Consumes: `LOOP_SEC` from Task 2 (import from `../../../../main/services/cover-motion/recipe`, types only via `ipc.ts`; `LOOP_SEC` is a value, so import the module, which has no Node imports).
- Produces:
  - `surge(t: number, strength: number): number`: px, `16 * strength * (0.5 - 0.5 * cos(2π t / 8))`.
  - `sway(t, strength)`: the same shape, `10 * strength`.
  - `flutterAmp(strength): number`: `2.5 * strength`. The phase is `2π t / 4`; the per-pixel phase offset is done in the shader.
  - `drift(t: number, strength: number): { a: number; b: number; blend: number }`: two offsets in px, `4 * strength * τ` with τ = `t % 4` and `(t + 2) % 4`; `blend = |2τa/4 − 1|`.
  - `bob(t: number, strength: number, index: number): { lift: number; tiltDeg: number }`. Index 0: amp 3, period 4, phase 0. Index 1: 2.5, 8/3, 1.3. Index 2: 2, 4, 2.6. Then repeat with phase + 0.7. Lift = `amp·strength·sin(2πt/period + phase)`, tilt = `0.8·strength·sin(… + 0.9)`.
  - `twinkle(t): number`: the phase `2π t / 4` (amplitude 0.2 in the shader).
  - `sprayDrops(t: number, strength: number, emitters: readonly [number, number][], seed: number): Drop[]`, with `interface Drop { x: number; y: number; r: number; alpha: number }` in 768-px space.
    - 90 drops per loop, born at `k·8/90` plus a seeded jitter of up to 0.08 s, each from a seeded emitter.
    - Life, vx, vy and r ranges as in Global Constraints; `vx·strength`, `vy·strength`, gravity `55·strength`.
    - Alpha: fades in over 0.15 s and fades out over the last 40% of life. Age is `(t − born) mod 8`.
    - Use the seeded PRNG from `coverLight.ts` (`random`). Export it there if it isn't already.

- [ ] **Step 1: Write the failing tests:**

```ts
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)
it('loops without a seam', () => {
  close(surge(0, 1.5), surge(8, 1.5))
  close(sway(0.3, 1), sway(8.3, 1))
  close(bob(1.1, 1.5, 1).lift, bob(9.1, 1.5, 1).lift)
  const d0 = drift(0.5, 1.5),
    d8 = drift(8.5, 1.5)
  close(d0.a, d8.a)
  close(d0.blend, d8.blend)
  expect(sprayDrops(2, 1.5, [[400, 200]], 7)).toEqual(sprayDrops(10, 1.5, [[400, 200]], 7))
})
it('scales distance with strength, never the rhythm', () => {
  close(surge(4, 1.5), 24)
  close(surge(4, 1), 16)
  close(surge(2, 1.5) / surge(2, 1), 1.5)
  expect(drift(1, 1.5).blend).toBe(drift(1, 1).blend)
})
it('throws spray only from emitters and keeps it fading in and out', () => {
  expect(sprayDrops(3, 1.5, [], 1)).toEqual([])
  for (const d of sprayDrops(3, 1.5, [[400, 200]], 1)) {
    expect(d.alpha).toBeGreaterThan(0)
    expect(d.alpha).toBeLessThanOrEqual(1)
  }
})
```

- [ ] **Step 2:** Run `npx vitest run src/renderer/widgets/music/coverParts`. Expected: FAIL.
- [ ] **Step 3:** Implement `timeline.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Cover motion: the loop's clock, seamless and scaled by strength"` (git add the two files).

---

### Task 4: The worker (Python), its setup, and the cover key

**Files:**

- Create:
  - `native/cover-motion/worker.py`
  - `native/cover-motion/requirements.txt` (pinned: torch 2.14.1, transformers 5.3.0, opencv-python-headless 5.0.0.93, plus the numpy and pillow versions the spike's venv resolved; read them with `uv pip freeze`)
  - `native/cover-motion/setup.sh`
  - `native/cover-motion/fetch_models.py`
  - `native/cover-motion/test_worker.py`
- Create: `src/main/services/cover-motion/coverKey.ts` and `coverKey.test.ts`
- Modify:
  - `package.json`: `"setup:covers": "sh native/cover-motion/setup.sh"`
  - `electron-builder.yml`: ship `worker.py` to `cover-motion`, mirroring the aligner entry
  - `src/main/paths.ts`: `coverMotionScriptPath`, mirroring `alignerScriptPath`

**Interfaces:**

- **Worker protocol:**
  - The worker reads JSON lines on stdin and prints one JSON object per line. It exits when stdin closes.
  - It is run as `python -I -B worker.py` with env `FOCUS_COVER_RUNTIME=<runtime dir>`.
  - It loads SAM from `<runtime>/models/sam2.1-hiera-base-plus` on the first `segment`, on MPS when available, else CPU.
  - Every reply is `{"type":"reply","id":N,"ok":true,…}` or `{"type":"reply","id":N,"ok":false,"error":"…"}`.
  - **`{"op":"segment","id":N,"cover":PATH,"points":[[x,y],…],"labels":[1|0,…],"out":PATH}`**
    - Points are in 768-px space.
    - Writes the mask PNG (0/255, 768²) to `out`.
    - Replies `{"area":0..1}`.
  - **`{"op":"build","id":N,"cover":PATH,"parts":[{"mask":PATH,"kind":K,"flip":bool,"out":PATH}],"protected":[PATH,…],"plate":PATH}`**
    - Per part, writes a weight map PNG to `out`:
      - R = motion weight 0–255;
      - G = "along" 0–255, from the pinned side (0) to the far end (255);
      - B = the part's mask, feathered by σ 0.8 px (the alpha Bob draws with).
    - Writes the plate JPEG to `plate`: the cover with every **bob** part's mask, dilated 4 px, filled in by `cv2.inpaint(…, 7, INPAINT_TELEA)`.
    - Replies `{"parts":[{"move":[dx,dy],"center":[x,y],"emitters":[[x,y],…≤200],"color":[r,g,b]}…]}`.
- **Python functions**, tested directly:
  - `pin_and_move(gray, mask, flip) -> tuple[np.ndarray, np.ndarray]`: the move unit vector and the pinned-side centroid.
  - `weight_map(mask, kind, move, protected) -> np.ndarray` (H×W×3 uint8)
  - `emitters(mask, move) -> list[tuple[int,int]]`
  - `plate(cover, bob_masks) -> np.ndarray`
- **`coverKey.ts`:**
  - `dHash(gray: Uint8Array /* 9×8, row-major */): string`: 16 hex characters.
  - `coverKey(image: Electron.NativeImage): string`: centre-crop to a square, resize to 9×8, take luminance, then `dHash`.
  - `squareCover(image: Electron.NativeImage, px = 768): Buffer` (JPEG quality 92). The worker's cover file.

**Algorithms the signatures don't settle (use these):**

- **Pin and move (hand mode).**
  - Take a 12 px ring outside the mask, and its edge density: the Sobel magnitude of `gray`, Gaussian-blurred with σ 6.
  - Pinned centroid = the edge-weighted ring centroid. A part hangs off the busy, detailed side (a head, a hull, the sea) and moves toward the open side (sky, background).
  - `move` = normalize(mask centroid − pinned centroid); with `flip`, negated.
  - This is my reading of the spec's "pinned on the side touching the largest still neighbor", and the editor's flip arrow corrects misses.
- **Weight maps:**
  - `along` = the projection of each pixel onto `move` from the pinned centroid, scaled 0..1 over the mask's extent and smooth-stepped.
  - **Surge and sway:** R = `smoothstep(along) × feather(dilate(mask, r20), σ10)`.
  - **Flutter:** R = `feather(mask, σ3) × along²`.
  - **Drift, twinkle and spray:** R = `feather(mask, σ3)`. Spray only emits; the shader doesn't move its pixels.
  - **Bob:** R = `feather(mask, σ0.8)`.
  - **Then, for every kind:** R ×= `1 − feather(dilate(protected, r12), σ4)`, so protected pixels and a 12 px margin around them never move.
- **Emitters:** ring pixels on the moving side (`dot(p − center, move) > 0`), the 200 furthest along `move`.
- **Color:** the mean of the part's brightest 10% of pixels.

- [ ] **Step 1: Write the failing tests.**
  - `coverKey.test.ts`:
    - the same 9×8 image always gives the same hash;
    - a brighter copy (+20 on every pixel) gives the same hash;
    - a mirrored image gives a different hash;
    - the output matches `/^[0-9a-f]{16}$/`.
  - `test_worker.py` (unittest; build a synthetic 768² cover: a smooth gradient sky above y=400, noisy "ground" below, and a white blob part straddling y=400):
    - `pin_and_move` points the move upward (dy < 0) for the blob, and downward with `flip`;
    - Surge's R is 0 at the pinned edge and over 200 at the far end;
    - R is 0 inside a protected square and within 12 px of it;
    - emitters lie outside the mask, on the sky side;
    - `plate` leaves pixels outside the dilated bob masks unchanged.
- [ ] **Step 2:** Run `npx vitest run src/main/services/cover-motion/coverKey.test.ts`. Expected: FAIL. The Python tests run after Step 4.
- [ ] **Step 3: Implement.**
  - `coverKey.ts`.
  - `worker.py` (port `seg.py`'s SAM call and the spike's masks math; no LTX, no Gemma).
  - `fetch_models.py`: `huggingface_hub.snapshot_download("facebook/sam2.1-hiera-base-plus", local_dir=…)` with telemetry off.
  - `setup.sh`: copy `native/aligner/setup.sh`'s shape. Default runtime `~/Library/Application Support/Focus Screen/cover-motion`; Python 3.12 via uv or venv; install the requirements; fetch the model.
  - `requirements.txt`, the `package.json` script, the `electron-builder.yml` entry, and `paths.ts`.
- [ ] **Step 4: Install and test.**
  - Run `npm run setup:covers`, then `"$HOME/Library/Application Support/Focus Screen/cover-motion/.venv/bin/python" -I -B -m unittest native/cover-motion/test_worker.py -v` and `npx vitest run src/main/services/cover-motion`.
  - Expected: all PASS. The setup run downloads ~2 GB the first time: torch, plus SAM at ~320 MB.
- [ ] **Step 5:** Commit: `git add native/cover-motion src/main/services/cover-motion/coverKey* package.json electron-builder.yml src/main/paths.ts && git commit -m "Cover motion: the SAM worker, its setup, and the cover key"`

---

### Task 5: Worker client and store (main)

**Files:**

- Create:
  - `src/main/services/cover-motion/worker.ts` (+ `worker.test.ts`)
  - `src/main/services/cover-motion/store.ts` (+ `store.test.ts`)
- Create: `src/main/services/cover-motion/helper.ts`
- Copy: `src/main/services/autosync/helper.ts`'s `alignerWorker`

**Interfaces:**

- **`helper.ts`:** `coverWorker(script: string, runtime: string): StartCoverWorker | null`. Null unless the script, `.venv/bin/python` and `models/sam2.1-hiera-base-plus/config.json` all exist. Same `-I -B` args, `input: true`, env `FOCUS_COVER_RUNTIME`.
- **`worker.ts`:**
  - `type StartCoverWorker` (as `StartAligner`).
  - `createCoverWorker(start: StartCoverWorker): CoverWorker`, with:
    - `segment(cover: string, points: [number, number][], labels: (0 | 1)[], out: string): Promise<{ ok: true; area: number } | { ok: false; error: string }>`
    - `build(request: BuildRequest): Promise<BuildResult>`, where the request and result mirror the worker protocol in Task 4 and `BuildResult = { ok: true; parts: BuiltPart[] } | { ok: false; error: string }`.
  - `parseCoverReply(raw: unknown): Reply | null`. Untrusted: numbers must be finite, emitters ≤ 200, colors 0–255, vectors of length 2.
  - Timeouts: `SEGMENT_TIMEOUT_MS = 60_000` (covers the first model load) and `BUILD_TIMEOUT_MS = 60_000`. Idle stop after `IDLE_STOP_MS = 180_000`. A worker exit fails every pending call with `error: 'stopped'`.
- **`store.ts`:**
  - `createCoverStore(dir: string)`: `dir` is `userData/cover-motion/library`.
  - `folder(key)`: `dir/<key>/`. The key must match `/^[0-9a-f]{16}$/`, or it throws.
  - `readRecipe(key): CoverRecipe | null`: via `parseRecipe`; missing or corrupt → null.
  - `writeRecipe(key, recipe)`: an atomic write with `jsonFile.ts`.
  - `readBuilt(key): BuiltScene | null` and `writeBuilt(key, built)`: `built.json`, holding the worker's per-part numbers, also parsed as untrusted.
    - `BuiltScene = { version: 1; plate: boolean; parts: Record<string, BuiltPart> }`, keyed by part id.
    - `BuiltPart = { move: [number, number]; center: [number, number]; emitters: [number, number][]; color: [number, number, number] }`: the worker's per-part reply, as `worker.ts` parses it.
    - A part's spray `seed` is its id's number (`p3` → 3).
  - `remove(key)`.
  - Paths: masks are `<folder>/<partId>.png`, weights `<folder>/<partId>-w.png`, the plate `<folder>/plate.jpg`, the cover `<folder>/cover.jpg`.

- [ ] **Step 1: Write the failing tests:**
  - `worker.test.ts`, with a fake `start` modelled on `src/main/services/todos/apple-reminders/fakeHelper.ts`:
    - a segment reply resolves;
    - an `ok:false` reply resolves with its error, cut to 200 characters;
    - garbage lines are ignored;
    - the worker exiting mid-call resolves `{ok:false, error:'stopped'}`;
    - a timeout resolves `{ok:false, error:'timed out'}` (use fake timers);
    - **(Review Focus 3)** `segment` while the fake never answers, then advancing 60 s → `timed out`, with no unhandled promise.
  - `store.test.ts`, in a temp dir from `fs.mkdtempSync(os.tmpdir())`:
    - round-trips a recipe;
    - **(Review Focus 4)** writing `{"version":2}` or `not json` to `recipe.json` → `readRecipe` returns null;
    - `folder('../etc')` throws.
- [ ] **Step 2:** Run `npx vitest run src/main/services/cover-motion`. Expected: FAIL.
- [ ] **Step 3:** Implement `helper.ts`, `worker.ts` and `store.ts`.
- [ ] **Step 4:** Run the tests and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Cover motion: worker client and per-cover store"` (add the new files).

---

### Task 6: The service, IPC, and the editor's commands (main)

**Files:**

- Create: `src/main/services/cover-motion/service.ts` (+ `service.test.ts`)
- Modify:
  - `src/main/ipc.ts`: channels, payload types, `InvokeChannels`, `SendChannels`, push map, `FocusScreenApi`
  - `src/preload/index.ts`
  - `src/main/index.ts`: wire it up like `prepare` at lines ~867 and ~934

**Interfaces:**

- **Channels:**
  - `coverMotionGet: 'cover-motion:get'`
  - `coverMotionChanged: 'cover-motion:changed'`
  - `coverEditorGet: 'cover-editor:get'`
  - `coverEditorChanged: 'cover-editor:changed'`
  - `coverEditorCommand: 'cover-editor:command'`
- **Payloads, in `ipc.ts`:**
  - `CoverScene { cover: string; plate: string | null; strength: number; parts: ScenePart[] }`. `cover` and `plate` are data URLs.
  - `ScenePart { kind: MotionKind; weight: string /* data URL */; move: [number, number]; center: [number, number]; emitters: [number, number][]; color: [number, number, number]; seed: number }`
  - `CoverMotionState { available: boolean; scene: CoverScene | null }`. `available` = Mac, runtime installed, and `movingParts` on.
  - `CoverEditorState`:
    - `open: boolean`
    - `busy: 'loading' | 'cutting' | 'building' | null`
    - `cover: string | null`
    - `parts: { id: string; kind: MotionKind; outline: string /* mask data URL */ }[]`
    - `preview: CoverScene | null`
    - `message: string | null`
    - `dirty: boolean`
  - `CoverEditorCommand` is one of:
    - `{ kind: 'open' }`, `{ kind: 'close' }`
    - `{ kind: 'pick'; x: number; y: number }`, with `x` and `y` from 0 to 1 over the cover
    - `{ kind: 'setKind'; id: string; motion: MotionKind }`
    - `{ kind: 'flip'; id: string }`, `{ kind: 'remove'; id: string }`
    - `{ kind: 'save' }`, `{ kind: 'useAutomatic' }`
  - `parseCoverEditorCommand(raw): CoverEditorCommand | null`.
- **Service:** `createCoverMotionService(deps)`.
  - `deps`: `{ store, startWorker: StartCoverWorker | null, music: { get(): PlaybackState; subscribe(fn): () => void }, settings: { get(): Settings; subscribe }, imageFromDataUrl(url): NativeImage }`.
  - It returns `{ get(): CoverMotionState; subscribe(fn); editor: { get(): CoverEditorState; subscribe(fn); command(c: CoverEditorCommand): Promise<void> } }`.
- **Behavior:**
  - When the track's artwork changes, including arriving after the track: key it with `coverKey`, read the recipe and built scene, and push a `CoverScene`, or null if there isn't one.
  - **Open:** snapshots the current cover (data URL + key). The editor works on that snapshot until Close, whatever plays next (Review Focus 1). It writes `cover.jpg` with `squareCover` and sets `busy: 'loading'` until the first `segment` returns.
  - **Pick:**
    - the point becomes a positive point at `(x·768, y·768)`, then `segment` writes to `<folder>/<nextId>.png`;
    - an area under 0.002 → `message: "That's too small to move"`, nothing added;
    - an area over 0.8 → `"That's most of the cover"`, nothing added (Review Focus 5);
    - otherwise the part is added with kind `'sway'`, `build` reruns, and the preview updates.
  - **More than 6 parts:** `"Six moving parts at most"`.
  - **`setKind`, `flip`, `remove`:** each edits the draft recipe and rebuilds.
  - **Save:** writes the recipe and built scene to the snapshot's key; if that key is the playing cover's, it pushes the new scene.
  - **`useAutomatic`:** removes the key's folder (phase 1 has no automatic recipe) and pushes a null scene.
  - **Worker unavailable:** `message: "Moving parts aren't installed: run npm run setup:covers"`. A worker failure → `message: "Couldn't cut that out (…)"` and `busy: null`.

- [ ] **Step 1: Write the failing tests** (`service.test.ts`, with a fake worker that writes small PNGs, a temp-dir store and fake music and settings):
  - a recipe on disk for the cover's key yields a scene when that track plays, and none for another cover;
  - artwork null, then set → the scene appears (Review Focus 2);
  - open, then the track changes, then save → the recipe is written under the **first** cover's key (Review Focus 1);
  - pick with fake area 0.001 → a "too small" message and no parts; with 0.9 → "most of the cover" (Review Focus 5);
  - a seventh pick → "Six moving parts at most";
  - `movingParts: false` → `available: false` and `scene: null`.
- [ ] **Step 2:** Run `npx vitest run src/main/services/cover-motion/service.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the service, `parseCoverEditorCommand`, and the IPC, preload and `index.ts` wiring:
  - `toWindows` for both pushes, and `handle` and `on` for gets and commands;
  - `startWorker` from `coverWorker(coverMotionScriptPath, join(userData, 'cover-motion'))` on Mac only, null elsewhere.
- [ ] **Step 4:** Run `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Cover motion: service, editor commands and IPC"` (add the changed files).

---

### Task 7: Drawing it (renderer, WebGL)

**Files:**

- Create:
  - `src/renderer/widgets/music/coverParts/PartsCanvas.tsx`
  - `src/renderer/widgets/music/coverParts/shader.ts` (GLSL sources as strings)
  - `src/renderer/hooks/useCoverMotion.ts`
- Modify:
  - `src/renderer/widgets/music/AnimatedCover.tsx`: render `<PartsCanvas>` over the art layer inside `.cover__frame`, under sheen and sparkle, when `scene` is non-null
  - `src/renderer/widgets/NowPlaying.css` (`.cover__parts { position:absolute; inset:0 }`)

**Interfaces:**

- Consumes: `CoverScene` and `ScenePart` (Task 6), and every timeline function (Task 3).
- Produces: `PartsCanvas({ scene, playing }: { scene: CoverScene; playing: boolean }): JSX.Element`. `useCoverMotion(): CoverMotionState | null` (via `useBridgeValue`, like `useMusic`).

**The shader, per pixel** (`p` in 768-px space; textures are the cover, the plate and up to 6 weight maps W_i with R, G, B as in Task 4):

1. Displacement `d = Σ` over surge, sway and flutter parts:
   - Surge and sway: `R_i · amp(t) · rotate(move_i, curl·G_i)`, with `amp` = `surge(t)` or `sway(t)`, and curl = +35° turned toward +y. That's the spike's claw curl, so it falls with gravity.
   - Flutter: `R_i · flutterAmp · sin(2π t/4 + φ(p)) · move_i`, where φ is GLSL value noise at the scale of σ18 px.
2. `color = cover(p − d)`.
3. Drift parts: `ok = R_i(p) · R_i(p − (a,0)·dir) · R_i(p − (b,0)·dir)`, where `dir = sign of move_i.x`, or +1. Then `color = mix(color, mix(cover(p − a), cover(p − b), blend), ok)`.
4. Twinkle: `color *= 1 + 0.2·strength·R_i·sin(twinkle(t) + φ(p))`.
5. Bob parts (index k among the bob parts): `color = mix(color, plate(p), B_i(p) dilated)`. Then, with `M` the rotation by `tiltDeg` about `center_i` plus `lift`: `color = mix(color, cover(M⁻¹p), B_i(M⁻¹p))`.
6. Spray: a second pass of `gl.POINTS` from `sprayDrops(t, strength, emitters_i, seed_i)`, soft round sprites in `color_i` at 0.9 × alpha.

**Loop:**

- 30 fps.
- Time runs only while `playing`, and never under reduced motion.
- When paused (and nothing is fading in), the frame loop stops.
- It's built like the removed WebGL cover in git history (`git show c469a38:src/renderer/widgets/music/AnimatedCover.tsx`): ResizeObserver, DPR ≤ 2, `webglcontextlost` → hide the canvas so the still art shows.
- A new `scene` (cover change) fades in over 900 ms like `ART_IN`.

- [ ] **Step 1:** Implement `useCoverMotion`, `shader.ts` and `PartsCanvas`, then wire them into `AnimatedCover`. No unit test: the math is Task 3's; this is pixels.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 3: Verify against the approved spike in a demo test copy** (CLAUDE.md "preview" pattern; scratch `preview-app` with its own userData, and `loadArtwork` patched to return the spike's `covers/great-wave-sq.png`):
  - write the spike's masks (`ai-cover-test/out/parts/{wave,sky,boat-front,boat-left,boat-far}.png`) as parts p1–p5, as surge, drift, bob, bob and bob, into the test copy's store for the cover's key;
  - build them with the worker;
  - set `music.cover: 'animated'`;
  - capture frames at t = 0, 2, 4 and 6 s.
  - Expected: the crest at t = 4 reaches about as far as `wave-layers-150` frame 96, the boats bob, and the sky drifts.
  - Then:
    - pause → a `drawElements`/`drawArrays` count of 0 over 2 s (hook `WebGLRenderingContext.prototype` as in earlier checks);
    - reduced motion → still;
    - CPU within a few points of Living colors.
- [ ] **Step 4:** Commit: `git commit -m "Cover motion: draw the layered cover live in WebGL"` (add the files).

---

### Task 8: The editor in Customize

**Files:**

- Create: `src/renderer/screens/customize/CoverPartsEditor.tsx` (+ `.css`), `src/renderer/hooks/useCoverEditor.ts`
- Modify: `src/renderer/screens/customize/MusicSection.tsx` (a "Moving parts" row when `cover === 'animated'`)

**Interfaces:**

- Consumes: `CoverEditorState` and `CoverEditorCommand` (Task 6), and `PartsCanvas` (Task 7).
- Produces: `CoverPartsEditor(): JSX.Element`.

**UI (plain CSS, the project's tokens, buttons ≥ 44 px):**

- **The row** (shown only when `useCoverMotion()?.available`): "Moving parts", hint "Click parts of the cover to bring them to life", and a button "Edit moving parts…" that sends `open`.
- **When `available` is false on a Mac,** the row says "Not installed" with the hint "Run npm run setup:covers".
- **The open editor** (inline below the row) has the cover at 20rem:
  - every part outlined: its mask as a CSS mask image with a 2 px accent outline;
  - clicking the cover sends `pick` with `x = offsetX/width` and `y = offsetY/height`;
  - beside it, `PartsCanvas` with `preview`, always playing.
- **Each part's row:** a number badge, a `PillGroup` of the 7 kinds (Surge, Flutter, Sway, Drift, Bob, Spray, Twinkle), a flip button (↔, label "Turn the other way"), and remove (×).
- **The footer:** Save (primary, enabled when `dirty`), "Use automatic", and Close.
- **Status:** `busy` shows "Loading…", "Cutting out…" or "Building…". `message` shows as a status line (`role="status"`).

- [ ] **Step 1:** Implement the hook, editor and CSS, then wire them into `MusicSection`.
- [ ] **Step 2:** Run `npm run typecheck && npm run lint && npm test`. Expected: PASS.
- [ ] **Step 3: Verify in the demo test copy** (with the Great Wave artwork as in Task 7, starting with no recipe):
  - open the editor, click the crest, choose Surge, click the sky, choose Drift, click a boat, choose Bob;
  - the preview animates;
  - Save makes the Focus Screen's cover animate;
  - "Use automatic" returns it to glow only;
  - clicking a point on the title box alone shows "too small" or adds a small part (either is fine; nothing breaks).
  - Screenshot each state.
- [ ] **Step 4:** Commit: `git commit -m "Customize: edit a cover's moving parts"`

---

### Task 9: Docs and graph

**Files:** Modify `CLAUDE.md`. Run `graphify update .`.

- [ ] **Step 1: Update CLAUDE.md.**
  - The Stack bullet: the cover-motion worker, its runtime path, and `npm run setup:covers`. Add it to the Commands block too.
  - The Layout tree: `services/cover-motion/`, `widgets/music/coverParts/` and `native/cover-motion/`.
  - The userData list: `cover-motion/library/<key>/`.
  - Security and privacy: covers never leave the Mac; only `setup:covers` downloads anything (PyPI and Hugging Face, telemetry off).
  - Design: rewrite the animated-cover bullet. Moving parts, the 8 s loop, strength 1.5, hand-picked wins, the protected-area rule for phase 2, and the dizziness reason.
- [ ] **Step 2:** Run `npx prettier --check src && npm run typecheck && npm run lint && npm test && graphify update .`. Expected: PASS.
- [ ] **Step 3:** Commit: `git commit -am "CLAUDE.md: layered animated covers"`
