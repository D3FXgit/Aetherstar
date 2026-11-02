// @vitest-environment node
// describe/expect/it/beforeEach/afterEach come from Vitest's globals (vite.config.ts test.globals: true)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createMainTranslator, BUILT_IN_ENGLISH } = require('../main-translator.cjs')

const tables = {
  en: { 'main.display.label': 'Display {id}', 'only.english': 'English only' },
  de: { 'main.display.label': 'Bildschirm {id}' },
}
const catalog = {
  scan: () => new Map(Object.keys(tables).map((code) => [code, {}])),
  loadLanguage: (code) => tables[code] ?? {},
}

let root
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-main-i18n-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('createMainTranslator', () => {
  it('uses the OS locale (or its base language) until the renderer reports one', () => {
    const translator = createMainTranslator({ catalog, getSystemLocale: () => 'de-AT' })
    expect(translator.getActiveLanguage()).toBe('de')
    expect(translator.t('main.display.label', { id: '7' })).toBe('Bildschirm 7')
  })

  it('follows the renderer, falls back to English per key, then to the built-in English, then to the key', () => {
    const translator = createMainTranslator({ catalog, getSystemLocale: () => 'en-US' })
    translator.setActiveLanguage('de')
    expect(translator.t('only.english')).toBe('English only')
    expect(translator.t('main.startupFailed.title')).toBe(BUILT_IN_ENGLISH['main.startupFailed.title'])
    expect(translator.t('no.such.key')).toBe('no.such.key')
  })

  it('ignores invalid codes and treats an uninstalled language as English', () => {
    const translator = createMainTranslator({ catalog, getSystemLocale: () => '' })
    translator.setActiveLanguage('../etc')
    expect(translator.getActiveLanguage()).toBe('en')
    translator.setActiveLanguage('fr')
    expect(translator.getActiveLanguage()).toBe('en')
  })

  it('remembers the reported language across restarts', () => {
    const statePath = path.join(root, 'main-language.json')
    createMainTranslator({ catalog, statePath }).setActiveLanguage('de')
    const next = createMainTranslator({ catalog, statePath, getSystemLocale: () => 'en' })
    expect(next.getActiveLanguage()).toBe('de')
  })

  it('every built-in English text is also in languages/en.txt and languages/de.txt', () => {
    const { parseLanguageFile } = require('../language-file.cjs')
    const languagesDir = path.join(__dirname, '..', '..', '..', 'languages')
    const en = parseLanguageFile(fs.readFileSync(path.join(languagesDir, 'en.txt'), 'utf-8')).entries
    const de = parseLanguageFile(fs.readFileSync(path.join(languagesDir, 'de.txt'), 'utf-8')).entries
    for (const [key, text] of Object.entries(BUILT_IN_ENGLISH)) {
      expect(en[key]).toBe(text)
      expect(de[key]).toBeTruthy()
    }
  })
})
