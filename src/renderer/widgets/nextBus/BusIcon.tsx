/** The bus glyph at the front of the Bus pill (and alone in its bubble). */
export function BusIcon({
  className = 'next-bus__icon pill-icon'
}: {
  className?: string
}): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="3" width="16" height="15" rx="3" />
      <path d="M4 11h16M8 21v-3M16 21v-3" />
      <circle cx="8" cy="14.5" r="0.5" fill="currentColor" />
      <circle cx="16" cy="14.5" r="0.5" fill="currentColor" />
    </svg>
  )
}

/** A shuttle van: the ASU shuttle pill's bubble (the pill itself says "ASU" instead). */
export function ShuttleIcon(): React.JSX.Element {
  return (
    <svg
      className="next-bus__icon pill-icon pill-icon--bubble"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 16V8a2 2 0 0 1 2-2h10l5 5v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
      <path d="M3 11h17M9 6v5" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="16.5" cy="17.5" r="1.5" />
    </svg>
  )
}
