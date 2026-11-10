// What the user picked for one cover's moving parts: which parts, and how each one moves. It is
// kept on disk next to the parts' masks and read back as untrusted data. No Node imports: the
// renderer imports this module's constants too.

/** The motions a part can have; each is drawn by the renderer from the part's weight map. */
export const MOTION_KINDS = [
  'surge',
  'flutter',
  'sway',
  'drift',
  'bob',
  'spray',
  'twinkle'
] as const
export type MotionKind = (typeof MOTION_KINDS)[number]

/** Every motion repeats a whole number of times in this, so the loop never shows a seam. */
export const LOOP_SEC = 8
/** WebGL 1 has 8 texture units for sure: the cover, the plate, and one weight map per part. */
export const MAX_PARTS = 6
export const RECIPE_VERSION = 1
/** The size covers are analysed and drawn at; parts' points and distances are in these pixels. */
export const ANALYSIS_PX = 768

/** SAM gives each click three cuts to choose from, smallest first. */
export const CUT_SIZES = 3
/** Clicks one part can be made of; past this it's easier to start the part again. */
export const MAX_STROKES = 8

/**
 * One click that shaped a part: where it was (in the analysis square), whether it added its cut
 * or carved it out, and which of SAM's cuts for it was used (0 the smallest).
 */
export interface Stroke {
  x: number
  y: number
  add: boolean
  size: number
}

export interface RecipePart {
  /** Also the stem of the part's mask file, so it must stay a safe file name. */
  id: string
  kind: MotionKind
  /**
   * The motion's direction turned from the one guessed for the part, in eighths of a full turn
   * (the editor's arrow; 4 is the other way round). A flip alone can't point a wave sideways.
   */
  turn: number
  /** Its clicks, in order, so another click can change one; parts made before had none. */
  strokes?: Stroke[]
  /**
   * It started from the mask it had before it kept its clicks (`<id>-base.png`), and the clicks
   * go on top of that.
   */
  base?: true
}

export interface CoverRecipe {
  version: typeof RECIPE_VERSION
  source: 'hand'
  parts: RecipePart[]
}

const PART_ID = /^p[0-9]{1,3}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseStroke(raw: unknown): Stroke | null {
  if (!isRecord(raw)) return null
  const { x, y, add, size } = raw
  const inSquare = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= ANALYSIS_PX
  if (!inSquare(x) || !inSquare(y) || typeof add !== 'boolean') return null
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size >= CUT_SIZES)
    return null
  return { x, y, add, size }
}

/** A part's clicks; anything off-shape is none, since the part's mask is still good without them. */
function parseStrokes(raw: unknown): Stroke[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STROKES) return null
  const strokes = raw.map(parseStroke)
  return strokes.some((stroke) => stroke === null) ? null : (strokes as Stroke[])
}

function parsePart(raw: unknown): RecipePart | null {
  if (!isRecord(raw)) return null
  const { id, kind, turn } = raw
  if (typeof id !== 'string' || !PART_ID.test(id)) return null
  if (typeof kind !== 'string' || !(MOTION_KINDS as readonly string[]).includes(kind)) return null
  if (typeof turn !== 'number' || !Number.isInteger(turn) || turn < 0 || turn > 7) return null
  const part: RecipePart = { id, kind: kind as MotionKind, turn }
  const strokes = raw.strokes === undefined ? null : parseStrokes(raw.strokes)
  if (strokes) {
    part.strokes = strokes
    if (raw.base === true) part.base = true
  }
  return part
}

/** A recipe read from disk: anything off-shape, or from a later version, is no recipe. */
export function parseRecipe(raw: unknown): CoverRecipe | null {
  if (!isRecord(raw) || raw.version !== RECIPE_VERSION || raw.source !== 'hand') return null
  if (!Array.isArray(raw.parts) || raw.parts.length > MAX_PARTS) return null
  const parts = raw.parts.map(parsePart)
  if (parts.some((part) => part === null)) return null
  return { version: RECIPE_VERSION, source: 'hand', parts: parts as RecipePart[] }
}

export function withPart(recipe: CoverRecipe, part: RecipePart): CoverRecipe {
  if (recipe.parts.length >= MAX_PARTS) return recipe
  return { ...recipe, parts: [...recipe.parts, part] }
}

export function withoutPart(recipe: CoverRecipe, id: string): CoverRecipe {
  return { ...recipe, parts: recipe.parts.filter((part) => part.id !== id) }
}

export function withKind(recipe: CoverRecipe, id: string, kind: MotionKind): CoverRecipe {
  return {
    ...recipe,
    parts: recipe.parts.map((part) => (part.id === id ? { ...part, kind } : part))
  }
}

/** A part's clicks, once its mask has been cut from them. */
export function withStrokes(
  recipe: CoverRecipe,
  id: string,
  strokes: Stroke[],
  base: boolean
): CoverRecipe {
  return {
    ...recipe,
    parts: recipe.parts.map((part) => {
      if (part.id !== id) return part
      const next: RecipePart = { id: part.id, kind: part.kind, turn: part.turn, strokes }
      if (base) next.base = true
      return next
    })
  }
}

/** The editor's arrow: the part's direction turned another eighth, clockwise. */
export function turned(recipe: CoverRecipe, id: string): CoverRecipe {
  return {
    ...recipe,
    parts: recipe.parts.map((part) =>
      part.id === id ? { ...part, turn: (part.turn + 1) % 8 } : part
    )
  }
}
