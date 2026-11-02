// Localization. Texts live in plain language files (languages/en.txt,
// languages/de.txt, plus any the user drops into <userData>/languages); see
// docs/i18n-conventions.md for how to use this from a screen, and
// docs/translating.md for the file format.
export { useT, useLanguage } from './useT'
export {
  t,
  setLanguage,
  initI18n,
  refreshLanguages,
  reloadLanguages,
  pickLanguage,
  getSystemLanguages,
  useI18nStore,
  type I18nState,
} from './store'
export type { Dictionary, LanguageInfo, LanguageSource, TFunction, TranslationParams } from './types'
