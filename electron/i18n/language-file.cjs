// Parser for the plain-text language files (format: top of languages/en.txt,
// docs/translating.md). Pure, so it runs under plain Node. src/i18n/languageFile.ts
// is a line-for-line twin (main cannot load renderer TS, Vite does not bundle
// CJS); src/i18n/__tests__/parserParity.test.ts keeps them in step.

/** Language codes this app accepts: `en`, `de`, `pt-BR`, `zh-Hant`, `gsw` ... */
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/

/** A key: dot-separated segments of letters, digits, `_` and `-`. */
const KEY_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/

/** The Unicode CLDR plural categories a `key.<category>` suffix may name. */
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other']

const KNOWN_HEADERS = ['code', 'name', 'fallback']

/**
 * `DE` -> `de`, `pt-br` -> `pt-BR`, `zh-hant` -> `zh-Hant`. Returns null for
 * anything that is not a language code at all (so `README`, `._de`, `../x`
 * are rejected rather than normalised into something that looks valid).
 */
function normalizeLanguageCode(raw) {
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

function isValidLanguageCode(code) {
  return typeof code === 'string' && LANGUAGE_CODE_PATTERN.test(code)
}

/** `\n` -> line break, `\t` -> tab, `\\` -> backslash; any other `\x` stays exactly as written. */
function unescapeValue(value) {
  return value.replace(/\\([nt\\])/g, (_match, ch) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : '\\'))
}

/**
 * Parse one language file. Never throws: every line that cannot be used is
 * reported in `problems` (1-based line numbers) and skipped, so one typo in a
 * hand-edited file costs that one line, not the whole language.
 *
 * @param {string} text
 * @returns {{
 *   code: string | null, name: string | null, fallback: string | null,
 *   entries: Record<string, string>,
 *   problems: { line: number, message: string }[],
 * }}
 */
function parseLanguageFile(text) {
  const result = { code: null, name: null, fallback: null, entries: {}, problems: [] }
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
      result[headerName] = code
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

/** `a.b.one` -> `a.b`; null when the last segment is not a plural category. */
function pluralBase(key) {
  const dot = key.lastIndexOf('.')
  if (dot <= 0) return null
  return PLURAL_CATEGORIES.includes(key.slice(dot + 1)) ? key.slice(0, dot) : null
}

/**
 * How many English keys a language has no text for. Plural forms count as a
 * group: Japanese only needs `.other`, Polish adds `.few`/`.many` -- as long as
 * a language has *some* form of an English plural key, its own plural rules
 * decide which forms it needs, so `.one` missing there is not "untranslated".
 */
function countMissingKeys(entries, referenceEntries) {
  const pluralBasesPresent = new Set()
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

/**
 * The order a language borrows missing texts in, before English: its own
 * code, then its `@fallback` chain, then its base language (`de-AT` -> `de`).
 * English is NOT appended -- the renderer keeps English as its own last-resort
 * dictionary, so it can tell "untranslated" from "unknown key".
 *
 * @param {string} code
 * @param {(code: string) => ({ fallback: string | null } | undefined)} lookup
 * @returns {string[]}
 */
function resolveFallbackChain(code, lookup) {
  const chain = []
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

/** Merge a chain's entries: the first code in the chain wins. */
function mergeChain(chain, lookup) {
  const merged = {}
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const language = lookup(chain[i])
    if (language) Object.assign(merged, language.entries)
  }
  return merged
}

module.exports = {
  LANGUAGE_CODE_PATTERN,
  KEY_PATTERN,
  PLURAL_CATEGORIES,
  normalizeLanguageCode,
  isValidLanguageCode,
  parseLanguageFile,
  countMissingKeys,
  resolveFallbackChain,
  mergeChain,
}
