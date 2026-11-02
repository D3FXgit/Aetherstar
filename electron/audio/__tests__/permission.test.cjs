// @vitest-environment node
const electronModulePath = require.resolve('electron')
const permissionModulePath = require.resolve('../permission.cjs')

function requirePermissionWithMockedElectron({ askResult = true, status = 'granted' } = {}) {
  const askCalls = []
  const statusCalls = []

  require.cache[electronModulePath] = {
    id: electronModulePath,
    filename: electronModulePath,
    loaded: true,
    exports: {
      systemPreferences: {
        askForMediaAccess: (mediaType) => {
          askCalls.push(mediaType)
          return Promise.resolve(askResult)
        },
        getMediaAccessStatus: (mediaType) => {
          statusCalls.push(mediaType)
          return status
        },
      },
    },
  }

  delete require.cache[permissionModulePath]
  const mod = require('../permission.cjs')
  return { mod, askCalls, statusCalls }
}

describe('permission (darwin)', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    delete require.cache[electronModulePath]
    delete require.cache[permissionModulePath]
  })

  it('requestMicPermission asks systemPreferences and maps granted', async () => {
    const { mod, askCalls } = requirePermissionWithMockedElectron({ askResult: true })
    const status = await mod.requestMicPermission()
    expect(askCalls).toEqual(['microphone'])
    expect(status).toBe('granted')
  })

  it('requestMicPermission maps a false result to denied', async () => {
    const { mod } = requirePermissionWithMockedElectron({ askResult: false })
    expect(await mod.requestMicPermission()).toBe('denied')
  })

  it('getMicPermissionStatus reads status without prompting', () => {
    const { mod, statusCalls, askCalls } = requirePermissionWithMockedElectron({ status: 'denied' })
    expect(mod.getMicPermissionStatus()).toBe('denied')
    expect(statusCalls).toEqual(['microphone'])
    expect(askCalls).toEqual([])
  })
})

describe('permission (non-darwin)', () => {
  const originalPlatform = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    delete require.cache[electronModulePath]
    delete require.cache[permissionModulePath]
  })

  it('treats other platforms as already granted without calling systemPreferences', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const { mod, askCalls, statusCalls } = requirePermissionWithMockedElectron()
    expect(await mod.requestMicPermission()).toBe('granted')
    expect(mod.getMicPermissionStatus()).toBe('granted')
    expect(askCalls).toEqual([])
    expect(statusCalls).toEqual([])
  })
})
