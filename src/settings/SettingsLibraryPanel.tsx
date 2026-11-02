import { useEffect, useState } from 'react'
import { GlassButton } from '../design/primitives/GlassButton'
import { SettingsPanel } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'
import { ROW_BUTTON_CLASS } from './settingsStyles'
import { AddLibraryFolderButton } from '../library/AddLibraryFolderButton'
import * as libraryApi from '../library/api'
import type { LibraryRoot } from '../library/types'
import { useT } from '../i18n'

/** Song folders: add, rescan and remove library roots, using the library API and AddLibraryFolderButton. */
export function SettingsLibraryPanel() {
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const t = useT()

  function reload() {
    libraryApi.listRoots().then(setRoots)
  }

  useEffect(() => {
    reload()
  }, [])

  return (
    <SettingsPanel title={t('settings.library.title')} testId="settings-library-panel">
      {roots.map((root) => (
        <SettingsRow key={root.path} label={root.path}>
          <GlassButton
            type="button"
            className={ROW_BUTTON_CLASS}
            onClick={async () => {
              await libraryApi.rescan(root.path)
            }}
          >
            {t('settings.library.rescan')}
          </GlassButton>
          <GlassButton
            type="button"
            className={ROW_BUTTON_CLASS}
            onClick={async () => {
              await libraryApi.removeRoot(root.path)
              reload()
            }}
          >
            {t('settings.library.remove')}
          </GlassButton>
        </SettingsRow>
      ))}
      <SettingsRow
        label={t('settings.library.add.label')}
        description={roots.length === 0 ? t('settings.library.add.empty') : t('settings.library.add.more')}
      >
        <AddLibraryFolderButton
          className={ROW_BUTTON_CLASS}
          onFolderPicked={async (folderPath) => {
            await libraryApi.addRoot(folderPath)
            reload()
          }}
        />
      </SettingsRow>
    </SettingsPanel>
  )
}
