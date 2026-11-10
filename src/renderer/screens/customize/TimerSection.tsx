import type { SettingsPatch, TimerSettings } from '../../../main/ipc'
import { BREAK_PICKS, COUNTDOWN_PICKS, FOCUS_PICKS } from '../../../main/services/timer/lengths'
import { LengthGroup, PillGroup, Section, ToggleRow } from './controls'

export function TimerSection({
  timer,
  update
}: {
  timer: TimerSettings
  update: (patch: SettingsPatch) => void
}): React.JSX.Element {
  const set = (change: Partial<TimerSettings>): void => update({ timer: change })
  return (
    <Section title="Timer">
      <PillGroup
        label="Style"
        options={[
          { value: 'ring', label: 'Ring' },
          { value: 'bar', label: 'Bar' },
          { value: 'flip', label: 'Flip digits' }
        ]}
        value={timer.style}
        onPick={(style) => set({ style })}
      />
      <PillGroup
        label="Direction"
        options={[
          { value: 'down', label: 'Count down' },
          { value: 'up', label: 'Count up' }
        ]}
        value={timer.direction}
        onPick={(direction) => set({ direction })}
      />
      <LengthGroup
        label="Focus length"
        name="Focus"
        picks={FOCUS_PICKS}
        valueSec={timer.focusSec}
        onChange={(focusSec) => set({ focusSec })}
      />
      <LengthGroup
        label="Break length"
        name="Break"
        picks={BREAK_PICKS}
        valueSec={timer.breakSec}
        onChange={(breakSec) => set({ breakSec })}
      />
      <LengthGroup
        label="Countdown length"
        name="Countdown"
        picks={COUNTDOWN_PICKS}
        valueSec={timer.countdownSec}
        onChange={(countdownSec) => set({ countdownSec })}
      />
      <div className="customize__rows customize__rows--ruled">
        <ToggleRow
          label="Chime when time is up"
          on={timer.chime}
          onToggle={(chime) => set({ chime })}
        />
        <ToggleRow
          label="Auto-start breaks"
          on={timer.autoStartBreaks}
          onToggle={(autoStartBreaks) => set({ autoStartBreaks })}
        />
      </div>
    </Section>
  )
}
