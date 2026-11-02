import type { Dictionary, TranslationParams } from './types'

export interface TranslationContext {
  /** The active language's code -- picks plural rules and number formatting. */
  language: string
  /** The active language's texts (its own fallback chain already merged in). */
  dictionary: Dictionary
  /** English: the last resort before the bare key. */
  fallback: Dictionary
}

const pluralRulesCache = new Map<string, Intl.PluralRules>()
const numberFormatCache = new Map<string, Intl.NumberFormat>()

function pluralRules(language: string): Intl.PluralRules {
  let rules = pluralRulesCache.get(language)
  if (!rules) {
    try {
      rules = new Intl.PluralRules(language)
    } catch {
      rules = new Intl.PluralRules('en') // A user file named with a code Intl does not know.
    }
    pluralRulesCache.set(language, rules)
  }
  return rules
}

function numberFormat(language: string): Intl.NumberFormat {
  let format = numberFormatCache.get(language)
  if (!format) {
    try {
      format = new Intl.NumberFormat(language)
    } catch {
      format = new Intl.NumberFormat('en')
    }
    numberFormatCache.set(language, format)
  }
  return format
}

/**
 * The keys to try, in order, for one dictionary. With a numeric `count`:
 * `key.zero` (only for exactly 0, and only if written), then the language's
 * own CLDR category (`key.one`, `key.few`, ...), then `key.other`, then the
 * bare `key`.
 */
function candidateKeys(key: string, language: string, params: TranslationParams | undefined): string[] {
  const count = params?.count
  if (typeof count !== 'number' || !Number.isFinite(count)) return [key]
  const candidates = count === 0 ? [`${key}.zero`] : []
  candidates.push(`${key}.${pluralRules(language).select(count)}`, `${key}.other`, key)
  return candidates
}

function lookup(dictionary: Dictionary, keys: string[]): string | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(dictionary, key)) return dictionary[key]
  }
  return undefined
}

/** Fill `{name}` placeholders. Numbers are formatted for the language (1234 -> "1.234" in German). Unknown names stay as written. */
export function interpolate(text: string, params: TranslationParams | undefined, language: string): string {
  if (!params) return text
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return match
    const value = params[name]
    return typeof value === 'number' ? numberFormat(language).format(value) : String(value)
  })
}

const warned = new Set<string>()

function warnOnce(id: string, message: string): void {
  if (!import.meta.env.DEV || warned.has(id)) return
  warned.add(id)
  console.warn(`[i18n] ${message}`)
}

/**
 * Look a key up: the active language first, then English, then the key
 * itself (so a missing text is visible, never blank). Warns once per key in
 * development builds.
 */
export function translate(key: string, params: TranslationParams | undefined, context: TranslationContext): string {
  const { language, dictionary, fallback } = context
  const own = lookup(dictionary, candidateKeys(key, language, params))
  if (own !== undefined) return interpolate(own, params, language)

  const english = lookup(fallback, candidateKeys(key, 'en', params))
  if (english !== undefined) {
    if (language !== 'en') warnOnce(`${language}:${key}`, `no "${language}" text for "${key}" -- showing English`)
    return interpolate(english, params, language)
  }

  warnOnce(`?:${key}`, `unknown key "${key}" -- add it to languages/en.txt (and the other language files)`)
  return interpolate(key, params, language)
}
