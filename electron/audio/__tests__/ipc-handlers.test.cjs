// @vitest-environment node
const { createFakeAudioBridge } = require('../test-helpers/fakeAudioBridge.cjs')
const { DEFAULT_POLL_INTERVAL_MS } = require('../device-watcher.cjs')

const electronModulePath = require.resolve('electron')
const ipcRegistryModulePath = require.resolve('../../ipc-registry.cjs')
const permissionModulePath = require.resolve('../permission.cjs')
const ipcHandlersModulePath = require.resolve('../ipc-handlers.cjs')

const MIC_1 = { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }
const MIC_2 = { id: 'mic-2', name: 'Interface In 1', channelCount: 1, sampleRate: 48000 }

function setupWithMockedElectron({ devices = [MIC_1], askResult = true, status = 'granted', getWindow } = {}) {
  const handlers = {}
  const sentEvents = []

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
      systemPreferences: {
        askForMediaAccess: () => Promise.resolve(askResult),
        getMediaAccessStatus: () => status,
      },
    },
  }

  delete require.cache[ipcRegistryModulePath]
  delete require.cache[permissionModulePath]
  delete require.cache[ipcHandlersModulePath]
  const { IPC_CHANNELS } = require('../../ipc-registry.cjs')
  const { registerAudioIpcHandlers } = require('../ipc-handlers.cjs')

  const bridge = createFakeAudioBridge(devices)
  const fakeWindow = { webContents: { send: (channel, payload) => sentEvents.push({ channel, payload }) } }
  const { stopWatcher, dispose } = registerAudioIpcHandlers(bridge, getWindow ?? (() => fakeWindow))

  return { handlers, sentEvents, IPC_CHANNELS, bridge, stopWatcher, dispose }
}

function cleanup() {
  delete require.cache[electronModulePath]
  delete require.cache[ipcRegistryModulePath]
  delete require.cache[permissionModulePath]
  delete require.cache[ipcHandlersModulePath]
  vi.useRealTimers()
}

describe('registerAudioIpcHandlers: devices + permission', () => {
  afterEach(cleanup)

  it('AUDIO_LIST_DEVICES returns the bridge device list', async () => {
    const { handlers, IPC_CHANNELS } = setupWithMockedElectron({ devices: [MIC_1, MIC_2] })
    expect(handlers[IPC_CHANNELS.AUDIO_LIST_DEVICES.channel]()).toEqual([MIC_1, MIC_2])
  })

  /**
   * Seen in the running app's main-process log: once the renderer frame goes
   * away (window close, dev reload, crashed frame) every relayed pitch batch --
   * ~30 a second per open capture -- threw "Render frame was disposed before
   * WebFrameMain could be accessed" out of the *native* addon's callback,
   * flooding the log with stack traces from inside the audio thread.
   */
  it('drops relayed events instead of throwing when the renderer frame is gone', () => {
    const disposed = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: () => {
          throw new Error('Render frame was disposed before WebFrameMain could be accessed')
        },
      },
    }
    const { handlers, IPC_CHANNELS, bridge } = setupWithMockedElectron({ getWindow: () => disposed })

    handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, MIC_1.id)
    // The native audio thread delivering a batch into a window that is gone.
    expect(() => bridge.emitBatch(MIC_1.id, [1000], [220, 0.9, 0.3])).not.toThrow()
  })

  it('does not even reach webContents on a destroyed window', () => {
    let sends = 0
    const destroyed = {
      isDestroyed: () => true,
      webContents: {
        isDestroyed: () => false,
        send: () => {
          sends += 1
        },
      },
    }
    const { handlers, IPC_CHANNELS, bridge } = setupWithMockedElectron({ getWindow: () => destroyed })

    handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, MIC_1.id)
    bridge.emitBatch(MIC_1.id, [1000], [220, 0.9, 0.3])
    expect(sends).toBe(0)
  })

  it('AUDIO_REQUEST_PERMISSION and AUDIO_GET_PERMISSION_STATUS call through to permission.cjs', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const { handlers, IPC_CHANNELS } = setupWithMockedElectron({ askResult: true, status: 'denied' })
    await expect(handlers[IPC_CHANNELS.AUDIO_REQUEST_PERMISSION.channel]()).resolves.toBe('granted')
    expect(handlers[IPC_CHANNELS.AUDIO_GET_PERMISSION_STATUS.channel]()).toBe('denied')
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })
})

describe('registerAudioIpcHandlers: capture start/stop + batch relay', () => {
  afterEach(cleanup)

  it('starting capture registers with the bridge and relays a decoded batch as AUDIO_PITCH_BATCH', async () => {
    const { handlers, sentEvents, IPC_CHANNELS, bridge } = setupWithMockedElectron()

    await handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, MIC_1.id)
    expect(bridge.isCapturing(MIC_1.id)).toBe(true)

    bridge.emitBatch(MIC_1.id, new Float64Array([1000]), new Float32Array([220, 0.9, 0.25]))

    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0].channel).toBe(IPC_CHANNELS.AUDIO_PITCH_BATCH.channel)
    expect(sentEvents[0].payload.deviceId).toBe(MIC_1.id)
    expect(sentEvents[0].payload.samples).toEqual([
      { t: 1000, hz: 220, confidence: expect.closeTo(0.9, 4), rms: expect.closeTo(0.25, 4), deviceId: MIC_1.id },
    ])
  })

  it('stopping capture unregisters with the bridge, no further batches relay', async () => {
    const { handlers, sentEvents, IPC_CHANNELS, bridge } = setupWithMockedElectron()
    await handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, MIC_1.id)
    await handlers[IPC_CHANNELS.AUDIO_STOP_CAPTURE.channel]({}, MIC_1.id)
    expect(bridge.isCapturing(MIC_1.id)).toBe(false)
    bridge.emitBatch(MIC_1.id, new Float64Array([1000]), new Float32Array([220, 0.9, 0.25]))
    expect(sentEvents).toHaveLength(0)
  })

  it('starting capture with a composite key routes the channel index to the bridge and relays under the composite key', async () => {
    const { handlers, sentEvents, IPC_CHANNELS, bridge } = setupWithMockedElectron({ devices: [MIC_2] })

    await handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, 'mic-2#1')
    expect(bridge.isCapturing('mic-2', 1)).toBe(true)
    expect(bridge.isCapturing('mic-2', 0)).toBe(false)

    bridge.emitBatch('mic-2', new Float64Array([1000]), new Float32Array([220, 0.9, 0.25]), 1)

    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0].payload.deviceId).toBe('mic-2#1')
    expect(sentEvents[0].payload.samples[0].deviceId).toBe('mic-2#1')
  })

  it('a bare deviceId key (no #) still targets channel 0, unchanged from before channel routing existed', async () => {
    const { handlers, sentEvents, IPC_CHANNELS, bridge } = setupWithMockedElectron()

    await handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, MIC_1.id)
    expect(bridge.isCapturing(MIC_1.id, 0)).toBe(true)

    bridge.emitBatch(MIC_1.id, new Float64Array([1000]), new Float32Array([220, 0.9, 0.25]))
    expect(sentEvents[0].payload.deviceId).toBe(MIC_1.id)
  })

  it('stopping capture with a composite key stops only that channel', async () => {
    const { handlers, sentEvents, IPC_CHANNELS, bridge } = setupWithMockedElectron({ devices: [MIC_2] })

    await handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, 'mic-2#1')
    await handlers[IPC_CHANNELS.AUDIO_STOP_CAPTURE.channel]({}, 'mic-2#1')
    expect(bridge.isCapturing('mic-2', 1)).toBe(false)

    bridge.emitBatch('mic-2', new Float64Array([1000]), new Float32Array([220, 0.9, 0.25]), 1)
    expect(sentEvents).toHaveLength(0)
  })

  it('a mid-stream disconnect sentinel (null times) stops capture and relays AUDIO_DEVICE_LIST_CHANGED', async () => {
    const { handlers, sentEvents, IPC_CHANNELS, bridge } = setupWithMockedElectron({ devices: [MIC_1, MIC_2] })
    await handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, MIC_1.id)
    await handlers[IPC_CHANNELS.AUDIO_LIST_DEVICES.channel]() // refresh known devices, mirrors real renderer flow

    bridge.setDevices([MIC_2]) // the cable really was pulled
    bridge.emitBatch(MIC_1.id, null, null)

    expect(bridge.isCapturing(MIC_1.id)).toBe(false)
    const relayed = sentEvents.find((e) => e.channel === IPC_CHANNELS.AUDIO_DEVICE_LIST_CHANGED.channel)
    expect(relayed.payload.devices).toEqual([MIC_2])
    expect(relayed.payload.removed).toEqual([MIC_1])
    expect(relayed.payload.added).toEqual([])
  })

  it('a sentinel from a device that is still plugged in does not fabricate a removal', async () => {
    // The sentinel means "this stream died", which is not the same as "this
    // hardware is gone" -- a cpal stream error can fire with the device still
    // enumerable. Reporting a removal the device-watcher will never contradict
    // (its next poll sees no change, so it emits no `added`) would strand the
    // renderer: the seat is torn down and nothing ever restores it.
    const { handlers, sentEvents, IPC_CHANNELS, bridge } = setupWithMockedElectron({ devices: [MIC_1, MIC_2] })
    await handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, MIC_1.id)
    await handlers[IPC_CHANNELS.AUDIO_LIST_DEVICES.channel]()

    bridge.emitBatch(MIC_1.id, null, null)

    const relayed = sentEvents.find((e) => e.channel === IPC_CHANNELS.AUDIO_DEVICE_LIST_CHANGED.channel)
    expect(relayed.payload.devices).toEqual([MIC_1, MIC_2])
    expect(relayed.payload.removed).toEqual([])
  })

  it('reports a sentinel removal against live enumeration, not a stale known-device list', async () => {
    // Regression: the old path filtered its own `knownDevices` cache, so
    // whatever else had changed since the last AUDIO_LIST_DEVICES call was
    // silently reported as still present.
    const { handlers, sentEvents, IPC_CHANNELS, bridge } = setupWithMockedElectron({ devices: [MIC_1] })
    await handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, MIC_1.id)
    await handlers[IPC_CHANNELS.AUDIO_LIST_DEVICES.channel]()

    bridge.setDevices([MIC_2]) // MIC_1 out, MIC_2 in, between polls
    bridge.emitBatch(MIC_1.id, null, null)

    const relayed = sentEvents.find((e) => e.channel === IPC_CHANNELS.AUDIO_DEVICE_LIST_CHANGED.channel)
    expect(relayed.payload.devices).toEqual([MIC_2])
    expect(relayed.payload.removed).toEqual([MIC_1])
    expect(relayed.payload.added).toEqual([MIC_2])
  })
})

describe('registerAudioIpcHandlers: raw scope (lab-only)', () => {
  afterEach(cleanup)

  it('gates the raw-scope callback to between start and stop', async () => {
    const { handlers, sentEvents, IPC_CHANNELS, bridge } = setupWithMockedElectron()

    bridge.emitScopeChunk(MIC_1.id, new Float32Array([0.1, 0.2]))
    expect(sentEvents).toHaveLength(0)

    await handlers[IPC_CHANNELS.AUDIO_START_RAW_SCOPE.channel]({}, MIC_1.id)
    bridge.emitScopeChunk(MIC_1.id, new Float32Array([0.1, 0.2]))
    expect(sentEvents).toHaveLength(1)
    expect(sentEvents[0].channel).toBe(IPC_CHANNELS.AUDIO_RAW_SCOPE_CHUNK.channel)
    expect(sentEvents[0].payload).toEqual({ deviceId: MIC_1.id, chunk: new Float32Array([0.1, 0.2]) })

    await handlers[IPC_CHANNELS.AUDIO_STOP_RAW_SCOPE.channel]({}, MIC_1.id)
    bridge.emitScopeChunk(MIC_1.id, new Float32Array([0.3]))
    expect(sentEvents).toHaveLength(1)
  })
})

describe('registerAudioIpcHandlers: device-watcher relay', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(cleanup)

  it('relays a device-list diff as AUDIO_DEVICE_LIST_CHANGED', () => {
    const bridge = createFakeAudioBridge([MIC_1])
    const handlers = {}
    require.cache[electronModulePath] = {
      id: electronModulePath,
      filename: electronModulePath,
      loaded: true,
      exports: { ipcMain: { handle: (channel, listener) => { handlers[channel] = listener } } },
    }
    delete require.cache[ipcRegistryModulePath]
    delete require.cache[ipcHandlersModulePath]
    const { IPC_CHANNELS } = require('../../ipc-registry.cjs')
    const { registerAudioIpcHandlers } = require('../ipc-handlers.cjs')

    const sentEvents = []
    const fakeWindow = { webContents: { send: (channel, payload) => sentEvents.push({ channel, payload }) } }
    registerAudioIpcHandlers(bridge, () => fakeWindow)

    bridge.listDevices = () => [MIC_1, MIC_2]
    vi.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS)

    const relayed = sentEvents.find((e) => e.channel === IPC_CHANNELS.AUDIO_DEVICE_LIST_CHANGED.channel)
    expect(relayed.payload.added).toEqual([MIC_2])
  })

  it('does not enumerate devices while gameplay is active, and catches up afterwards', () => {
    const bridge = createFakeAudioBridge([MIC_1])
    require.cache[electronModulePath] = {
      id: electronModulePath,
      filename: electronModulePath,
      loaded: true,
      exports: { ipcMain: { handle: () => {} } },
    }
    delete require.cache[ipcRegistryModulePath]
    delete require.cache[ipcHandlersModulePath]
    const { IPC_CHANNELS } = require('../../ipc-registry.cjs')
    const { registerAudioIpcHandlers } = require('../ipc-handlers.cjs')

    const sentEvents = []
    const fakeWindow = { webContents: { send: (channel, payload) => sentEvents.push({ channel, payload }) } }
    let gameplay = true
    const { pollDevicesNow } = registerAudioIpcHandlers(bridge, () => fakeWindow, { isGameplayActive: () => gameplay })

    const listDevices = vi.fn(() => [MIC_1, MIC_2])
    bridge.listDevices = listDevices
    vi.advanceTimersByTime(DEFAULT_POLL_INTERVAL_MS * 3)
    expect(listDevices).not.toHaveBeenCalled()

    gameplay = false
    pollDevicesNow()
    expect(listDevices).toHaveBeenCalledTimes(1)
    const relayed = sentEvents.find((e) => e.channel === IPC_CHANNELS.AUDIO_DEVICE_LIST_CHANGED.channel)
    expect(relayed.payload.added).toEqual([MIC_2])
  })
})

describe('registerAudioIpcHandlers: pitch relay coalescing and teardown', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(cleanup)

  it('sends a batch at once, merges batches that arrive inside the send window, and keeps the payload shape', async () => {
    const { handlers, sentEvents, IPC_CHANNELS, bridge } = setupWithMockedElectron({ devices: [MIC_1] })
    await handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, MIC_1.id)

    bridge.emitBatch(MIC_1.id, new Float64Array([1000]), new Float32Array([220, 0.9, 0.25]))
    bridge.emitBatch(MIC_1.id, new Float64Array([1010]), new Float32Array([221, 0.9, 0.25]))
    bridge.emitBatch(MIC_1.id, new Float64Array([1020]), new Float32Array([222, 0.9, 0.25]))

    const pitch = () => sentEvents.filter((e) => e.channel === IPC_CHANNELS.AUDIO_PITCH_BATCH.channel)
    expect(pitch()).toHaveLength(1)
    expect(pitch()[0].payload.samples.map((s) => s.t)).toEqual([1000])

    vi.advanceTimersByTime(50)
    expect(pitch()).toHaveLength(2)
    expect(pitch()[1].payload).toEqual({
      deviceId: MIC_1.id,
      samples: [
        { t: 1010, hz: 221, confidence: expect.any(Number), rms: 0.25, deviceId: MIC_1.id },
        { t: 1020, hz: 222, confidence: expect.any(Number), rms: 0.25, deviceId: MIC_1.id },
      ],
    })
  })

  it('drops a pending merged batch when the capture stops', async () => {
    const { handlers, sentEvents, IPC_CHANNELS, bridge } = setupWithMockedElectron({ devices: [MIC_1] })
    await handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, MIC_1.id)
    bridge.emitBatch(MIC_1.id, new Float64Array([1000]), new Float32Array([220, 0.9, 0.25]))
    bridge.emitBatch(MIC_1.id, new Float64Array([1010]), new Float32Array([221, 0.9, 0.25]))
    await handlers[IPC_CHANNELS.AUDIO_STOP_CAPTURE.channel]({}, MIC_1.id)

    vi.advanceTimersByTime(50)
    expect(sentEvents.filter((e) => e.channel === IPC_CHANNELS.AUDIO_PITCH_BATCH.channel)).toHaveLength(1)
  })

  it('dispose stops every open capture and raw scope', async () => {
    const result = setupWithMockedElectron({ devices: [MIC_1, MIC_2] })
    const { handlers, IPC_CHANNELS, bridge } = result
    await handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, MIC_1.id)
    await handlers[IPC_CHANNELS.AUDIO_START_CAPTURE.channel]({}, 'mic-2#1')
    await handlers[IPC_CHANNELS.AUDIO_START_RAW_SCOPE.channel]({}, MIC_1.id)

    result.dispose()

    expect(bridge.isCapturing(MIC_1.id)).toBe(false)
    expect(bridge.isCapturing('mic-2', 1)).toBe(false)
    expect(bridge.isScoping(MIC_1.id)).toBe(false)
  })
})
