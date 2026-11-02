// @vitest-environment node
// describe/expect/it/beforeEach come from Vitest's globals (vite.config.ts test.globals: true)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { writeAvatarFile, deleteAvatarFile, avatarVersion } = require('../avatar-io.cjs')

// A 1x1 red pixel JPEG, base64-encoded -- small, real, valid JPEG bytes.
const SAMPLE_JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=='

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'avatars-'))
}

describe('writeAvatarFile / deleteAvatarFile', () => {
  it('writes the data URL bytes to <avatarsDir>/<playerId>.jpg and returns that path', () => {
    const avatarsDir = tempDir()
    const resultPath = writeAvatarFile(avatarsDir, 'player-1', SAMPLE_JPEG_DATA_URL)

    expect(resultPath).toBe(path.join(avatarsDir, 'player-1.jpg'))
    expect(fs.existsSync(resultPath)).toBe(true)
    expect(fs.readFileSync(resultPath).length).toBeGreaterThan(0)
  })

  it('deletes the avatar file', () => {
    const avatarsDir = tempDir()
    const resultPath = writeAvatarFile(avatarsDir, 'player-1', SAMPLE_JPEG_DATA_URL)

    deleteAvatarFile(avatarsDir, 'player-1')

    expect(fs.existsSync(resultPath)).toBe(false)
  })

  it('avatarVersion changes when the avatar is rewritten in place, and is null for a missing file', () => {
    const avatarsDir = tempDir()
    const filePath = writeAvatarFile(avatarsDir, 'player-1', SAMPLE_JPEG_DATA_URL)
    const before = avatarVersion(filePath)
    expect(before).toMatch(/^\d+-\d+$/)

    // Same name, different bytes -- exactly what an avatar change does.
    fs.writeFileSync(filePath, Buffer.concat([fs.readFileSync(filePath), Buffer.from([0xff, 0xd9])]))
    expect(avatarVersion(filePath)).not.toBe(before)

    expect(avatarVersion(path.join(avatarsDir, 'nobody.jpg'))).toBeNull()
  })

  it('does not throw when deleting an avatar that does not exist', () => {
    const avatarsDir = tempDir()
    expect(() => deleteAvatarFile(avatarsDir, 'no-such-player')).not.toThrow()
  })
})
