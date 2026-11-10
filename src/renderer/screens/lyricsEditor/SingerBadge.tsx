import { useEffect, useRef, useState } from 'react'
import type { Singer } from '../../../main/services/lyrics/singers/cast'
import { initials } from '../../../main/services/lyrics/singers/cast'
import { onAccentColor } from '../../theme/color'
import { partGradient } from '../../widgets/music/singerColors'

/** A singer's circle: their picture, or their initials on their color. */
export function SingerCircle({
  singer,
  hex,
  picture,
  small = false
}: {
  singer: Pick<Singer, 'name'>
  /** Their color fitted to the editor's cards. */
  hex: string
  picture?: string | undefined
  small?: boolean
}): React.JSX.Element {
  const className = `singer-circle${small ? ' singer-circle--small' : ''}`
  if (picture) {
    return (
      <span className={className} style={{ borderColor: hex }} aria-hidden="true">
        <img src={picture} alt="" draggable={false} />
      </span>
    )
  }
  return (
    <span
      className={className}
      style={{ background: hex, color: onAccentColor(hex) }}
      aria-hidden="true"
    >
      {initials(singer.name)}
    </span>
  )
}

/** "Everyone": the song's cast as one circle, in their colors. */
export function EveryoneCircle({
  hexes,
  small = false
}: {
  hexes: readonly string[]
  small?: boolean
}): React.JSX.Element {
  const [first] = hexes
  return (
    <span
      className={`singer-circle${small ? ' singer-circle--small' : ''}`}
      // Dark letters over the light end of a mixed circle; the cast row's empty state is plain.
      style={
        first
          ? { background: partGradient(hexes), color: onAccentColor(first) }
          : { background: 'var(--border-strong)', color: 'var(--text)' }
      }
      aria-hidden="true"
    >
      All
    </span>
  )
}

/** Files a drag carries; only those can be dropped on a badge. */
function carriesFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

/**
 * A singer as a button: clicked to assign (or, choosing the song's cast, to add or take out),
 * right-clicked for its picture, and an image dropped on it becomes its picture.
 */
export function SingerBadge({
  singer,
  hex,
  picture,
  keyHint,
  pressed,
  label,
  showName = true,
  onPick,
  onMenu,
  onDropFile
}: {
  singer: Singer
  hex: string
  picture?: string | undefined
  /** The number key that assigns them, in the song's cast row. */
  keyHint?: string | undefined
  /** In the duet being built, or in the song's cast while choosing it. */
  pressed: boolean
  /** The accessible name, when it says more than the singer's name. */
  label?: string | undefined
  showName?: boolean
  onPick: () => void
  onMenu: (singer: Singer, at: { x: number; y: number }) => void
  onDropFile: (singer: Singer, file: File) => void
}): React.JSX.Element {
  const [dropping, setDropping] = useState(false)
  return (
    <button
      type="button"
      className={`singer-badge${dropping ? ' singer-badge--drop' : ''}${showName ? '' : ' singer-badge--bare'}`}
      aria-label={label ?? singer.name}
      aria-pressed={pressed}
      title={keyHint ? `${singer.name} (${keyHint})` : singer.name}
      onClick={onPick}
      onContextMenu={(event) => {
        event.preventDefault()
        // The keyboard's menu key fires this with no pointer: open it by the badge instead.
        const box = event.currentTarget.getBoundingClientRect()
        const fromKeys = event.clientX === 0 && event.clientY === 0
        onMenu(
          singer,
          fromKeys ? { x: box.left, y: box.bottom } : { x: event.clientX, y: event.clientY }
        )
      }}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        setDropping(false)
        const file = event.dataTransfer.files[0]
        if (!file) return
        event.preventDefault()
        onDropFile(singer, file)
      }}
    >
      <SingerCircle singer={singer} hex={hex} picture={picture} />
      {showName && <span className="singer-badge__name">{singer.name}</span>}
      {keyHint && <span className="singer-badge__key">{keyHint}</span>}
    </button>
  )
}

/**
 * A badge's picture menu, in the page (no native menu): choose a picture, or remove the one it
 * has. Esc, a press outside it or choosing an item closes it.
 */
export function PictureMenu({
  singer,
  at,
  hasPicture,
  onChoose,
  onRemove,
  onClose
}: {
  singer: Singer
  at: { x: number; y: number }
  hasPicture: boolean
  onChoose: () => void
  onRemove: () => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onPress = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPress, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPress, true)
    }
  }, [onClose])

  // Kept inside the window: a badge at the right edge opens its menu leftwards.
  const style = {
    left: Math.max(8, Math.min(at.x, window.innerWidth - 240)),
    top: Math.max(8, Math.min(at.y, window.innerHeight - 120))
  }
  return (
    <div
      ref={ref}
      className="picture-menu"
      role="menu"
      aria-label={`${singer.name}'s picture`}
      style={style}
    >
      <button
        type="button"
        role="menuitem"
        aria-label={`Choose a picture for ${singer.name}`}
        onClick={() => {
          onChoose()
          onClose()
        }}
      >
        Choose Picture…
      </button>
      <button
        type="button"
        role="menuitem"
        aria-label={`Remove ${singer.name}'s picture`}
        disabled={!hasPicture}
        onClick={() => {
          onRemove()
          onClose()
        }}
      >
        Remove Picture
      </button>
    </div>
  )
}
