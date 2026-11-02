/** Where a language file came from: shipped with the app, or the user's own languages folder. */
export type LanguageSource = 'bundled' | 'user'

/** One entry of the Settings language list (window.api.i18n.listLanguages). */
export interface LanguageInfo {
  /** Normalised language code, e.g. `en`, `de`, `pt-BR`. Taken from the file name. */
  code: string
  /** The language's name in itself, from the file's `@name:` header (the code when there is none). */
  name: string
  /** `user` when a file in the user's languages folder adds or overrides this language. */
  source: LanguageSource
  /** English keys this language has no text for (those show in English). 0 for English itself. */
  missingKeys: number
}

/** A flat key -> text table as parsed from a language file. Plural forms are `key.one`, `key.other`, ... */
export type Dictionary = Record<string, string>

/** Values for `{name}` placeholders. A numeric `count` also picks the plural form. */
export type TranslationParams = Record<string, string | number>

/** `t('settings.title')`, `t('settings.mics.players.count', { count: 3 })`. */
export type TFunction = (key: string, params?: TranslationParams) => string
