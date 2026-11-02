import { useEffect, useState } from 'react'
import { GlassButton } from '../design/primitives/GlassButton'
import { NeonText } from '../design/primitives/NeonText'
import { SettingsPanel } from './SettingsGroup'
import { SettingsRow } from './SettingsRow'
import { ROW_BUTTON_CLASS } from './settingsStyles'
import { useAppPreferencesStore } from './appPreferencesStore'
import { getSystemLanguages, pickLanguage, refreshLanguages, setLanguage, useI18nStore, useT } from '../i18n'

/**
 * The language picker.
 *
 * One row per installed language rather than a dropdown: the list is short,
 * every row can say where the language came from and how complete it is, and
 * a row of plain buttons is reachable by the sofa's spatial focus where a
 * native <select> popup is not.
 *
 * The list is whatever .txt files exist -- bundled plus the user's own
 * languages folder -- re-read each time this panel opens, so a file someone
 * just dropped in shows up without a restart. Each language's name is shown in
 * that language ("Deutsch", not "German"), so someone who cannot read the
 * current one can still find their own.
 */
export function SettingsLanguagePanel() {
  const t = useT()
  const preference = useAppPreferencesStore((state) => state.language)
  const languages = useI18nStore((state) => state.languages)
  const canOpenFolder = typeof window !== 'undefined' && Boolean(window.api?.i18n)

  // True once this panel's own re-read of the folders has landed. Until then
  // the list is the built-in one, which never has the user's own languages in
  // it, so "not in the list" means nothing yet.
  const [listed, setListed] = useState(false)
  useEffect(() => {
    let alive = true
    void refreshLanguages().finally(() => {
      if (alive) setListed(true)
    })
    return () => {
      alive = false
    }
  }, [])

  // The saved language's file was deleted: the app already falls back to the
  // system language / English, so show Automatic as the choice in force and
  // forget the stale preference rather than leave no row selected.
  const preferenceMissing = listed && preference !== null && !languages.some((language) => language.code === preference)
  useEffect(() => {
    if (preferenceMissing) void setLanguage(null)
  }, [preferenceMissing])
  const autoSelected = preference === null || preferenceMissing

  const systemCode = pickLanguage(null, getSystemLanguages(), languages.map((language) => language.code))
  const systemName = languages.find((language) => language.code === systemCode)?.name ?? systemCode

  return (
    <SettingsPanel title={t('settings.language.title')} testId="settings-language-panel">
      <SettingsRow
        label={t('settings.language.auto.label')}
        description={t('settings.language.auto.description', { language: systemName })}
      >
        <ChoiceControl
          selected={autoSelected}
          testId="auto"
          label={t('settings.language.auto.label')}
          onChoose={() => void setLanguage(null)}
        />
      </SettingsRow>

      {languages.map((language) => (
        <SettingsRow
          key={language.code}
          label={<span lang={language.code}>{language.name}</span>}
          description={
            <>
              <span>
                {language.source === 'user' ? t('settings.language.source.user') : t('settings.language.source.bundled')}
              </span>
              {language.missingKeys > 0 ? (
                <>
                  <span aria-hidden> · </span>
                  <span>{t('settings.language.missing', { count: language.missingKeys })}</span>
                </>
              ) : null}
            </>
          }
        >
          <ChoiceControl
            selected={preference === language.code}
            testId={language.code}
            label={language.name}
            onChoose={() => void setLanguage(language.code)}
          />
        </SettingsRow>
      ))}

      {canOpenFolder ? (
        <SettingsRow label={t('settings.language.folder.label')} description={t('settings.language.folder.description')}>
          <GlassButton
            type="button"
            className={ROW_BUTTON_CLASS}
            data-testid="settings-language-open-folder"
            onClick={() => void window.api?.i18n?.openLanguagesFolder()}
          >
            {t('settings.language.folder.action')}
          </GlassButton>
        </SettingsRow>
      ) : null}
    </SettingsPanel>
  )
}

interface ChoiceControlProps {
  selected: boolean
  /** `auto` or a language code -- suffix of the control's testid. */
  testId: string
  /** What the button chooses, for its accessible name ("Use Deutsch"). */
  label: string
  onChoose: () => void
}

/** "Selected" marker or a "Use" button -- the same pairing the Displays panel uses. */
function ChoiceControl({ selected, testId, label, onChoose }: ChoiceControlProps) {
  const t = useT()
  if (selected) {
    return (
      <NeonText accent="gold" className="text-xs font-semibold" data-testid={`settings-language-selected-${testId}`}>
        {t('common.selected')}
      </NeonText>
    )
  }
  return (
    <GlassButton
      type="button"
      className={ROW_BUTTON_CLASS}
      data-testid={`settings-language-use-${testId}`}
      aria-label={t('settings.language.useLabel', { language: label })}
      onClick={onChoose}
    >
      {t('settings.language.use')}
    </GlassButton>
  )
}
