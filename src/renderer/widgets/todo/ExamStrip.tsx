import { useState } from 'react'
import type { ExamItem } from '../../../main/ipc'
import { examStrip } from './examView'
import './ExamStrip.css'

/**
 * The countdown to the user's next exam, pinned above the to-dos from the day it's added until
 * it's over; gold from 3 days out. The others fold away behind "+N more". A right-click on any
 * of them gives its Edit… and Delete (by `data-homework-id`).
 */
export function ExamStrip({
  exams,
  now
}: {
  exams: ExamItem[]
  now: Date
}): React.JSX.Element | null {
  const [unfolded, setUnfolded] = useState(false)
  const strip = examStrip(exams, now)
  if (!strip) return null
  const { first, rest } = strip

  return (
    <section
      className={`exam-strip${first.near ? ' exam-strip--near' : ''}`}
      aria-label="Exams coming up"
    >
      <div className="exam-strip__first" data-homework-id={first.id}>
        <div className="exam-strip__count">
          <span className="exam-strip__big">{first.big}</span>
          {first.unit && <span className="exam-strip__unit">{first.unit}</span>}
        </div>
        <div className="exam-strip__text">
          <span className="exam-strip__name">{first.name}</span>
          <span className="exam-strip__when">{first.when}</span>
        </div>
        {/* A short card's version: one line, so the to-dos keep their room. */}
        <span className="exam-strip__line">
          <span className="exam-strip__name">{first.name}</span> · {first.brief}
        </span>
      </div>
      {rest.length > 0 && (
        <button
          type="button"
          className="exam-strip__more"
          aria-expanded={unfolded}
          onClick={() => setUnfolded((open) => !open)}
        >
          {unfolded ? 'Fewer' : `+${rest.length} more`}
        </button>
      )}
      {unfolded && rest.length > 0 && (
        <ul className="exam-strip__rest">
          {rest.map((exam) => (
            <li
              key={exam.id}
              className={
                exam.near ? 'exam-strip__other exam-strip__other--near' : 'exam-strip__other'
              }
              data-homework-id={exam.id}
            >
              {exam.name} · {exam.brief}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
