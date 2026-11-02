// @vitest-environment node
// describe/expect/it come from Vitest's globals (vite.config.ts test.globals: true)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { readAudienceSettings, writeAudienceSettings } = require('../settings.cjs')

function tempSettingsPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audience-settings-')), 'audience-window.json')
}

describe('readAudienceSettings / writeAudienceSettings', () => {
  it('returns a default { displayId: null, enabled: false } when the file does not exist', () => {
    expect(readAudienceSettings(tempSettingsPath())).toEqual({ displayId: null, enabled: false })
  })

  it('round-trips a written displayId, defaulting enabled to false', () => {
    const settingsPath = tempSettingsPath()
    writeAudienceSettings(settingsPath, { displayId: 2 })
    expect(readAudienceSettings(settingsPath)).toEqual({ displayId: 2, enabled: false })
  })

  it('round-trips a written enabled flag', () => {
    const settingsPath = tempSettingsPath()
    writeAudienceSettings(settingsPath, { displayId: 2, enabled: true })
    expect(readAudienceSettings(settingsPath)).toEqual({ displayId: 2, enabled: true })
  })

  it('returns the default when the file is corrupt, without throwing', () => {
    const settingsPath = tempSettingsPath()
    fs.writeFileSync(settingsPath, '{ not valid json')
    expect(() => readAudienceSettings(settingsPath)).not.toThrow()
    expect(readAudienceSettings(settingsPath)).toEqual({ displayId: null, enabled: false })
  })
})
