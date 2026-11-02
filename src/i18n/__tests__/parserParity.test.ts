// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as renderer from '../languageFile'

/**
 * The anti-drift harness for the two language-file parsers.
 *
 * electron/i18n/language-file.cjs (main process, CommonJS) and
 * src/i18n/languageFile.ts (renderer, TypeScript) are twins: neither module
 * system can load the other's file. So instead of a shared implementation
 * there is a shared proof -- both are run over the same inputs and must agree
 * exactly, problem messages included. Same approach as
 * src/stage/chart/__tests__/parserEquivalence.test.ts.
 */
const require_ = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../..')

const main = require_(path.join(ROOT, 'electron/i18n/language-file.cjs')) as typeof renderer

const CORPUS: Record<string, string> = {
  'en.txt (shipped)': readFileSync(path.join(ROOT, 'languages/en.txt'), 'utf-8'),
  'de.txt (shipped)': readFileSync(path.join(ROOT, 'languages/de.txt'), 'utf-8'),
  'headers': '@code: DE_at\n@NAME:  Österreichisch \n@fallback: de\n@colour: red\n@code:\n@fallback: not a code\n@oops',
  'escapes': 'a = line\\nbreak\nb = tab\\there\nc = back\\\\slash\nd = keep \\x and \\{',
  'bad lines': 'no equals\n= value\nbad key = x\nempty =\ndup = 1\ndup = 2\n\t# tabbed comment\n',
  'plurals': 'x.zero = none\nx.one = {count} one\nx.few = {count} few\nx.other = {count} other',
  'line endings': String.fromCharCode(0xfeff) + 'a = 1\r\nb = 2\rc = 3\n',
  'empty': '',
}

describe('main-process and renderer language-file parsers agree', () => {
  for (const [name, text] of Object.entries(CORPUS)) {
    it(`parses "${name}" identically`, () => {
      expect(renderer.parseLanguageFile(text)).toEqual(main.parseLanguageFile(text))
    })
  }

  it('normalise language codes identically', () => {
    for (const raw of ['de', 'DE', 'pt_br', 'zh-HANT', 'gsw', 'english', '../x', '', 'de-AT-x', 'e']) {
      expect(renderer.normalizeLanguageCode(raw)).toBe(main.normalizeLanguageCode(raw))
      expect(renderer.isValidLanguageCode(raw)).toBe(main.isValidLanguageCode(raw))
    }
  })

  it('count missing keys and resolve fallback chains identically', () => {
    const english = { a: '1', b: '2', 'n.one': '1', 'n.other': 'n' }
    const partial = { a: 'x', 'n.other': 'n' }
    expect(renderer.countMissingKeys(partial, english)).toBe(main.countMissingKeys(partial, english))

    const languages: Record<string, { fallback: string | null; entries: Record<string, string> }> = {
      de: { fallback: null, entries: { a: 'de' } },
      'de-CH': { fallback: 'gsw', entries: { b: 'ch' } },
      gsw: { fallback: 'de-CH', entries: { c: 'gsw' } },
    }
    const lookup = (code: string) => languages[code]
    const chain = renderer.resolveFallbackChain('de-CH', lookup)
    expect(chain).toEqual(main.resolveFallbackChain('de-CH', lookup))
    expect(renderer.mergeChain(chain, lookup)).toEqual(main.mergeChain(chain, lookup))
  })
})
