// @vitest-environment node
// describe/expect/it come from Vitest's globals (vite.config.ts test.globals: true)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { readCalibrationSettings, writeCalibrationSettings, CALIBRATION_SCHEMA_VERSION } = require('../settings.cjs')

const DEFAULT_SETTINGS = { outputOffsetMs: 0, inputDevices: {}, players: {} }

function tempSettingsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'calibration-settings-')), 'calibration.json')
}

describe('readCalibrationSettings / writeCalibrationSettings', () => {
  it('returns the default settings when the file does not exist', () => {
    expect(readCalibrationSettings(tempSettingsPath())).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips a written CalibrationSettings object', () => {
    const settingsPath = tempSettingsPath()
    const settings = {
      outputOffsetMs: 120,
      inputDevices: { 'mic-1': { offsetMs: 15 } },
      players: { 'player-1': { difficulty: 'hard', transpositionSemitones: -2 } },
    }
    writeCalibrationSettings(settingsPath, settings)
    expect(readCalibrationSettings(settingsPath)).toEqual(settings)
  })

  it('stamps the schema version into the file, and keeps it out of what is read back', () => {
    const settingsPath = tempSettingsPath()
    writeCalibrationSettings(settingsPath, { outputOffsetMs: 0, inputDevices: {}, players: {} })
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).schemaVersion).toBe(CALIBRATION_SCHEMA_VERSION)
    expect(readCalibrationSettings(settingsPath)).not.toHaveProperty('schemaVersion')
  })

  it('drops input offsets saved before native frames were stamped at window centre, keeping output offset, difficulties and transpositions', () => {
    const settingsPath = tempSettingsPath()
    // A file from before versioning existed: no schemaVersion field at all.
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        outputOffsetMs: 120,
        inputDevices: { 'mic-1': { offsetMs: 45 } },
        players: { 'player-1': { difficulty: 'hard', transpositionSemitones: -2 } },
      }),
    )
    expect(readCalibrationSettings(settingsPath)).toEqual({
      outputOffsetMs: 120,
      inputDevices: {},
      players: { 'player-1': { difficulty: 'hard', transpositionSemitones: -2 } },
    })

    // Same for an explicit older version.
    fs.writeFileSync(settingsPath, JSON.stringify({ schemaVersion: 1, outputOffsetMs: 0, inputDevices: { m: { offsetMs: 30 } }, players: {} }))
    expect(readCalibrationSettings(settingsPath).inputDevices).toEqual({})
  })

  it('a re-measured input offset written under the current version survives the next read', () => {
    const settingsPath = tempSettingsPath()
    fs.writeFileSync(settingsPath, JSON.stringify({ outputOffsetMs: 80, inputDevices: { 'mic-1': { offsetMs: 45 } }, players: {} }))
    const migrated = readCalibrationSettings(settingsPath)
    writeCalibrationSettings(settingsPath, { ...migrated, inputDevices: { 'mic-1': { offsetMs: 12 } } })
    expect(readCalibrationSettings(settingsPath)).toEqual({ outputOffsetMs: 80, inputDevices: { 'mic-1': { offsetMs: 12 } }, players: {} })
  })

  it('returns the default when the file is corrupt, without throwing', () => {
    const settingsPath = tempSettingsPath()
    fs.writeFileSync(settingsPath, '{ not valid json')
    expect(() => readCalibrationSettings(settingsPath)).not.toThrow()
    expect(readCalibrationSettings(settingsPath)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('calibration offset bounds', () => {
  it('clamps offsets into ±1000 ms on write', () => {
    const settingsPath = tempSettingsPath()
    writeCalibrationSettings(settingsPath, {
      outputOffsetMs: 5000,
      inputDevices: { 'mic-1': { offsetMs: -2500 }, 'mic-2': { offsetMs: 40 } },
      players: {},
    })
    expect(readCalibrationSettings(settingsPath)).toEqual({
      outputOffsetMs: 1000,
      inputDevices: { 'mic-1': { offsetMs: -1000 }, 'mic-2': { offsetMs: 40 } },
      players: {},
    })
  })

  it('discards implausible offsets saved by the old mixed-clock measurement, keeping the rest', () => {
    const settingsPath = tempSettingsPath()
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        schemaVersion: CALIBRATION_SCHEMA_VERSION,
        // perf-vs-AudioContext origin mix: minutes; epoch-vs-AudioContext: ~1.7e12.
        outputOffsetMs: 183_250,
        inputDevices: { 'mic-1': { offsetMs: 1.76e12 }, 'mic-2': { offsetMs: 35 }, 'mic-3': { offsetMs: 'x' } },
        players: { p: { difficulty: 'easy', transpositionSemitones: 1 } },
      }),
    )
    expect(readCalibrationSettings(settingsPath)).toEqual({
      outputOffsetMs: 0,
      inputDevices: { 'mic-2': { offsetMs: 35 } },
      players: { p: { difficulty: 'easy', transpositionSemitones: 1 } },
    })
  })
})
