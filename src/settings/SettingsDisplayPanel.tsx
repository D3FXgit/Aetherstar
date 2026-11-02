import { useEffect, useState } from 'react'
import { GlassButton } from '../design/primitives/GlassButton'
import { GlassToggle } from '../design/primitives/GlassToggle'
import { NeonText } from '../design/primitives/NeonText'
import { SettingsPanel } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'
import { EMPTY_STATE_CLASS, ROW_BUTTON_CLASS } from './settingsStyles'
import type { AudienceDisplaysPayload } from '../audience/types'
import { useT } from '../i18n'

const EMPTY: AudienceDisplaysPayload = { displays: [], selectedDisplayId: null, enabled: false }

/** Whether the audience window opens, and on which monitor. */
export function SettingsDisplayPanel() {
  const [payload, setPayload] = useState<AudienceDisplaysPayload>(EMPTY)
  const t = useT()

  useEffect(() => {
    window.api?.audience.listDisplays().then(setPayload)
  }, [])

  return (
    <SettingsPanel title={t('settings.display.title')} testId="settings-display-panel">
      <SettingsRow label={t('settings.display.second.label')} description={t('settings.display.second.description')}>
        <GlassToggle
          label={t('settings.display.second.toggle')}
          data-testid="settings-display-enabled-toggle"
          checked={payload.enabled}
          onChange={async (enabled) => {
            setPayload((prev) => ({ ...prev, enabled }))
            await window.api?.audience.setEnabled(enabled)
          }}
        />
      </SettingsRow>

      {payload.displays.length === 0 && <p className={EMPTY_STATE_CLASS}>{t('settings.display.empty')}</p>}
      {payload.displays.map((display) => {
        const isSelected = display.id === payload.selectedDisplayId
        return (
          <SettingsRow key={display.id} label={display.label} description={display.isPrimary ? t('settings.display.primary') : undefined}>
            {isSelected ? (
              <NeonText accent="gold" className="text-xs font-semibold" data-testid={`settings-display-selected-${display.id}`}>
                {t('common.selected')}
              </NeonText>
            ) : (
              <GlassButton
                type="button"
                className={ROW_BUTTON_CLASS}
                data-testid={`settings-display-select-${display.id}`}
                onClick={async () => {
                  await window.api?.audience.setDisplay(display.id)
                  setPayload((prev) => ({ ...prev, selectedDisplayId: display.id }))
                }}
              >
                {t('common.select')}
              </GlassButton>
            )}
          </SettingsRow>
        )
      })}
    </SettingsPanel>
  )
}
