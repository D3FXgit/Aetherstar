import {
  countMissingKeys,
  mergeChain,
  normalizeLanguageCode,
  parseLanguageFile,
  resolveFallbackChain,
  type ParsedLanguageFile,
} from './languageFile'
import type { Dictionary, LanguageInfo } from './types'

/**
 * The language files in the repo's languages/ folder, compiled into the
 * renderer bundle as raw text.
 *
 * Two jobs. In the running app it is the instant first paint: the saved
 * language's texts are on screen in the very first frame, before the main
 * process has answered (it then replaces them with the files on disk, which
 * may include the user's own overrides). Without a main process at all --
 * unit tests, the browser preview -- it is the only source.
 *
 * A glob, not two named imports: a new languages/xx.txt in the repo is picked
 * up by the next build with no code change.
 */
const RAW_FILES = import.meta.glob('../../languages/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const REFERENCE_LANGUAGE = 'en'

interface BundledLanguage extends ParsedLanguageFile {
  code: string
}

const BUNDLED = new Map<string, BundledLanguage>()
for (const [filePath, text] of Object.entries(RAW_FILES)) {
  const fileName = filePath.slice(filePath.lastIndexOf('/') + 1).replace(/\.txt$/i, '')
  const code = normalizeLanguageCode(fileName)
  if (!code) continue
  const parsed = parseLanguageFile(text)
  BUNDLED.set(code, { ...parsed, code, fallback: parsed.fallback && parsed.fallback !== code ? parsed.fallback : null })
}

const lookup = (code: string) => BUNDLED.get(code)

/** A bundled language's texts with its own fallback chain merged in (English not included). Unknown -> {}. */
export function loadBundledLanguage(code: string): Dictionary {
  return mergeChain(resolveFallbackChain(code, lookup), lookup)
}

/** The same shape window.api.i18n.listLanguages returns, for the bundled files only. */
export function listBundledLanguages(): LanguageInfo[] {
  const reference = BUNDLED.get(REFERENCE_LANGUAGE)?.entries ?? {}
  return [...BUNDLED.values()]
    .map((language) => ({
      code: language.code,
      name: language.name || language.code,
      source: 'bundled' as const,
      missingKeys: language.code === REFERENCE_LANGUAGE ? 0 : countMissingKeys(loadBundledLanguage(language.code), reference),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
}
