// Restricted protocol that serves local library media under the app's CSP.
// Only paths under a known library root or the thumbnails dir are served --
// never an unchecked file:// passthrough.
const fs = require('node:fs')
const { protocol } = require('electron')
const { fileResponse } = require('../media-response.cjs')
const { resolveRequestedPath, requestUrlToPath, isUnderAnyRoot } = require('../protocols.cjs')

const SCHEME = 'aetherstar-media'

// This scheme's privileged registration lives in
// electron/privileged-schemes.cjs, in a single combined call with
// app-media's -- registerSchemesAsPrivileged replaces the list rather than
// appending, so registering them separately unprivileged whichever ran first.

/**
 * aetherstar-media://roots/<absolute path> -- `roots` is just a fixed host
 * label; the path is what src/library/mediaUrl.ts's toLibraryMediaUrl builds:
 * forward slashes, a leading `/` (also ahead of a Windows drive letter) and
 * percent-encoding, `#` and `?` included.
 *
 * @param {{ getKnownRoots: () => string[], thumbnailsDir: string }} opts
 */
function createMediaRequestHandler({ getKnownRoots, thumbnailsDir }) {
  return async function handleMediaRequest(request) {
    // Nothing in here may throw out of the handler: an exception in a
    // protocol handler surfaces in the renderer as an opaque net error with
    // no status at all, which is far harder to diagnose than a 4xx.
    try {
      const requestedPath = requestUrlToPath(request.url)
      if (!requestedPath) return new Response('', { status: 400 })

      const allowedRoots = [...getKnownRoots(), thumbnailsDir].filter(Boolean)
      if (!isUnderAnyRoot(requestedPath, allowedRoots)) {
        return new Response('', { status: 403 })
      }

      const resolvedPath = typeof resolveRequestedPath === 'function' ? resolveRequestedPath(requestedPath) : requestedPath
      if (!isUnderAnyRoot(resolvedPath, allowedRoots)) {
        return new Response('', { status: 403 })
      }

      if (!fs.existsSync(resolvedPath)) {
        return new Response('', { status: 404 })
      }

      try {
        return await fileResponse(resolvedPath, request)
      } catch {
        return new Response('', { status: 404 })
      }
    } catch {
      return new Response('', { status: 500 })
    }
  }
}

/**
 * @param {{ getKnownRoots: () => string[], thumbnailsDir: string }} opts
 */
function registerMediaProtocol(opts) {
  protocol.handle(SCHEME, createMediaRequestHandler(opts))
}

module.exports = { registerMediaProtocol, createMediaRequestHandler, SCHEME }
