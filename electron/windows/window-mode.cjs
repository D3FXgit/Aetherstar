// Persists whether the main window runs full screen (the default for a TV app)
// or windowed. Both exits -- macOS's green button and Settings > Graphics >
// "Windowed mode" -- are remembered here; Escape is not one (it is Back). Main-
// process JSON because it is needed before any renderer exists.
const fs = require('node:fs')

// Full screen unless the user has said otherwise -- `windowed: false`.
const DEFAULT_WINDOW_MODE = { windowed: false }

function readWindowMode(settingsPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    // Anything that isn't an explicit `true` means full screen, so a truncated
    // or hand-edited file degrades to the default rather than to `undefined`.
    return { windowed: parsed.windowed === true }
  } catch {
    return { ...DEFAULT_WINDOW_MODE }
  }
}

/**
 * Whether a full-screen transition is the user's choice, and so worth
 * remembering for the next launch.
 *
 * Not every `leave-full-screen` is someone leaving full screen. macOS tears a
 * full-screen *space* down when its window closes, so a clean quit fires the
 * event on the way out -- and because that fires before the process ends, the
 * app would write `{ windowed: true }` as its last act of every session and
 * then start windowed forever after, with the user never having asked for it.
 * That is the "full screen doesn't work any more at all" failure: the default
 * is not broken, it has been overwritten by the app's own shutdown.
 *
 * So a transition counts only while the window is a live thing the user is
 * still looking at. Anything during teardown describes the OS reclaiming a
 * space, not a preference.
 */
function isUserDrivenModeChange({ quitting, windowDestroyed } = {}) {
  return quitting !== true && windowDestroyed !== true
}

function writeWindowMode(settingsPath, mode) {
  fs.writeFileSync(settingsPath, JSON.stringify({ windowed: mode.windowed === true }))
}

module.exports = { readWindowMode, writeWindowMode, isUserDrivenModeChange, DEFAULT_WINDOW_MODE }
