import { create } from 'zustand'
import { APP_PREFERENCES_STORAGE_KEY, useAppPreferencesStore } from '../settings/appPreferencesStore'
import { listBundledLanguages, loadBundledLanguage, REFERENCE_LANGUAGE } from './bundled'
import { isValidLanguageCode, normalizeLanguageCode } from './languageFile'
import { translate } from './translate'
import type { Dictionary, LanguageInfo, TranslationParams } from './types'

/**
 * The active language.
 *
 * ---------------------------------------------------------------------------
 * Where things come from
 *
 * - Which language: the `language` preference (src/settings/appPreferencesStore,
 *   null = "Automatic"), else the system language (navigator.languages), else
 *   English. This store follows that preference; it never stores its own copy,
 *   so there is exactly one place the choice lives and is persisted.
 * - The texts: window.api.i18n (the main process reads the bundled languages/
 *   folder plus the user's own <userData>/languages). Without a main process
 *   -- tests, browser preview -- the bundled files compiled into the renderer
 *   (./bundled.ts). The bundled copy also paints the very first frame, so a
 *   shipped language never flashes English at startup.
 * - The fallback: English, held separately so `t()` can tell "not translated
 *   yet" (show English) from "no such key" (show the key).
 * ---------------------------------------------------------------------------
 */
export interface I18nState {
  /** The active language's code. */
  language: string
  /** The active language's texts, its own fallback chain merged in. */
  dictionary: Dictionary
  /** English. */
  fallback: Dictionary
  /** Every language on offer (bundled + the user's folder). */
  languages: LanguageInfo[]
}

/** The system's preferred languages, most preferred first. */
export function getSystemLanguages(): string[] {
  if (typeof navigator === 'undefined') return []
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) return [...navigator.languages]
  return navigator.language ? [navigator.language] : []
}

/**
 * Choose the language to show: the saved preference if that language exists,
 * else the first system language that does (exactly, or by its base language:
 * system `de-AT` with only `de` installed -> `de`), else English.
 */
export function pickLanguage(preference: string | null, systemLanguages: readonly string[], available: readonly string[]): string {
  const has = (code: string | null): boolean => code !== null && available.includes(code)
  if (preference !== null && has(preference)) return preference
  for (const system of systemLanguages) {
    const exact = normalizeLanguageCode(system) ?? normalizeLanguageCode(system.split('-')[0])
    if (exact !== null && has(exact)) return exact
    const base = exact ? exact.split('-')[0] : null
    if (base !== null && has(base)) return base
  }
  return REFERENCE_LANGUAGE
}

function setDocumentLanguage(code: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = code
}

function initialState(): I18nState {
  const languages = listBundledLanguages()
  const language = pickLanguage(
    useAppPreferencesStore.getState().language,
    getSystemLanguages(),
    languages.map((l) => l.code),
  )
  setDocumentLanguage(language)
  return {
    language,
    dictionary: loadBundledLanguage(language),
    fallback: loadBundledLanguage(REFERENCE_LANGUAGE),
    languages,
  }
}

export const useI18nStore = create<I18nState>(() => initialState())

async function fetchDictionary(code: string): Promise<Dictionary> {
  const api = window.api?.i18n
  if (api) {
    try {
      const dictionary = await api.loadLanguage(code)
      if (dictionary && typeof dictionary === 'object') return dictionary
    } catch (error) {
      console.warn(`[i18n] could not load "${code}" from the main process -- using the built-in copy`, error)
    }
  }
  return loadBundledLanguage(code)
}

async function fetchLanguageList(): Promise<LanguageInfo[]> {
  const api = window.api?.i18n
  if (api) {
    try {
      const languages = await api.listLanguages()
      if (Array.isArray(languages) && languages.length > 0) return languages
    } catch (error) {
      console.warn('[i18n] could not list languages from the main process -- using the built-in ones', error)
    }
  }
  return listBundledLanguages()
}

let applySequence = 0
let lastApply: Promise<void> = Promise.resolve()

/** Resolve `preference` against what is installed and load that language. The latest call wins. */
function applyPreference(preference: string | null): Promise<void> {
  const sequence = ++applySequence
  const available = useI18nStore.getState().languages.map((l) => l.code)
  const code = pickLanguage(preference, getSystemLanguages(), available)
  lastApply = fetchDictionary(code).then((dictionary) => {
    if (sequence !== applySequence) return
    useI18nStore.setState({ language: code, dictionary })
    setDocumentLanguage(code)
    // Main shows a few native dialogs itself; they follow the screen's language.
    window.api?.i18n?.setActiveLanguage?.(code)
  })
  return lastApply
}

// The preference is the single source of truth: whoever changes it (the
// Settings picker, another window via the storage event below), this follows.
useAppPreferencesStore.subscribe((state, previous) => {
  if (state.language !== previous.language) void applyPreference(state.language)
})

/**
 * Switch language: a code from `languages`, or null for "Automatic" (system
 * language). Persists the choice; every `useT()` re-renders. Resolves once the
 * new texts are on screen.
 */
export function setLanguage(code: string | null): Promise<void> {
  const next = code === null || isValidLanguageCode(code) ? code : null
  if (useAppPreferencesStore.getState().language === next) return lastApply
  useAppPreferencesStore.getState().setLanguage(next)
  return lastApply
}

/** Re-read the language list (a file may have been added) and re-apply the preference against it. */
export async function refreshLanguages(): Promise<void> {
  const languages = await fetchLanguageList()
  useI18nStore.setState({ languages })
  await applyPreference(useAppPreferencesStore.getState().language)
}

/** Re-read everything -- the list, English, the active language. Runs when a language file changes on disk. */
export async function reloadLanguages(): Promise<void> {
  const [languages, fallback] = await Promise.all([fetchLanguageList(), fetchDictionary(REFERENCE_LANGUAGE)])
  // The compiled-in English is the floor: whatever the files on disk say is
  // layered over it, so English can never come back with holes in it.
  useI18nStore.setState({ languages, fallback: { ...loadBundledLanguage(REFERENCE_LANGUAGE), ...fallback } })
  await applyPreference(useAppPreferencesStore.getState().language)
}

function handleStorage(event: StorageEvent): void {
  if (event.key !== APP_PREFERENCES_STORAGE_KEY || event.newValue === null) return
  try {
    const stored = (JSON.parse(event.newValue) as { language?: unknown }).language
    const language = isValidLanguageCode(stored) ? stored : null
    if (useAppPreferencesStore.getState().language !== language) useAppPreferencesStore.setState({ language })
  } catch {
    // Not ours to fix: the other window's store sanitises what it writes.
  }
}

let initPromise: Promise<void> | null = null

/**
 * Call once at startup (src/main.tsx). Loads the language files from disk,
 * follows file changes in the languages folders, and follows a language
 * change made in another window of the app. Safe to call more than once.
 */
export function initI18n(): Promise<void> {
  if (initPromise) return initPromise
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage)
    window.api?.i18n?.onLanguagesChanged?.(() => void reloadLanguages())
  }
  initPromise = typeof window !== 'undefined' && window.api?.i18n ? reloadLanguages() : Promise.resolve()
  return initPromise
}

/**
 * Translate outside React (event handlers, stores, plain functions). Does NOT
 * re-render anything when the language changes -- in a component use `useT()`.
 */
export function t(key: string, params?: TranslationParams): string {
  const { language, dictionary, fallback } = useI18nStore.getState()
  return translate(key, params, { language, dictionary, fallback })
}
