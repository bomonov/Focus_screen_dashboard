/** An open book: the Next class pill's bubble, in its calendar's color. */
export function BookIcon({ color }: { color?: string | null }): React.JSX.Element {
  return (
    <svg
      className="next-class__book pill-icon pill-icon--bubble"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={color ? { color } : undefined}
      aria-hidden="true"
    >
      <path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2Z" />
      <path d="M12 6.5v13" />
    </svg>
  )
}
