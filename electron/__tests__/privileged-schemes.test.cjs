// @vitest-environment node
// describe/expect/it come from Vitest's globals (vite.config.ts test.globals: true)

// Same require-cache-injection pattern as ipc-registry.test.cjs -- requiring
// the real 'electron' package outside the Electron binary returns a path
// string, not the API surface.
const electronModulePath = require.resolve('electron')
const modulePath = require.resolve('../privileged-schemes.cjs')

describe('registerPrivilegedSchemes', () => {
  let calls

  beforeEach(() => {
    calls = []
    require.cache[electronModulePath] = {
      id: electronModulePath,
      filename: electronModulePath,
      loaded: true,
      exports: {
        protocol: {
          registerSchemesAsPrivileged: (schemes) => calls.push(schemes),
        },
      },
    }
    delete require.cache[modulePath]
  })

  // The regression guard for a real, shipped bug: app-media and
  // aetherstar-media were registered from two different modules, and because
  // Electron's registerSchemesAsPrivileged *replaces* the list instead of
  // appending, whichever ran first silently lost supportFetchAPI. Every
  // fetch() against it then failed with "URL scheme ... is not supported",
  // with nothing logged in the main process.
  it('registers every privileged scheme in exactly ONE call', () => {
    const { registerPrivilegedSchemes } = require('../privileged-schemes.cjs')
    registerPrivilegedSchemes()

    expect(calls).toHaveLength(1)
  })

  it('covers both app-media and aetherstar-media in that single call', () => {
    const { registerPrivilegedSchemes } = require('../privileged-schemes.cjs')
    registerPrivilegedSchemes()

    expect(calls[0].map((s) => s.scheme).sort()).toEqual(['aetherstar-media', 'app-media'])
  })

  it('gives both schemes the privileges fetch() and media elements need', () => {
    const { PRIVILEGED_SCHEMES } = require('../privileged-schemes.cjs')

    for (const { scheme, privileges } of PRIVILEGED_SCHEMES) {
      expect(privileges.standard, `${scheme} must be standard`).toBe(true)
      expect(privileges.supportFetchAPI, `${scheme} must support fetch()`).toBe(true)
      expect(privileges.stream, `${scheme} must support streaming for <audio>/<video>`).toBe(true)
    }
  })

  it('does not register anything at module load -- registration is explicit and ordered before app.whenReady()', () => {
    require('../privileged-schemes.cjs')
    expect(calls).toHaveLength(0)
  })
})
