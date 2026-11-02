// Persists the audience window's chosen display across restarts, in a single
// JSON file (no database needed for two values).
const fs = require('node:fs')

// enabled defaults to false -- the audience window is opt-in (Settings).
const DEFAULT_SETTINGS = { displayId: null, enabled: false }

function readAudienceSettings(settingsPath) {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw)
    return {
      displayId: parsed.displayId ?? null,
      enabled: parsed.enabled ?? false,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function writeAudienceSettings(settingsPath, settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings))
}

module.exports = { readAudienceSettings, writeAudienceSettings }
