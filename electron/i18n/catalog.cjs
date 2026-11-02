// Language discovery: the bundled languages/ folder plus <userData>/languages,
// where a user file adds a language or overrides a bundled one key by key.
// Re-read on every call so a saved translation shows without a restart. Only a
// language CODE comes from the renderer; files are matched by basename, never
// by a joined path, so nothing outside the two folders is readable.
const fs = require('node:fs')
const path = require('node:path')
const {
  normalizeLanguageCode,
  isValidLanguageCode,
  parseLanguageFile,
  countMissingKeys,
  resolveFallbackChain,
  mergeChain,
} = require('./language-file.cjs')

const REFERENCE_LANGUAGE = 'en'
/** A language file is a few KB; anything this big is not one. */
const MAX_FILE_BYTES = 1024 * 1024
const FILE_NAME_PATTERN = /^([A-Za-z]{2,3}(?:[-_][A-Za-z]{2,4})?)\.txt$/i

const USER_README = `AetherStar -- your own languages
================================

Every .txt file in this folder is a language pack. Add one and it shows up in
Settings > Graphics > Language (right away, or after restarting AetherStar).

To add a language:
  1. Copy en.txt from the app's own "languages" folder (or any language file)
     into this folder.
  2. Rename it to your language code, e.g. fr.txt, es.txt, pt-BR.txt.
  3. Change the "@name:" line at the top to your language's name, e.g.
     "@name: Français".
  4. Translate the text right of each "=". Leave the keys on the left alone.
  5. Save as UTF-8 and pick your language in Settings.

Anything you leave out is shown in English. A file here with the same name as
a built-in language (e.g. de.txt) overrides just the lines it contains.

Full guide: docs/translating.md in the AetherStar source.
`

/**
 * @param {{
 *   bundledDir: string,
 *   userDir: string,
 *   log?: Pick<Console, 'warn'>,
 * }} options
 */
function createLanguageCatalog({ bundledDir, userDir, log = console }) {
  /** Problems already reported, so a re-scan does not repeat every warning. */
  const reported = new Set()

  function readFolder(dir, source) {
    /** @type {Map<string, any>} */
    const found = new Map()
    let names
    try {
      names = fs.readdirSync(dir)
    } catch {
      return found // A missing folder is simply an empty one.
    }
    for (const fileName of names.sort()) {
      if (fileName.startsWith('.')) continue // ._de.txt (macOS metadata), dotfiles
      const match = FILE_NAME_PATTERN.exec(fileName)
      if (!match) continue
      const code = normalizeLanguageCode(match[1])
      if (!code) continue
      const filePath = path.join(dir, fileName)
      let text
      try {
        // lstat, not stat: a symlink named de.txt in the user folder would
        // otherwise be followed to whatever it points at, anywhere on disk --
        // exactly what matching by basename is meant to rule out.
        const stat = fs.lstatSync(filePath)
        if (stat.isSymbolicLink()) {
          report(filePath, 0, 'skipped: links are not followed -- copy the file here instead')
          continue
        }
        if (!stat.isFile()) continue
        if (stat.size > MAX_FILE_BYTES) {
          report(filePath, 0, `skipped: larger than ${MAX_FILE_BYTES} bytes`)
          continue
        }
        text = fs.readFileSync(filePath, 'utf-8')
      } catch (error) {
        report(filePath, 0, `could not be read (${error && error.message ? error.message : error})`)
        continue
      }
      const parsed = parseLanguageFile(text)
      for (const problem of parsed.problems) report(filePath, problem.line, problem.message)
      if (parsed.code && parsed.code !== code) {
        report(filePath, 0, `says "@code: ${parsed.code}" but is named ${fileName} -- using "${code}" (the file name wins)`)
      }
      if (found.has(code)) {
        report(filePath, 0, `another file in this folder is also "${code}" -- this one is ignored`)
        continue
      }
      found.set(code, {
        code,
        name: parsed.name,
        fallback: parsed.fallback && parsed.fallback !== code ? parsed.fallback : null,
        source,
        entries: parsed.entries,
        problems: parsed.problems,
        files: [filePath],
      })
    }
    return found
  }

  function report(filePath, line, message) {
    const id = `${filePath}:${line}:${message}`
    if (reported.has(id)) return
    reported.add(id)
    log.warn(`[i18n] ${path.basename(filePath)}${line > 0 ? ` line ${line}` : ''}: ${message}`)
  }

  /** Bundled languages, with user files layered on top (key by key). */
  function scan() {
    const languages = readFolder(bundledDir, 'bundled')
    for (const [code, user] of readFolder(userDir, 'user')) {
      const bundled = languages.get(code)
      if (!bundled) {
        languages.set(code, user)
        continue
      }
      languages.set(code, {
        code,
        name: user.name || bundled.name,
        fallback: user.fallback || bundled.fallback,
        source: 'user',
        entries: { ...bundled.entries, ...user.entries },
        problems: [...bundled.problems, ...user.problems],
        files: [...bundled.files, ...user.files],
      })
    }
    return languages
  }

  /** @returns {{ code: string, name: string, source: 'bundled' | 'user', missingKeys: number }[]} */
  function listLanguages() {
    const languages = scan()
    const lookup = (code) => languages.get(code)
    const reference = languages.get(REFERENCE_LANGUAGE)
    const referenceEntries = reference ? reference.entries : {}
    return [...languages.values()]
      .map((language) => ({
        code: language.code,
        name: language.name || language.code,
        source: language.source,
        missingKeys:
          language.code === REFERENCE_LANGUAGE
            ? 0
            : countMissingKeys(mergeChain(resolveFallbackChain(language.code, lookup), lookup), referenceEntries),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code))
  }

  /**
   * One language's texts, with its own fallback chain (`@fallback`, then the
   * base language) already merged in. English is not merged in: the renderer
   * holds it separately as the last resort. An unknown code is an empty table
   * (everything shows in English); a malformed one is an error.
   */
  function loadLanguage(code) {
    if (!isValidLanguageCode(code)) throw new Error(`invalid language code: ${JSON.stringify(code)}`)
    const languages = scan()
    const lookup = (c) => languages.get(c)
    return mergeChain(resolveFallbackChain(code, lookup), lookup)
  }

  /** Create the user folder (and its README) if needed. Returns the folder path. */
  function ensureUserDir() {
    fs.mkdirSync(userDir, { recursive: true })
    const readmePath = path.join(userDir, 'README.txt')
    if (!fs.existsSync(readmePath)) fs.writeFileSync(readmePath, USER_README, 'utf-8')
    return userDir
  }

  return { scan, listLanguages, loadLanguage, ensureUserDir, bundledDir, userDir }
}

module.exports = { createLanguageCatalog, REFERENCE_LANGUAGE, USER_README }
