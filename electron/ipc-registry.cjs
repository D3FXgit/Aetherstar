// Single source of truth for IPC channel names, consumed by both preload.cjs
// (renderer surface) and main.cjs (handler registration). No codegen step —
// this file and ipc-registry.d.ts are kept in sync by hand and by the
// electron/__tests__/ipc-registry.test.cjs consistency check.
const IPC_CHANNELS = {
  APP_GET_INFO: { channel: 'app:get-info', direction: 'invoke' },
  DIALOG_OPEN_FILE: { channel: 'dialog:open-file', direction: 'invoke' },
  WINDOW_MINIMIZE: { channel: 'window:minimize', direction: 'invoke' },
  APP_QUIT: { channel: 'app:quit', direction: 'send' },
  WINDOW_TOGGLE_MAXIMIZE: { channel: 'window:toggle-maximize', direction: 'invoke' },
  WINDOW_GET_DISPLAY_MODE: { channel: 'window:get-display-mode', direction: 'invoke' },
  WINDOW_SET_WINDOWED: { channel: 'window:set-windowed', direction: 'invoke' },
  WINDOW_DISPLAY_MODE_CHANGED: { channel: 'window:display-mode-changed', direction: 'send' },
  APP_PING: { channel: 'app:ping', direction: 'send' },
  MAIN_PONG: { channel: 'main:pong', direction: 'send' },

  LIBRARY_ADD_ROOT: { channel: 'library:add-root', direction: 'invoke' },
  LIBRARY_REMOVE_ROOT: { channel: 'library:remove-root', direction: 'invoke' },
  LIBRARY_LIST_ROOTS: { channel: 'library:list-roots', direction: 'invoke' },
  LIBRARY_RESCAN: { channel: 'library:rescan', direction: 'invoke' },
  LIBRARY_SEARCH: { channel: 'library:search', direction: 'invoke' },
  LIBRARY_GET_SONG: { channel: 'library:get-song', direction: 'invoke' },
  LIBRARY_LIST_SCAN_ERRORS: { channel: 'library:list-scan-errors', direction: 'invoke' },
  LIBRARY_SCAN_PROGRESS: { channel: 'library:scan-progress', direction: 'send' },
  // Renderer -> main, fire-and-forget: a song is (or is no longer) being sung,
  // so background work (scans, loudness decoding, thumbnail backfill, device
  // polling) holds still until it ends.
  LIBRARY_SET_GAMEPLAY_ACTIVE: { channel: 'library:set-gameplay-active', direction: 'send' },
  // Renderer -> main: persist a loudness measurement the renderer made itself
  // (src/audio/songGain.ts) into the index, for machines without ffmpeg.
  LIBRARY_SET_LOUDNESS: { channel: 'library:set-loudness', direction: 'invoke' },
  LIBRARY_LIST_FAVORITES: { channel: 'library:list-favorites', direction: 'invoke' },
  LIBRARY_SET_FAVORITE: { channel: 'library:set-favorite', direction: 'invoke' },
  // One row per played song (sung or jukebox), for the history sorts.
  LIBRARY_RECORD_PLAY: { channel: 'library:record-play', direction: 'invoke' },

  STAGE_GET_FIXTURE_CHART_PATH: { channel: 'stage:get-fixture-chart-path', direction: 'invoke' },

  PLAYERS_LIST: { channel: 'players:list', direction: 'invoke' },
  PLAYERS_CREATE: { channel: 'players:create', direction: 'invoke' },
  PLAYERS_UPDATE: { channel: 'players:update', direction: 'invoke' },
  PLAYERS_DELETE: { channel: 'players:delete', direction: 'invoke' },
  PLAYERS_REORDER: { channel: 'players:reorder', direction: 'invoke' },
  PLAYERS_READ_IMPORTED_PHOTO: { channel: 'players:read-imported-photo', direction: 'invoke' },

  AUDIO_LIST_DEVICES: { channel: 'audio:list-devices', direction: 'invoke' },
  AUDIO_REQUEST_PERMISSION: { channel: 'audio:request-permission', direction: 'invoke' },
  AUDIO_GET_PERMISSION_STATUS: { channel: 'audio:get-permission-status', direction: 'invoke' },
  AUDIO_START_CAPTURE: { channel: 'audio:start-capture', direction: 'invoke' },
  AUDIO_STOP_CAPTURE: { channel: 'audio:stop-capture', direction: 'invoke' },
  AUDIO_PITCH_BATCH: { channel: 'audio:pitch-batch', direction: 'send' },
  AUDIO_DEVICE_LIST_CHANGED: { channel: 'audio:device-list-changed', direction: 'send' },
  AUDIO_START_RAW_SCOPE: { channel: 'audio:start-raw-scope', direction: 'invoke' },
  AUDIO_STOP_RAW_SCOPE: { channel: 'audio:stop-raw-scope', direction: 'invoke' },
  AUDIO_RAW_SCOPE_CHUNK: { channel: 'audio:raw-scope-chunk', direction: 'send' },
  AUDIO_GET_MIC_MONITOR: { channel: 'audio:get-mic-monitor', direction: 'invoke' },
  AUDIO_SET_MIC_MONITOR: { channel: 'audio:set-mic-monitor', direction: 'invoke' },

  AUDIENCE_REPORT_SCORE_STATE: { channel: 'audience:report-score-state', direction: 'send' },
  AUDIENCE_SCORE_STATE: { channel: 'audience:score-state', direction: 'send' },
  AUDIENCE_LIST_DISPLAYS: { channel: 'audience:list-displays', direction: 'invoke' },
  AUDIENCE_SET_DISPLAY: { channel: 'audience:set-display', direction: 'invoke' },
  AUDIENCE_SET_ENABLED: { channel: 'audience:set-enabled', direction: 'invoke' },
  // Whether an audience window currently exists: pulled once on subscribe,
  // then pushed to the main window on every open/close.
  AUDIENCE_GET_WINDOW_PRESENCE: { channel: 'audience:get-window-presence', direction: 'invoke' },
  AUDIENCE_WINDOW_PRESENCE: { channel: 'audience:window-presence', direction: 'send' },

  FX_GET_ASSETS_DIR: { channel: 'fx:get-assets-dir', direction: 'invoke' },

  SESSION_START: { channel: 'session:start', direction: 'invoke' },
  SESSION_RECORD_ENTRY: { channel: 'session:record-entry', direction: 'invoke' },
  SESSION_LIST_LEADERBOARD: { channel: 'session:list-leaderboard', direction: 'invoke' },

  MULTIPLAYER_LIST_MIC_SLOTS: { channel: 'multiplayer:list-mic-slots', direction: 'invoke' },
  MULTIPLAYER_SAVE_MIC_SLOT: { channel: 'multiplayer:save-mic-slot', direction: 'invoke' },
  MULTIPLAYER_CLEAR_MIC_SLOT: { channel: 'multiplayer:clear-mic-slot', direction: 'invoke' },
  MULTIPLAYER_GET_CPU_USAGE: { channel: 'multiplayer:get-cpu-usage', direction: 'invoke' },

  CALIBRATION_GET: { channel: 'calibration:get', direction: 'invoke' },
  CALIBRATION_SET: { channel: 'calibration:set', direction: 'invoke' },

  // Language packs (electron/i18n/): plain .txt files in the bundled
  // languages/ folder and <userData>/languages. Only a language CODE crosses
  // this boundary, never a path.
  I18N_LIST_LANGUAGES: { channel: 'i18n:list-languages', direction: 'invoke' },
  I18N_LOAD_LANGUAGE: { channel: 'i18n:load-language', direction: 'invoke' },
  I18N_OPEN_LANGUAGES_FOLDER: { channel: 'i18n:open-languages-folder', direction: 'invoke' },
  // Main -> renderer: a language file was added, changed or removed.
  I18N_LANGUAGES_CHANGED: { channel: 'i18n:languages-changed', direction: 'send' },
  // Renderer -> main, fire-and-forget: the language now on screen, so native
  // dialogs the main process shows use it too.
  I18N_SET_ACTIVE_LANGUAGE: { channel: 'i18n:set-active-language', direction: 'send' },
}

module.exports = { IPC_CHANNELS }
