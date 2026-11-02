import { SettingsPanel } from './SettingsGroup'
import { SettingsLinkRow } from './SettingsRow'
import { MicMatrix } from '../multiplayer/MicMatrix'
import { usePitchStore } from '../audio/pitchStore'
import { usePlayersStore } from '../players/store'
import { useScene } from '../scenes/useScene'
import { useEffect } from 'react'
import { useT } from '../i18n'

/**
 * The hardware pane: eight numbered microphone inputs, and the way to the
 * screens that go deeper on one of them.
 *
 * The matrix is the pane's whole point and gets the whole width, so it is not
 * wrapped in a `SettingsRow` -- a row is a label plus one trailing control, and
 * this is a table.
 */
export function SettingsMicsPanel() {
  const t = useT()
  return (
    <SettingsPanel title={t('settings.mics.title')} testId="settings-mics-panel">
      <div className="px-6 pb-4 pt-1">
        <p className="mb-3 max-w-[52ch] text-[13px] leading-snug text-ink-secondary">{t('settings.mics.hint')}</p>
        <MicMatrix />
      </div>
    </SettingsPanel>
  )
}

/**
 * The drill-ins that belong with the mics: the full-screen check, the timing
 * wizard, and the roster.
 *
 * These stay separate scenes rather than being inlined -- each is a real,
 * multi-step task, and a settings pane is not the place to run one.
 */
export function SettingsMicToolsPanel() {
  const deviceCount = usePitchStore((state) => state.devices.length)
  const players = usePlayersStore((state) => state.players)
  const { navigate } = useScene()
  const t = useT()

  useEffect(() => {
    usePlayersStore.getState().load()
  }, [])

  return (
    <SettingsPanel testId="settings-mic-tools-panel">
      <SettingsLinkRow
        label={t('settings.mics.check.label')}
        description={
          deviceCount === 0 ? t('settings.mics.check.none') : t('settings.mics.check.count', { count: deviceCount })
        }
        action={t('settings.mics.check.action')}
        onClick={() => navigate('mic')}
      />
      <SettingsLinkRow
        label={t('settings.mics.timing.label')}
        description={t('settings.mics.timing.description')}
        action={t('settings.mics.timing.action')}
        onClick={() => navigate('calibration')}
      />
      <SettingsLinkRow
        label={t('settings.mics.players.label')}
        description={
          players.length === 0 ? t('settings.mics.players.none') : t('settings.mics.players.count', { count: players.length })
        }
        action={t('settings.mics.players.action')}
        onClick={() => navigate('players')}
      />
    </SettingsPanel>
  )
}
