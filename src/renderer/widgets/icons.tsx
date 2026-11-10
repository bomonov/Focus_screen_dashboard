// Small line icons (the tab bars, Customize's controls), drawn on a 24-unit grid in the current
// text color.

function Icon({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** Pomodoro: a tomato. */
export function TomatoIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M12 7.5c-4.7 0-8.5 2.7-8.5 6.4S7.3 20.5 12 20.5s8.5-2.9 8.5-6.6S16.7 7.5 12 7.5Z" />
      <path d="M12 7.5 9 4.5M12 7.5l3-3M12 7.5 7.5 8.5M12 7.5l4.5 1M12 7.5V3" />
    </Icon>
  )
}

/** A Pomodoro break: a cup. */
export function CupIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M4.5 9h12v5.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V9ZM16.5 10.5h1.25a2.75 2.75 0 0 1 0 5.5H16" />
      <path d="M8.5 3.5c-.6.9.6 1.6 0 2.5M12.5 3.5c-.6.9.6 1.6 0 2.5" />
    </Icon>
  )
}

/** Countdown: an hourglass. */
export function HourglassIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M6 3h12M6 21h12M7 3c0 4.5 4 5.5 5 9-1 3.5-5 4.5-5 9M17 3c0 4.5-4 5.5-5 9 1 3.5 5 4.5 5 9" />
    </Icon>
  )
}

/** Stopwatch. */
export function StopwatchIcon(): React.JSX.Element {
  return (
    <Icon>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 13.5V10M10 2.5h4M12 2.5V6M18.5 6.5 20 5" />
    </Icon>
  )
}

/** Every to-do: a list. */
export function ListIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </Icon>
  )
}

/** Turn a moving part's direction: an arrow going round, clockwise. */
export function TurnIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v4.5h-4.5" />
    </Icon>
  )
}

/** Remove. */
export function CloseIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  )
}

/** A dropdown's chevron. */
export function ChevronDownIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  )
}

/** Add (any accent colour). */
export function PlusIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

/** Homework: the same pencil as its to-do checkbox. */
export function PencilIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M14 7l3 3" />
    </Icon>
  )
}

/** An exam: a clipboard with a tick. */
export function ExamIcon(): React.JSX.Element {
  return (
    <Icon>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 3h6v3H9zM9 13l2 2 4-4" />
    </Icon>
  )
}
