// Custom app-media:// scheme so the sandboxed renderer can read local chart
// text and play local media, consistently in dev (http://localhost:5173) and
// packaged (file://) mode.
const fs = require('node:fs')
const path = require('node:path')
const { protocol } = require('electron')
const { fileResponse } = require('./media-response.cjs')
const { pickChartFile } = require('./library/chart-files.cjs')

// NOTE: this scheme's *privileged* registration lives in
// electron/privileged-schemes.cjs, together with aetherstar-media's.
// registerSchemesAsPrivileged replaces the whole list rather than appending,
// so two separate calls left one scheme unprivileged -- see that file.

// Mirrors scan-worker.cjs's own extension groups -- a chart's #MP3/#VIDEO/#COVER
// tag is frequently stale (renamed file, different extension, a video
// downloaded under a completely different filename -- all common in
// real-world UltraStar libraries), so both scan-time indexing *and*
// playback-time resolution need the identical "any file of the right kind in
// this song's folder" fallback, or a song that scans as playable can still
// fail to actually load its media once you try to sing it.
const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.flac', '.aac'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.avi', '.mpg', '.mpeg', '.webm', '.mov', '.mkv', '.m4v'])
const COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp'])
const MEDIA_EXTENSION_GROUPS = [AUDIO_EXTENSIONS, VIDEO_EXTENSIONS, COVER_EXTENSIONS]

function findFallbackByExtension(dir, requestedFilename) {
  const ext = path.extname(requestedFilename).toLowerCase()
  const group = MEDIA_EXTENSION_GROUPS.find((extensions) => extensions.has(ext))
  if (!group) return null

  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const match = entries.find((e) => e.isFile() && group.has(path.extname(e.name).toLowerCase()))
  return match ? path.join(dir, match.name) : null
}

/**
 * A library song's `path` is its *folder* (electron/library/db.cjs's schema
 * primary key), not its chart .txt file -- SessionPlay.tsx hands that folder
 * straight to Sing/useChartLoader as `chartPath`. Resolving a requested path
 * that turns out to be a directory to the chart file inside it (mirroring
 * scan-worker.cjs's own `findTxtFile`) is what makes that actually work,
 * instead of fetching a directory and failing every real library song.
 */
/**
 * Host that suppresses every fallback below and serves the requested file or
 * nothing. Must stay in sync with src/stage/media/resolveMediaPath.ts's
 * EXACT_MEDIA_HOST.
 *
 * The substitutions in resolveRequestedPath are right for the mix, the video
 * and the cover -- the worst case there is the right sort of file under the
 * wrong name. They are wrong for a separated stem, which lives in the same
 * folder as the song's full mix: a missing `#VOCALS` would resolve to that
 * mix and play the whole song a second time over the instrumental.
 */
const EXACT_MEDIA_HOST = 'exact'

function resolveRequestedPath(absolutePath) {
  let stat
  try {
    stat = fs.statSync(absolutePath)
  } catch {
    // Doesn't exist as given -- the chart's own #MP3/#VIDEO/#COVER tag
    // (src/stage/media/resolveMediaPath.ts joins it against sourceDir with
    // no existence check at all) may simply not match the real filename.
    return findFallbackByExtension(path.dirname(absolutePath), path.basename(absolutePath)) ?? absolutePath
  }
  if (!stat.isDirectory()) {
    // The tagged video exists but Chromium cannot decode it (UltraStar
    // libraries are full of MPEG-1/2 .mpg and DivX .avi, which fail with
    // DEMUXER_ERROR_COULD_NOT_OPEN). If someone has dropped a transcoded
    // .mp4/.webm alongside it, serve that instead of a file that can only
    // ever fail -- so transcoding a song needs no #VIDEO tag edit.
    const playable = preferPlayableVideoSibling(absolutePath)
    return playable ?? absolutePath
  }

  let entries
  try {
    entries = fs.readdirSync(absolutePath, { withFileTypes: true })
  } catch {
    return absolutePath
  }
  // The same choice the scanner indexed the folder by (chart-files.cjs): a
  // readme.txt beside the chart must never be what gets sung. Only a folder
  // with no recognisable chart at all falls back to "some .txt", in name order.
  const chart = pickChartFile(absolutePath, entries)
  if (chart) return chart
  const txt = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.txt'))
    .map((e) => e.name)
    .sort()[0]
  return txt ? path.join(absolutePath, txt) : absolutePath
}

/**
 * The absolute filesystem path an `app-media://` or `aetherstar-media://`
 * request names, or null when the URL cannot be decoded.
 *
 * The renderer builds these URLs with forward slashes and a leading `/`
 * ahead of the drive letter on Windows (`/D:/Songs/a%23b.mp3` -- see
 * src/stage/media/resolveMediaPath.ts), so that slash is stripped again here
 * before the path is normalized to the platform's own form.
 */
function requestUrlToPath(requestUrl, platform = process.platform) {
  let url
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  let decoded
  try {
    decoded = decodeURIComponent(url.pathname)
  } catch {
    // A stray `%` that is not an escape (URIError) -- malformed, not missing.
    return null
  }
  if (decoded.includes('\0')) return null
  if (platform === 'win32' && /^\/[a-zA-Z]:([/\x5c]|$)/.test(decoded)) {
    decoded = decoded.slice(1)
  }
  return path.normalize(decoded)
}

/** True when `absPath` is one of `roots` or sits somewhere beneath one. */
function isUnderAnyRoot(absPath, roots) {
  return roots.some((root) => {
    if (!root) return false
    const relative = path.relative(root, absPath)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  })
}

/** Extensions Chromium's <video> can actually decode -- must match src/stage/media/isNativelyPlayableVideo.ts. */
const NATIVELY_PLAYABLE_VIDEO = new Set(['.mp4', '.webm'])

function preferPlayableVideoSibling(absolutePath) {
  const ext = path.extname(absolutePath).toLowerCase()
  if (!VIDEO_EXTENSIONS.has(ext) || NATIVELY_PLAYABLE_VIDEO.has(ext)) return null

  let entries
  try {
    entries = fs.readdirSync(path.dirname(absolutePath), { withFileTypes: true })
  } catch {
    return null
  }
  const match = entries.find((e) => e.isFile() && NATIVELY_PLAYABLE_VIDEO.has(path.extname(e.name).toLowerCase()))
  return match ? path.join(path.dirname(absolutePath), match.name) : null
}

/**
 * Tells the renderer which file a request actually resolved to.
 *
 * A library song's path is its *folder*, so the renderer asks for the folder
 * and this handler picks the .txt inside it. Without reporting that back,
 * the renderer had no way to know the real chart location and derived the
 * song's media directory by stripping one segment off the folder -- landing
 * on the library root, so `#MP3:Midnight Carousel.mp3` resolved to
 * `<library>/Midnight Carousel.mp3` instead of
 * `<library>/Lumen Quartet - Midnight Carousel/Midnight Carousel.mp3`.
 *
 * URI-encoded because HTTP header values must be ASCII and song paths very
 * often are not (umlauts, accents).
 */
const RESOLVED_PATH_HEADER = 'x-aetherstar-resolved-path'

/**
 * Must be called after app.whenReady().
 *
 * `getAllowedRoots`, when given, confines the scheme to those directories --
 * main.cjs passes the configured library roots, the app's userData (avatars,
 * thumbnails), the bundled fixtures/ and assets/, and any file or folder the
 * user explicitly picked in an open dialog this session. Anything else is a
 * 403. Without it the scheme used to serve any absolute path on the machine
 * to any page that could construct a URL. Omitting it (unit tests) keeps the
 * old unrestricted behaviour.
 *
 * @param {{ getAllowedRoots?: () => string[] }} [options]
 */
function registerAppMediaProtocol({ getAllowedRoots } = {}) {
  protocol.handle('app-media', async (request) => {
    try {
      const url = new URL(request.url)
      const absolutePath = requestUrlToPath(request.url)
      if (!absolutePath) return new Response(null, { status: 400, statusText: 'Bad Request' })

      const allowedRoots = typeof getAllowedRoots === 'function' ? getAllowedRoots().filter(Boolean) : null
      if (allowedRoots && !isUnderAnyRoot(absolutePath, allowedRoots)) {
        return new Response(null, { status: 403, statusText: 'Forbidden' })
      }

      const resolvedPath = url.host === EXACT_MEDIA_HOST ? absolutePath : resolveRequestedPath(absolutePath)
      // Fallbacks only ever look inside the requested folder, but check the
      // final answer too rather than rely on that staying true.
      if (allowedRoots && !isUnderAnyRoot(resolvedPath, allowedRoots)) {
        return new Response(null, { status: 403, statusText: 'Forbidden' })
      }
      // Audio/video are served with byte ranges so seeking works. Only chart
      // text carries the resolved-path header (a media element never reads it).
      if (!resolvedPath.toLowerCase().endsWith('.txt')) return await fileResponse(resolvedPath, request)

      return await fileResponse(resolvedPath, request, {
        [RESOLVED_PATH_HEADER]: encodeURIComponent(resolvedPath),
        'access-control-expose-headers': RESOLVED_PATH_HEADER,
      })
    } catch {
      return new Response(null, { status: 404, statusText: 'Not Found' })
    }
  })
}

module.exports = {
  registerAppMediaProtocol,
  resolveRequestedPath,
  requestUrlToPath,
  isUnderAnyRoot,
  RESOLVED_PATH_HEADER,
  EXACT_MEDIA_HOST,
}
