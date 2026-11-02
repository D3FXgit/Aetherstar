// Wires the I18N_* IPC channels to the language catalog, and watches the
// language folders so a saved translation shows up without a restart.
//
// Electron's ipcMain/shell are passed in rather than required here, so this
// module is testable under plain Node (electron/i18n/__tests__).
const fs = require('node:fs')
const { IPC_CHANNELS } = require('../ipc-registry.cjs')

/**
 * @param {{
 *   ipcMain: Pick<import('electron').IpcMain, 'handle' | 'on'>,
 *   shell: Pick<import('electron').Shell, 'openPath'>,
 *   catalog: ReturnType<typeof import('./catalog.cjs').createLanguageCatalog>,
 *   translator?: Pick<ReturnType<typeof import('./main-translator.cjs').createMainTranslator>, 'setActiveLanguage'>,
 * }} deps
 */
function registerI18nIpcHandlers({ ipcMain, shell, catalog, translator }) {
  ipcMain.handle(IPC_CHANNELS.I18N_LIST_LANGUAGES.channel, () => catalog.listLanguages())

  // Only a language code crosses this boundary -- never a path. The catalog
  // validates it and only ever reads <code>.txt from its two folders.
  ipcMain.handle(IPC_CHANNELS.I18N_LOAD_LANGUAGE.channel, (_event, code) => catalog.loadLanguage(code))

  // Resolves '' on success, or the OS's error message (shell.openPath's contract).
  ipcMain.handle(IPC_CHANNELS.I18N_OPEN_LANGUAGES_FOLDER.channel, async () => {
    try {
      return await shell.openPath(catalog.ensureUserDir())
    } catch (error) {
      return String(error && error.message ? error.message : error)
    }
  })

  // The renderer's language, so main's own dialogs match it (main-translator.cjs).
  if (translator) {
    ipcMain.on(IPC_CHANNELS.I18N_SET_ACTIVE_LANGUAGE.channel, (_event, code) => translator.setActiveLanguage(code))
  }
}

/**
 * Watch folders for language-file changes and call `onChange` once per burst
 * (editors save in several steps: temp file, rename, touch). Best effort: a
 * folder that cannot be watched -- missing, or a platform without support --
 * is skipped silently; the Settings list still re-reads on every open.
 *
 * @param {{ dirs: string[], onChange: () => void, debounceMs?: number, watch?: typeof fs.watch }} options
 * @returns {() => void} stop watching
 */
function watchLanguageFolders({ dirs, onChange, debounceMs = 250, watch = fs.watch }) {
  let timer = null
  const watchers = []
  const trigger = (_eventType, fileName) => {
    if (fileName && !/\.txt$/i.test(String(fileName))) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      onChange()
    }, debounceMs)
  }
  for (const dir of dirs) {
    try {
      const watcher = watch(dir, { persistent: false }, trigger)
      watcher.on?.('error', () => {})
      watchers.push(watcher)
    } catch {
      // Not watchable: fine, see above.
    }
  }
  return () => {
    if (timer) clearTimeout(timer)
    timer = null
    for (const watcher of watchers) {
      try {
        watcher.close()
      } catch {
        // already closed
      }
    }
  }
}

module.exports = { registerI18nIpcHandlers, watchLanguageFolders }
