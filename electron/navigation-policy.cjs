// What the app's windows may navigate to, and what may be handed to the OS
// browser. Pure (no electron import) so the rules are unit-testable;
// electron/main.cjs wires them into will-navigate / setWindowOpenHandler.
const { pathToFileURL } = require('node:url')

/**
 * Only web links leave the app. shell.openExternal hands its argument to the
 * OS, which will happily launch `file:`, `smb:`, `ms-msdt:`-style protocol
 * handlers and anything else registered on the machine -- so a link a chart
 * or a compromised page could plant must never reach it unless it is plainly
 * http(s).
 */
function isSafeExternalUrl(url) {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * In dev only the Vite server's own origin; in production only the app's own
 * dist/index.html (any query/hash -- the audience window loads it with
 * `?window=audience`). The previous rule allowed any `file://` URL at all,
 * i.e. any local HTML file on the machine, and in dev used a string prefix,
 * which `http://localhost:5173.evil.example` also satisfies.
 *
 * @param {{ isDev: boolean, devServerUrl: string, indexHtmlPath: string, platform?: string }} options
 * @returns {(url: string) => boolean}
 */
function createNavigationGuard({ isDev, devServerUrl, indexHtmlPath, platform = process.platform }) {
  const devOrigin = (() => {
    try {
      return new URL(devServerUrl).origin
    } catch {
      return null
    }
  })()
  const indexPathname = decodeURIComponent(pathToFileURL(indexHtmlPath).pathname)
  const caseInsensitive = platform === 'win32' || platform === 'darwin'
  const samePath = (a, b) => (caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b)

  return function isAllowedNavigation(url) {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (isDev) return devOrigin !== null && parsed.origin === devOrigin
    if (parsed.protocol !== 'file:') return false
    let pathname
    try {
      pathname = decodeURIComponent(parsed.pathname)
    } catch {
      return false
    }
    return samePath(pathname, indexPathname)
  }
}

module.exports = { isSafeExternalUrl, createNavigationGuard }
