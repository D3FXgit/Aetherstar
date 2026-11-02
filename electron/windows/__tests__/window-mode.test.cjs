// @vitest-environment node
// describe/expect/it come from Vitest's globals (vite.config.ts test.globals: true)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { readWindowMode, writeWindowMode, isUserDrivenModeChange, DEFAULT_WINDOW_MODE } = require('../window-mode.cjs')

function tempSettingsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'window-mode-')), 'window-mode.json')
}

describe('readWindowMode / writeWindowMode', () => {
  it('defaults to full screen -- { windowed: false } -- when no file has ever been written', () => {
    expect(readWindowMode(tempSettingsPath())).toEqual({ windowed: false })
    expect(DEFAULT_WINDOW_MODE).toEqual({ windowed: false })
  })

  it('round-trips the windowed choice, so it survives a restart', () => {
    const settingsPath = tempSettingsPath()
    writeWindowMode(settingsPath, { windowed: true })
    expect(readWindowMode(settingsPath)).toEqual({ windowed: true })
    writeWindowMode(settingsPath, { windowed: false })
    expect(readWindowMode(settingsPath)).toEqual({ windowed: false })
  })

  it('falls back to full screen on a corrupt file rather than throwing at startup', () => {
    const settingsPath = tempSettingsPath()
    fs.writeFileSync(settingsPath, '{ not valid json')
    expect(() => readWindowMode(settingsPath)).not.toThrow()
    expect(readWindowMode(settingsPath)).toEqual({ windowed: false })
  })

  it('treats any non-true stored value as full screen', () => {
    const settingsPath = tempSettingsPath()
    fs.writeFileSync(settingsPath, JSON.stringify({ windowed: 'yes' }))
    expect(readWindowMode(settingsPath)).toEqual({ windowed: false })
  })
})

describe('isUserDrivenModeChange', () => {
  it('counts a transition on a live window, which is someone actually leaving or entering full screen', () => {
    expect(isUserDrivenModeChange({ quitting: false, windowDestroyed: false })).toBe(true)
  })

  it('ignores the leave-full-screen macOS fires while quitting -- the bug that made the app start windowed forever', () => {
    expect(isUserDrivenModeChange({ quitting: true, windowDestroyed: false })).toBe(false)
  })

  it('ignores a transition on a window that is already gone', () => {
    expect(isUserDrivenModeChange({ quitting: false, windowDestroyed: true })).toBe(false)
  })

  it('treats a missing state object as teardown-free rather than throwing', () => {
    expect(isUserDrivenModeChange()).toBe(true)
  })
})
