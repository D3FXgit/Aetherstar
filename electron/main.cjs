const { app, BrowserWindow, Menu, ipcMain, screen, session, shell, dialog, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { IPC_CHANNELS } = require('./ipc-registry.cjs')
const libraryDb = require('./library/db.cjs')
const scanner = require('./library/scanner.cjs')
// Thumbnails are made here, in the main process -- nativeImage isn't reliably
// available inside the worker_threads context runScan() executes in (see
// startLibraryScan / backfillMissingThumbnails).
const { runThumbnailBackfill, encodeThumbnail } = require('./library/thumbnail-backfill.cjs')
const mediaProtocol = require('./library/media-protocol.cjs')
const stageProtocol = require('./protocols.cjs')
const { registerPrivilegedSchemes } = require('./privileged-schemes.cjs')
const playersDbModule = require('./players/db.cjs')
const avatarIo = require('./players/avatar-io.cjs')
const sessionDbModule = require('./session/db.cjs')
const { registerSessionIpcHandlers } = require('./session/ipc-handlers.cjs')
const multiplayerDbModule = require('./multiplayer/db.cjs')
const { createNativeBridge } = require('./audio/native-bridge.cjs')
const { registerAudioIpcHandlers } = require('./audio/ipc-handlers.cjs')
const { startSampling } = require('./audio/cpuUsage.cjs')
const { registerMicMonitorIpcHandlers } = require('./audio/monitor-ipc.cjs')
const audienceSettings = require('./windows/settings.cjs')
const windowMode = require('./windows/window-mode.cjs')
const calibrationSettings = require('./calibration/settings.cjs')
const { pickTargetDisplay } = require('./windows/display-targeting.cjs')
const { createAudienceWindow, registerDisplayHotplugHandling, createWindowPresence } = require('./windows/audience-window.cjs')
const { createScoreStateBroadcaster } = require('./windows/state-broadcaster.cjs')
const { installAppMenu, hideWindowMenuBar, devShortcutAction, NO_MENU_BAR_WINDOW_OPTIONS } = require('./windows/app-menu.cjs')
const { isSafeExternalUrl, createNavigationGuard } = require('./navigation-policy.cjs')
const { createGameplayActivity } = require('./gameplay-activity.cjs')
const { createLanguageCatalog } = require('./i18n/catalog.cjs')
const { registerI18nIpcHandlers, watchLanguageFolders } = require('./i18n/ipc-handlers.cjs')
const { createMainTranslator } = require('./i18n/main-translator.cjs')

// Offline stand-in used only when native/ hasn't been built yet (npm run
// build:native) -- keeps the app usable (empty device list, not a rejected
// IPC promise) instead of crashing at startup on a missing .node addon.
const OFFLINE_AUDIO_BRIDGE = {
  listDevices: () => [],
  startCapture: () => {},
  stopCapture: () => {},
  startRawScope: () => {},
  stopRawScope: () => {},
  // Monitoring is entirely native, so with no addon there is nothing to
  // monitor -- but the setting still has to be readable and writable, or
  // Settings would throw instead of showing a switch that does nothing yet.
  setMicMonitoring: () => {},
}

// Must run before app.whenReady() -- Electron requires privileged schemes to
// be registered at module-load time, not inside the ready handler. One call
// covering every scheme: registerSchemesAsPrivileged replaces the list
// rather than appending (see electron/privileged-schemes.cjs).
registerPrivilegedSchemes()

// Also before ready (switches are read at startup). Menu music must play
// without a click first; Chromium's gesture rule otherwise leaves an
// AudioContext suspended. The renderer keeps its own gesture fallback anyway
// (src/audio/webAudioApi.ts's ensureAudioContextRunning).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Unpackaged AND not explicitly production -- `npm start` runs unpackaged against built files.
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production'
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'

/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {BrowserWindow | null} */
let audienceWindow = null
/**
 * Whether an audience window exists, pushed to the main window on every change
 * (window.api.audience.onWindowPresence): the host stops composing audience
 * frames while nobody could see them.
 */
const audiencePresence = createWindowPresence((open) => {
  const win = mainWindow
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(IPC_CHANNELS.AUDIENCE_WINDOW_PRESENCE.channel, open)
})
/**
 * Set the moment the app starts going away, so that the full-screen events the
 * OS fires during teardown are not mistaken for the user choosing a window.
 */
let isQuitting = false
/** @type {ReturnType<typeof createScoreStateBroadcaster> | null} */
let scoreBroadcaster = null
/** @type {import('better-sqlite3').Database | null} */
let db = null
/** @type {import('better-sqlite3').Database | null} */
let playersDb = null
/** @type {import('better-sqlite3').Database | null} */
let sessionDb = null
/** @type {import('better-sqlite3').Database | null} */
let multiplayerDb = null
// CPU headroom for /lab/multiplayer -- only the main process can see the
// native capture threads' actual cost.
let latestCpuPercent = 0
let stopCpuSampling = null
/** What registerAudioIpcHandlers returned -- its dispose() closes every capture on quit. */
let audioIpc = null
/** Stops the language-folder watcher (registerLanguageIpc). */
let stopWatchingLanguages = null
/** Set by the renderer while a song is being sung; background work holds still meanwhile. */
const gameplay = createGameplayActivity()
/**
 * Files and folders the user picked in an open dialog this session. The
 * app-media:// scheme is confined to known directories (see
 * getAppMediaAllowedRoots); something the user explicitly chose -- a chart
 * opened in the Stage lab, a photo imported as an avatar -- is one of them.
 */
const userPickedPaths = new Set()
/** Roots whose thumbnail backfill is currently running, so a rescan does not start a second one. */
const thumbnailBackfillsRunning = new Set()

function getLibraryPaths() {
  const userDataDir = app.getPath('userData')
  return {
    dbPath: path.join(userDataDir, 'library.db'),
    thumbnailsDir: path.join(userDataDir, 'thumbnails'),
  }
}

function getPlayersPaths() {
  const userDataDir = app.getPath('userData')
  return {
    // Same file as the library index -- own connection, own migration, own table.
    dbPath: path.join(userDataDir, 'library.db'),
    avatarsDir: path.join(userDataDir, 'avatars'),
  }
}

function getAudienceSettingsPath() {
  return path.join(app.getPath('userData'), 'audience-window.json')
}

function getCalibrationSettingsPath() {
  return path.join(app.getPath('userData'), 'calibration.json')
}

function getWindowModeSettingsPath() {
  return path.join(app.getPath('userData'), 'window-mode.json')
}

function getMicMonitorSettingsPath() {
  return path.join(app.getPath('userData'), 'mic-monitor.json')
}

/**
 * Language packs (docs/translating.md). The bundled folder ships OUTSIDE the
 * asar archive (electron-builder.yml extraResources), so it stays a plain,
 * editable folder; the user folder is where people drop their own languages.
 */
function getLanguageDirs() {
  return {
    bundledDir: app.isPackaged ? path.join(process.resourcesPath, 'languages') : path.join(__dirname, '..', 'languages'),
    userDir: path.join(app.getPath('userData'), 'languages'),
  }
}

/** @type {{ catalog: ReturnType<typeof createLanguageCatalog>, translator: ReturnType<typeof createMainTranslator> } | null} */
let languageServices = null

/** Created on first use: the startup error dialog can need it before the IPC handlers exist. */
function getLanguageServices() {
  if (!languageServices) {
    const catalog = createLanguageCatalog(getLanguageDirs())
    const translator = createMainTranslator({
      catalog,
      getSystemLocale: () => app.getLocale(),
      statePath: path.join(app.getPath('userData'), 'main-language.json'),
    })
    languageServices = { catalog, translator }
  }
  return languageServices
}

/** Translate a text the main process shows itself; English when the key is missing. */
function tMain(key, params) {
  return getLanguageServices().translator.t(key, params)
}

/** The current window state as the renderer sees it, plus the platform that decides how to escape it. */
function currentDisplayMode() {
  const windowed = mainWindow ? !mainWindow.isFullScreen() : windowMode.readWindowMode(getWindowModeSettingsPath()).windowed
  return { windowed, platform: process.platform }
}

function createWindow() {
  // Full screen is the startup default: this is a television app driven from a
  // sofa, and a 1200x800 window on a 4K screen is not what a party looks at.
  // The `width`/`height` below are still meaningful -- they are the size the
  // window restores to the moment anyone leaves full screen.
  const { windowed } = windowMode.readWindowMode(getWindowModeSettingsPath())

  // Closing the previous main window set this (see the 'close' handler
  // below). On macOS the app outlives that window and `activate` brings a new
  // one up here -- which must not inherit "quitting", or none of its
  // full-screen changes would ever be remembered again.
  isQuitting = false

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    show: false,
    fullscreen: !windowed,
    backgroundColor: '#12121a',
    // No desktop menu bar in the window on Windows/Linux -- see electron/windows/app-menu.cjs.
    ...NO_MENU_BAR_WINDOW_OPTIONS,
    // `hiddenInset` and full screen are not in tension on macOS: the traffic
    // lights stay in the auto-hiding title bar, which the system reveals when
    // the pointer reaches the top of the screen. That green button (and
    // Control-Command-F) is macOS's own way out, which is why the platform
    // needs no app-specific gesture -- see electron/windows/window-mode.cjs.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Pitch judging and the note highway run on requestAnimationFrame;
      // Chromium throttles that (and timers) whenever it decides the window
      // is hidden or occluded -- e.g. behind the audience window on a single
      // display -- which would stall scoring mid-song.
      backgroundThrottling: false,
    },
  })

  // Whatever the OS ends up doing is what gets remembered. Someone who escapes
  // full screen with the macOS green button never touches Settings, and would
  // otherwise be dropped straight back into full screen on the next launch --
  // the exact "stuck in full screen with no way out" failure the toggle exists
  // to prevent. The renderer is told too, so an open Settings pane agrees with
  // the window it is describing.
  //
  // Teardown is the exception, and the reason isUserDrivenModeChange exists:
  // macOS fires leave-full-screen while it dismantles the window's full-screen
  // space on quit, which would otherwise persist `windowed: true` at the end of
  // every single session -- see electron/windows/window-mode.cjs.
  const syncDisplayMode = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (!windowMode.isUserDrivenModeChange({ quitting: isQuitting, windowDestroyed: false })) return
    const mode = currentDisplayMode()
    windowMode.writeWindowMode(getWindowModeSettingsPath(), { windowed: mode.windowed })
    mainWindow.webContents.send(IPC_CHANNELS.WINDOW_DISPLAY_MODE_CHANGED.channel, mode)
  }

  mainWindow.once('ready-to-show', () => {
    const win = mainWindow
    if (!win) return
    // Avoid the white flash while the renderer boots.
    win.show()

    // A safety net, not the mechanism: `fullscreen: true` in the constructor is
    // what normally puts the window in a full-screen space, and on macOS it
    // does so only once the window is actually on screen. `show: false` means
    // that is *here*, not at construction, and a platform that quietly declined
    // the constructor's request would otherwise leave the app windowed with
    // nothing having gone visibly wrong.
    if (!windowed && !win.isFullScreen()) win.setFullScreen(true)

    // Only now do OS-driven changes count as the user's decision. Listening
    // from construction instead lets the enter/exit churn around the first
    // show() persist itself as "the user chose windowed" -- and because that is
    // written to disk, the *next* launch would then start windowed and the
    // default would look as if it had never worked.
    win.on('enter-full-screen', syncDisplayMode)
    win.on('leave-full-screen', syncDisplayMode)
  })

  hideWindowMenuBar(mainWindow)

  if (isDev) {
    // F12 / Ctrl+Shift+I / Ctrl+R came from the default menu, which Windows
    // and Linux no longer have (see electron/windows/app-menu.cjs).
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const action = devShortcutAction(input, { platform: process.platform, isDev })
      if (!action) return
      event.preventDefault()
      if (action === 'toggleDevTools') mainWindow?.webContents.toggleDevTools()
      else mainWindow?.webContents.reload()
    })
    mainWindow.loadURL(DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Closing the main window is teardown too, not a preference: on macOS the
  // full-screen space is dismantled as part of it, and `close` runs before the
  // resulting leave-full-screen would reach syncDisplayMode.
  mainWindow.on('close', () => {
    isQuitting = true
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    // The audience window has no purpose without the main window -- never leave it orphaned.
    audienceWindow?.close()
  })
}

function loadIntoWindow(win, urlQuery) {
  if (isDev) {
    win.loadURL(`${DEV_SERVER_URL}?${urlQuery}`)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      query: Object.fromEntries(new URLSearchParams(urlQuery)),
    })
  }
}

function toDisplayInfo(display) {
  return {
    id: display.id,
    label: tMain('main.display.label', { id: String(display.id) }),
    bounds: display.bounds,
    isPrimary: display.id === screen.getPrimaryDisplay().id,
  }
}

function openAudienceWindow() {
  const { displayId, enabled } = audienceSettings.readAudienceSettings(getAudienceSettingsPath())
  // Opt-in: never (re)open the audience window -- at startup or on a display
  // hot-plug -- unless the user turned it on in Settings.
  if (!enabled) return

  audienceWindow?.close()

  const displays = screen.getAllDisplays()
  const { display, isSingleDisplayFallback } = pickTargetDisplay(displays, screen.getPrimaryDisplay().id, displayId)

  const win = createAudienceWindow({
    display,
    isSingleDisplayFallback,
    preloadPath: path.join(__dirname, 'preload.cjs'),
    loadFn: loadIntoWindow,
  })
  audienceWindow = win
  audiencePresence.set(true)

  // Late join: send the cached state once, immediately, not via the throttled path.
  win.webContents.once('did-finish-load', () => {
    const latest = scoreBroadcaster?.getLatest()
    if (latest && audienceWindow === win) {
      win.webContents.send(IPC_CHANNELS.AUDIENCE_SCORE_STATE.channel, latest)
    }
  })

  win.on('closed', () => {
    if (audienceWindow === win) {
      audienceWindow = null
      audiencePresence.set(false)
    }
  })
}

// One instance only; a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    applyContentSecurityPolicy()

    // Before any window exists, so none is ever created with Electron's default
    // "File Edit View Window Help" menu bar (visible in windowed mode).
    installAppMenu({ Menu, platform: process.platform, isDev })

    // app-media:// does not need SQLite, so it is registered first: a DB
    // failure (typically a better-sqlite3 ABI mismatch) then only degrades the
    // library, shown in a dialog, instead of every media fetch or the window.
    stageProtocol.registerAppMediaProtocol({ getAllowedRoots: getAppMediaAllowedRoots })

    try {
      const { dbPath, thumbnailsDir } = getLibraryPaths()
      db = libraryDb.openDb(dbPath)
      mediaProtocol.registerMediaProtocol({
        getKnownRoots: () => libraryDb.listRoots(db).map((r) => r.path),
        thumbnailsDir,
      })
      playersDb = playersDbModule.openPlayersDb(getPlayersPaths().dbPath)
      sessionDb = sessionDbModule.openSessionDb(getLibraryPaths().dbPath)
      multiplayerDb = multiplayerDbModule.openMultiplayerDb(getLibraryPaths().dbPath)
    } catch (error) {
      console.error('[main] library/players startup failed -- continuing with those features degraded:', error)
      dialog.showErrorBox(
        tMain('main.startupFailed.title'),
        tMain('main.startupFailed.body', { error: String(error?.message ?? error) }),
      )
    }

    scoreBroadcaster = createScoreStateBroadcaster((state) => {
      audienceWindow?.webContents.send(IPC_CHANNELS.AUDIENCE_SCORE_STATE.channel, state)
    }, 34)

    stopCpuSampling = startSampling(1000, ({ percent }) => {
      latestCpuPercent = percent
    })

    registerIpcHandlers()
    createWindow()
    openAudienceWindow()

    registerDisplayHotplugHandling(() => {
      // The audience window is a satellite of the main window (see the main
      // window's 'closed' handler). With no main window -- macOS, all windows
      // closed, app still running -- plugging a TV in must not conjure up an
      // orphan scoreboard that nothing drives and nothing will ever close.
      if (!mainWindow || mainWindow.isDestroyed()) return
      // A monitor was added/removed -- re-target the audience window rather
      // than leave it on a display that may no longer exist.
      openAudienceWindow()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  stopCpuSampling?.()
})

// Last stop before the process exits (after every window has closed): shut
// down everything that would otherwise outlive the JS that drives it -- native
// capture streams calling back into a torn-down runtime, the scan worker
// thread, and the ffmpeg decoders its loudness pass spawned (OS processes,
// which nothing else would ever kill).
let teardownDone = false
app.on('will-quit', () => {
  if (teardownDone) return
  teardownDone = true
  thumbnailBackfillsRunning.clear()
  stopWatchingLanguages?.()
  try {
    audioIpc?.dispose()
  } catch (error) {
    console.error('[main] audio teardown failed:', error)
  }
  scanner.terminateAllScans().catch(() => {})
})

// Block navigation away from the app's own page: in dev the Vite origin, in
// production exactly dist/index.html (see electron/navigation-policy.cjs).
const isAllowedNavigation = createNavigationGuard({
  isDev,
  devServerUrl: DEV_SERVER_URL,
  indexHtmlPath: path.join(__dirname, '..', 'dist', 'index.html'),
})

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault()
  })

  // Every window (main and audience): never open a new Electron window, and
  // hand only plain web links to the user's browser -- shell.openExternal
  // passes anything else to whatever OS protocol handler claims the scheme.
  contents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch((error) => console.error('[main] openExternal failed:', error))
    }
    return { action: 'deny' }
  })
})

/**
 * Where app-media:// may read from: the configured library roots, the app's
 * own data (avatars, thumbnails, the library DB's neighbours), the bundled
 * fixtures/ and assets/, and anything the user picked in an open dialog this
 * session. Read on every request, so a library root added a moment ago works
 * at once.
 */
function getAppMediaAllowedRoots() {
  const roots = [
    app.getPath('userData'),
    path.join(__dirname, '..', 'fixtures'),
    path.join(__dirname, '..', 'assets'),
    ...userPickedPaths,
  ]
  if (db) {
    try {
      for (const root of libraryDb.listRoots(db)) roots.push(root.path)
    } catch (error) {
      console.error('[main] could not read library roots for app-media://:', error)
    }
  }
  return roots
}

// The policy is set two ways, because neither alone covers both builds:
//  - this response header, which is what applies in dev (http://localhost,
//    where the inline react-refresh preamble and the HMR websocket need a
//    looser policy than production);
//  - a <meta http-equiv="Content-Security-Policy"> in index.html, which is
//    what applies in production: the packaged app loads dist/index.html over
//    file://, and webRequest.onHeadersReceived never sees file:// responses,
//    so this header alone left production with no CSP at all. The meta copy
//    of the production policy sits *after* the place Vite injects its dev
//    preamble, so it does not block that in dev; keep the two in sync.
function applyContentSecurityPolicy() {
  // `aetherstar-media:` (library media) must be in media-src and connect-src
  // too, not just img-src: song previews play video and fetch() audio from it.
  const policy = isDev
    ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: aetherstar-media: app-media:; media-src 'self' aetherstar-media: app-media:; connect-src 'self' ws://localhost:5173 http://localhost:5173 aetherstar-media: app-media:"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: aetherstar-media: app-media:; media-src 'self' aetherstar-media: app-media:; connect-src 'self' aetherstar-media: app-media:"

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
}

function registerIpcHandlers() {
  // Request/response: renderer awaits the result.
  ipcMain.handle(IPC_CHANNELS.APP_GET_INFO.channel, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }))

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_FILE.channel, async (_event, options) => {
    if (!mainWindow) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: [options?.directory ? 'openDirectory' : 'openFile'],
    })
    if (canceled || !filePaths[0]) return null
    // An explicit pick is consent to read it over app-media:// -- a picked
    // file's whole folder, since a chart's audio/video/cover sit beside it.
    userPickedPaths.add(options?.directory ? filePaths[0] : path.dirname(filePaths[0]))
    return filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE.channel, () => mainWindow?.minimize())
  ipcMain.on(IPC_CHANNELS.APP_QUIT.channel, () => app.quit())
  ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE.channel, () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })

  ipcMain.handle(IPC_CHANNELS.WINDOW_GET_DISPLAY_MODE.channel, () => currentDisplayMode())

  // Settings > Graphics > "Windowed mode". Persisted first, so the choice
  // survives even if the window is gone by the time the OS finishes animating.
  ipcMain.handle(IPC_CHANNELS.WINDOW_SET_WINDOWED.channel, (_event, windowed) => {
    const next = windowed === true
    windowMode.writeWindowMode(getWindowModeSettingsPath(), { windowed: next })
    mainWindow?.setFullScreen(!next)
    // Reported as requested rather than read back: setFullScreen is animated on
    // macOS, so isFullScreen() immediately afterwards still describes the old
    // state. The enter/leave-full-screen listeners correct the record when the
    // transition actually lands.
    return { windowed: next, platform: process.platform }
  })

  // Fire-and-forget: renderer -> main, answered on the MAIN_PONG channel.
  ipcMain.on(IPC_CHANNELS.APP_PING.channel, (event, payload) => {
    event.sender.send(IPC_CHANNELS.MAIN_PONG.channel, { received: payload, at: Date.now() })
  })

  registerLibraryIpcHandlers()

  ipcMain.handle(IPC_CHANNELS.STAGE_GET_FIXTURE_CHART_PATH.channel, () =>
    path.join(__dirname, '..', 'fixtures', 'sample-song', 'notes.txt'),
  )

  ipcMain.handle(IPC_CHANNELS.FX_GET_ASSETS_DIR.channel, () => path.join(__dirname, '..', 'assets'))

  registerPlayersIpcHandlers()
  registerAudienceIpcHandlers()
  registerSessionIpcHandlers(sessionDb)
  registerMultiplayerIpcHandlers()
  registerCalibrationIpcHandlers()
  registerLanguageIpc()

  const audioBridge = createNativeBridge() ?? OFFLINE_AUDIO_BRIDGE
  if (audioBridge === OFFLINE_AUDIO_BRIDGE) {
    console.warn('[audio] native/ addon not found -- run `npm run build:native`. Mic Check will show no devices.')
  }
  audioIpc = registerAudioIpcHandlers(audioBridge, () => mainWindow, { isGameplayActive: gameplay.isActive })

  // Live microphone monitoring -- Settings > Audio & Mics > "Karaoke effect".
  // Applied to the addon here, at startup, rather than when a renderer first
  // asks: a capture can open before any window has mounted a settings screen.
  const monitor = registerMicMonitorIpcHandlers(audioBridge, getMicMonitorSettingsPath)
  if (monitor.enabled) {
    console.log(`[audio] microphone monitoring is on at level ${monitor.level}`)
  }
}

// `app-media://` needs a fixed host before the path, or Chromium reads a Unix
// path's first segment ("Users") as the host. Twin of
// src/stage/media/resolveMediaPath.ts's toAppMediaUrl (main cannot import src/).
function toAppMediaUrl(absolutePath) {
  const normalized = absolutePath.replace(/\\/g, '/')
  const pathWithSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  const encoded = encodeURI(pathWithSlash).replace(/#/g, '%23').replace(/\?/g, '%3F')
  return `app-media://media${encoded}`
}

/**
 * The avatar's URL with a `?v=` that changes whenever the file does --
 * avatars are overwritten in place, so without it Chromium keeps showing the
 * cached old picture (see avatar-io.cjs's avatarVersion). app-media:// only
 * reads the URL's path, so the query never reaches the file system.
 */
function toAvatarUrl(avatarPath) {
  const url = toAppMediaUrl(avatarPath)
  const version = avatarIo.avatarVersion(avatarPath)
  return version ? `${url}?v=${encodeURIComponent(version)}` : url
}

function toPlayerProfile(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    avatarUrl: row.avatar_path ? toAvatarUrl(row.avatar_path) : '',
    songsSung: row.songs_sung,
    bestScore: row.best_score,
  }
}

function registerPlayersIpcHandlers() {
  const { avatarsDir } = getPlayersPaths()

  ipcMain.handle(IPC_CHANNELS.PLAYERS_LIST.channel, () => playersDbModule.listPlayers(playersDb).map(toPlayerProfile))

  ipcMain.handle(IPC_CHANNELS.PLAYERS_CREATE.channel, (_event, input) => {
    const created = playersDbModule.createPlayer(playersDb, { name: input.name, color: input.color })
    if (input.avatarDataUrl) {
      const avatarPath = avatarIo.writeAvatarFile(avatarsDir, created.id, input.avatarDataUrl)
      playersDbModule.updatePlayer(playersDb, created.id, { avatar_path: avatarPath })
    }
    const [row] = playersDbModule.listPlayers(playersDb).filter((p) => p.id === created.id)
    return toPlayerProfile(row)
  })

  ipcMain.handle(IPC_CHANNELS.PLAYERS_UPDATE.channel, (_event, input) => {
    const patch = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.color !== undefined) patch.color = input.color
    if (input.avatarDataUrl !== undefined) {
      patch.avatar_path = avatarIo.writeAvatarFile(avatarsDir, input.id, input.avatarDataUrl)
    }
    if (input.songsSung !== undefined) patch.songs_sung = input.songsSung
    if (input.bestScore !== undefined) patch.best_score = input.bestScore
    playersDbModule.updatePlayer(playersDb, input.id, patch)
    const [row] = playersDbModule.listPlayers(playersDb).filter((p) => p.id === input.id)
    return toPlayerProfile(row)
  })

  ipcMain.handle(IPC_CHANNELS.PLAYERS_DELETE.channel, (_event, id) => {
    avatarIo.deleteAvatarFile(avatarsDir, id)
    playersDbModule.deletePlayer(playersDb, id)
  })

  ipcMain.handle(IPC_CHANNELS.PLAYERS_REORDER.channel, (_event, orderedIds) => {
    playersDbModule.reorderPlayers(playersDb, orderedIds)
  })

  ipcMain.handle(IPC_CHANNELS.PLAYERS_READ_IMPORTED_PHOTO.channel, async (_event, filePath) => {
    // Only a file the user just picked in the open dialog (PlayerForm's
    // "Import photo") -- never an arbitrary path a renderer names.
    if (typeof filePath !== 'string' || !stageProtocol.isUnderAnyRoot(path.resolve(filePath), [...userPickedPaths])) {
      throw new Error('players:read-imported-photo only reads a file chosen in the open dialog')
    }
    const buffer = await fs.promises.readFile(filePath)
    const ext = path.extname(filePath).slice(1).toLowerCase() || 'jpeg'
    const mime = ext === 'jpg' ? 'jpeg' : ext
    return `data:image/${mime};base64,${buffer.toString('base64')}`
  })
}

function registerAudienceIpcHandlers() {
  // Fire-and-forget: main window -> main, coalesced by scoreBroadcaster and
  // relayed to the audience window.
  ipcMain.on(IPC_CHANNELS.AUDIENCE_REPORT_SCORE_STATE.channel, (_event, state) => {
    scoreBroadcaster?.report(state)
  })

  ipcMain.handle(IPC_CHANNELS.AUDIENCE_GET_WINDOW_PRESENCE.channel, () => audiencePresence.isOpen())

  ipcMain.handle(IPC_CHANNELS.AUDIENCE_LIST_DISPLAYS.channel, () => {
    const { displayId, enabled } = audienceSettings.readAudienceSettings(getAudienceSettingsPath())
    return {
      displays: screen.getAllDisplays().map(toDisplayInfo),
      selectedDisplayId: displayId,
      enabled,
    }
  })

  ipcMain.handle(IPC_CHANNELS.AUDIENCE_SET_DISPLAY.channel, (_event, displayId) => {
    const current = audienceSettings.readAudienceSettings(getAudienceSettingsPath())
    audienceSettings.writeAudienceSettings(getAudienceSettingsPath(), { ...current, displayId })
    openAudienceWindow()
  })

  ipcMain.handle(IPC_CHANNELS.AUDIENCE_SET_ENABLED.channel, (_event, enabled) => {
    const current = audienceSettings.readAudienceSettings(getAudienceSettingsPath())
    audienceSettings.writeAudienceSettings(getAudienceSettingsPath(), { ...current, enabled })
    if (enabled) {
      openAudienceWindow()
    } else {
      // Close immediately rather than waiting for the next hot-plug/re-open
      // path to notice -- turning the toggle off should feel instant.
      audienceWindow?.close()
    }
  })
}

function registerMultiplayerIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.MULTIPLAYER_LIST_MIC_SLOTS.channel, () => multiplayerDbModule.listMicSlots(multiplayerDb))

  ipcMain.handle(IPC_CHANNELS.MULTIPLAYER_SAVE_MIC_SLOT.channel, (_event, slot) =>
    multiplayerDbModule.saveMicSlot(multiplayerDb, slot),
  )

  ipcMain.handle(IPC_CHANNELS.MULTIPLAYER_CLEAR_MIC_SLOT.channel, (_event, slotNumber) =>
    multiplayerDbModule.clearMicSlot(multiplayerDb, slotNumber),
  )

  ipcMain.handle(IPC_CHANNELS.MULTIPLAYER_GET_CPU_USAGE.channel, () => ({ percent: latestCpuPercent }))
}

// Language packs: scanned once at startup (so a broken line is reported in the
// log straight away), then re-read on every request. The user folder is
// created on first run with a README, and both folders are watched so a
// translator sees a saved file without restarting.
function registerLanguageIpc() {
  const { catalog, translator } = getLanguageServices()
  try {
    catalog.ensureUserDir()
  } catch (error) {
    console.warn('[i18n] could not create the user languages folder:', error)
  }
  try {
    const languages = catalog.listLanguages()
    console.log(`[i18n] ${languages.length} language(s): ${languages.map((l) => `${l.code} (${l.source})`).join(', ')}`)
  } catch (error) {
    console.warn('[i18n] language scan failed:', error)
  }
  registerI18nIpcHandlers({ ipcMain, shell, catalog, translator })
  stopWatchingLanguages = watchLanguageFolders({
    dirs: [catalog.userDir, catalog.bundledDir],
    onChange: () => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.I18N_LANGUAGES_CHANGED.channel)
        }
      }
    },
  })
}

function registerCalibrationIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.CALIBRATION_GET.channel, () => calibrationSettings.readCalibrationSettings(getCalibrationSettingsPath()))

  ipcMain.handle(IPC_CHANNELS.CALIBRATION_SET.channel, (_event, settings) => {
    calibrationSettings.writeCalibrationSettings(getCalibrationSettingsPath(), settings)
    return settings
  })
}

function registerLibraryIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.LIBRARY_ADD_ROOT.channel, (_event, rootPath) => {
    libraryDb.addRoot(db, rootPath)
    return startLibraryScan(rootPath)
  })

  ipcMain.handle(IPC_CHANNELS.LIBRARY_REMOVE_ROOT.channel, (_event, rootPath) => {
    thumbnailBackfillsRunning.delete(rootPath)
    libraryDb.removeRoot(db, rootPath)
  })

  ipcMain.handle(IPC_CHANNELS.LIBRARY_LIST_ROOTS.channel, () => libraryDb.listRoots(db))

  ipcMain.handle(IPC_CHANNELS.LIBRARY_RESCAN.channel, (_event, rootPath) => startLibraryScan(rootPath))

  ipcMain.handle(IPC_CHANNELS.LIBRARY_SEARCH.channel, (_event, filters) => libraryDb.search(db, filters))

  ipcMain.handle(IPC_CHANNELS.LIBRARY_GET_SONG.channel, (_event, songPath) => libraryDb.getSong(db, songPath))

  ipcMain.handle(IPC_CHANNELS.LIBRARY_LIST_SCAN_ERRORS.channel, () => libraryDb.listScanErrors(db))

  ipcMain.handle(IPC_CHANNELS.LIBRARY_LIST_FAVORITES.channel, () => (db ? libraryDb.listFavorites(db) : []))

  ipcMain.handle(IPC_CHANNELS.LIBRARY_SET_FAVORITE.channel, (_event, songPath, favorite) =>
    db ? libraryDb.setFavorite(db, songPath, favorite === true) : false,
  )

  ipcMain.handle(IPC_CHANNELS.LIBRARY_RECORD_PLAY.channel, (_event, songPath, mode) =>
    db ? libraryDb.recordPlay(db, { songPath, mode }) : false,
  )

  // A measurement the renderer made itself (decode + meter) on a machine where
  // the scan's ffmpeg pass could not. Validated here, and only ever *fills* a
  // missing measurement: an ffmpeg one (oversampled true peak) is better and
  // is never overwritten. The renderer may name the folder with forward
  // slashes (recovered from a media URL) while a Windows index is keyed with
  // backslashes, so both spellings are tried. Resolves true when stored.
  ipcMain.handle(IPC_CHANNELS.LIBRARY_SET_LOUDNESS.channel, (_event, songPath, measurement) => {
    if (!db || typeof songPath !== 'string' || songPath.length === 0) return false
    const clean = libraryDb.sanitizeLoudnessMeasurement(measurement)
    if (!clean) return false
    const candidates = /^[A-Za-z]:[/\x5c]/.test(songPath) ? [songPath, songPath.split('/').join(path.win32.sep)] : [songPath]
    for (const candidate of new Set(candidates)) {
      const song = libraryDb.getSong(db, candidate)
      if (!song) continue
      if (song.loudnessLufs !== null && song.loudnessLufs !== undefined) return false
      libraryDb.updateLoudness(db, candidate, clean)
      return true
    }
    return false
  })

  registerGameplayActivityIpc()
}

/**
 * window.api.library.setGameplayActive(active). While a song is being sung:
 * scans pause between batches and start no new loudness decode
 * (scanner.setGameplayActive), the thumbnail backfill waits
 * (gameplay.whenIdle), and audio-device polling stops (the device watcher's
 * isPaused). When it ends, all of them resume and devices are re-enumerated
 * at once, so a mic unplugged mid-song is noticed straight away.
 */
function registerGameplayActivityIpc() {
  gameplay.onChange((active) => {
    scanner.setGameplayActive(active)
    if (!active) audioIpc?.pollDevicesNow?.()
  })

  /** webContents ids already wired to reset the flag when their page goes away. */
  const watchedSenders = new Set()

  ipcMain.on(IPC_CHANNELS.LIBRARY_SET_GAMEPLAY_ACTIVE.channel, (event, active) => {
    gameplay.set(active === true)

    // A renderer that reloads, crashes or closes mid-song never gets to say
    // "false" -- without this, every scan would stay paused until restart.
    const sender = event.sender
    if (!sender || watchedSenders.has(sender.id)) return
    watchedSenders.add(sender.id)
    const reset = () => gameplay.set(false)
    sender.on('render-process-gone', reset)
    sender.on('did-navigate', reset)
    sender.once('destroyed', () => {
      watchedSenders.delete(sender.id)
      reset()
    })
  })
}

function startLibraryScan(rootPath) {
  const { dbPath, thumbnailsDir } = getLibraryPaths()
  return scanner
    .startScan(rootPath, {
      dbPath,
      thumbnailsDir,
      onProgress: (progress) => {
        const win = mainWindow
        if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
        win.webContents.send(IPC_CHANNELS.LIBRARY_SCAN_PROGRESS.channel, progress)
      },
    })
    .then((result) => {
      // Deliberately not awaited: the scan's caller gets its answer now, and
      // covers fill in behind it.
      backfillMissingThumbnails(rootPath, thumbnailsDir).catch((error) => {
        console.error('[library] thumbnail backfill failed:', error)
      })
      return result
    })
}

// The scan worker leaves thumbnail_path null (nativeImage is main-thread
// only), so thumbnails are made here after each scan, paused while a song is
// sung (electron/library/thumbnail-backfill.cjs).
async function backfillMissingThumbnails(rootPath, thumbnailsDir) {
  if (!db || thumbnailBackfillsRunning.has(rootPath)) return
  thumbnailBackfillsRunning.add(rootPath)
  try {
    const pending = libraryDb.listSongsMissingThumbnail(db, rootPath)
    await runThumbnailBackfill({
      pending,
      thumbnailsDir,
      encode: (coverPath) => encodeThumbnail(nativeImage, coverPath),
      commit: (entries) => {
        if (db) libraryDb.updateThumbnailPaths(db, entries)
      },
      whenIdle: () => gameplay.whenIdle(),
      // Cleared on quit (will-quit), and dropped if the root is removed.
      isCancelled: () => !thumbnailBackfillsRunning.has(rootPath) || !db,
    })
  } finally {
    thumbnailBackfillsRunning.delete(rootPath)
  }
}
