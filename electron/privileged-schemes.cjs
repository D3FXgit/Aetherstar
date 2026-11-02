// The ONE place `protocol.registerSchemesAsPrivileged` is called: it replaces
// the whole list rather than appending, so registering schemes from two modules
// silently un-privileges whichever ran first.
const { protocol } = require('electron')

const PRIVILEGED_SCHEMES = [
  // Chart text + song audio/video, addressed by absolute path.
  {
    scheme: 'app-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  // Library media (cover art, thumbnails, preview audio/video), served
  // only from under a known library root -- see library/media-protocol.cjs.
  {
    scheme: 'aetherstar-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false },
  },
]

/** Must be called at main-process module load, before app.whenReady(). */
function registerPrivilegedSchemes() {
  protocol.registerSchemesAsPrivileged(PRIVILEGED_SCHEMES)
}

module.exports = { PRIVILEGED_SCHEMES, registerPrivilegedSchemes }
