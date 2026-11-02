import { useState } from 'react'
import { motion } from 'framer-motion'
import { BackButton } from '../scenes/SceneHeader'
import { SettingsNav, type SettingsNavSection } from './SettingsNav'
import { SettingsGroup } from './SettingsGroup'
import { GROUP_CONTAINER_VARIANTS } from './settingsStyles'
import { SettingsMicsPanel, SettingsMicToolsPanel } from './SettingsMicsPanel'
import { SettingsMicMonitorPanel } from './SettingsMicMonitorPanel'
import { SettingsVolumePanel } from './SettingsVolumePanel'
import { SettingsLibraryPanel } from './SettingsLibraryPanel'
import { SettingsDisplayPanel } from './SettingsDisplayPanel'
import { SettingsWindowPanel } from './SettingsWindowPanel'
import { SettingsFxPanel } from './SettingsFxPanel'
import { SettingsLanguagePanel } from './SettingsLanguagePanel'
import { useAppPreferencesStore } from './appPreferencesStore'
import { useT } from '../i18n'

export const SETTINGS_TAB_MICS = 'settings-tab-mics'
export const SETTINGS_TAB_SONGS = 'settings-tab-songs'
export const SETTINGS_TAB_GRAPHICS = 'settings-tab-graphics'

/** Tab ids and the language-file keys of their labels (languages/*.txt). */
const SECTIONS = [
  { id: SETTINGS_TAB_MICS, labelKey: 'settings.tabs.audio' },
  { id: SETTINGS_TAB_SONGS, labelKey: 'settings.tabs.songs' },
  { id: SETTINGS_TAB_GRAPHICS, labelKey: 'settings.tabs.graphics' },
] as const

const SECTION_IDS = new Set<string>(SECTIONS.map((section) => section.id))

/**
 * The Settings scene: three panes, one visible at a time. Plain tab state, so
 * only the visible pane is mounted and can safely hold something expensive
 * (see MicMatrix's capture claim).
 */
export function Settings() {
  const t = useT()
  const sections: readonly SettingsNavSection[] = SECTIONS.map(({ id, labelKey }) => ({ id, label: t(labelKey) }))
  const storedTabId = useAppPreferencesStore((state) => state.settingsTabId)
  // Restoring the last pane: people adjust related settings more than once, so
  // reopening where they left off saves re-finding it. Validated against the
  // current tab set so a stale id from an older build can't blank the scene.
  const [activeId, setActiveId] = useState<string>(() =>
    storedTabId !== null && SECTION_IDS.has(storedTabId) ? storedTabId : SECTIONS[0].id,
  )

  function handleSelect(id: string) {
    setActiveId(id)
    useAppPreferencesStore.getState().setSettingsTabId(id)
  }

  return (
    // Full viewport height: Settings draws Back in its own rail, so the shell
    // reserves no band above it.
    <div className="flex h-screen w-full justify-center" data-testid="settings-scene">
      {/* Rail and pane share one centred column so neither gutter runs away
          from the other on a wide window. The rail stacks above the pane on a
          narrow window rather than being duplicated or hidden -- it is the only
          way between panes, so it is never allowed to disappear. */}
      <div className="flex w-full max-w-[1100px] flex-col gap-6 px-10 lg:flex-row lg:gap-10">
        <aside className="flex shrink-0 flex-col gap-4 pt-10 lg:w-56 lg:gap-6">
          {/* Back leads the rail, above the title and tabs, so the screen's
              navigation reads top to bottom in one aligned column. */}
          <BackButton className="self-start" />
          <h1 className="text-[28px] font-bold tracking-tight text-ink-primary">{t('settings.title')}</h1>
          <SettingsNav sections={sections} activeId={activeId} onSelect={handleSelect} />
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto pb-10 pr-1 lg:pt-10">
          <motion.div
            className="flex w-full flex-col gap-7"
            variants={GROUP_CONTAINER_VARIANTS}
            initial="hidden"
            animate="visible"
            // Keyed on the tab so switching panes replays the entrance stagger
            // rather than swapping content underneath a finished animation.
            key={activeId}
          >
            {activeId === SETTINGS_TAB_MICS && (
              <SettingsGroup id={SETTINGS_TAB_MICS} title={t('settings.tabs.audio')}>
                {/* First: it is the setting people reach for most, and the
                    only one that changes every sound the game makes. */}
                <SettingsVolumePanel />
                <SettingsMicsPanel />
                {/* Directly under the matrix: it is about those same eight
                    inputs, and it is the setting most likely to be reached for
                    while someone is standing in front of them testing one. */}
                <SettingsMicMonitorPanel />
                <SettingsMicToolsPanel />
              </SettingsGroup>
            )}

            {activeId === SETTINGS_TAB_SONGS && (
              <SettingsGroup id={SETTINGS_TAB_SONGS} title={t('settings.tabs.songs')}>
                <SettingsLibraryPanel />
              </SettingsGroup>
            )}

            {activeId === SETTINGS_TAB_GRAPHICS && (
              <SettingsGroup id={SETTINGS_TAB_GRAPHICS} title={t('settings.tabs.graphics')}>
                {/* First in the pane: it is the only control that can undo the
                    full-screen startup default, so it must not be something a
                    user has to scroll past two other panels to find. */}
                <SettingsWindowPanel />
                <SettingsDisplayPanel />
                <SettingsFxPanel />
                {/* Last: set once (and usually right already -- it follows the
                    system language), so it should not push the window and
                    display controls down. */}
                <SettingsLanguagePanel />
              </SettingsGroup>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  )
}
