// No 'node:path' import here -- the sandboxed renderer bundle has no Node module
// access, so path manipulation is done with plain string operations instead.

/** Directory portion of an absolute path (manual split; handles both slash styles). */
export function dirnameOf(absoluteFilePath: string): string {
  const lastSlash = Math.max(absoluteFilePath.lastIndexOf('/'), absoluteFilePath.lastIndexOf('\\'))
  return lastSlash === -1 ? '' : absoluteFilePath.slice(0, lastSlash)
}

/**
 * Wraps an absolute filesystem path as a fetchable/playable app-media:// URL.
 *
 * Two encoding pitfalls, both confirmed against real Electron (not just
 * Node's URL parser, which doesn't reproduce either -- the gap that let both
 * ship unnoticed):
 *
 * 1. `encodeURI` deliberately leaves `#` and `?` unescaped (they're
 *    meaningful URI syntax elsewhere), but UltraStar's own
 *    `#VIDEO:...[VD#1].mpg`-style tagging convention routinely puts a
 *    literal `#` in a real filename, and a URL parser treats an unescaped
 *    `#` as the start of the fragment, silently truncating everything after
 *    it. Both are escaped here since this string is always a full path,
 *    never legitimately a fragment or query.
 * 2. A "standard" privileged scheme (protocol.registerSchemesAsPrivileged's
 *    `standard: true`, required for supportFetchAPI) parses `scheme://` +
 *    an absolute Unix path as `scheme://<host>/<rest>` -- Chromium's real URL
 *    parser treats the path's own leading `/Users/...` segment as the
 *    *authority* (host), silently eating the leading slash and lowercasing
 *    "Users" to "users", not as part of the path. A fixed, throwaway host
 *    ("media", as the library's `aetherstar-media://roots<path>` uses
 *    "roots") keeps `url.pathname` in the protocol handler the untouched
 *    absolute path, whatever it starts with.
 */
export function toAppMediaUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/')
  const pathWithSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  const encoded = encodeURI(pathWithSlash).replace(/#/g, '%23').replace(/\?/g, '%3F')
  return `app-media://media${encoded}`
}

/**
 * Host that tells electron/protocols.cjs to serve this exact file or nothing:
 * no "any file of the right kind in this folder" substitution.
 *
 * That substitution is right for the mix, the video and the cover -- the worst
 * case is the right sort of file under the wrong name. It is wrong for a stem:
 * a song's stems sit in the same folder as its full mix, so a missing
 * `#VOCALS` would resolve to the mix and play the entire song a second time
 * on top of the instrumental. Silence would be better than that, and this is
 * how the renderer says so.
 */
export const EXACT_MEDIA_HOST = 'exact'

export function toExactAppMediaUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/')
  const pathWithSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  const encoded = encodeURI(pathWithSlash).replace(/#/g, '%23').replace(/\?/g, '%3F')
  return `app-media://${EXACT_MEDIA_HOST}${encoded}`
}

/** Joins a chart's source directory with one of its relative media filenames (UltraStar's one-song-per-folder convention). */
export function resolveMediaPath(sourceDir: string, relativeFileName: string | undefined): string | null {
  if (!relativeFileName) return null
  return toAppMediaUrl(joinSongPath(sourceDir, relativeFileName))
}

/** As `resolveMediaPath`, but the handler must serve exactly this file or fail — used for stems. */
export function resolveExactMediaPath(sourceDir: string, relativeFileName: string | undefined): string | null {
  if (!relativeFileName) return null
  return toExactAppMediaUrl(joinSongPath(sourceDir, relativeFileName))
}

/**
 * The song's cover art. With no `#COVER` tag (common: plenty of charts just
 * leave `Artist - Title [CO].jpg` or `..._cover.jpg` in the folder), it asks
 * for the UltraStar-conventional name instead. The app-media handler serves
 * that file if it exists and otherwise the folder's first image -- the same
 * "any image here" rule the library scanner used to make the song's thumbnail,
 * so the stage shows the picture the song list does.
 */
export function resolveCoverUrl(sourceDir: string, meta: { coverPath?: string; artist: string; title: string }): string | null {
  if (meta.coverPath) return resolveMediaPath(sourceDir, meta.coverPath)
  const name = `${meta.artist} - ${meta.title}`.replace(/[\\/:*?"<>|]/g, '').trim()
  return resolveMediaPath(sourceDir, `${name || 'cover'} [CO].jpg`)
}

/** The chart's `#BACKGROUND` image, or null. Never guessed: without the tag, the cover stands in. */
export function resolveBackgroundUrl(sourceDir: string, meta: { backgroundPath?: string }): string | null {
  return resolveMediaPath(sourceDir, meta.backgroundPath)
}

function joinSongPath(sourceDir: string, relativeFileName: string): string {
  const normalizedDir = sourceDir.replace(/[/\\]+$/, '')
  return `${normalizedDir}/${relativeFileName}`
}

/**
 * Response header the app-media:// handler sets on chart text, naming the
 * file it actually served. A library song's path is its folder, so the chart
 * sits one level deeper than the requested path -- this is how the renderer
 * learns the real directory to resolve #MP3/#VIDEO against. Must stay in
 * sync with electron/protocols.cjs (main-process code src/ cannot import).
 */
export const RESOLVED_PATH_HEADER = 'x-aetherstar-resolved-path'
