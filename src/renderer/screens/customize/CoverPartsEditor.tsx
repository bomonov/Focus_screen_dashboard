import type { CoverEditorCommand, CoverScene, MotionKind } from '../../../main/ipc'
import { useCoverEditor } from '../../hooks/useCoverEditor'
import { ChevronDownIcon, CloseIcon, TurnIcon } from '../../widgets/icons'
import { PartsCanvas } from '../../widgets/music/coverParts/PartsCanvas'
import './CoverPartsEditor.css'

const send = (command: CoverEditorCommand): void =>
  window.focusScreen.sendCoverEditorCommand(command)

const MOTIONS: { value: MotionKind; label: string }[] = [
  { value: 'surge', label: 'Surge: swells out and back' },
  { value: 'flutter', label: 'Flutter: edges quiver' },
  { value: 'sway', label: 'Sway: bends gently' },
  { value: 'drift', label: 'Drift: slides along' },
  { value: 'bob', label: 'Bob: floats up and down' },
  { value: 'spray', label: 'Spray: throws drops' },
  { value: 'twinkle', label: 'Twinkle: glimmers' }
]

/** Each part's tint on the cover and its number's chip in the list, so the two can be matched. */
const PART_COLORS = ['#FFC627', '#00A3E0', '#78BE20', '#FF7F32', '#E8508A', '#9D7BFF']

const BUSY: Record<'loading' | 'cutting' | 'building', string> = {
  loading: 'Loading…',
  cutting: 'Cutting out…',
  building: 'Building…'
}

/** A new preview (a part added, changed or removed) remounts the canvas with its pictures. */
function previewKey(scene: CoverScene): string {
  return scene.parts
    .map((part) => `${part.kind}:${part.move.join(',')}:${part.weight.length}`)
    .join('|')
}

/**
 * Picks the parts of the playing cover that move: click a part to cut it out (again for another
 * size, Shift to add a piece to the selected part, Option to cut one out), choose how it moves,
 * turn its direction, and watch it live beside the cover. Main does the cutting (SAM, on this
 * Mac) and keeps the result for this cover.
 */
export function CoverPartsEditor({
  strength
}: {
  /** The strength slider's value, so the preview follows it as the Focus Screen does. */
  strength: number
}): React.JSX.Element | null {
  const editor = useCoverEditor()
  if (!editor?.open) return null

  function pick(event: React.MouseEvent<HTMLDivElement>): void {
    const box = event.currentTarget.getBoundingClientRect()
    const how = event.altKey ? 'carve' : event.shiftKey ? 'add' : null
    send({
      kind: 'pick',
      x: Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1),
      y: Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1),
      ...(how ? { with: how } : {})
    })
  }

  return (
    <div className="parts-editor">
      {editor.cover && (
        <div className="parts-editor__stage">
          <figure className="parts-editor__figure">
            <div
              className="parts-editor__cover"
              onClick={pick}
              title="Click a part to make it move, and again for another size"
            >
              <img src={editor.cover} alt="The cover being edited" draggable={false} />
              {editor.parts.map((part, i) => (
                <div
                  key={part.id}
                  className={`parts-editor__tint${part.id === editor.selected ? ' parts-editor__tint--selected' : ''}`}
                  style={{
                    background: PART_COLORS[i % PART_COLORS.length],
                    maskImage: `url(${part.outline})`,
                    WebkitMaskImage: `url(${part.outline})`
                  }}
                />
              ))}
            </div>
            <figcaption className="customize__hint">Click a part</figcaption>
          </figure>
          <figure className="parts-editor__figure">
            <div className="parts-editor__preview">
              <img src={editor.cover} alt="" draggable={false} />
              {editor.preview && (
                <PartsCanvas
                  key={previewKey(editor.preview)}
                  scene={{ ...editor.preview, strength }}
                  playing
                />
              )}
            </div>
            <figcaption className="customize__hint">Preview</figcaption>
          </figure>
        </div>
      )}
      <p className="customize__hint parts-editor__status" role="status">
        {editor.busy
          ? BUSY[editor.busy]
          : (editor.message ??
            (editor.parts.length === 0
              ? 'Click a part of the cover, such as a wave, hair or the sky, to make it move.'
              : 'Click a part again for another size. Shift-click adds a piece to the selected part; Option-click cuts one out.'))}
      </p>
      {editor.parts.length > 0 && (
        // One compact row a part; past four rows the list scrolls instead of growing.
        <ul className="parts-editor__list" aria-label="Moving parts">
          {editor.parts.map((part, i) => (
            <li
              key={part.id}
              className={`parts-editor__part${part.id === editor.selected ? ' parts-editor__part--selected' : ''}`}
            >
              <button
                type="button"
                className="parts-editor__pick"
                aria-label={`Select part ${i + 1}`}
                aria-pressed={part.id === editor.selected}
                title="Select it: Shift-clicks on the cover add to it"
                disabled={editor.busy !== null}
                onClick={() => send({ kind: 'select', id: part.id })}
              >
                <span
                  className="parts-editor__chip"
                  style={{ background: PART_COLORS[i % PART_COLORS.length] }}
                >
                  {i + 1}
                </span>
              </button>
              <span className="parts-editor__select">
                <select
                  aria-label={`How part ${i + 1} moves`}
                  value={part.kind}
                  disabled={editor.busy !== null}
                  onChange={(event) =>
                    send({ kind: 'setKind', id: part.id, motion: event.target.value as MotionKind })
                  }
                >
                  {MOTIONS.map((motion) => (
                    <option key={motion.value} value={motion.value}>
                      {motion.label}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon />
              </span>
              <button
                type="button"
                className="parts-editor__icon"
                aria-label={`Turn part ${i + 1}'s direction`}
                title="Turn its direction"
                disabled={editor.busy !== null}
                onClick={() => send({ kind: 'turn', id: part.id })}
              >
                <TurnIcon />
              </button>
              <button
                type="button"
                className="parts-editor__icon"
                aria-label={`Remove part ${i + 1}`}
                title="Remove"
                disabled={editor.busy !== null}
                onClick={() => send({ kind: 'remove', id: part.id })}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="parts-editor__actions">
        <button
          type="button"
          className="customize__button customize__button--primary"
          disabled={!editor.dirty || editor.busy !== null}
          onClick={() => send({ kind: 'save' })}
        >
          Save
        </button>
        <button
          type="button"
          className="customize__button"
          disabled={editor.busy !== null}
          onClick={() => send({ kind: 'useAutomatic' })}
        >
          Use automatic
        </button>
        <button type="button" className="customize__button" onClick={() => send({ kind: 'close' })}>
          Close
        </button>
      </div>
    </div>
  )
}
