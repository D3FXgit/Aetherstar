// Microphone permission. Only macOS gates mic access behind an OS prompt;
// elsewhere Electron offers no check, so access counts as granted.
const { systemPreferences } = require('electron')

async function requestMicPermission() {
  if (process.platform !== 'darwin') return 'granted'
  const granted = await systemPreferences.askForMediaAccess('microphone')
  return granted ? 'granted' : 'denied'
}

function getMicPermissionStatus() {
  if (process.platform !== 'darwin') return 'granted'
  return systemPreferences.getMediaAccessStatus('microphone')
}

module.exports = { requestMicPermission, getMicPermissionStatus }
