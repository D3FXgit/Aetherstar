// @vitest-environment node
// describe/expect/it/vi come from Vitest's globals (vite.config.ts test.globals: true)
const { IPC_CHANNELS } = require('../../ipc-registry.cjs')
const { registerI18nIpcHandlers, watchLanguageFolders } = require('../ipc-handlers.cjs')

function fakeIpcMain() {
  const handlers = new Map()
  return { handlers, handle: (channel, handler) => handlers.set(channel, handler) }
}

describe('registerI18nIpcHandlers', () => {
  const catalog = {
    listLanguages: () => [{ code: 'en', name: 'English', source: 'bundled', missingKeys: 0 }],
    loadLanguage: (code) => ({ greeting: `hello from ${code}` }),
    ensureUserDir: () => '/user/languages',
  }

  it('serves listLanguages and loadLanguage from the catalog', async () => {
    const ipcMain = fakeIpcMain()
    registerI18nIpcHandlers({ ipcMain, shell: { openPath: async () => '' }, catalog })
    expect(await ipcMain.handlers.get(IPC_CHANNELS.I18N_LIST_LANGUAGES.channel)({})).toEqual(catalog.listLanguages())
    expect(await ipcMain.handlers.get(IPC_CHANNELS.I18N_LOAD_LANGUAGE.channel)({}, 'de')).toEqual({ greeting: 'hello from de' })
  })

  it('opens (and first creates) the user languages folder, reporting the OS error as a string', async () => {
    const ipcMain = fakeIpcMain()
    const opened = []
    registerI18nIpcHandlers({
      ipcMain,
      shell: { openPath: async (p) => (opened.push(p), '') },
      catalog,
    })
    expect(await ipcMain.handlers.get(IPC_CHANNELS.I18N_OPEN_LANGUAGES_FOLDER.channel)({})).toBe('')
    expect(opened).toEqual(['/user/languages'])

    const failing = fakeIpcMain()
    registerI18nIpcHandlers({
      ipcMain: failing,
      shell: { openPath: async () => '' },
      catalog: { ...catalog, ensureUserDir: () => { throw new Error('read-only disk') } },
    })
    expect(await failing.handlers.get(IPC_CHANNELS.I18N_OPEN_LANGUAGES_FOLDER.channel)({})).toBe('read-only disk')
  })
})

describe('registerI18nIpcHandlers: active language', () => {
  it('passes the language the renderer reports to the main translator', () => {
    const listeners = new Map()
    const ipcMain = { handle: () => {}, on: (channel, listener) => listeners.set(channel, listener) }
    const reported = []
    registerI18nIpcHandlers({
      ipcMain,
      shell: { openPath: async () => '' },
      catalog: {},
      translator: { setActiveLanguage: (code) => reported.push(code) },
    })
    listeners.get(IPC_CHANNELS.I18N_SET_ACTIVE_LANGUAGE.channel)({}, 'de')
    expect(reported).toEqual(['de'])
  })
})

describe('watchLanguageFolders', () => {
  it('calls onChange once per burst of .txt changes, ignores other files, and skips unwatchable folders', () => {
    vi.useFakeTimers()
    try {
      const listeners = []
      const closed = []
      const watch = (dir, _options, listener) => {
        if (dir === '/missing') throw new Error('ENOENT')
        listeners.push(listener)
        return { on: () => {}, close: () => closed.push(dir) }
      }
      const onChange = vi.fn()
      const stop = watchLanguageFolders({ dirs: ['/user', '/missing', '/bundled'], onChange, debounceMs: 100, watch })
      expect(listeners).toHaveLength(2)

      listeners[0]('rename', 'fr.txt')
      listeners[0]('change', 'fr.txt')
      listeners[1]('change', 'de.txt')
      listeners[0]('change', 'notes.docx')
      vi.advanceTimersByTime(150)
      expect(onChange).toHaveBeenCalledTimes(1)

      listeners[0]('change', 'notes.docx')
      vi.advanceTimersByTime(150)
      expect(onChange).toHaveBeenCalledTimes(1)

      stop()
      expect(closed).toEqual(['/user', '/bundled'])
    } finally {
      vi.useRealTimers()
    }
  })
})
