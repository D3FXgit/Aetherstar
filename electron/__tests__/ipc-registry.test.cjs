// @vitest-environment node
// describe/expect/it/beforeEach come from Vitest's globals (vite.config.ts test.globals: true)
const fs = require('node:fs')
const path = require('node:path')

const { IPC_CHANNELS } = require('../ipc-registry.cjs')

describe('IPC_CHANNELS registry', () => {
  it('defines every channel main.cjs and preload.cjs need, with a channel string and direction', () => {
    const expectedKeys = [
      'APP_GET_INFO',
      'DIALOG_OPEN_FILE',
      'WINDOW_MINIMIZE',
      'WINDOW_TOGGLE_MAXIMIZE',
      'WINDOW_GET_DISPLAY_MODE',
      'WINDOW_SET_WINDOWED',
      'WINDOW_DISPLAY_MODE_CHANGED',
      'APP_PING',
      'MAIN_PONG',
      'LIBRARY_ADD_ROOT',
      'LIBRARY_REMOVE_ROOT',
      'LIBRARY_LIST_ROOTS',
      'LIBRARY_RESCAN',
      'LIBRARY_SEARCH',
      'LIBRARY_GET_SONG',
      'LIBRARY_LIST_SCAN_ERRORS',
      'LIBRARY_SCAN_PROGRESS',
      'LIBRARY_SET_GAMEPLAY_ACTIVE',
      'LIBRARY_SET_LOUDNESS',
      'LIBRARY_LIST_FAVORITES',
      'LIBRARY_SET_FAVORITE',
      'LIBRARY_RECORD_PLAY',
      'STAGE_GET_FIXTURE_CHART_PATH',
      'PLAYERS_LIST',
      'PLAYERS_CREATE',
      'PLAYERS_UPDATE',
      'PLAYERS_DELETE',
      'PLAYERS_REORDER',
      'PLAYERS_READ_IMPORTED_PHOTO',
      'AUDIO_LIST_DEVICES',
      'AUDIO_REQUEST_PERMISSION',
      'AUDIO_GET_PERMISSION_STATUS',
      'AUDIO_START_CAPTURE',
      'AUDIO_STOP_CAPTURE',
      'AUDIO_PITCH_BATCH',
      'AUDIO_DEVICE_LIST_CHANGED',
      'AUDIO_START_RAW_SCOPE',
      'AUDIO_STOP_RAW_SCOPE',
      'AUDIO_RAW_SCOPE_CHUNK',
      'AUDIO_GET_MIC_MONITOR',
      'AUDIO_SET_MIC_MONITOR',
      'AUDIENCE_REPORT_SCORE_STATE',
      'AUDIENCE_SCORE_STATE',
      'AUDIENCE_LIST_DISPLAYS',
      'AUDIENCE_SET_DISPLAY',
      'AUDIENCE_SET_ENABLED',
      'AUDIENCE_GET_WINDOW_PRESENCE',
      'AUDIENCE_WINDOW_PRESENCE',
      'FX_GET_ASSETS_DIR',
      'SESSION_START',
      'SESSION_RECORD_ENTRY',
      'SESSION_LIST_LEADERBOARD',
      'MULTIPLAYER_LIST_MIC_SLOTS',
      'MULTIPLAYER_SAVE_MIC_SLOT',
      'MULTIPLAYER_CLEAR_MIC_SLOT',
      'MULTIPLAYER_GET_CPU_USAGE',
      'I18N_LIST_LANGUAGES',
      'I18N_LOAD_LANGUAGE',
      'I18N_OPEN_LANGUAGES_FOLDER',
      'I18N_LANGUAGES_CHANGED',
      'I18N_SET_ACTIVE_LANGUAGE',
    ]
    for (const key of expectedKeys) {
      expect(IPC_CHANNELS[key]).toBeDefined()
      expect(typeof IPC_CHANNELS[key].channel).toBe('string')
      expect(['invoke', 'send']).toContain(IPC_CHANNELS[key].direction)
    }
  })
})

// Requiring the real 'electron' package outside the Electron binary returns a
// path string, not the API surface -- so we inject a fake module into Node's
// own require cache before loading preload.cjs, rather than reaching for
// Vitest's ESM-oriented module mocking (which doesn't reliably intercept a
// plain CJS `require()` chain like this one).
const electronModulePath = require.resolve('electron')
const preloadModulePath = require.resolve('../preload.cjs')

describe('preload.cjs <-> registry consistency', () => {
  let exposedApi
  let invokeMock
  let sendMock
  let onMock

  beforeEach(() => {
    const invokeCalls = []
    const sendCalls = []
    const onCalls = []

    invokeMock = (...args) => {
      invokeCalls.push(args)
      return Promise.resolve(undefined)
    }
    invokeMock.calls = invokeCalls
    sendMock = (...args) => sendCalls.push(args)
    sendMock.calls = sendCalls
    onMock = (...args) => onCalls.push(args)
    onMock.calls = onCalls

    require.cache[electronModulePath] = {
      id: electronModulePath,
      filename: electronModulePath,
      loaded: true,
      exports: {
        contextBridge: {
          exposeInMainWorld: (_key, api) => {
            exposedApi = api
          },
        },
        ipcRenderer: {
          invoke: invokeMock,
          send: sendMock,
          on: onMock,
          removeListener: () => {},
        },
      },
    }

    delete require.cache[preloadModulePath]
    require('../preload.cjs')
  })

  it('invokes app:get-info via the registry channel value, not a hardcoded duplicate', async () => {
    await exposedApi.getAppInfo()
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.APP_GET_INFO.channel])
  })

  it('invokes dialog:open-file via the registry channel value', async () => {
    await exposedApi.openFile()
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.DIALOG_OPEN_FILE.channel])
  })

  it('invokes dialog:open-file with a directory option when picking a folder', async () => {
    await exposedApi.openFile({ directory: true })
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.DIALOG_OPEN_FILE.channel, { directory: true }])
  })

  it('invokes window:minimize and window:toggle-maximize via the registry channel values', async () => {
    await exposedApi.minimize()
    await exposedApi.toggleMaximize()
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.WINDOW_MINIMIZE.channel])
    expect(invokeMock.calls[1]).toEqual([IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE.channel])
  })

  it('invokes window.getDisplayMode/setWindowed via the registry channel values', async () => {
    await exposedApi.window.getDisplayMode()
    await exposedApi.window.setWindowed(true)
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.WINDOW_GET_DISPLAY_MODE.channel])
    expect(invokeMock.calls[1]).toEqual([IPC_CHANNELS.WINDOW_SET_WINDOWED.channel, true])
  })

  it('subscribes to window:display-mode-changed via the registry channel value', () => {
    exposedApi.window.onDisplayModeChanged(() => {})
    expect(onMock.calls[0][0]).toBe(IPC_CHANNELS.WINDOW_DISPLAY_MODE_CHANGED.channel)
    expect(typeof onMock.calls[0][1]).toBe('function')
  })

  it('sends app:ping via the registry channel value', () => {
    exposedApi.ping('hello')
    expect(sendMock.calls[0]).toEqual([IPC_CHANNELS.APP_PING.channel, 'hello'])
  })

  it('subscribes to main:pong via the registry channel value', () => {
    exposedApi.onPong(() => {})
    expect(onMock.calls[0][0]).toBe(IPC_CHANNELS.MAIN_PONG.channel)
    expect(typeof onMock.calls[0][1]).toBe('function')
  })

  it('invokes library.addRoot/removeRoot/listRoots/rescan via the registry channel values', async () => {
    await exposedApi.library.addRoot('/library')
    await exposedApi.library.removeRoot('/library')
    await exposedApi.library.listRoots()
    await exposedApi.library.rescan('/library')
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.LIBRARY_ADD_ROOT.channel, '/library'])
    expect(invokeMock.calls[1]).toEqual([IPC_CHANNELS.LIBRARY_REMOVE_ROOT.channel, '/library'])
    expect(invokeMock.calls[2]).toEqual([IPC_CHANNELS.LIBRARY_LIST_ROOTS.channel])
    expect(invokeMock.calls[3]).toEqual([IPC_CHANNELS.LIBRARY_RESCAN.channel, '/library'])
  })

  it('invokes library.search/getSong/listScanErrors via the registry channel values', async () => {
    await exposedApi.library.search({ query: 'nova' })
    await exposedApi.library.getSong('/library/song')
    await exposedApi.library.listScanErrors()
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.LIBRARY_SEARCH.channel, { query: 'nova' }])
    expect(invokeMock.calls[1]).toEqual([IPC_CHANNELS.LIBRARY_GET_SONG.channel, '/library/song'])
    expect(invokeMock.calls[2]).toEqual([IPC_CHANNELS.LIBRARY_LIST_SCAN_ERRORS.channel])
  })

  it('invokes library favourites and play history via the registry channel values', async () => {
    await exposedApi.library.listFavorites()
    await exposedApi.library.setFavorite('/library/song', true)
    await exposedApi.library.recordPlay('/library/song', 'jukebox')
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.LIBRARY_LIST_FAVORITES.channel])
    expect(invokeMock.calls[1]).toEqual([IPC_CHANNELS.LIBRARY_SET_FAVORITE.channel, '/library/song', true])
    expect(invokeMock.calls[2]).toEqual([IPC_CHANNELS.LIBRARY_RECORD_PLAY.channel, '/library/song', 'jukebox'])
  })

  it('subscribes to library scan progress via the registry channel value', () => {
    exposedApi.library.onScanProgress(() => {})
    expect(onMock.calls[0][0]).toBe(IPC_CHANNELS.LIBRARY_SCAN_PROGRESS.channel)
    expect(typeof onMock.calls[0][1]).toBe('function')
  })

  it('sends library:set-gameplay-active (fire-and-forget) via the registry channel value, as a strict boolean', () => {
    exposedApi.library.setGameplayActive(true)
    exposedApi.library.setGameplayActive(false)
    exposedApi.library.setGameplayActive('yes')
    expect(IPC_CHANNELS.LIBRARY_SET_GAMEPLAY_ACTIVE.direction).toBe('send')
    expect(sendMock.calls).toEqual([
      [IPC_CHANNELS.LIBRARY_SET_GAMEPLAY_ACTIVE.channel, true],
      [IPC_CHANNELS.LIBRARY_SET_GAMEPLAY_ACTIVE.channel, false],
      [IPC_CHANNELS.LIBRARY_SET_GAMEPLAY_ACTIVE.channel, false],
    ])
  })

  it('invokes library.setLoudness via the registry channel value, passing only the two numbers', async () => {
    await exposedApi.library.setLoudness('/library/song', { integratedLufs: -12, truePeakDbtp: -1, extra: 'x' })
    expect(IPC_CHANNELS.LIBRARY_SET_LOUDNESS.direction).toBe('invoke')
    expect(invokeMock.calls[0]).toEqual([
      IPC_CHANNELS.LIBRARY_SET_LOUDNESS.channel,
      '/library/song',
      { integratedLufs: -12, truePeakDbtp: -1 },
    ])
  })

  it('invokes stage.getFixtureChartPath via the registry channel value', async () => {
    await exposedApi.stage.getFixtureChartPath()
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.STAGE_GET_FIXTURE_CHART_PATH.channel])
  })

  it('invokes players.list/create/update/delete/reorder via the registry channel values', async () => {
    await exposedApi.players.list()
    await exposedApi.players.create({ name: 'Alex', color: 'coral' })
    await exposedApi.players.update({ id: 'p1', name: 'Alexandra' })
    await exposedApi.players.delete('p1')
    await exposedApi.players.reorder(['p2', 'p1'])
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.PLAYERS_LIST.channel])
    expect(invokeMock.calls[1]).toEqual([IPC_CHANNELS.PLAYERS_CREATE.channel, { name: 'Alex', color: 'coral' }])
    expect(invokeMock.calls[2]).toEqual([IPC_CHANNELS.PLAYERS_UPDATE.channel, { id: 'p1', name: 'Alexandra' }])
    expect(invokeMock.calls[3]).toEqual([IPC_CHANNELS.PLAYERS_DELETE.channel, 'p1'])
    expect(invokeMock.calls[4]).toEqual([IPC_CHANNELS.PLAYERS_REORDER.channel, ['p2', 'p1']])
  })

  it('invokes players.readImportedPhoto via the registry channel value', async () => {
    await exposedApi.players.readImportedPhoto('/Users/me/photo.jpg')
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.PLAYERS_READ_IMPORTED_PHOTO.channel, '/Users/me/photo.jpg'])
  })

  it('invokes players.update with songsSung/bestScore via the registry channel value', async () => {
    await exposedApi.players.update({ id: 'p1', songsSung: 3, bestScore: 8000 })
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.PLAYERS_UPDATE.channel, { id: 'p1', songsSung: 3, bestScore: 8000 }])
  })

  it('invokes audio.listDevices/requestPermission/getPermissionStatus via the registry channel values', async () => {
    await exposedApi.audio.listDevices()
    await exposedApi.audio.requestPermission()
    await exposedApi.audio.getPermissionStatus()
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.AUDIO_LIST_DEVICES.channel])
    expect(invokeMock.calls[1]).toEqual([IPC_CHANNELS.AUDIO_REQUEST_PERMISSION.channel])
    expect(invokeMock.calls[2]).toEqual([IPC_CHANNELS.AUDIO_GET_PERMISSION_STATUS.channel])
  })

  it('invokes audio.startCapture/stopCapture/startRawScope/stopRawScope via the registry channel values', async () => {
    await exposedApi.audio.startCapture('mic-1')
    await exposedApi.audio.stopCapture('mic-1')
    await exposedApi.audio.startRawScope('mic-1')
    await exposedApi.audio.stopRawScope('mic-1')
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.AUDIO_START_CAPTURE.channel, 'mic-1'])
    expect(invokeMock.calls[1]).toEqual([IPC_CHANNELS.AUDIO_STOP_CAPTURE.channel, 'mic-1'])
    expect(invokeMock.calls[2]).toEqual([IPC_CHANNELS.AUDIO_START_RAW_SCOPE.channel, 'mic-1'])
    expect(invokeMock.calls[3]).toEqual([IPC_CHANNELS.AUDIO_STOP_RAW_SCOPE.channel, 'mic-1'])
  })

  it('invokes audio.getMicMonitor/setMicMonitor via the registry channel values', async () => {
    await exposedApi.audio.getMicMonitor()
    await exposedApi.audio.setMicMonitor({ enabled: true, level: 0.4 })
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.AUDIO_GET_MIC_MONITOR.channel])
    expect(invokeMock.calls[1]).toEqual([IPC_CHANNELS.AUDIO_SET_MIC_MONITOR.channel, { enabled: true, level: 0.4 }])
  })

  it('subscribes to audio.onPitchBatch/onDeviceListChanged/onRawScopeChunk via the registry channel values', () => {
    exposedApi.audio.onPitchBatch(() => {})
    exposedApi.audio.onDeviceListChanged(() => {})
    exposedApi.audio.onRawScopeChunk(() => {})
    expect(onMock.calls[0][0]).toBe(IPC_CHANNELS.AUDIO_PITCH_BATCH.channel)
    expect(onMock.calls[1][0]).toBe(IPC_CHANNELS.AUDIO_DEVICE_LIST_CHANGED.channel)
    expect(onMock.calls[2][0]).toBe(IPC_CHANNELS.AUDIO_RAW_SCOPE_CHUNK.channel)
  })

  it('sends audience:report-score-state via the registry channel value', () => {
    exposedApi.audience.reportScoreState({ players: [] })
    expect(sendMock.calls[0]).toEqual([IPC_CHANNELS.AUDIENCE_REPORT_SCORE_STATE.channel, { players: [] }])
  })

  it('subscribes to audience:score-state via the registry channel value', () => {
    exposedApi.audience.onScoreState(() => {})
    expect(onMock.calls[0][0]).toBe(IPC_CHANNELS.AUDIENCE_SCORE_STATE.channel)
    expect(typeof onMock.calls[0][1]).toBe('function')
  })

  it('invokes audience.listDisplays/setDisplay via the registry channel values', async () => {
    await exposedApi.audience.listDisplays()
    await exposedApi.audience.setDisplay(2)
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.AUDIENCE_LIST_DISPLAYS.channel])
    expect(invokeMock.calls[1]).toEqual([IPC_CHANNELS.AUDIENCE_SET_DISPLAY.channel, 2])
  })

  it('invokes audience.setEnabled via the registry channel value', async () => {
    await exposedApi.audience.setEnabled(true)
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.AUDIENCE_SET_ENABLED.channel, true])
  })

  it('audience.onWindowPresence reports the current state on subscribe, then every pushed change', async () => {
    const heard = []
    const unsubscribe = exposedApi.audience.onWindowPresence((open) => heard.push(open))
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.AUDIENCE_GET_WINDOW_PRESENCE.channel])
    expect(onMock.calls[0][0]).toBe(IPC_CHANNELS.AUDIENCE_WINDOW_PRESENCE.channel)
    await Promise.resolve()
    await Promise.resolve()
    // The mocked invoke resolves undefined -> reported as closed.
    expect(heard).toEqual([false])

    const listener = onMock.calls[0][1]
    listener({}, true)
    listener({}, false)
    expect(heard).toEqual([false, true, false])
    expect(typeof unsubscribe).toBe('function')
  })

  it('audience.onWindowPresence drops the initial answer when a push already arrived, or after unsubscribing', async () => {
    const heard = []
    exposedApi.audience.onWindowPresence((open) => heard.push(open))
    onMock.calls[0][1]({}, true)
    await Promise.resolve()
    await Promise.resolve()
    expect(heard).toEqual([true])

    const late = []
    const unsubscribe = exposedApi.audience.onWindowPresence((open) => late.push(open))
    unsubscribe()
    await Promise.resolve()
    await Promise.resolve()
    expect(late).toEqual([])
  })

  it('invokes fx.getAssetsDir via the registry channel value', async () => {
    await exposedApi.fx.getAssetsDir()
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.FX_GET_ASSETS_DIR.channel])
  })

  it('invokes session.start/recordEntry/listLeaderboard via the registry channel values', async () => {
    await exposedApi.session.start()
    await exposedApi.session.recordEntry({ sessionId: 's1', songPath: '/song', playerId: 'p1', score: 100, epicCount: 1, goodCount: 0, awfulCount: 0 })
    await exposedApi.session.listLeaderboard()
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.SESSION_START.channel])
    expect(invokeMock.calls[1]).toEqual([
      IPC_CHANNELS.SESSION_RECORD_ENTRY.channel,
      { sessionId: 's1', songPath: '/song', playerId: 'p1', score: 100, epicCount: 1, goodCount: 0, awfulCount: 0 },
    ])
    expect(invokeMock.calls[2]).toEqual([IPC_CHANNELS.SESSION_LIST_LEADERBOARD.channel])
  })

  it('invokes multiplayer.listMicSlots/saveMicSlot/clearMicSlot via the registry channel values', async () => {
    await exposedApi.multiplayer.listMicSlots()
    await exposedApi.multiplayer.saveMicSlot({ slotNumber: 1, deviceId: 'mic-1', channelIndex: 0 })
    await exposedApi.multiplayer.clearMicSlot(1)
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.MULTIPLAYER_LIST_MIC_SLOTS.channel])
    expect(invokeMock.calls[1]).toEqual([
      IPC_CHANNELS.MULTIPLAYER_SAVE_MIC_SLOT.channel,
      { slotNumber: 1, deviceId: 'mic-1', channelIndex: 0 },
    ])
    expect(invokeMock.calls[2]).toEqual([IPC_CHANNELS.MULTIPLAYER_CLEAR_MIC_SLOT.channel, 1])
  })

  it('invokes multiplayer.getCpuUsage via the registry channel value', async () => {
    await exposedApi.multiplayer.getCpuUsage()
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.MULTIPLAYER_GET_CPU_USAGE.channel])
  })

  it('invokes i18n.listLanguages/loadLanguage/openLanguagesFolder via the registry channel values', async () => {
    await exposedApi.i18n.listLanguages()
    await exposedApi.i18n.loadLanguage('de')
    await exposedApi.i18n.openLanguagesFolder()
    expect(invokeMock.calls[0]).toEqual([IPC_CHANNELS.I18N_LIST_LANGUAGES.channel])
    expect(invokeMock.calls[1]).toEqual([IPC_CHANNELS.I18N_LOAD_LANGUAGE.channel, 'de'])
    expect(invokeMock.calls[2]).toEqual([IPC_CHANNELS.I18N_OPEN_LANGUAGES_FOLDER.channel])
  })

  it('sends i18n:set-active-language (fire-and-forget) via the registry channel value, as a string', () => {
    exposedApi.i18n.setActiveLanguage('de')
    expect(IPC_CHANNELS.I18N_SET_ACTIVE_LANGUAGE.direction).toBe('send')
    expect(sendMock.calls).toEqual([[IPC_CHANNELS.I18N_SET_ACTIVE_LANGUAGE.channel, 'de']])
  })

  it('subscribes to i18n:languages-changed via the registry channel value', () => {
    const heard = []
    exposedApi.i18n.onLanguagesChanged(() => heard.push('changed'))
    expect(onMock.calls[0][0]).toBe(IPC_CHANNELS.I18N_LANGUAGES_CHANGED.channel)
    onMock.calls[0][1]({}, 'ignored payload')
    expect(heard).toEqual(['changed'])
  })

  it('getWindowRole() defaults to "main" when no location is available (this Node test harness, and any real main-window load)', () => {
    expect(exposedApi.getWindowRole()).toBe('main')
  })

  // parseWindowRole is pure (just URLSearchParams over a string) and exported
  // from preload.cjs specifically so it's testable without a real DOM/location
  // -- preload.cjs itself only runs here via the require-cache-mocked 'electron'.
  it('parseWindowRole returns "audience" when the query string has window=audience', () => {
    const { parseWindowRole } = require('../preload.cjs')
    expect(parseWindowRole('?window=audience')).toBe('audience')
  })

  it('parseWindowRole returns "main" for an empty, missing, or unrelated query string', () => {
    const { parseWindowRole } = require('../preload.cjs')
    expect(parseWindowRole('')).toBe('main')
    expect(parseWindowRole('?foo=bar')).toBe('main')
  })
})

describe('preload.cjs sandbox constraint', () => {
  it("requires only 'electron' -- a sandboxed preload script silently fails to load on any other require(), local or built-in, which leaves window.api undefined for the whole session with no visible error (confirmed against a real Electron instance via the DevTools Protocol; not reproducible through this file's own require-cache-mocked tests above, since those load preload.cjs under plain Node)", () => {
    const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf-8')
    const requireCalls = [...preloadSource.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
    expect(requireCalls).toEqual(['electron'])
  })
})

describe('main.cjs <-> registry consistency (static check)', () => {
  it('requires the ipc registry and no longer hardcodes the old channel string literals', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf-8')

    expect(mainSource).toMatch(/require\(['"]\.\/ipc-registry\.cjs['"]\)/)

    for (const { channel } of Object.values(IPC_CHANNELS)) {
      const hardcodedLiteral = new RegExp(`['"]${channel}['"]`)
      expect(mainSource).not.toMatch(hardcodedLiteral)
    }
  })

  it('wires up the audience window modules', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf-8')

    expect(mainSource).toMatch(/require\(['"]\.\/windows\/audience-window\.cjs['"]\)/)
    expect(mainSource).toMatch(/require\(['"]\.\/windows\/state-broadcaster\.cjs['"]\)/)
    expect(mainSource).toMatch(/require\(['"]\.\/windows\/settings\.cjs['"]\)/)
    expect(mainSource).toMatch(/require\(['"]\.\/windows\/display-targeting\.cjs['"]\)/)
  })
})

describe('packaging: fixtures/ ships with the built app', () => {
  it('electron-builder.yml includes fixtures/ in its files list', () => {
    const builderConfig = fs.readFileSync(path.join(__dirname, '..', '..', 'electron-builder.yml'), 'utf-8')
    expect(builderConfig).toMatch(/fixtures\/\*\*\/\*/)
  })
})

describe('packaging: assets/ ships with the built app', () => {
  it('electron-builder.yml includes assets/ in its files list', () => {
    const builderConfig = fs.readFileSync(path.join(__dirname, '..', '..', 'electron-builder.yml'), 'utf-8')
    expect(builderConfig).toMatch(/assets\/\*\*\/\*/)
  })
})

describe('packaging: languages/ ships unpacked and editable', () => {
  it('electron-builder.yml copies languages/*.txt as an extraResource, outside the asar archive', () => {
    const builderConfig = fs.readFileSync(path.join(__dirname, '..', '..', 'electron-builder.yml'), 'utf-8')
    expect(builderConfig).toMatch(/^extraResources:/m)
    expect(builderConfig).toMatch(/- from: languages\s+to: languages/)
  })

  it('main.cjs reads the bundled languages from process.resourcesPath when packaged', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf-8')
    expect(mainSource).toMatch(/path\.join\(process\.resourcesPath, 'languages'\)/)
    expect(mainSource).toMatch(/require\(['"]\.\/i18n\/catalog\.cjs['"]\)/)
  })
})
