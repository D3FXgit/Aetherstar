// Translations for the few texts the main process shows itself (native
// dialogs, display names). The renderer owns the language choice and reports
// it over i18n:set-active-language; until it does -- e.g. a startup error
// dialog before any window exists -- the last reported language (persisted)
// or the OS locale is used. Pure apart from the optional state file, so it is
// testable under plain Node.
const fs = require('node:fs')
const { normalizeLanguageCode, isValidLanguageCode } = require('./language-file.cjs')

/**
 * Last-resort English, for when even languages/en.txt cannot be read (a
 * broken install is exactly when the startup error dialog appears). Keep in
 * sync with the `main.*` block in languages/en.txt.
 */
const BUILT_IN_ENGLISH = {
  'main.startupFailed.title': 'AetherStar: some features failed to start',
  'main.startupFailed.body':
    "The library and player database could not be opened, so those features won't work this session.\n\n{error}",
  'main.display.label': 'Display {id}',
}

function interpolate(text, params, language) {
  if (!params) return text
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return match
    const value = params[name]
    if (typeof value !== 'number') return String(value)
    try {
      return new Intl.NumberFormat(language).format(value)
    } catch {
      return String(value)
    }
  })
}

function readSavedLanguage(statePath) {
  if (!statePath) return null
  try {
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    return isValidLanguageCode(saved && saved.language) ? saved.language : null
  } catch {
    return null
  }
}

/**
 * @param {{
 *   catalog: Pick<ReturnType<typeof import('./catalog.cjs').createLanguageCatalog>, 'scan' | 'loadLanguage'>,
 *   getSystemLocale?: () => string,
 *   statePath?: string,
 *   log?: Pick<Console, 'warn'>,
 * }} options
 */
function createMainTranslator({ catalog, getSystemLocale = () => 'en', statePath, log = console }) {
  /** Set once the renderer reports; wins over the saved file and the OS locale. */
  let reported = null

  function installedCodes() {
    try {
      return new Set(catalog.scan().keys())
    } catch {
      return new Set()
    }
  }

  /** The requested code if installed, else its base language, else English. */
  function resolve(requested) {
    const code = normalizeLanguageCode(requested)
    if (!code) return 'en'
    const installed = installedCodes()
    if (installed.has(code)) return code
    const base = code.split('-')[0]
    return installed.has(base) ? base : 'en'
  }

  function getActiveLanguage() {
    return resolve(reported || readSavedLanguage(statePath) || getSystemLocale())
  }

  function load(code) {
    try {
      return catalog.loadLanguage(code)
    } catch {
      return {}
    }
  }

  /** Called with the code the renderer is showing. Invalid codes are ignored. */
  function setActiveLanguage(code) {
    if (!isValidLanguageCode(code) || code === reported) return
    reported = code
    if (!statePath) return
    try {
      fs.writeFileSync(statePath, JSON.stringify({ language: code }), 'utf-8')
    } catch (error) {
      log.warn('[i18n] could not remember the active language:', error)
    }
  }

  /** The active language's text, else English from disk, else BUILT_IN_ENGLISH, else the key. */
  function t(key, params) {
    const language = getActiveLanguage()
    const own = language === 'en' ? {} : load(language)
    const text = own[key] ?? load('en')[key] ?? BUILT_IN_ENGLISH[key] ?? key
    return interpolate(text, params, language)
  }

  return { t, setActiveLanguage, getActiveLanguage }
}

module.exports = { createMainTranslator, BUILT_IN_ENGLISH }
