import type { TodoState } from '../../../main/ipc'
import { useConnectForm } from '../../hooks/useConnectForm'
import { CanvasForm } from '../../widgets/todo/CanvasForm'
import { SourceIcon } from '../../widgets/todo/SourceIcon'
import { Section } from './controls'
import { sourceRows, type SourceAction } from './customizeView'

export function SourcesSection({ todos }: { todos: TodoState | null }): React.JSX.Element {
  // Connect Canvas asks main for its form, which comes back to this window.
  const [form, closeForm] = useConnectForm()
  const rows = sourceRows(todos)

  return (
    <Section title="To-do sources">
      <div className="customize__rows">
        {rows.map((row) => (
          <div key={row.id} className="customize__source">
            <div className="customize__row">
              {/* The same icon, in the same colour, as the source's to-do checkboxes. */}
              <span className="customize__source-icon">
                <SourceIcon source={row.id} filled />
              </span>
              <span className="customize__toggle-text">
                <span>{row.name}</span>
                <span className="customize__hint">{row.status}</span>
              </span>
              {row.action && !(row.id === 'canvas' && form) && <ActionButton action={row.action} />}
            </div>
            {row.id === 'canvas' && form && (
              <div className="customize__form">
                <CanvasForm initialAddress={form.address} onClose={closeForm} />
              </div>
            )}
          </div>
        ))}
      </div>
      {todos?.demo && (
        <p className="customize__hint">
          Demo to-dos fill the card until a source is connected (dev builds only).
        </p>
      )}
    </Section>
  )
}

function ActionButton({ action }: { action: SourceAction }): React.JSX.Element {
  return (
    <button
      type="button"
      className={`customize__button${action.primary ? ' customize__button--primary' : ''}`}
      onClick={() => window.focusScreen.sendTodoCommand(action.command)}
    >
      {action.label}
    </button>
  )
}
