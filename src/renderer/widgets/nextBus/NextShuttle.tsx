import { useNow } from '../../hooks/useNow'
import { useTransit } from '../../hooks/useTransit'
import { stageClasses, usePillStage } from '../nextClass/pillStage'
import { ShuttleIcon } from './BusIcon'
// The same pill as Next class and Next bus beside it.
import '../nextClass/NextClass.css'
import { shuttleParts, shuttleView, shuttleWhen } from './shuttleView'
import './NextBus.css'

/**
 * The top bar's "ASU · Gold · every ~15 min · until 10:30 PM": ASU's published
 * timetable for the picked shuttle stops, worded so it never passes for live tracking.
 */
export function NextShuttle(): React.JSX.Element | null {
  const state = useTransit()
  const now = useNow()
  const view = shuttleView(state)
  const stage = usePillStage()
  if (!view) return null
  const { service, more } = view
  const title = [
    ...(state?.shuttles ?? []).map(
      (other) =>
        `${other.route}${other.toward ? ` to ${other.toward}` : ''}: ${shuttleWhen(other, now)}`
    ),
    'ASU shuttles, from ASU’s published timetable, not live tracking.'
  ].join('\n')
  const classes = ['next-class', 'next-bus', 'next-bus--shuttle', ...stageClasses(stage, 'shuttle')]
  if (service.state !== 'running') classes.push('next-bus--quiet')

  return (
    <p className={classes.join(' ')} title={title} data-pill="shuttle">
      {/* "ASU" is enough beside the route's own name, and no glyph: beside the Bus pill the
          room goes to how often it runs. The hover text spells it out. Its bubble gets one. */}
      <ShuttleIcon />
      <span className="next-class__label">ASU</span>
      <span className="next-class__title">{service.route}</span>
      <span className="next-bus__parts">
        {shuttleParts(service, now).map((part) => (
          <span key={part} className="next-class__part">
            {part}
          </span>
        ))}
        {more > 0 && <span className="next-class__part">+{more} more</span>}
      </span>
    </p>
  )
}
