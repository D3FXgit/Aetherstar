import { GlassSlider } from '../design/primitives/GlassSlider'
import { GlassButton } from '../design/primitives/GlassButton'
import { SettingsPanel } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'
import { MENU_MUSIC_MODES, useAppPreferencesStore } from './appPreferencesStore'
import { MIXER_ROWS } from './mixerRows'
import { ROW_BUTTON_CLASS } from './settingsStyles'
import type { MenuMusicMode } from './types'
import { useT } from '../i18n'

const MENU_MUSIC_LABEL_KEYS: Record<MenuMusicMode, string> = {
  library: 'settings.volume.menuMusicSource.library',
  builtin: 'settings.volume.menuMusicSource.builtin',
  off: 'settings.volume.menuMusicSource.off',
}

export function SettingsVolumePanel() {
  const mixer = useAppPreferencesStore((state) => state.mixer)
  const setMixerVolume = useAppPreferencesStore((state) => state.setMixerVolume)
  const t = useT()

  return (
    <SettingsPanel title={t('settings.volume.title')} testId="settings-volume-panel">
      {MIXER_ROWS.map(({ channel, labelKey, descriptionKey }) => (
        <SettingsRow key={channel} label={t(labelKey)} description={t(descriptionKey)}>
          <GlassSlider
            label={t('settings.volume.sliderLabel', { channel: t(labelKey) })}
            data-testid={`settings-volume-${channel}`}
            className="w-48"
            value={mixer[channel]}
            min={0}
            max={1}
            step={0.05}
            valueText={t('common.percent', { value: Math.round(mixer[channel] * 100) })}
            onChange={(next) => setMixerVolume(channel, next)}
          />
        </SettingsRow>
      ))}
      {/* Right under the Menu music slider (the last mixer row): the slider
          sets how loud the menu music is, this sets what it is. */}
      <MenuMusicSourceRow />
    </SettingsPanel>
  )
}

/**
 * Songs from your library / Built-in track / Off. A row of plain buttons, not a
 * dropdown, so the sofa's spatial focus can reach every choice.
 */
function MenuMusicSourceRow() {
  const t = useT()
  const mode = useAppPreferencesStore((state) => state.menuMusicMode)
  const setMode = useAppPreferencesStore((state) => state.setMenuMusicMode)
  const label = t('settings.volume.menuMusicSource.label')

  return (
    <SettingsRow label={label} description={t('settings.volume.menuMusicSource.description')}>
      <div role="radiogroup" aria-label={label} className="flex shrink-0 flex-wrap justify-end gap-2" data-testid="settings-menu-music-source">
        {MENU_MUSIC_MODES.map((option) => {
          const selected = option === mode
          return (
            <GlassButton
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              variant={selected ? 'primary' : 'solid'}
              className={ROW_BUTTON_CLASS}
              data-testid={`settings-menu-music-${option}`}
              onClick={() => setMode(option)}
            >
              {t(MENU_MUSIC_LABEL_KEYS[option])}
            </GlassButton>
          )
        })}
      </div>
    </SettingsRow>
  )
}
