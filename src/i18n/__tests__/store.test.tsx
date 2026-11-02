import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'

const PREFS_KEY = 'aetherstar:app-preferences'

/** A fresh i18n + preferences module pair, as at app start. */
async function freshI18n() {
  vi.resetModules()
  const i18n = await import('../index')
  const prefs = await import('../../settings/appPreferencesStore')
  return { ...i18n, useAppPreferencesStore: prefs.useAppPreferencesStore }
}

function setSystemLanguages(languages: string[]) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(languages[0] ?? '')
}

beforeEach(() => {
  localStorage.clear()
  setSystemLanguages(['en-US'])
})

afterEach(() => {
  vi.restoreAllMocks()
  delete window.api
})

describe('pickLanguage', () => {
  it('prefers the saved choice, then the system language (exact, then base), then English', async () => {
    const { pickLanguage } = await freshI18n()
    const available = ['en', 'de', 'pt-BR']
    expect(pickLanguage('pt-BR', ['de-DE'], available)).toBe('pt-BR')
    expect(pickLanguage(null, ['pt-BR', 'de'], available)).toBe('pt-BR')
    expect(pickLanguage(null, ['de-AT'], available)).toBe('de')
    expect(pickLanguage(null, ['fr-FR', 'de-CH'], available)).toBe('de')
    expect(pickLanguage('fr', ['ja'], available)).toBe('en')
    expect(pickLanguage(null, [], available)).toBe('en')
  })
})

describe('the i18n store without a main process (tests, browser preview)', () => {
  it('starts in the system language when nothing is saved', async () => {
    setSystemLanguages(['de-DE', 'en'])
    const { t, useI18nStore } = await freshI18n()
    expect(useI18nStore.getState().language).toBe('de')
    expect(t('settings.title')).toBe('Einstellungen')
    expect(document.documentElement.lang).toBe('de')
  })

  it('starts in English for a system language nobody has translated yet', async () => {
    setSystemLanguages(['fi-FI'])
    const { t } = await freshI18n()
    expect(t('settings.title')).toBe('Settings')
  })

  it('starts in the saved language over the system one', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ language: 'de' }))
    const { useI18nStore } = await freshI18n()
    expect(useI18nStore.getState().language).toBe('de')
  })

  it('lists the bundled languages from the language files compiled into the renderer', async () => {
    const { useI18nStore } = await freshI18n()
    expect(useI18nStore.getState().languages).toEqual([
      { code: 'de', name: 'Deutsch', source: 'bundled', missingKeys: 0 },
      { code: 'en', name: 'English', source: 'bundled', missingKeys: 0 },
    ])
  })

  it('setLanguage switches the texts, persists the choice, and null goes back to the system language', async () => {
    const { t, setLanguage, useAppPreferencesStore } = await freshI18n()
    await setLanguage('de')
    expect(t('settings.title')).toBe('Einstellungen')
    expect(useAppPreferencesStore.getState().language).toBe('de')
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).language).toBe('de')

    await setLanguage(null)
    expect(t('settings.title')).toBe('Settings')
    expect(useAppPreferencesStore.getState().language).toBeNull()
  })

  it('useT re-renders a component when the language changes', async () => {
    const { useT, setLanguage } = await freshI18n()
    function Title() {
      const t = useT()
      return <h1>{t('settings.mics.players.count', { count: 2 })}</h1>
    }
    render(<Title />)
    expect(screen.getByRole('heading')).toHaveTextContent('2 players in your roster.')

    await act(() => setLanguage('de'))
    expect(screen.getByRole('heading')).toHaveTextContent('2 Spieler in deiner Truppe.')
  })

  it('follows a language change made in another window (the storage event)', async () => {
    const { useI18nStore, initI18n } = await freshI18n()
    await initI18n()
    const newValue = JSON.stringify({ language: 'de' })
    window.dispatchEvent(new StorageEvent('storage', { key: PREFS_KEY, newValue }))
    await waitFor(() => expect(useI18nStore.getState().language).toBe('de'))
  })
})

describe('the i18n store with the main process (window.api.i18n)', () => {
  function stubApi(overrides: Partial<NonNullable<NonNullable<Window['api']>['i18n']>> = {}) {
    let changed: (() => void) | null = null
    const i18n = {
      listLanguages: vi.fn().mockResolvedValue([
        { code: 'de', name: 'Deutsch', source: 'bundled', missingKeys: 0 },
        { code: 'en', name: 'English', source: 'bundled', missingKeys: 0 },
        { code: 'fr', name: 'Français', source: 'user', missingKeys: 40 },
      ]),
      loadLanguage: vi.fn(async (code: string) =>
        code === 'fr' ? { 'settings.title': 'Paramètres' } : code === 'en' ? { 'settings.title': 'Settings' } : {},
      ),
      openLanguagesFolder: vi.fn().mockResolvedValue(''),
      onLanguagesChanged: vi.fn((callback: () => void) => {
        changed = callback
        return () => {}
      }),
      ...overrides,
    }
    window.api = { i18n } as unknown as Window['api']
    return { i18n, fireChanged: () => changed?.() }
  }

  it('offers a language that only exists in the user folder, and loads it through IPC', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ language: 'fr' }))
    const { i18n } = stubApi()
    const { initI18n, t, useI18nStore } = await freshI18n()
    // First paint: fr is not compiled in, so English until the files are read.
    expect(t('settings.title')).toBe('Settings')

    await initI18n()
    expect(useI18nStore.getState().languages.map((l) => l.code)).toContain('fr')
    expect(i18n.loadLanguage).toHaveBeenCalledWith('fr')
    expect(t('settings.title')).toBe('Paramètres')
    // Untranslated keys fall back to English.
    expect(t('settings.tabs.audio')).toBe('Audio & Mics')
  })

  it('falls back to the built-in copy when the main process cannot load a language', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ language: 'de' }))
    stubApi({ loadLanguage: vi.fn().mockRejectedValue(new Error('boom')) })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { initI18n, t } = await freshI18n()
    await initI18n()
    expect(t('settings.title')).toBe('Einstellungen')
  })

  it('tells the main process which language is on screen, so its native dialogs match', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ language: 'fr' }))
    const setActiveLanguage = vi.fn()
    stubApi({ setActiveLanguage })
    const { initI18n, setLanguage } = await freshI18n()
    await initI18n()
    expect(setActiveLanguage).toHaveBeenLastCalledWith('fr')
    await setLanguage('de')
    expect(setActiveLanguage).toHaveBeenLastCalledWith('de')
  })

  it('reloads when a language file changes on disk', async () => {
    const { i18n, fireChanged } = stubApi()
    const { initI18n } = await freshI18n()
    await initI18n()
    const listLanguages = vi.mocked(i18n.listLanguages)
    const listsBefore = listLanguages.mock.calls.length
    fireChanged()
    await waitFor(() => expect(listLanguages.mock.calls.length).toBe(listsBefore + 1))
  })
})
