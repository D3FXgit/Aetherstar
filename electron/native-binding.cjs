// Resolves the Electron-ABI build of a native addon cached by
// `npm run rebuild:electron` (.native-cache/), so node_modules can keep the
// plain-Node build `npm test` needs. Undefined outside Electron or before the
// cache exists (the module then resolves its own default).
const fs = require('fs')
const path = require('path')

function resolveNativeBinding(moduleName) {
  if (!process.versions.electron) return undefined
  const cachePath = path.join(__dirname, '..', '.native-cache', `${moduleName}-electron.node`)
  return fs.existsSync(cachePath) ? cachePath : undefined
}

module.exports = { resolveNativeBinding }
