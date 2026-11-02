// Avatar files: one downscaled JPEG per player in userData/avatars/, served
// over app-media:// (electron/protocols.cjs; userData is an allowed root).
const fs = require('node:fs')
const path = require('node:path')

const DATA_URL_PATTERN = /^data:image\/[a-zA-Z+.-]+;base64,(.+)$/

function writeAvatarFile(avatarsDir, playerId, dataUrl) {
  const match = dataUrl.match(DATA_URL_PATTERN)
  if (!match) throw new Error('writeAvatarFile: expected a base64 image data URL')

  fs.mkdirSync(avatarsDir, { recursive: true })
  const filePath = path.join(avatarsDir, `${playerId}.jpg`)
  fs.writeFileSync(filePath, Buffer.from(match[1], 'base64'))
  return filePath
}

function deleteAvatarFile(avatarsDir, playerId) {
  const filePath = path.join(avatarsDir, `${playerId}.jpg`)
  fs.rmSync(filePath, { force: true })
}

/**
 * A short token that changes whenever the avatar file is rewritten, for the
 * `?v=` on its URL (main.cjs's toPlayerProfile).
 *
 * writeAvatarFile overwrites `<id>.jpg` in place, so the URL of a changed
 * photo is byte-for-byte the URL of the old one -- and Chromium's image cache
 * kept showing the old face until the app restarted. Size is included next to
 * the mtime because FAT-family drives store modification times coarsely
 * enough for two quick edits to share one. The app-media:// handler reads
 * only the URL's path, so the query never reaches the file system.
 *
 * @returns {string | null} null when the file cannot be stat'ed
 */
function avatarVersion(filePath) {
  try {
    const stat = fs.statSync(filePath)
    return `${Math.round(stat.mtimeMs)}-${stat.size}`
  } catch {
    return null
  }
}

module.exports = { writeAvatarFile, deleteAvatarFile, avatarVersion }
