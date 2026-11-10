# Layered animated cover: design

Date: 2026-10-21. Status: draft for the user's approval.

## Intent

The user wants the album cover to come alive "like a short GIF, the art itself moving", the way
Apple Music's motion artwork does, with **one or a few parts of the art moving and the rest still**.
Their reference is an artist's hand animation of Hokusai's _The Great Wave_
(youtu.be/EPirVEBFe2E, 0:17–0:23): the crest surges with its shapes intact, spray flies, clouds
drift.

What has been tried, and what it taught us:

| Tried                                                                                | Result                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Warping the whole cover (SpookyGhost port, c469a38)                                  | Made the user dizzy. Whole-picture warp, zoom and sway in 6–8 s loops sit in the band where visual motion sickness peaks (about 0.1–0.4 Hz).                         |
| Still art lit by its own colors (glow, sheen, sparkle; 2cbe28f, installed)           | Comfortable, but the art itself doesn't move.                                                                                                                        |
| AI video (LTX-2.3 on the Mac)                                                        | Too soft when its own pixels were used, a jelly-like stretch when its motion was transferred, and with free motion it zoomed the camera and faded to black. Dropped. |
| **Layered animation** (the spike in `~/Library/Developer/FocusScreen/ai-cover-test`) | **Approved:** "lowkey, that's almost perfect", then at 1.5× motion "yesssss, I love it".                                                                             |

The approved spike: SAM 2.1 cut _The Great Wave_ into parts from a few clicks (wave, sky, three
boats, Fuji). Each part got its own motion:

- the crest bent forward and back as one piece, pinned at its base, with the claws reaching furthest (24 px at 768 px);
- the claws fluttered out of step with each other;
- spray drops flew off the claw tips and fell;
- the sky's clouds drifted;
- the boats bobbed over water filled in behind them;
- Fuji and the title stayed the cover's own pixels.

Every motion fits an 8-second loop, so it has no seam. Rendering took 6 s with no AI video.

## Goals

1. Covers the user plays come alive in layers, as in the spike, at the approved strength.
2. **Automatic:** an on-device model looks at a cover, decides which parts could move and how, and they're cut out and animated without the user doing anything.
3. **Picked by hand:** in Customize the user can click parts of the current cover, choose how each one moves, and keep that for the album. A hand-picked cover always wins over the automatic one.
4. It stays comfortable: nothing that made the user dizzy comes back.

## Non-goals

- AI-generated video frames (LTX or similar). The model download from the spike can be deleted.
- Windows. Like auto-sync, this is a Mac add-on at first.
- Getting every cover right automatically. A cover the automatic pass can't read stays still (with glow), and the user can pick its parts by hand.

## Anti-goals (a failure even if it technically works)

- The whole picture moving, zooming or panning, or a big shape (Surge, Sway) rocking quicker than once per 8 s loop. The small, approved quicker motions are the exception: Flutter twice per loop, Bob every 4 s or 8/3 s.
- Text, logos or faces bending or warping.
- Covers or anything about the user's music leaving the Mac.
- A download or a wait the user didn't agree to.

## Constraints

- CLAUDE.md applies in full: the renderer never touches Node or files; IPC channels and payload types live in `src/main/ipc.ts`; helper output is untrusted (anything off-shape is no data); pure logic gets unit tests; `typecheck`, `lint` and `test` pass after each step.
- New dependencies and native helpers need the user's OK first.
- New network hosts need the user's approval, recorded in CLAUDE.md with a date.
- The models and the Python runtime never go in the repo or the app bundle. They live in `userData`, like the aligner's, so the GitHub repo and the `.dmg` stay small.
- Covers arrive in main as image bytes (data URLs from the players); nothing new is fetched to get them.
- Machine: the user's M5 with 24 GB. The spike's SAM step ran on MPS in seconds.
- Licenses: the app may be published on GitHub. Any model has to allow redistribution of the code that downloads it, and must not need a sign-in. SAM 2.1 is Apache-2.0 and ungated.

## How it works (my calls, open to change)

### Analyse offline, animate live

1. **A Python worker analyses each cover once.**
   - It's spawned by main like the aligner (`HelperProcess`, JSON lines, an idle stop).
   - Output per cover: the part masks (PNG), a "plate" (the cover with the moving objects' surroundings filled in so nothing tears when they move), and a recipe (JSON) naming each part's motion and its parameters.
   - Cached in `userData/cover-motion/`, keyed by a hash of the cover, so a cover shared by an album's songs is analysed once.
   - The hash is perceptual (my call): taken from a small normalised copy of the cover. "Up next" only gives the queue's small thumbnail, so an exact pixel hash would never match the full cover and analysing ahead would be wasted.
2. **The renderer animates live,** in WebGL inside the existing `AnimatedCover`, from the masks, plate and recipe. I chose live over pre-rendered video because:
   - it keeps the art pin-sharp at any card size;
   - it pauses exactly with the music;
   - a strength change shows at once;
   - there are no video files per album.

   Cost should be like Living colors, which measured about +9 points of GPU-process CPU while playing. It draws only while music plays and stays still with reduced motion.

3. **Glow, sheen and sparkle stay as they are.** The glow sits behind the cover. Sheen and sparkle draw over it when chosen. A cover with no parts yet shows exactly today's animated cover.

### Motion recipes (from the spike; every period divides the 8 s loop)

| Kind    | For                                              | Motion (at strength 1.0; the user's chosen default is 1.5)                                           |
| ------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Surge   | Big shapes: a wave, a cape                       | Bends forward and back as one piece, pinned at a base, 16 px at the far end at 768 px, once per loop |
| Flutter | Fine edges: claws, hair tips, leaves             | 2.5 px, out of step, twice per loop, strongest at the edge                                           |
| Sway    | Hanging or growing things: hair, plants, ribbons | A bend pinned at the root, like Surge but gentler, once per loop                                     |
| Drift   | Sky, clouds, water surface                       | Texture drifts 4 px/s one way; two offsets crossfaded so it loops                                    |
| Bob     | Floating objects: boats, lanterns                | Lifts 2–3 px and tilts under 1°, each on its own rhythm (4 s or 8/3 s)                               |
| Spray   | Thrown from an edge: spray, sparks, petals, snow | Small drops in the part's own light color, arcing and fading, about 90 per loop                      |
| Twinkle | Stars, city lights                               | Brightness only, no movement                                                                         |

Strength is one number for the whole cover (`MOTION`), so "more" or "less" never changes the rhythm.

### Automatic mode

The worker asks a vision-language model on the Mac to look at the cover and return, as JSON:

- the parts that could move;
- for each part, its kind from the table above;
- a point or box on that part;
- for Surge and Sway, which side is pinned and which way it moves.

SAM turns each point or box into a mask. The model's answer is untrusted input: a part with an unknown kind, a location off the picture or an implausible size is dropped. A cover with no usable parts stays still.

**Protected areas (my call).**

- **What counts:** text, logos and faces, illustrated faces included. The model also marks these, and SAM cuts them.
- **Their pixels never move.** A moving part that touches one isn't refused. Its motion fades to zero across a margin of about 12 px at 768 px, so it's pinned there: hair moves but the face doesn't, and a sky drifts but the title printed on it doesn't.
- **Surge's and Sway's bend band** (41 px in the spike) never reaches into a protected area.
- **These are pure rules,** tested with fixture masks.

The model is the builder's choice within these limits:

- ungated, with a license fine for a GitHub project;
- at most about 8 GB;
- runs on the 24 GB Mac;
- can give locations, not only names.

Candidates: Gemma 3 12B 4-bit (already downloaded in the spike), or a small grounding model such as Florence-2 (MIT) after the VLM names the parts.

When it runs: for the cover that's playing, as soon as it changes (if the add-on is installed and the cover isn't cached), and for "Up next" when the player gives it. One cover at a time, in the background.

### Picked by hand (Customize › Music)

- **"Edit moving parts…"** opens the current cover large in the Customize window.
- **Click a part:** the worker runs SAM on that click (well under a second once loaded) and the part is outlined.
- **Choose how it moves** with pills (Surge, Flutter, Sway, Drift, Bob, Spray, Twinkle). Surge and Sway are pinned on the side touching the largest still neighbor, and an arrow lets the user flip it.
- **Preview** plays live beside the editor.
- **"Use automatic"** clears the hand-picked parts.

Saved per cover hash. These override the automatic recipe.

**The user's pick wins (my call).** The editor doesn't look for text or faces. It needs only SAM, so it stays fast and works without the vision model. If the user deliberately picks a face to move, that's their choice, and the live preview shows them the result.

### Settings

- `music.cover: 'animated'` keeps its meaning.
- New: `music.movingParts` (on/off, default on once the add-on is installed).
- New: `music.motionStrength`, defaulting to 1.5, the user's pick. Whether it's shown in Customize is open; see "Left to the builder".

### Install

For this Mac, the same as the aligner: a setup script (`npm run setup:covers`) that makes a Python 3.12 environment in `userData/cover-motion` and downloads the models from Hugging Face. Until the runtime is there, the feature hides, and Customize says how to install it.

## Order of work (my call)

Automatic part-finding has never been tried; only the hand-clicked spike has. So:

1. **First:** the live renderer, the motion recipes, the protected-area rules, hand-picking in Customize, and the setup script (SAM only). This is proven by the spike and useful alone.
2. **Then, before any automatic wiring:** a model trial on about 8 of the user's own covers. For each, the user marks the automatic result good, wrong or still.
   - **Automatic ships** (on by default) if at least 5 of the 8 are good and none moves a protected area.
   - **Otherwise, the trial moves on to bigger or sign-in models** (the user's call, below). Automatic stays off, with hand-picking as the feature, only if none of those gets there either.

## Verification

- Pure logic tested:
  - recipe parsing and validation of the worker's JSON;
  - every motion's period dividing the loop;
  - strength scaling;
  - the cover hash;
  - the anchoring rules (nothing moves next to text or faces).
- The worker gets a small test with a fixture cover (the spike's _Great Wave_ and its parts).
- In a demo test copy:
  - _The Great Wave_ with the spike's recipe must look like `wave-layers-150.gif`;
  - pause stops all drawing;
  - reduced motion is still;
  - CPU is about Living colors' cost.
- The real check is the user's own covers, mostly Japanese and Vocaloid illustrations, so the automatic pass is judged on a handful of them before it's called done.

## Decided by the user (2026-10-21)

1. **Characters' hair, ribbons and clothes may move** (Sway and Flutter, also in automatic mode), with the face and any text always still and pinned. Automatic mode looks for these as well as scenery.
2. **If no model within the limits reaches 5 of 8 good, try bigger models**, including ones that need a Hugging Face sign-in. The user signs in and accepts any terms themselves. The setup script uses that login and never asks for or stores a token. Hand-picking only is the last resort, not the first fallback.

## Left to the builder

- The exact vision model and grounding approach, within the limits above.
- Shader structure, mask and plate formats, and the inpainting method (OpenCV Telea was fine in the spike for small moves).
- How Surge, Sway and Bob pick their pins and directions in automatic mode.
- Whether motion strength gets a Customize control or stays at 1.5.
