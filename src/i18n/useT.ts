import { useMemo } from 'react'
import { useI18nStore } from './store'
import { translate } from './translate'
import type { TFunction } from './types'

/**
 * The translate function for components. The component re-renders whenever
 * the language (or a language file) changes, so the switch in Settings is live
 * everywhere at once.
 *
 *   const t = useT()
 *   <h1>{t('settings.title')}</h1>
 *   <p>{t('settings.mics.players.count', { count: players.length })}</p>
 */
export function useT(): TFunction {
  const language = useI18nStore((state) => state.language)
  const dictionary = useI18nStore((state) => state.dictionary)
  const fallback = useI18nStore((state) => state.fallback)
  return useMemo<TFunction>(
    () => (key, params) => translate(key, params, { language, dictionary, fallback }),
    [language, dictionary, fallback],
  )
}

/** The active language code (`en`, `de`, ...), for `lang` attributes and locale-aware formatting. */
export function useLanguage(): string {
  return useI18nStore((state) => state.language)
}
