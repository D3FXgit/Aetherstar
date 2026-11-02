// @vitest-environment node
// describe/expect/it come from Vitest's globals (vite.config.ts test.globals: true)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  DEFAULT_MIC_MONITOR_SETTINGS,
  normalizeMicMonitorSettings,
  readMicMonitorSettings,
  writeMicMonitorSettings,
} = require('../monitor-settings.cjs')

function tempSettingsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mic-monitor-')), 'mic-monitor.json')
}

describe('readMicMonitorSettings / writeMicMonitorSettings', () => {
  /**
   * The default that matters. Monitoring is an amplifier pointed at the room;
   * a first launch that switches it on without being asked is both a surprise
   * and a feedback risk in a room nobody has set up yet.
   */
  it('defaults to off when no file has ever been written', () => {
    expect(readMicMonitorSettings(tempSettingsPath())).toEqual({ enabled: false, level: 0.5 })
    expect(DEFAULT_MIC_MONITOR_SETTINGS.enabled).toBe(false)
  })

  it('round-trips the switch and the level, so both survive a restart', () => {
    const settingsPath = tempSettingsPath()
    writeMicMonitorSettings(settingsPath, { enabled: true, level: 0.3 })
    expect(readMicMonitorSettings(settingsPath)).toEqual({ enabled: true, level: 0.3 })

    writeMicMonitorSettings(settingsPath, { enabled: false, level: 0.9 })
    expect(readMicMonitorSettings(settingsPath)).toEqual({ enabled: false, level: 0.9 })
  })

  it('falls back to off on a corrupt file rather than throwing at startup', () => {
    const settingsPath = tempSettingsPath()
    fs.writeFileSync(settingsPath, '{ not valid json')
    expect(() => readMicMonitorSettings(settingsPath)).not.toThrow()
    expect(readMicMonitorSettings(settingsPath)).toEqual({ enabled: false, level: 0.5 })
  })

  /**
   * A half-read file must never resolve to "on". `enabled` is only ever true
   * for an explicit `true`, so a truncated write, a hand edit, or a value from
   * an older shape all degrade to silence.
   */
  it('treats any non-true stored value as off', () => {
    const settingsPath = tempSettingsPath()
    fs.writeFileSync(settingsPath, JSON.stringify({ enabled: 'yes', level: 0.5 }))
    expect(readMicMonitorSettings(settingsPath).enabled).toBe(false)
  })

  it('clamps a stored level into 0..1 rather than passing it through to the native layer', () => {
    const settingsPath = tempSettingsPath()

    fs.writeFileSync(settingsPath, JSON.stringify({ enabled: true, level: 12 }))
    expect(readMicMonitorSettings(settingsPath).level).toBe(1)

    fs.writeFileSync(settingsPath, JSON.stringify({ enabled: true, level: -4 }))
    expect(readMicMonitorSettings(settingsPath).level).toBe(0)
  })

  it('substitutes the default level for a missing or non-numeric one', () => {
    const settingsPath = tempSettingsPath()
    fs.writeFileSync(settingsPath, JSON.stringify({ enabled: true }))
    expect(readMicMonitorSettings(settingsPath).level).toBe(DEFAULT_MIC_MONITOR_SETTINGS.level)

    fs.writeFileSync(settingsPath, JSON.stringify({ enabled: true, level: 'loud' }))
    expect(readMicMonitorSettings(settingsPath).level).toBe(DEFAULT_MIC_MONITOR_SETTINGS.level)
  })

  /**
   * The write side normalises too, so a malformed IPC payload can never be
   * persisted -- otherwise the next launch would read back a value this module
   * promises cannot exist.
   */
  it('normalises on write and returns what it actually stored', () => {
    const settingsPath = tempSettingsPath()
    const stored = writeMicMonitorSettings(settingsPath, { enabled: 1, level: 5 })
    expect(stored).toEqual({ enabled: false, level: 1 })
    expect(readMicMonitorSettings(settingsPath)).toEqual({ enabled: false, level: 1 })
  })
})

describe('normalizeMicMonitorSettings', () => {
  it('turns null/undefined/garbage into the safe default rather than throwing', () => {
    expect(normalizeMicMonitorSettings(null)).toEqual({ enabled: false, level: 0.5 })
    expect(normalizeMicMonitorSettings(undefined)).toEqual({ enabled: false, level: 0.5 })
    expect(normalizeMicMonitorSettings('on')).toEqual({ enabled: false, level: 0.5 })
  })

  it('passes a well-formed setting through untouched', () => {
    expect(normalizeMicMonitorSettings({ enabled: true, level: 0.42 })).toEqual({ enabled: true, level: 0.42 })
  })
})
