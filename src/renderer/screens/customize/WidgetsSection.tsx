import type { SettingsPatch, TodoState, WidgetSettings } from '../../../main/ipc'
import { useLayoutEditing } from '../../hooks/useLayoutEditing'
import { Section, ToggleRow } from './controls'
import { sourceNames } from './customizeView'

export function WidgetsSection({
  widgets,
  todos,
  update
}: {
  widgets: WidgetSettings
  todos: TodoState | null
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const set = (change: Partial<WidgetSettings>): void => update({ widgets: change })
  const editing = useLayoutEditing()
  const custom = widgets.layout !== null
  return (
    <Section title="Widgets on screen">
      <div className="customize__rows">
        <ToggleRow
          label="Now playing"
          hint="Disc, controls, lyrics"
          on={widgets.music}
          onToggle={(music) => set({ music })}
        />
        <ToggleRow
          label="To-do list"
          hint={sourceNames(todos)}
          on={widgets.todos}
          onToggle={(on) => set({ todos: on })}
        />
        <ToggleRow
          label="Timer"
          hint="Pomodoro, countdown, stopwatch"
          on={widgets.timer}
          onToggle={(timer) => set({ timer })}
        />
        <ToggleRow
          label="Clock and date"
          hint="Top bar; the Customize button always stays"
          on={widgets.clock}
          onToggle={(clock) => set({ clock })}
        />
        <div className="customize__row">
          <span className="customize__toggle-text">
            <span>Card layout</span>
            <span className="customize__hint">
              {editing
                ? 'Drag the cards on the Focus Screen, then click Done'
                : custom
                  ? 'Your own arrangement'
                  : 'Music on the left, to-do and timer on the right'}
            </span>
          </span>
          <span className="customize__row-actions">
            <button
              type="button"
              className="customize__button"
              disabled={!custom}
              onClick={() => set({ layout: null })}
            >
              Reset
            </button>
            <button
              type="button"
              className={`customize__button${editing ? ' customize__button--primary' : ''}`}
              onClick={() => window.focusScreen.setLayoutEditing(!editing)}
            >
              {editing ? 'Done' : 'Edit layout'}
            </button>
          </span>
        </div>
      </div>
    </Section>
  )
}
