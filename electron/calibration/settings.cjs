// Persists calibration offsets/presets across restarts in a single JSON file
// (same shape as electron/windows/settings.cjs).
const fs = require('node:fs')

const DEFAULT_SETTINGS = { outputOffsetMs: 0, inputDevices: {}, players: {} }

/**
 * Version of what the saved numbers *mean*, stamped into the file on every
 * write and stripped again on read (the renderer never sees it).
 *
 * 1 (implicit -- files written before versioning carry no field): native pitch
 *   frames were stamped when the analysis window *ended*.
 * 2: native frames are stamped at the window's centre capture time, roughly
 *   15-40 ms earlier. A per-mic input offset measured under 1 includes that
 *   lag, so applied now it over-compensates and every note is judged early.
 *   Such offsets are dropped on read (the mic reads as uncalibrated until it is
 *   measured again); the output offset and every singer's difficulty and
 *   transposition are unaffected and kept.
 */
const CALIBRATION_SCHEMA_VERSION = 2

/**
 * Mirrors src/calibration/offsets.ts. No working speaker or mic chain is a
 * second late, so a saved offset beyond this is a measurement fault (the
 * renderer once mixed AudioContext, performance.now() and epoch clocks and
 * saved offsets of minutes, or ~1.7e12 ms for a mic) and is discarded on read
 * -- reading as uncalibrated -- rather than shifting every song. On write,
 * values are clamped into range.
 */
const MAX_CALIBRATION_OFFSET_MS = 1000

function isPlausibleOffsetMs(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) && Math.abs(ms) <= MAX_CALIBRATION_OFFSET_MS
}

function clampOffsetMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 0
  return Math.max(-MAX_CALIBRATION_OFFSET_MS, Math.min(MAX_CALIBRATION_OFFSET_MS, ms))
}

function plausibleInputDevices(inputDevices) {
  const result = {}
  if (!inputDevices || typeof inputDevices !== 'object') return result
  for (const [deviceId, entry] of Object.entries(inputDevices)) {
    if (entry && isPlausibleOffsetMs(entry.offsetMs)) result[deviceId] = entry
  }
  return result
}

function clampedInputDevices(inputDevices) {
  const result = {}
  if (!inputDevices || typeof inputDevices !== 'object') return result
  for (const [deviceId, entry] of Object.entries(inputDevices)) {
    result[deviceId] = { ...entry, offsetMs: clampOffsetMs(entry?.offsetMs) }
  }
  return result
}

function readCalibrationSettings(settingsPath) {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8')
    const parsed = JSON.parse(raw)
    const version = Number.isInteger(parsed.schemaVersion) ? parsed.schemaVersion : 1
    const inputOffsetsStillValid = version >= CALIBRATION_SCHEMA_VERSION
    return {
      outputOffsetMs: isPlausibleOffsetMs(parsed.outputOffsetMs) ? parsed.outputOffsetMs : DEFAULT_SETTINGS.outputOffsetMs,
      // Not rewritten here: reading has no side effects. The next write (any
      // calibration change -- the renderer always writes the whole object it
      // read) persists the reset along with the current version.
      inputDevices: inputOffsetsStillValid ? plausibleInputDevices(parsed.inputDevices) : {},
      players: parsed.players ?? { ...DEFAULT_SETTINGS.players },
    }
  } catch {
    return { outputOffsetMs: DEFAULT_SETTINGS.outputOffsetMs, inputDevices: {}, players: {} }
  }
}

function writeCalibrationSettings(settingsPath, settings) {
  const sanitized = {
    ...settings,
    outputOffsetMs: clampOffsetMs(settings?.outputOffsetMs),
    inputDevices: clampedInputDevices(settings?.inputDevices),
  }
  fs.writeFileSync(settingsPath, JSON.stringify({ ...sanitized, schemaVersion: CALIBRATION_SCHEMA_VERSION }))
}

module.exports = { readCalibrationSettings, writeCalibrationSettings, CALIBRATION_SCHEMA_VERSION, MAX_CALIBRATION_OFFSET_MS }
