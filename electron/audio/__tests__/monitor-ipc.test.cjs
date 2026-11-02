// @vitest-environment node
// describe/expect/it/afterEach come from Vitest's globals (vite.config.ts test.globals: true)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createFakeAudioBridge } = require('../test-helpers/fakeAudioBridge.cjs')

// Same require-cache-injection pattern as ipc-handlers.test.cjs -- requiring
// the real 'electron' package outside the Electron binary returns a path
// string, not the API surface.
const electronModulePath = require.resolve('electron')
const ipcRegistryModulePath = require.resolve('../../ipc-registry.cjs')
const monitorIpcModulePath = require.resolve('../monitor-ipc.cjs')

function setupWithMockedElectron({ initialFile } = {}) {
  const handlers = {}
  const settingsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mic-monitor-ipc-')), 'mic-monitor.json')
  if (initialFile !== undefined) {
    fs.writeFileSync(settingsPath, initialFile)
  }

  require.cache[electronModulePath] = {
    id: electronModulePath,
    filename: electronModulePath,
    loaded: true,
    exports: {
      ipcMain: {
        handle: (channel, listener) => {
          handlers[channel] = listener
        },
      },
    },
  }

  delete require.cache[ipcRegistryModulePath]
  delete require.cache[monitorIpcModulePath]
  const { IPC_CHANNELS } = require('../../ipc-registry.cjs')
  const { registerMicMonitorIpcHandlers } = require('../monitor-ipc.cjs')

  const bridge = createFakeAudioBridge([])
  const startupSettings = registerMicMonitorIpcHandlers(bridge, () => settingsPath)

  return { handlers, IPC_CHANNELS, bridge, settingsPath, startupSettings }
}

function cleanup() {
  delete require.cache[electronModulePath]
  delete require.cache[ipcRegistryModulePath]
  delete require.cache[monitorIpcModulePath]
}

describe('registerMicMonitorIpcHandlers', () => {
  afterEach(cleanup)

  /**
   * The first-run guarantee. Monitoring is an amplifier aimed at the room, and
   * a fresh install must not switch it on -- so the addon has to be told "off"
   * explicitly at startup rather than left at whatever it defaults to.
   */
  it('pushes "off" into the native bridge at startup when nothing has been persisted', () => {
    const { bridge, startupSettings } = setupWithMockedElectron()
    expect(bridge.getMicMonitoring()).toEqual({ enabled: false, level: 0.5 })
    expect(startupSettings).toEqual({ enabled: false, level: 0.5 })
  })

  /**
   * The restart guarantee. The native layer, not the renderer, owns this
   * state; if it were only applied when a Settings screen mounted, the first
   * song after a restart would come up unmonitored.
   */
  it('pushes the persisted setting into the native bridge at startup, before any renderer asks', () => {
    const { bridge } = setupWithMockedElectron({ initialFile: JSON.stringify({ enabled: true, level: 0.3 }) })
    expect(bridge.getMicMonitoring()).toEqual({ enabled: true, level: 0.3 })
  })

  it('AUDIO_GET_MIC_MONITOR reads the persisted setting back', () => {
    const { handlers, IPC_CHANNELS } = setupWithMockedElectron({
      initialFile: JSON.stringify({ enabled: true, level: 0.75 }),
    })
    expect(handlers[IPC_CHANNELS.AUDIO_GET_MIC_MONITOR.channel]()).toEqual({ enabled: true, level: 0.75 })
  })

  it('AUDIO_SET_MIC_MONITOR persists the setting and applies it to the native bridge', () => {
    const { handlers, IPC_CHANNELS, bridge, settingsPath } = setupWithMockedElectron()

    const result = handlers[IPC_CHANNELS.AUDIO_SET_MIC_MONITOR.channel](null, { enabled: true, level: 0.4 })

    expect(result).toEqual({ enabled: true, level: 0.4 })
    expect(bridge.getMicMonitoring()).toEqual({ enabled: true, level: 0.4 })
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))).toEqual({ enabled: true, level: 0.4 })
  })

  /**
   * The renderer is not trusted to have clamped. Returning the *stored* value
   * rather than the requested one is what keeps a slider from sitting at a
   * position the audio path is not actually honouring.
   */
  it('clamps an out-of-range level before persisting it, and returns what it stored', () => {
    const { handlers, IPC_CHANNELS, bridge } = setupWithMockedElectron()

    const result = handlers[IPC_CHANNELS.AUDIO_SET_MIC_MONITOR.channel](null, { enabled: true, level: 9 })

    expect(result).toEqual({ enabled: true, level: 1 })
    expect(bridge.getMicMonitoring()).toEqual({ enabled: true, level: 1 })
  })

  it('turning monitoring off applies "off" to the native bridge, not just to the file', () => {
    const { handlers, IPC_CHANNELS, bridge } = setupWithMockedElectron({
      initialFile: JSON.stringify({ enabled: true, level: 0.6 }),
    })
    expect(bridge.getMicMonitoring().enabled).toBe(true)

    handlers[IPC_CHANNELS.AUDIO_SET_MIC_MONITOR.channel](null, { enabled: false, level: 0.6 })

    expect(bridge.getMicMonitoring()).toEqual({ enabled: false, level: 0.6 })
  })

  /**
   * With no compiled addon, main.cjs substitutes an offline bridge whose
   * methods are no-ops. Settings still has to work -- a switch that throws is
   * worse than a switch that is not audible yet.
   */
  it('works against a bridge whose setMicMonitoring does nothing', () => {
    const offlineBridge = { setMicMonitoring: () => {} }
    const settingsPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mic-monitor-offline-')), 'mic-monitor.json')
    const handlers = {}

    require.cache[electronModulePath] = {
      id: electronModulePath,
      filename: electronModulePath,
      loaded: true,
      exports: {
        ipcMain: {
          handle: (channel, listener) => {
            handlers[channel] = listener
          },
        },
      },
    }
    delete require.cache[ipcRegistryModulePath]
    delete require.cache[monitorIpcModulePath]
    const { IPC_CHANNELS } = require('../../ipc-registry.cjs')
    const { registerMicMonitorIpcHandlers } = require('../monitor-ipc.cjs')

    expect(() => registerMicMonitorIpcHandlers(offlineBridge, () => settingsPath)).not.toThrow()
    expect(handlers[IPC_CHANNELS.AUDIO_SET_MIC_MONITOR.channel](null, { enabled: true, level: 0.2 })).toEqual({
      enabled: true,
      level: 0.2,
    })
  })
})
