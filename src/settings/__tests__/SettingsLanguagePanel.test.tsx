import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Settings } from '../Settings'
import { SettingsLanguagePanel } from '../SettingsLanguagePanel'
import { useAppPreferencesStore } from '../appPreferencesStore'
import { refreshLanguages, setLanguage, useI18nStore } from '../../i18n'

beforeEach(() => {
  localStorage.clear()
})

afterEach(async () => {
  delete window.api
  await setLanguage(null)
  vi.restoreAllMocks()
})

/** The mocked list outlives the test in the i18n store; put the built-in one back. */
async function restoreBuiltInLanguageList() {
  delete window.api
  await setLanguage(null)
  await refreshLanguages()
}

describe('SettingsLanguagePanel', () => {
  it('lists every installed language by its own name, with "Automatic" selected by default', async () => {
    render(<SettingsLanguagePanel />)

    expect(screen.getByText('Deutsch')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByTestId('settings-language-selected-auto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use Deutsch' })).toBeInTheDocument()
    // The system language (jsdom: en-US) is named on the Automatic row.
    expect(screen.getByText('Follow your system language (English).')).toBeInTheDocument()
    await waitFor(() => expect(useI18nStore.getState().languages).toHaveLength(2))
  })

  it('falls back to Automatic, and forgets the preference, when the saved language file was deleted', async () => {
    window.api = {
      i18n: {
        listLanguages: vi.fn().mockResolvedValue([
          { code: 'de', name: 'Deutsch', source: 'bundled', missingKeys: 0 },
          { code: 'en', name: 'English', source: 'bundled', missingKeys: 0 },
        ]),
        loadLanguage: vi.fn().mockResolvedValue({}),
        openLanguagesFolder: vi.fn().mockResolvedValue(''),
      },
    } as unknown as typeof window.api
    // fr.txt (a user file) was chosen, then deleted from the folder.
    useAppPreferencesStore.setState({ language: 'fr' })

    render(<SettingsLanguagePanel />)

    await waitFor(() => expect(screen.getByTestId('settings-language-selected-auto')).toBeInTheDocument())
    await waitFor(() => expect(useAppPreferencesStore.getState().language).toBeNull())
    await restoreBuiltInLanguageList()
  })

  it('keeps a user language selected while the folder is still being read', async () => {
    let resolveList: (value: unknown) => void = () => {}
    window.api = {
      i18n: {
        listLanguages: vi.fn().mockReturnValue(new Promise((resolve) => (resolveList = resolve))),
        loadLanguage: vi.fn().mockResolvedValue({}),
        openLanguagesFolder: vi.fn().mockResolvedValue(''),
      },
    } as unknown as typeof window.api
    useAppPreferencesStore.setState({ language: 'fr' })

    render(<SettingsLanguagePanel />)
    expect(useAppPreferencesStore.getState().language).toBe('fr')

    resolveList([
      { code: 'en', name: 'English', source: 'bundled', missingKeys: 0 },
      { code: 'fr', name: 'Français', source: 'user', missingKeys: 0 },
    ])
    await waitFor(() => expect(screen.getByTestId('settings-language-selected-fr')).toBeInTheDocument())
    expect(useAppPreferencesStore.getState().language).toBe('fr')
    await restoreBuiltInLanguageList()
  })

  it('switches the whole Settings screen live and remembers the choice', async () => {
    useAppPreferencesStore.setState({ settingsTabId: 'settings-tab-graphics' })
    render(<Settings />)
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Use Deutsch' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Einstellungen' })).toBeInTheDocument())
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Audio & Mikros', 'Song-Ordner', 'Grafik'])
    expect(screen.getByText('Sprache')).toBeInTheDocument()
    expect(screen.getByTestId('settings-language-selected-de')).toHaveTextContent('Ausgewählt')
    expect(useAppPreferencesStore.getState().language).toBe('de')

    // ...and back, via "Automatic" (now labelled in German).
    fireEvent.click(screen.getByRole('button', { name: 'Automatisch nehmen' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument())
    expect(useAppPreferencesStore.getState().language).toBeNull()
  })

  it('shows where a language came from and how much is untranslated, and opens the user folder', async () => {
    const openLanguagesFolder = vi.fn().mockResolvedValue('')
    window.api = {
      i18n: {
        listLanguages: vi.fn().mockResolvedValue([
          { code: 'de', name: 'Deutsch', source: 'bundled', missingKeys: 0 },
          { code: 'en', name: 'English', source: 'bundled', missingKeys: 0 },
          { code: 'fr', name: 'Français', source: 'user', missingKeys: 1 },
          { code: 'it', name: 'Italiano', source: 'user', missingKeys: 12 },
        ]),
        loadLanguage: vi.fn().mockResolvedValue({}),
        openLanguagesFolder,
      },
    } as unknown as Window['api']

    render(<SettingsLanguagePanel />)

    await waitFor(() => expect(screen.getByText('Français')).toBeInTheDocument())
    expect(screen.getByText('1 text not translated yet')).toBeInTheDocument()
    expect(screen.getByText('12 texts not translated yet')).toBeInTheDocument()
    expect(screen.getAllByText('From your languages folder')).toHaveLength(2)

    fireEvent.click(screen.getByTestId('settings-language-open-folder'))
    expect(openLanguagesFolder).toHaveBeenCalledTimes(1)
  })

  it('hides "Open languages folder" when there is no main process to open it', () => {
    render(<SettingsLanguagePanel />)
    expect(screen.queryByTestId('settings-language-open-folder')).toBeNull()
  })
})
