import './Card.css'

interface CardProps {
  label: string
  className: string
  children: React.ReactNode
}

export function Card({ label, className, children }: CardProps): React.JSX.Element {
  return (
    <section aria-label={label} className={`card ${className}`}>
      {children}
    </section>
  )
}
