// Wires the live-monitoring ("karaoke effect") setting to the two things that
// have to agree about it: the JSON file it is persisted in, and the native
// addon that acts on it.
//
// Kept out of ./ipc-handlers.cjs because this pair of handlers needs the
// userData path, which that module deliberately knows nothing about -- the
// same split main.cjs already makes for calibration and window mode.
const { ipcMain } = require('electron')
const { IPC_CHANNELS } = require('../ipc-registry.cjs')
const { readMicMonitorSettings, writeMicMonitorSettings } = require('./monitor-settings.cjs')

/**
 * @param bridge the AudioBridge (or the offline stand-in) -- only `setMicMonitoring` is used.
 * @param getSettingsPath a thunk, because `app.getPath('userData')` is not
 *   available at module load time.
 * @returns the setting that was applied at startup, so the caller can log it.
 */
function registerMicMonitorIpcHandlers(bridge, getSettingsPath) {
  function apply(settings) {
    bridge.setMicMonitoring(settings.enabled, settings.level)
    return settings
  }

  // Applied here, at registration, rather than when a renderer first asks:
  // monitoring is a property of the native capture path, and a capture can be
  // opened before any window has mounted a settings screen. Waiting for the
  // renderer would mean the first song after a restart came up unmonitored --
  // or, worse, that a user who had turned it *off* got one song of it back.
  const startupSettings = apply(readMicMonitorSettings(getSettingsPath()))

  ipcMain.handle(IPC_CHANNELS.AUDIO_GET_MIC_MONITOR.channel, () => readMicMonitorSettings(getSettingsPath()))

  ipcMain.handle(IPC_CHANNELS.AUDIO_SET_MIC_MONITOR.channel, (_event, settings) =>
    // Persist first, then apply what was *actually* persisted, and return that
    // -- so a renderer that sent an out-of-range level sees the clamped value
    // rather than holding a slider position the audio path is not honouring.
    apply(writeMicMonitorSettings(getSettingsPath(), settings)),
  )

  return startupSettings
}

module.exports = { registerMicMonitorIpcHandlers }
