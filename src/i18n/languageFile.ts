import type { Dictionary } from './types'

// The language-file format, renderer side. This is a line-for-line twin of
// electron/i18n/language-file.cjs (see the note there for why it is a twin and
// not a shared import); src/i18n/__tests__/parserParity.test.ts runs both over
// the same inputs so they cannot drift. Change both together.

/** Language codes this app accepts: `en`, `de`, `pt-BR`, `zh-Hant`, `gsw` ... */
export const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/

const KEY_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/

/** The Unicode CLDR plural categories a `key.<category>` suffix may name. */
export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const

const KNOWN_HEADERS = ['code', 'name', 'fallback']

export interface LanguageFileProblem {
  /** 1-based; 0 for a problem with the file as a whole. */
  line: number
  message: string
}

export interface ParsedLanguageFile {
  code: string | null
  name: string | null
  fallback: string | null
  entries: Dictionary
  problems: LanguageFileProblem[]
}

/** `DE` -> `de`, `pt-br` -> `pt-BR`, `zh-hant` -> `zh-Hant`; null for anything that is not a language code. */
export function normalizeLanguageCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const match = /^([A-Za-z]{2,3})(?:[-_]([A-Za-z]{2,4}))?$/.exec(raw.trim())
  if (!match) return null
  const language = match[1].toLowerCase()
  const region = match[2]
  if (!region) return language
  const normalizedRegion =
    region.length === 2 ? region.toUpperCase() : region[0].toUpperCase() + region.slice(1).toLowerCase()
  const code = `${language}-${normalizedRegion}`
  return LANGUAGE_CODE_PATTERN.test(code) ? code : null
}

export function isValidLanguageCode(code: unknown): code is string {
  return typeof code === 'string' && LANGUAGE_CODE_PATTERN.test(code)
}

function unescapeValue(value: string): string {
  return value.replace(/\\([nt\\])/g, (_match, ch: string) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : '\\'))
}

/** Parse one language file. Never throws: unusable lines are reported in `problems` and skipped. */
export function parseLanguageFile(text: unknown): ParsedLanguageFile {
  const result: ParsedLanguageFile = { code: null, name: null, fallback: null, entries: {}, problems: [] }
  if (typeof text !== 'string') {
    result.problems.push({ line: 0, message: 'file is not text' })
    return result
  }
  // A UTF-8 byte-order mark (Notepad adds one) is not part of the first line.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines = body.split(/\r\n|\n|\r/)

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) return

    if (line.startsWith('@')) {
      const header = /^@([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
      if (!header) {
        result.problems.push({ line: lineNumber, message: 'header lines look like "@name: value"' })
        return
      }
      const headerName = header[1].toLowerCase()
      const value = header[2].trim()
      if (!KNOWN_HEADERS.includes(headerName)) {
        result.problems.push({ line: lineNumber, message: `unknown header "@${header[1]}" (ignored)` })
        return
      }
      if (value === '') {
        result.problems.push({ line: lineNumber, message: `"@${headerName}" has no value` })
        return
      }
      if (headerName === 'name') {
        result.name = value
        return
      }
      const code = normalizeLanguageCode(value)
      if (!code) {
        result.problems.push({ line: lineNumber, message: `"${value}" is not a language code like "de" or "pt-BR"` })
        return
      }
      if (headerName === 'code') result.code = code
      else result.fallback = code
      return
    }

    const equals = line.indexOf('=')
    if (equals === -1) {
      result.problems.push({ line: lineNumber, message: 'expected "key = value"' })
      return
    }
    const key = line.slice(0, equals).trim()
    const value = line.slice(equals + 1).trim()
    if (!KEY_PATTERN.test(key)) {
      result.problems.push({
        line: lineNumber,
        message: key === '' ? 'missing key before "="' : `"${key}" is not a valid key (letters, digits, "_", "-", ".")`,
      })
      return
    }
    if (value === '') {
      result.problems.push({ line: lineNumber, message: `"${key}" is empty (the English text is shown instead)` })
      return
    }
    if (Object.prototype.hasOwnProperty.call(result.entries, key)) {
      result.problems.push({ line: lineNumber, message: `"${key}" is defined twice (this later one wins)` })
    }
    result.entries[key] = unescapeValue(value)
  })

  return result
}

function pluralBase(key: string): string | null {
  const dot = key.lastIndexOf('.')
  if (dot <= 0) return null
  return (PLURAL_CATEGORIES as readonly string[]).includes(key.slice(dot + 1)) ? key.slice(0, dot) : null
}

/** English keys a language has no text for; plural forms count as one group (see the .cjs twin). */
export function countMissingKeys(entries: Dictionary, referenceEntries: Dictionary): number {
  const pluralBasesPresent = new Set<string>()
  for (const key of Object.keys(entries)) {
    const base = pluralBase(key)
    if (base) pluralBasesPresent.add(base)
  }
  let missing = 0
  for (const key of Object.keys(referenceEntries)) {
    if (Object.prototype.hasOwnProperty.call(entries, key)) continue
    const base = pluralBase(key)
    if (base && pluralBasesPresent.has(base)) continue
    missing += 1
  }
  return missing
}

interface ChainLanguage {
  fallback: string | null
  entries: Dictionary
}

/** Own code, then the `@fallback` chain, then the base language (`de-AT` -> `de`). English is not appended. */
export function resolveFallbackChain(code: string, lookup: (code: string) => ChainLanguage | undefined): string[] {
  const chain: string[] = []
  const queue = [code]
  while (queue.length > 0 && chain.length < 8) {
    const next = queue.shift()
    if (!next || chain.includes(next)) continue
    const language = lookup(next)
    if (!language) continue
    chain.push(next)
    if (language.fallback) queue.push(language.fallback)
    const dash = next.indexOf('-')
    if (dash > 0) queue.push(next.slice(0, dash))
  }
  return chain
}

/** Merge a chain's entries; the first code in the chain wins. */
export function mergeChain(chain: string[], lookup: (code: string) => ChainLanguage | undefined): Dictionary {
  const merged: Dictionary = {}
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const language = lookup(chain[i])
    if (language) Object.assign(merged, language.entries)
  }
  return merged
}
