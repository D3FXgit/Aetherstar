const fs = require('node:fs')
const path = require('node:path')

function getBinaryAbi(binaryPath) {
  try {
    if (!fs.existsSync(binaryPath)) return null
    const buf = fs.readFileSync(binaryPath)
    const str = buf.toString('latin1')
    const match = str.match(/node_register_module_v(\d+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

// Which OS a native binary was built for, from its file header: PE ("MZ") on
// Windows, ELF on Linux, Mach-O (thin or universal) on macOS. null when the
// file is missing or unrecognised.
function getBinaryPlatform(binaryPath) {
  try {
    if (!fs.existsSync(binaryPath)) return null
    const fd = fs.openSync(binaryPath, 'r')
    const header = Buffer.alloc(4)
    try {
      fs.readSync(fd, header, 0, 4, 0)
    } finally {
      fs.closeSync(fd)
    }
    if (header[0] === 0x4d && header[1] === 0x5a) return 'win32'
    if (header[0] === 0x7f && header[1] === 0x45 && header[2] === 0x4c && header[3] === 0x46) return 'linux'
    const magic = header.readUInt32BE(0)
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) return 'darwin'
    return null
  } catch {
    return null
  }
}

// The generic "this binary is not for this runtime" message: a binary built
// for another OS, or the Electron build that `npm run rebuild:electron` leaves
// behind when its trailing `rebuild:node` step did not run.
function wrongBuildMessage(detail) {
  return `better-sqlite3 could not be loaded: the binary is for another platform or an Electron build (${detail}). Please run "npm run rebuild:node".`
}

function extractAbiFromError(err) {
  if (!err || !err.message) return null
  const match = err.message.match(/NODE_MODULE_VERSION\s+(\d+)/)
  return match ? match[1] : null
}

function checkBetterSqlite3Abi(options = {}) {
  const binaryPath =
    options.binaryPath ||
    path.resolve(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node')
  const runningAbi = String(options.runningAbi || process.versions.modules)
  const requireFn = options.requireFn || require

  const binaryAbi = options.binaryAbi !== undefined ? options.binaryAbi : getBinaryAbi(binaryPath)
  const runningPlatform = options.runningPlatform || process.platform
  const binaryPlatform =
    options.binaryPlatform !== undefined ? options.binaryPlatform : getBinaryPlatform(binaryPath)

  if (!fs.existsSync(binaryPath) && options.binaryAbi === undefined) {
    return {
      ok: false,
      compiledAbi: null,
      runningAbi,
      message: `better-sqlite3 binary not found. Please run "npm run rebuild:node".`,
    }
  }

  // A binary for another OS (e.g. a node_modules folder copied between
  // machines) fails to load with an unhelpful dlopen error -- name it.
  if (binaryPlatform && binaryPlatform !== runningPlatform) {
    return {
      ok: false,
      compiledAbi: binaryAbi,
      runningAbi,
      message: wrongBuildMessage(`built for ${binaryPlatform}, running on ${runningPlatform}`),
    }
  }

  // If the binary ABI symbol is read and doesn't match the running Node ABI, fail immediately
  if (binaryAbi && binaryAbi !== runningAbi) {
    return {
      ok: false,
      compiledAbi: binaryAbi,
      runningAbi,
      message: `better-sqlite3 ABI mismatch (built for NODE_MODULE_VERSION ${binaryAbi}, running NODE_MODULE_VERSION ${runningAbi}). Please run "npm run rebuild:node".`,
    }
  }

  // Also verify by actually requiring / instantiating to catch dlopen or runtime link issues
  try {
    const Database = requireFn('better-sqlite3')
    const db = new Database(':memory:')
    db.close()
  } catch (err) {
    // Only a load error that names the module version is a real ABI
    // mismatch; any other dlopen failure (wrong architecture, wrong OS, a
    // binary linked against Electron) used to be reported as one too, with
    // an "unknown" version -- misleading.
    const isAbiMismatch =
      Boolean(err?.message) &&
      (err.message.includes('NODE_MODULE_VERSION') ||
        err.message.includes('compiled against a different Node.js version'))

    if (!isAbiMismatch && err?.code === 'ERR_DLOPEN_FAILED') {
      return {
        ok: false,
        compiledAbi: binaryAbi || 'unknown',
        runningAbi,
        message: wrongBuildMessage(err.message.split(/\r?\n/)[0]),
      }
    }

    if (isAbiMismatch) {
      const errAbi = extractAbiFromError(err)
      const compiledAbi = errAbi || binaryAbi || 'unknown'
      return {
        ok: false,
        compiledAbi,
        runningAbi,
        message: `better-sqlite3 ABI mismatch (built for NODE_MODULE_VERSION ${compiledAbi}, running NODE_MODULE_VERSION ${runningAbi}). Please run "npm run rebuild:node".`,
      }
    }

    return {
      ok: false,
      compiledAbi: binaryAbi || 'unknown',
      runningAbi,
      message: `Failed to load better-sqlite3 (${err?.message || err}). Please run "npm run rebuild:node".`,
    }
  }

  return { ok: true, compiledAbi: binaryAbi, runningAbi }
}

function ensureBetterSqlite3(options = {}) {
  const result = checkBetterSqlite3Abi(options)
  if (!result.ok) {
    console.error(`\n${result.message}\n`)
    if (require.main === module) {
      process.exit(1)
    }
    throw new Error(result.message)
  }
  return () => {}
}

if (require.main === module) {
  ensureBetterSqlite3()
}

module.exports = ensureBetterSqlite3
module.exports.default = ensureBetterSqlite3
module.exports.getBinaryAbi = getBinaryAbi
module.exports.extractAbiFromError = extractAbiFromError
module.exports.getBinaryPlatform = getBinaryPlatform
module.exports.checkBetterSqlite3Abi = checkBetterSqlite3Abi
