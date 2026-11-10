import type { CardStatus, StatusTone } from '../../main/ipc'
import './StatusDot.css'

const TONE_WORDS: Record<StatusTone, string> = {
  ok: ', connected',
  problem: ', needs a look',
  none: ''
}

interface StatusDotProps {
  /** "To-do" */
  name: string
  status: CardStatus | null
  /** Its menu is showing. */
  open: boolean
  /** Opens the card's menu out of this dot; `keyboard` when Enter pressed it, not a click. */
  onOpen(dot: HTMLButtonElement, keyboard: boolean): void
}

/** A mouse or pen press opens the menu; a touch opens it on the tap, like a link. */
function opensOnPress(pointerType: string): boolean {
  return pointerType === 'mouse' || pointerType === 'pen'
}

/** A card's corner dot: green connected, red needs a look, grey nothing to connect. */
export function StatusDot({ name, status, open, onOpen }: StatusDotProps): React.JSX.Element {
  const tone = status?.tone ?? 'none'
  return (
    <button
      type="button"
      className={`status-dot status-dot--${tone}`}
      aria-label={`${name} menu${TONE_WORDS[tone]}`}
      aria-haspopup="menu"
      aria-expanded={open}
      title={open ? undefined : status?.lines.join('\n') || undefined}
      // Like a Mac's menus, it opens as the mouse goes down, not when it comes back up.
      onPointerDown={(event) => {
        if (event.button === 0 && !event.ctrlKey && opensOnPress(event.pointerType)) {
          onOpen(event.currentTarget, false)
        }
      }}
      onClick={(event) => {
        // That press has opened it already. A click has a count; a key press doesn't.
        const native = event.nativeEvent
        if (event.detail > 0 && native instanceof PointerEvent && opensOnPress(native.pointerType))
          return
        onOpen(event.currentTarget, event.detail === 0)
      }}
    />
  )
}
