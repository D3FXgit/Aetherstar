// @vitest-environment node
// describe/expect/it come from Vitest's globals (vite.config.ts test.globals: true)
const fs = require('node:fs')
const path = require('node:path')
const {
  parseLanguageFile,
  normalizeLanguageCode,
  isValidLanguageCode,
  countMissingKeys,
  resolveFallbackChain,
  mergeChain,
} = require('../language-file.cjs')

describe('parseLanguageFile', () => {
  it('reads headers, entries, comments and blank lines', () => {
    const parsed = parseLanguageFile(
      ['@code: de', '@name: Deutsch', '@fallback: en', '', '# a comment', '  # an indented comment', 'a.b = Hallo', 'c=d'].join('\n'),
    )
    expect(parsed.code).toBe('de')
    expect(parsed.name).toBe('Deutsch')
    expect(parsed.fallback).toBe('en')
    expect(parsed.entries).toEqual({ 'a.b': 'Hallo', c: 'd' })
    expect(parsed.problems).toEqual([])
  })

  it('handles a BOM and Windows/old-Mac line endings', () => {
    const parsed = parseLanguageFile(String.fromCharCode(0xfeff) + '@name: X\r\na = 1\rb = 2\r\n')
    expect(parsed.name).toBe('X')
    expect(parsed.entries).toEqual({ a: '1', b: '2' })
  })

  it('splits on the first "=" only and keeps "#" inside values', () => {
    const parsed = parseLanguageFile('formula = a = b # not a comment')
    expect(parsed.entries.formula).toBe('a = b # not a comment')
  })

  it('unescapes \\n, \\t and \\\\ and leaves other backslashes alone', () => {
    const parsed = parseLanguageFile('k = one\\ntwo\\tthree \\\\n \\x')
    expect(parsed.entries.k).toBe('one\ntwo\tthree \\n \\x')
  })

  it('keeps {placeholders} and plural keys verbatim', () => {
    const parsed = parseLanguageFile('n.one = {count} Song\nn.other = {count} Songs')
    expect(parsed.entries).toEqual({ 'n.one': '{count} Song', 'n.other': '{count} Songs' })
  })

  it('reports bad lines with their line numbers and keeps every good line', () => {
    const parsed = parseLanguageFile(
      [
        'good.one = fine', // 1
        'no equals sign here', // 2
        '= no key', // 3
        'bad key! = x', // 4
        'empty =', // 5
        '@colour: blue', // 6
        '@code: not a code', // 7
        '@broken', // 8
        'good.one = again', // 9
        'good.two = also fine', // 10
      ].join('\n'),
    )
    expect(parsed.entries).toEqual({ 'good.one': 'again', 'good.two': 'also fine' })
    expect(parsed.problems.map((p) => p.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
    expect(parsed.code).toBeNull()
    for (const problem of parsed.problems) expect(typeof problem.message).toBe('string')
  })

  it('never throws, even on non-text input', () => {
    expect(() => parseLanguageFile(undefined)).not.toThrow()
    expect(parseLanguageFile(undefined).problems).toHaveLength(1)
  })

  it('parses the shipped en.txt and de.txt without a single problem', () => {
    for (const file of ['en.txt', 'de.txt']) {
      const text = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'languages', file), 'utf-8')
      const parsed = parseLanguageFile(text)
      expect(parsed.problems).toEqual([])
      expect(parsed.code).toBe(file.slice(0, 2))
      expect(Object.keys(parsed.entries).length).toBeGreaterThan(20)
    }
  })

  it('ships a German file that translates every English key', () => {
    const read = (file) =>
      parseLanguageFile(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'languages', file), 'utf-8')).entries
    expect(countMissingKeys(read('de.txt'), read('en.txt'))).toBe(0)
    // ...and has no keys English does not know about (a typo'd key would be dead text).
    expect(Object.keys(read('de.txt')).filter((key) => !(key in read('en.txt')))).toEqual([])
  })
})

describe('language codes', () => {
  it('normalises case and separators', () => {
    expect(normalizeLanguageCode('DE')).toBe('de')
    expect(normalizeLanguageCode('pt-br')).toBe('pt-BR')
    expect(normalizeLanguageCode('pt_BR')).toBe('pt-BR')
    expect(normalizeLanguageCode('zh-hant')).toBe('zh-Hant')
  })

  it('rejects anything that is not a code', () => {
    for (const bad of ['README', '../en', 'e', 'english', '', 'de-', 'de-AT-x', null]) {
      expect(normalizeLanguageCode(bad)).toBeNull()
    }
    expect(isValidLanguageCode('de')).toBe(true)
    expect(isValidLanguageCode('pt-BR')).toBe(true)
    expect(isValidLanguageCode('../../etc/passwd')).toBe(false)
    expect(isValidLanguageCode('DE')).toBe(false)
  })
})

describe('countMissingKeys', () => {
  const english = { a: 'A', b: 'B', 'n.one': '1', 'n.other': 'n' }

  it('counts English keys the language does not have', () => {
    expect(countMissingKeys({ a: 'x' }, english)).toBe(3)
    expect(countMissingKeys({ a: 'x', b: 'y', 'n.one': '', 'n.other': '' }, english)).toBe(0)
  })

  it('treats plural forms as a group (a language with only ".other" is not missing ".one")', () => {
    expect(countMissingKeys({ a: 'x', b: 'y', 'n.other': 'n' }, english)).toBe(0)
  })
})

describe('fallback chains', () => {
  const languages = {
    de: { fallback: null, entries: { a: 'de-a', b: 'de-b' } },
    'de-AT': { fallback: null, entries: { a: 'at-a' } },
    'de-CH': { fallback: 'de-AT', entries: {} },
    x: { fallback: 'y', entries: { k: 'x' } },
    y: { fallback: 'x', entries: { k: 'y', l: 'y' } },
  }
  const lookup = (code) => languages[code]

  it('borrows from the base language of a regional variant', () => {
    expect(resolveFallbackChain('de-AT', lookup)).toEqual(['de-AT', 'de'])
    expect(mergeChain(['de-AT', 'de'], lookup)).toEqual({ a: 'at-a', b: 'de-b' })
  })

  it('follows @fallback before the base language', () => {
    expect(resolveFallbackChain('de-CH', lookup)).toEqual(['de-CH', 'de-AT', 'de'])
  })

  it('survives a cycle and skips unknown codes', () => {
    expect(resolveFallbackChain('x', lookup)).toEqual(['x', 'y'])
    expect(resolveFallbackChain('fr', lookup)).toEqual([])
  })
})
