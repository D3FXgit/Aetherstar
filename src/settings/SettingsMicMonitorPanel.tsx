import { useEffect } from 'react'
import { GlassSlider } from '../design/primitives/GlassSlider'
import { GlassToggle } from '../design/primitives/GlassToggle'
import { SettingsPanel } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'
import { useMicMonitorStore } from '../audio/micMonitorStore'
import { useT } from '../i18n'

/**
 * The karaoke effect: the singers' voices through the speakers. A mic aimed at
 * the speakers can feed back; the native layer caps the gain but does not cancel
 * feedback, so the level row tells people to turn it down if it whistles.
 */
export function SettingsMicMonitorPanel() {
  const enabled = useMicMonitorStore((state) => state.enabled)
  const level = useMicMonitorStore((state) => state.level)
  const loaded = useMicMonitorStore((state) => state.loaded)
  const setEnabled = useMicMonitorStore((state) => state.setEnabled)
  const setLevel = useMicMonitorStore((state) => state.setLevel)
  const t = useT()

  useEffect(() => {
    void useMicMonitorStore.getState().load()
  }, [])

  return (
    <SettingsPanel title={t('settings.monitor.title')} testId="settings-mic-monitor-panel">
      <SettingsRow label={t('settings.monitor.hear.label')} description={t('settings.monitor.hear.description')}>
        <GlassToggle
          label={t('settings.monitor.hear.label')}
          data-testid="settings-mic-monitor-toggle"
          checked={enabled}
          // Until `load()` has answered, the switch would be showing a guess.
          disabled={!loaded}
          onChange={(next) => void setEnabled(next)}
        />
      </SettingsRow>

      <SettingsRow
        label={t('settings.monitor.level.label')}
        description={enabled ? t('settings.monitor.level.description') : t('settings.monitor.level.disabled')}
      >
        <GlassSlider
          label={t('settings.monitor.level.label')}
          data-testid="settings-mic-monitor-level"
          className="w-48"
          value={level}
          min={0}
          max={1}
          step={0.05}
          valueText={t('common.percent', { value: Math.round(level * 100) })}
          // Greyed out rather than hidden while monitoring is off: a control
          // that appears and disappears makes the pane jump, and the level is
          // still worth seeing before switching it on.
          disabled={!loaded || !enabled}
          onChange={(next) => void setLevel(next)}
        />
      </SettingsRow>
    </SettingsPanel>
  )
}
