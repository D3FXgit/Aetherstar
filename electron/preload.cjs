const { contextBridge, ipcRenderer } = require('electron')

// A sandboxed preload can require only 'electron' -- any other require()
// silently aborts the whole script and leaves window.api undefined. So this
// table duplicates electron/ipc-registry.cjs; ipc-registry.test.cjs asserts the
// two stay identical.
const IPC_CHANNELS = {
  APP_GET_INFO: 'app:get-info',
  DIALOG_OPEN_FILE: 'dialog:open-file',
  WINDOW_MINIMIZE: 'window:minimize',
  APP_QUIT: 'app:quit',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_GET_DISPLAY_MODE: 'window:get-display-mode',
  WINDOW_SET_WINDOWED: 'window:set-windowed',
  WINDOW_DISPLAY_MODE_CHANGED: 'window:display-mode-changed',
  APP_PING: 'app:ping',
  MAIN_PONG: 'main:pong',

  LIBRARY_ADD_ROOT: 'library:add-root',
  LIBRARY_REMOVE_ROOT: 'library:remove-root',
  LIBRARY_LIST_ROOTS: 'library:list-roots',
  LIBRARY_RESCAN: 'library:rescan',
  LIBRARY_SEARCH: 'library:search',
  LIBRARY_GET_SONG: 'library:get-song',
  LIBRARY_LIST_SCAN_ERRORS: 'library:list-scan-errors',
  LIBRARY_SCAN_PROGRESS: 'library:scan-progress',
  LIBRARY_SET_GAMEPLAY_ACTIVE: 'library:set-gameplay-active',
  LIBRARY_SET_LOUDNESS: 'library:set-loudness',
  LIBRARY_LIST_FAVORITES: 'library:list-favorites',
  LIBRARY_SET_FAVORITE: 'library:set-favorite',
  LIBRARY_RECORD_PLAY: 'library:record-play',

  STAGE_GET_FIXTURE_CHART_PATH: 'stage:get-fixture-chart-path',

  PLAYERS_LIST: 'players:list',
  PLAYERS_CREATE: 'players:create',
  PLAYERS_UPDATE: 'players:update',
  PLAYERS_DELETE: 'players:delete',
  PLAYERS_REORDER: 'players:reorder',
  PLAYERS_READ_IMPORTED_PHOTO: 'players:read-imported-photo',

  AUDIO_LIST_DEVICES: 'audio:list-devices',
  AUDIO_REQUEST_PERMISSION: 'audio:request-permission',
  AUDIO_GET_PERMISSION_STATUS: 'audio:get-permission-status',
  AUDIO_START_CAPTURE: 'audio:start-capture',
  AUDIO_STOP_CAPTURE: 'audio:stop-capture',
  AUDIO_PITCH_BATCH: 'audio:pitch-batch',
  AUDIO_DEVICE_LIST_CHANGED: 'audio:device-list-changed',
  AUDIO_START_RAW_SCOPE: 'audio:start-raw-scope',
  AUDIO_STOP_RAW_SCOPE: 'audio:stop-raw-scope',
  AUDIO_RAW_SCOPE_CHUNK: 'audio:raw-scope-chunk',
  AUDIO_GET_MIC_MONITOR: 'audio:get-mic-monitor',
  AUDIO_SET_MIC_MONITOR: 'audio:set-mic-monitor',

  AUDIENCE_REPORT_SCORE_STATE: 'audience:report-score-state',
  AUDIENCE_SCORE_STATE: 'audience:score-state',
  AUDIENCE_LIST_DISPLAYS: 'audience:list-displays',
  AUDIENCE_SET_DISPLAY: 'audience:set-display',
  AUDIENCE_SET_ENABLED: 'audience:set-enabled',
  AUDIENCE_GET_WINDOW_PRESENCE: 'audience:get-window-presence',
  AUDIENCE_WINDOW_PRESENCE: 'audience:window-presence',

  FX_GET_ASSETS_DIR: 'fx:get-assets-dir',

  SESSION_START: 'session:start',
  SESSION_RECORD_ENTRY: 'session:record-entry',
  SESSION_LIST_LEADERBOARD: 'session:list-leaderboard',

  MULTIPLAYER_LIST_MIC_SLOTS: 'multiplayer:list-mic-slots',
  MULTIPLAYER_SAVE_MIC_SLOT: 'multiplayer:save-mic-slot',
  MULTIPLAYER_CLEAR_MIC_SLOT: 'multiplayer:clear-mic-slot',
  MULTIPLAYER_GET_CPU_USAGE: 'multiplayer:get-cpu-usage',

  CALIBRATION_GET: 'calibration:get',
  CALIBRATION_SET: 'calibration:set',

  I18N_LIST_LANGUAGES: 'i18n:list-languages',
  I18N_LOAD_LANGUAGE: 'i18n:load-language',
  I18N_OPEN_LANGUAGES_FOLDER: 'i18n:open-languages-folder',
  I18N_LANGUAGES_CHANGED: 'i18n:languages-changed',
  I18N_SET_ACTIVE_LANGUAGE: 'i18n:set-active-language',
}

// Pure, so it is testable without a DOM; `location` is only read (guarded)
// at the getWindowRole() call site below.
function parseWindowRole(search) {
  const params = new URLSearchParams(search || '')
  return params.get('window') === 'audience' ? 'audience' : 'main'
}

// The ONLY surface the renderer gets. Keep it small and explicit -- never
// expose ipcRenderer itself, and never accept a channel name from the renderer.
const api = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO),
  getWindowRole: () => parseWindowRole(globalThis.location ? globalThis.location.search : ''),
  openFile: (options) =>
    options === undefined
      ? ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE)
      : ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FILE, options),
  minimize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
  quit: () => ipcRenderer.send(IPC_CHANNELS.APP_QUIT),
  toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),

  /**
   * Full screen vs. windowed for the main window (Settings > Graphics >
   * "Windowed mode"). Separate from minimize/toggleMaximize above because it is
   * a *persisted* choice, not a momentary window command: the main process
   * remembers it across restarts, and reports it back here whenever the OS
   * changes it -- notably the macOS green button, which is the platform's own
   * way out of full screen and must leave the app agreeing with the screen.
   */
  window: {
    getDisplayMode: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_GET_DISPLAY_MODE),
    setWindowed: (windowed) => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SET_WINDOWED, windowed),

    /**
     * Subscribe to full-screen/windowed changes made outside this app's UI.
     * @returns {() => void} unsubscribe -- call it on component unmount.
     */
    onDisplayModeChanged: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.WINDOW_DISPLAY_MODE_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_DISPLAY_MODE_CHANGED, listener)
    },
  },

  ping: (payload) => ipcRenderer.send(IPC_CHANNELS.APP_PING, payload),

  /**
   * Subscribe to pongs from the main process.
   * @returns {() => void} unsubscribe -- call it on component unmount.
   */
  onPong: (callback) => {
    const listener = (_event, data) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.MAIN_PONG, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.MAIN_PONG, listener)
  },

  library: {
    addRoot: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_ADD_ROOT, rootPath),
    removeRoot: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_REMOVE_ROOT, rootPath),
    listRoots: () => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_LIST_ROOTS),
    rescan: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_RESCAN, rootPath),
    search: (filters) => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_SEARCH, filters),
    getSong: (songPath) => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_GET_SONG, songPath),
    listScanErrors: () => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_LIST_SCAN_ERRORS),

    /**
     * Tell the main process a song is (true) or is no longer (false) being
     * sung. While true, library scans and loudness analysis pause, thumbnail
     * backfill waits and audio-device polling stops, so none of them compete
     * with live pitch judging. Fire-and-forget; always send `false` when the
     * song ends or is abandoned.
     */
    setGameplayActive: (active) => ipcRenderer.send(IPC_CHANNELS.LIBRARY_SET_GAMEPLAY_ACTIVE, active === true),

    /**
     * Store a loudness measurement the renderer made itself (decode + meter,
     * src/audio/songGain.ts) in the library index, so it survives a restart
     * and every window sees it. The main process validates both numbers and
     * ignores anything that isn't a finite measurement.
     */
    setLoudness: (songPath, measurement) =>
      ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_SET_LOUDNESS, songPath, {
        integratedLufs: measurement ? measurement.integratedLufs : undefined,
        truePeakDbtp: measurement ? measurement.truePeakDbtp : undefined,
      }),

    /** Song folder paths the user has starred. */
    listFavorites: () => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_LIST_FAVORITES),
    setFavorite: (songPath, favorite) =>
      ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_SET_FAVORITE, String(songPath), favorite === true),
    /** Count one play of a song (sung or jukebox) for the history sorts. */
    recordPlay: (songPath, mode) =>
      ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_RECORD_PLAY, String(songPath), typeof mode === 'string' ? mode : null),

    /**
     * Subscribe to scan-progress events.
     * @returns {() => void} unsubscribe -- call it on component unmount.
     */
    onScanProgress: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.LIBRARY_SCAN_PROGRESS, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.LIBRARY_SCAN_PROGRESS, listener)
    },
  },

  stage: {
    getFixtureChartPath: () => ipcRenderer.invoke(IPC_CHANNELS.STAGE_GET_FIXTURE_CHART_PATH),
  },

  players: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.PLAYERS_LIST),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.PLAYERS_CREATE, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.PLAYERS_UPDATE, input),
    delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.PLAYERS_DELETE, id),
    reorder: (orderedIds) => ipcRenderer.invoke(IPC_CHANNELS.PLAYERS_REORDER, orderedIds),
    readImportedPhoto: (path) => ipcRenderer.invoke(IPC_CHANNELS.PLAYERS_READ_IMPORTED_PHOTO, path),
  },

  audio: {
    listDevices: () => ipcRenderer.invoke(IPC_CHANNELS.AUDIO_LIST_DEVICES),
    requestPermission: () => ipcRenderer.invoke(IPC_CHANNELS.AUDIO_REQUEST_PERMISSION),
    getPermissionStatus: () => ipcRenderer.invoke(IPC_CHANNELS.AUDIO_GET_PERMISSION_STATUS),
    startCapture: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.AUDIO_START_CAPTURE, deviceId),
    stopCapture: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.AUDIO_STOP_CAPTURE, deviceId),
    startRawScope: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.AUDIO_START_RAW_SCOPE, deviceId),
    stopRawScope: (deviceId) => ipcRenderer.invoke(IPC_CHANNELS.AUDIO_STOP_RAW_SCOPE, deviceId),

    /**
     * Live microphone monitoring -- the "karaoke effect": the singers' voices
     * come back out of the speakers alongside the song. Persisted in the main
     * process and applied by the native addon, so this is a read/write of that
     * state, not a renderer audio graph.
     */
    getMicMonitor: () => ipcRenderer.invoke(IPC_CHANNELS.AUDIO_GET_MIC_MONITOR),
    /** Returns the normalised setting the main process actually stored. */
    setMicMonitor: (settings) => ipcRenderer.invoke(IPC_CHANNELS.AUDIO_SET_MIC_MONITOR, settings),

    /**
     * Subscribe to batched pitch-sample events for any active capture.
     * @returns {() => void} unsubscribe -- call it on component unmount.
     */
    onPitchBatch: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AUDIO_PITCH_BATCH, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_PITCH_BATCH, listener)
    },

    /**
     * Subscribe to device add/remove/disconnect events.
     * @returns {() => void} unsubscribe -- call it on component unmount.
     */
    onDeviceListChanged: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AUDIO_DEVICE_LIST_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_DEVICE_LIST_CHANGED, listener)
    },

    /**
     * Subscribe to raw-waveform chunks (lab-only, only emits between startRawScope/stopRawScope).
     * @returns {() => void} unsubscribe -- call it on component unmount.
     */
    onRawScopeChunk: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AUDIO_RAW_SCOPE_CHUNK, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_RAW_SCOPE_CHUNK, listener)
    },
  },

  audience: {
    reportScoreState: (state) => ipcRenderer.send(IPC_CHANNELS.AUDIENCE_REPORT_SCORE_STATE, state),
    listDisplays: () => ipcRenderer.invoke(IPC_CHANNELS.AUDIENCE_LIST_DISPLAYS),
    setDisplay: (displayId) => ipcRenderer.invoke(IPC_CHANNELS.AUDIENCE_SET_DISPLAY, displayId),
    setEnabled: (enabled) => ipcRenderer.invoke(IPC_CHANNELS.AUDIENCE_SET_ENABLED, enabled),

    /**
     * Subscribe to the throttled score-state broadcast (audience window only).
     * @returns {() => void} unsubscribe -- call it on component unmount.
     */
    onScoreState: (callback) => {
      const listener = (_event, data) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.AUDIENCE_SCORE_STATE, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.AUDIENCE_SCORE_STATE, listener)
    },

    /**
     * Subscribe to whether an audience window is open. The callback fires once
     * with the current state shortly after subscribing (an invoke round trip),
     * then on every open/close. A push that arrives before that first answer
     * wins -- it is newer.
     * @returns {() => void} unsubscribe -- call it on component unmount.
     */
    onWindowPresence: (callback) => {
      let subscribed = true
      let pushed = false
      const listener = (_event, open) => {
        pushed = true
        callback(open === true)
      }
      ipcRenderer.on(IPC_CHANNELS.AUDIENCE_WINDOW_PRESENCE, listener)
      Promise.resolve(ipcRenderer.invoke(IPC_CHANNELS.AUDIENCE_GET_WINDOW_PRESENCE))
        .then((open) => {
          if (subscribed && !pushed) callback(open === true)
        })
        .catch(() => {})
      return () => {
        subscribed = false
        ipcRenderer.removeListener(IPC_CHANNELS.AUDIENCE_WINDOW_PRESENCE, listener)
      }
    },
  },

  fx: {
    getAssetsDir: () => ipcRenderer.invoke(IPC_CHANNELS.FX_GET_ASSETS_DIR),
  },

  session: {
    start: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_START),
    recordEntry: (entry) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_RECORD_ENTRY, entry),
    listLeaderboard: () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST_LEADERBOARD),
    // Same channel, with a { songPath, difficulty?, limit? } query: one song's highscore table.
    listSongHighscores: (query) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST_LEADERBOARD, query),
  },

  multiplayer: {
    listMicSlots: () => ipcRenderer.invoke(IPC_CHANNELS.MULTIPLAYER_LIST_MIC_SLOTS),
    saveMicSlot: (slot) => ipcRenderer.invoke(IPC_CHANNELS.MULTIPLAYER_SAVE_MIC_SLOT, slot),
    clearMicSlot: (slotNumber) => ipcRenderer.invoke(IPC_CHANNELS.MULTIPLAYER_CLEAR_MIC_SLOT, slotNumber),
    getCpuUsage: () => ipcRenderer.invoke(IPC_CHANNELS.MULTIPLAYER_GET_CPU_USAGE),
  },

  calibration: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.CALIBRATION_GET),
    set: (settings) => ipcRenderer.invoke(IPC_CHANNELS.CALIBRATION_SET, settings),
  },

  /**
   * Language packs: one .txt file per language, from the bundled languages/
   * folder and the user's own <userData>/languages folder (src/i18n).
   */
  i18n: {
    listLanguages: () => ipcRenderer.invoke(IPC_CHANNELS.I18N_LIST_LANGUAGES),
    /** Only a code crosses over -- the main process validates it and never takes a path. */
    loadLanguage: (code) => ipcRenderer.invoke(IPC_CHANNELS.I18N_LOAD_LANGUAGE, String(code)),
    openLanguagesFolder: () => ipcRenderer.invoke(IPC_CHANNELS.I18N_OPEN_LANGUAGES_FOLDER),
    /** Tell main which language is on screen, for its own native dialogs. */
    setActiveLanguage: (code) => ipcRenderer.send(IPC_CHANNELS.I18N_SET_ACTIVE_LANGUAGE, String(code)),

    /**
     * Subscribe to "a language file was added, changed or removed".
     * @returns {() => void} unsubscribe
     */
    onLanguagesChanged: (callback) => {
      const listener = () => callback()
      ipcRenderer.on(IPC_CHANNELS.I18N_LANGUAGES_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.I18N_LANGUAGES_CHANGED, listener)
    },
  },
}

contextBridge.exposeInMainWorld('api', api)

module.exports = { parseWindowRole }
