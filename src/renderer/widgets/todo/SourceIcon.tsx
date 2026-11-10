import type { TodoSourceId } from '../../../main/ipc'
import canvasFilled from '../../../../assets/sources/canvas-filled.svg?raw'
import canvasOutline from '../../../../assets/sources/canvas-outline.svg?raw'
import googleFilled from '../../../../assets/sources/google-filled.svg?raw'
import googleOutline from '../../../../assets/sources/google-outline.svg?raw'
import homeworkFilled from '../../../../assets/sources/homework-filled.svg?raw'
import homeworkOutline from '../../../../assets/sources/homework-outline.svg?raw'
import remindersFilled from '../../../../assets/sources/reminders-filled.svg?raw'
import remindersOutline from '../../../../assets/sources/reminders-outline.svg?raw'

// Inlined at build time from assets/sources/ (our own files, never user input), so the icons
// stay swappable there and still take their color from CSS through currentColor.
const ICONS: Record<TodoSourceId, { outline: string; filled: string }> = {
  canvas: { outline: canvasOutline, filled: canvasFilled },
  homework: { outline: homeworkOutline, filled: homeworkFilled },
  reminders: { outline: remindersOutline, filled: remindersFilled },
  google: { outline: googleOutline, filled: googleFilled }
}

interface SourceIconProps {
  source: TodoSourceId
  /** Filled when the to-do is done, outline while it's open. */
  filled: boolean
}

export function SourceIcon({ source, filled }: SourceIconProps): React.JSX.Element {
  const icon = ICONS[source]
  return (
    <span
      className={`source-icon source-icon--${source}`}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: filled ? icon.filled : icon.outline }}
    />
  )
}
