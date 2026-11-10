/**
 * The album colors switch, in the lyrics box itself (the user asked for it there, not in
 * Customize): a dot in the cover's colors while they're on, in the text color while they're off.
 */
export function AlbumInkSwitch({
  on,
  inks
}: {
  on: boolean
  /** The colors the lyrics would take, for the dot. */
  inks: readonly string[]
}): React.JSX.Element {
  const dot = on && inks.length > 0 ? `conic-gradient(${[...inks, inks[0]].join(', ')})` : null
  return (
    <button
      type="button"
      className="lyrics__ink"
      aria-pressed={on}
      aria-label="Album colors"
      title={
        on
          ? 'Album colors on: sung lines take the cover’s colors'
          : 'Album colors off: click to color sung lines like the cover'
      }
      onClick={() => window.focusScreen.sendLyricsCommand({ kind: 'setAlbumInk', on: !on })}
    >
      <span className="lyrics__ink-ring">
        <span className="lyrics__ink-dot" style={dot ? { background: dot } : undefined} />
      </span>
    </button>
  )
}
