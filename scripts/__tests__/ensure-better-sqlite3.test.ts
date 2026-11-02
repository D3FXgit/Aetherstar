// @vitest-environment node
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import {
  checkBetterSqlite3Abi,
  extractAbiFromError,
  getBinaryPlatform,
  default as ensureBetterSqlite3,
} from '../ensure-better-sqlite3.cjs'

const require = createRequire(import.meta.url)

describe('ensureBetterSqlite3', () => {
  it('passes when binary ABI matches running ABI and better-sqlite3 loads', () => {
    const result = checkBetterSqlite3Abi()
    expect(result.ok).toBe(true)
    expect(result.runningAbi).toBe(String(process.versions.modules))
  })

  it('detects ABI mismatch when binary was built for a different Node module version', () => {
    const result = checkBetterSqlite3Abi({
      binaryAbi: '127',
      runningAbi: '137',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('better-sqlite3 ABI mismatch')
    expect(result.message).toContain('built for NODE_MODULE_VERSION 127')
    expect(result.message).toContain('running NODE_MODULE_VERSION 137')
    expect(result.message).toContain('npm run rebuild:node')
  })

  it('detects ABI mismatch from dlopen error message', () => {
    const fakeError = new Error(
      'The module was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version requires NODE_MODULE_VERSION 137.'
    )
    fakeError.code = 'ERR_DLOPEN_FAILED'

    // No ABI or platform read from the installed binary: this case is about
    // parsing the load error, whatever binary happens to be in node_modules.
    const result = checkBetterSqlite3Abi({
      binaryAbi: null,
      binaryPlatform: null,
      runningAbi: '137',
      requireFn: () => {
        throw fakeError
      },
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('better-sqlite3 ABI mismatch')
    expect(result.message).toContain('NODE_MODULE_VERSION 127')
    expect(result.message).toContain('npm run rebuild:node')
  })

  it('reports a binary for another platform as such, not as an ABI mismatch', () => {
    const result = checkBetterSqlite3Abi({
      binaryAbi: '127',
      runningAbi: '127',
      binaryPlatform: 'darwin',
      runningPlatform: 'win32',
    })
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain('ABI mismatch')
    expect(result.message).toContain('another platform or an Electron build')
    expect(result.message).toContain('built for darwin, running on win32')
    expect(result.message).toContain('npm run rebuild:node')
  })

  it('reports a dlopen failure without a module version as a wrong build, not an ABI mismatch', () => {
    const fakeError = Object.assign(new Error('%1 is not a valid Win32 application.'), { code: 'ERR_DLOPEN_FAILED' })

    const result = checkBetterSqlite3Abi({
      binaryAbi: null,
      binaryPlatform: null,
      runningAbi: '127',
      requireFn: () => {
        throw fakeError
      },
    })
    expect(result.ok).toBe(false)
    expect(result.message).not.toContain('ABI mismatch')
    expect(result.message).toContain('could not be loaded')
    expect(result.message).toContain('not a valid Win32 application')
    expect(result.message).toContain('npm run rebuild:node')
  })

  it('reads the platform of the installed binary', () => {
    expect(getBinaryPlatform('/non/existent/path/better_sqlite3.node')).toBeNull()
    expect(getBinaryPlatform(require.resolve('better-sqlite3/build/Release/better_sqlite3.node'))).toBe(process.platform)
  })

  it('handles missing binary file gracefully', () => {
    const result = checkBetterSqlite3Abi({
      binaryPath: '/non/existent/path/better_sqlite3.node',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('npm run rebuild:node')
  })

  it('throws Error with single-line instruction when ensureBetterSqlite3 fails', () => {
    expect(() =>
      ensureBetterSqlite3({
        binaryAbi: '127',
        runningAbi: '137',
      })
    ).toThrow('better-sqlite3 ABI mismatch (built for NODE_MODULE_VERSION 127, running NODE_MODULE_VERSION 137). Please run "npm run rebuild:node".')
  })

  it('extractAbiFromError parses NODE_MODULE_VERSION correctly', () => {
    expect(
      extractAbiFromError(
        new Error('Compiled against NODE_MODULE_VERSION 127, expected 137')
      )
    ).toBe('127')
    expect(extractAbiFromError(null)).toBeNull()
  })
})
