import { GlassToggle } from '../design/primitives/GlassToggle'
import { SettingsPanel } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'
import { useFxSettingsStore } from '../fx/quality/fxSettingsStore'
import { useT } from '../i18n'

/** The switch for `reduceEffects`; the setting itself lives in fxSettingsStore. */
export function SettingsFxPanel() {
  const reduceEffects = useFxSettingsStore((state) => state.reduceEffects)
  const setReduceEffects = useFxSettingsStore((state) => state.setReduceEffects)
  const t = useT()

  return (
    <SettingsPanel testId="settings-fx-panel">
      <SettingsRow label={t('settings.fx.reduce.label')} description={t('settings.fx.reduce.description')}>
        <GlassToggle label={t('settings.fx.reduce.label')} checked={reduceEffects} onChange={setReduceEffects} />
      </SettingsRow>
    </SettingsPanel>
  )
}
