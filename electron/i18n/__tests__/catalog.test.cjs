// @vitest-environment node
// describe/expect/it/beforeEach/afterEach come from Vitest's globals (vite.config.ts test.globals: true)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createLanguageCatalog } = require('../catalog.cjs')

let root
let bundledDir
let userDir
let warnings
const log = { warn: (message) => warnings.push(message) }

function write(dir, name, text) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), text, 'utf-8')
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-i18n-'))
  bundledDir = path.join(root, 'bundled')
  userDir = path.join(root, 'user', 'languages')
  warnings = []
  write(bundledDir, 'en.txt', '@code: en\n@name: English\na = A\nb = B\nc = C\n')
  write(bundledDir, 'de.txt', '@code: de\n@name: Deutsch\na = DE-A\nb = DE-B\n')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('language catalog: discovery', () => {
  it('lists every bundled language with its name, source and missing-key count', () => {
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    expect(catalog.listLanguages()).toEqual([
      { code: 'de', name: 'Deutsch', source: 'bundled', missingKeys: 1 },
      { code: 'en', name: 'English', source: 'bundled', missingKeys: 0 },
    ])
  })

  it('adds a language just by dropping a file into the user folder', () => {
    write(userDir, 'fr.txt', '@name: Français\na = FR-A\n')
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    expect(catalog.listLanguages()).toContainEqual({ code: 'fr', name: 'Français', source: 'user', missingKeys: 2 })
    expect(catalog.loadLanguage('fr')).toEqual({ a: 'FR-A' })
  })

  it('lets a user file override a bundled language key by key', () => {
    write(userDir, 'de.txt', '@name: Deutsch (meins)\nb = MEIN-B\nc = MEIN-C\n')
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    expect(catalog.loadLanguage('de')).toEqual({ a: 'DE-A', b: 'MEIN-B', c: 'MEIN-C' })
    expect(catalog.listLanguages()).toContainEqual({ code: 'de', name: 'Deutsch (meins)', source: 'user', missingKeys: 0 })
  })

  it('uses the file name as the code, normalised, and warns when @code disagrees', () => {
    write(userDir, 'PT_br.txt', '@code: en\n@name: Português\na = PT\n')
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    expect(catalog.listLanguages().map((l) => l.code)).toContain('pt-BR')
    expect(warnings.some((w) => w.includes('the file name wins'))).toBe(true)
  })

  it('falls back to the code when a file has no @name', () => {
    write(userDir, 'nl.txt', 'a = NL\n')
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    expect(catalog.listLanguages()).toContainEqual(expect.objectContaining({ code: 'nl', name: 'nl' }))
  })

  it('ignores files that are not language files: README, macOS ._ files, other extensions, folders', () => {
    write(userDir, 'README.txt', 'not a language')
    write(userDir, '._de.txt', '\u0000\u0005binary junk')
    write(userDir, 'fr.json', '{}')
    fs.mkdirSync(path.join(userDir, 'es.txt'))
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    expect(catalog.listLanguages().map((l) => l.code)).toEqual(['de', 'en'])
  })

  it('does not follow a symlinked language file out of the folder', (context) => {
    const outside = path.join(root, 'outside', 'secret.txt')
    write(path.dirname(outside), 'secret.txt', '@name: Secret\na = SECRET\n')
    fs.mkdirSync(userDir, { recursive: true })
    try {
      fs.symlinkSync(outside, path.join(userDir, 'fr.txt'), 'file')
    } catch {
      // Windows without Developer Mode cannot create symlinks; nothing to test there.
      context.skip()
      return
    }
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    expect(catalog.listLanguages().map((language) => language.code)).not.toContain('fr')
    expect(catalog.loadLanguage('fr')).toEqual({})
    expect(warnings.some((message) => message.includes('fr.txt') && message.includes('links are not followed'))).toBe(true)
  })

  it('checks the entry itself (lstat), so a link is skipped even where real symlinks cannot be made', () => {
    // Runs everywhere, including Windows without symlink rights: the entry is
    // a plain file on disk, reported as a link by lstat.
    write(userDir, 'fr.txt', '@name: Linked\na = LINKED\n')
    const realLstat = fs.lstatSync
    const spy = vi.spyOn(fs, 'lstatSync').mockImplementation((target, ...rest) => {
      const stat = realLstat(target, ...rest)
      if (path.basename(String(target)) !== 'fr.txt') return stat
      return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { isSymbolicLink: () => true, isFile: () => false })
    })
    try {
      const catalog = createLanguageCatalog({ bundledDir, userDir, log })
      expect(catalog.listLanguages().map((language) => language.code)).not.toContain('fr')
    } finally {
      spy.mockRestore()
    }
  })

  it('reports bad lines with file and line number but still loads the rest', () => {
    write(userDir, 'it.txt', '@name: Italiano\na = IT-A\nthis line is broken\nb = IT-B\n')
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    expect(catalog.loadLanguage('it')).toEqual({ a: 'IT-A', b: 'IT-B' })
    expect(warnings).toContainEqual(expect.stringMatching(/it\.txt line 3: expected "key = value"/))
  })

  it('reports each problem once, not on every re-scan', () => {
    write(userDir, 'it.txt', 'broken\n')
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    catalog.listLanguages()
    catalog.listLanguages()
    expect(warnings.filter((w) => w.includes('it.txt'))).toHaveLength(1)
  })

  it('picks up files added after it was created (re-reads on every request)', () => {
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    expect(catalog.listLanguages()).toHaveLength(2)
    write(userDir, 'sv.txt', '@name: Svenska\na = SV\n')
    expect(catalog.listLanguages()).toHaveLength(3)
  })

  it('works with a user folder that does not exist yet', () => {
    const catalog = createLanguageCatalog({ bundledDir, userDir: path.join(root, 'nope'), log })
    expect(catalog.listLanguages()).toHaveLength(2)
  })
})

describe('language catalog: loading', () => {
  it('merges a regional variant over its base language', () => {
    write(userDir, 'de-AT.txt', '@name: Deutsch (Österreich)\nb = SERVUS\n')
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    expect(catalog.loadLanguage('de-AT')).toEqual({ a: 'DE-A', b: 'SERVUS' })
    expect(catalog.listLanguages()).toContainEqual(expect.objectContaining({ code: 'de-AT', missingKeys: 1 }))
  })

  it('follows an explicit @fallback', () => {
    write(userDir, 'gsw.txt', '@name: Schwiizerdütsch\n@fallback: de\nb = GRÜEZI\n')
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    expect(catalog.loadLanguage('gsw')).toEqual({ a: 'DE-A', b: 'GRÜEZI' })
  })

  it('returns an empty table for an unknown language (everything shows in English)', () => {
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    expect(catalog.loadLanguage('fi')).toEqual({})
  })

  it('refuses anything that is not a language code -- no path ever reaches the file system', () => {
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    for (const bad of ['../bundled/en', '..\\en', '/etc/passwd', 'EN', 'en.txt', '', 42, null]) {
      expect(() => catalog.loadLanguage(bad)).toThrow(/invalid language code/)
    }
  })
})

describe('language catalog: the user folder', () => {
  it('creates the folder with a README on first run, and never overwrites the README', () => {
    const catalog = createLanguageCatalog({ bundledDir, userDir, log })
    expect(catalog.ensureUserDir()).toBe(userDir)
    const readme = path.join(userDir, 'README.txt')
    expect(fs.readFileSync(readme, 'utf-8')).toMatch(/fr\.txt/)

    fs.writeFileSync(readme, 'my notes', 'utf-8')
    catalog.ensureUserDir()
    expect(fs.readFileSync(readme, 'utf-8')).toBe('my notes')
  })
})
