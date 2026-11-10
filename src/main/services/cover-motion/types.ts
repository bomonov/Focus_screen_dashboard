// What main sends the renderer about the cover's moving parts, and what the editor sends back.
// No runtime imports: preload and renderer import these types.
import type { ClickWith } from './clicks'
import type { MotionKind } from './recipe'

/** One moving part, ready to draw: its weight map and the numbers the worker worked out for it. */
export interface ScenePart {
  kind: MotionKind
  /** PNG data URL: R how much it moves, G how far along from its pin, B its feathered mask. */
  weight: string
  /** Which way it moves (a unit vector) and its middle, in the 768 px analysis space. */
  move: [number, number]
  center: [number, number]
  /** Where spray leaves it (spray parts only). */
  emitters: [number, number][]
  /** Its own light, for spray drops. */
  color: [number, number, number]
  /** Seeds the spray, so a part's drops are the same every time. */
  seed: number
}

/** A cover with moving parts, as the renderer draws it. */
export interface CoverScene {
  /** JPEG data URLs: the cover's middle square, and (when a part bobs) what's under it. */
  cover: string
  plate: string | null
  strength: number
  parts: ScenePart[]
}

export interface CoverMotionState {
  /** On a Mac with the runtime installed and moving parts turned on. */
  available: boolean
  /** Whether it could be: installed, waiting for `npm run setup:covers`, or not on this OS. */
  setup: 'ready' | 'missing' | 'unsupported'
  /** The playing cover's parts; null when it has none. */
  scene: CoverScene | null
}

export interface CoverEditorState {
  open: boolean
  busy: 'loading' | 'cutting' | 'building' | null
  /** The cover being edited (the one playing when the editor opened). */
  cover: string | null
  parts: { id: string; kind: MotionKind; outline: string }[]
  /** The part the last click made or changed (or picked in the list): Shift-click adds to it. */
  selected: string | null
  preview: CoverScene | null
  message: string | null
  /** Changed since it opened or was last saved. */
  dirty: boolean
}

export type CoverEditorCommand =
  | { kind: 'open' }
  | { kind: 'close' }
  /** A click on the cover, 0–1 across and down; with Shift it adds, with Option it carves. */
  | { kind: 'pick'; x: number; y: number; with?: ClickWith }
  | { kind: 'select'; id: string }
  | { kind: 'setKind'; id: string; motion: MotionKind }
  /** The part's direction turned another eighth, clockwise. */
  | { kind: 'turn'; id: string }
  | { kind: 'remove'; id: string }
  | { kind: 'save' }
  | { kind: 'useAutomatic' }
