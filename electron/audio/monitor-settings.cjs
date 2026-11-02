// Persists the live-monitoring ("karaoke effect") switch and level as main-
// process JSON, not a renderer preference: the native addon acts on it and must
// be configured before (and independently of) any window.
const fs = require('node:fs')

/**
 * Off, at a middling level.
 *
 * Off is not a stylistic default: a karaoke app that amplifies the room the
 * first time it is launched, without being asked, is a bad first run and a
 * feedback risk in a room nobody has set up yet.
 *
 * The level still has a real default so that switching it on, on its own, does
 * something audible -- a toggle that appears to do nothing because the level
 * happens to be at zero is worse than no toggle. 0.5 maps (via the native
 * square taper) to well below the song, which is exactly "a bit quieter".
 */
const DEFAULT_MIC_MONITOR_SETTINGS = { enabled: false, level: 0.5 }

/** The slider's range. The *gain* ceiling that actually matters for feedback is enforced in Rust. */
const MIN_LEVEL = 0
const MAX_LEVEL = 1

function clampLevel(value) {
  const level = Number(value)
  if (!Number.isFinite(level)) return DEFAULT_MIC_MONITOR_SETTINGS.level
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level))
}

/**
 * Normalises anything into a valid setting.
 *
 * Shared by the reader and the writer on purpose: a hand-edited file and a
 * malformed IPC payload are the same problem, and neither may be able to put a
 * level the native layer will reject -- or an `enabled` that isn't a boolean --
 * into the addon.
 */
function normalizeMicMonitorSettings(value) {
  const source = value && typeof value === 'object' ? value : {}
  return { enabled: source.enabled === true, level: clampLevel(source.level) }
}

function readMicMonitorSettings(settingsPath) {
  try {
    return normalizeMicMonitorSettings(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')))
  } catch {
    // A missing, truncated or hand-mangled file degrades to "off", never to a
    // half-read object that could leave monitoring on at an unknown level.
    return { ...DEFAULT_MIC_MONITOR_SETTINGS }
  }
}

function writeMicMonitorSettings(settingsPath, settings) {
  const normalized = normalizeMicMonitorSettings(settings)
  fs.writeFileSync(settingsPath, JSON.stringify(normalized))
  return normalized
}

module.exports = {
  DEFAULT_MIC_MONITOR_SETTINGS,
  normalizeMicMonitorSettings,
  readMicMonitorSettings,
  writeMicMonitorSettings,
}
