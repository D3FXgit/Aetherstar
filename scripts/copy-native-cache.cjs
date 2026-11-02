// Step of `npm run rebuild:electron`: right after electron-rebuild has built
// better-sqlite3 against Electron's ABI, keep a copy of that binary in
// .native-cache/ -- electron/native-binding.cjs loads it from there -- before
// `npm run rebuild:node` rebuilds the copy in node_modules for plain Node
// (tests, scripts).
//
// A Node script rather than `mkdir -p ... && cp ...` so the npm script also
// works under cmd.exe on Windows, which has neither.
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const source = path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
const cacheDir = path.join(root, '.native-cache')
const target = path.join(cacheDir, 'better-sqlite3-electron.node')

if (!fs.existsSync(source)) {
  console.error(`copy-native-cache: ${path.relative(root, source)} not found -- did electron-rebuild succeed?`)
  process.exit(1)
}

fs.mkdirSync(cacheDir, { recursive: true })
fs.copyFileSync(source, target)
console.log(`copy-native-cache: ${path.relative(root, source)} -> ${path.relative(root, target)}`)
