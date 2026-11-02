// Wires every AUDIO_* IPC channel to the AudioBridge + permission + device-watcher
// modules, relaying native/device events to the renderer.
const { ipcMain } = require('electron')
const { IPC_CHANNELS } = require('../ipc-registry.cjs')
const { decodeBatch } = require('./native-bridge.cjs')
const permission = require('./permission.cjs')
const { diffDeviceLists, startDeviceWatcher } = require('./device-watcher.cjs')
const { parseCaptureKey } = require('./captureKey.cjs')

/**
 * Minimum spacing between two AUDIO_PITCH_BATCH messages for one capture.
 *
 * The native layer batches ~10 ms pitch frames into ~20-30 ms flushes today,
 * so at that cadence this never delays anything: a batch that arrives at least
 * this long after the previous send goes out immediately. It only bites if the
 * addon ever flushes faster (one frame per callback is 100 messages a second
 * per mic, x4 mics), in which case batches arriving inside the window are
 * merged into one message -- same `{ deviceId, samples }` shape, just more
 * samples -- instead of flooding the renderer's IPC queue.
 */
const PITCH_SEND_MIN_INTERVAL_MS = 8

// `bridge` must expose the AudioBridge JS-facing shape (native-bridge.cjs /
// test-helpers/fakeAudioBridge.cjs). `getMainWindow` is a thunk, not a direct
// reference, so a recreated window after close still gets relayed to.
//
// `isGameplayActive` pauses device-list polling while a song is being sung
// (see device-watcher.cjs for why polling is expensive).
function registerAudioIpcHandlers(
  bridge,
  getMainWindow,
  { isGameplayActive = () => false, pitchSendMinIntervalMs = PITCH_SEND_MIN_INTERVAL_MS, pollIntervalMs } = {},
) {
  let knownDevices = bridge.listDevices()
  /** captureKey -> { deviceId, channelIndex } for every capture this module started. */
  const activeCaptures = new Map()
  const activeRawScopes = new Set()
  /** captureKey -> { pending: PitchSample[] | null, timer, lastSentAt } */
  const pitchQueues = new Map()

  // The pitch relay below runs inside the *native* addon's callback, on every
  // batch (~30/s per open capture). Once the renderer frame goes away -- a
  // window close, a dev reload, a crashed frame -- `webContents.send` throws
  // "Render frame was disposed before WebFrameMain could be accessed" for every
  // one of those batches: observed in the running app as an unbounded stack
  // trace flood in the main-process log, with the exception escaping back into
  // the audio thread's callback rather than into anything that handles it.
  // A window that is going away is a normal fact, not an error, so drop the
  // payload and keep the stream alive.
  function send(channel, payload) {
    const window = getMainWindow()
    if (!window || window.isDestroyed?.()) return
    const { webContents } = window
    if (!webContents || webContents.isDestroyed?.()) return
    try {
      webContents.send(channel, payload)
    } catch {
      // The frame was disposed between the checks above and the send.
    }
  }

  function flushPitch(captureKey) {
    const queue = pitchQueues.get(captureKey)
    if (!queue || !queue.pending) return
    const samples = queue.pending
    queue.pending = null
    queue.timer = null
    queue.lastSentAt = Date.now()
    send(IPC_CHANNELS.AUDIO_PITCH_BATCH.channel, { deviceId: captureKey, samples })
  }

  function relayPitch(captureKey, samples) {
    let queue = pitchQueues.get(captureKey)
    if (!queue) {
      queue = { pending: null, timer: null, lastSentAt: -Infinity }
      pitchQueues.set(captureKey, queue)
    }
    if (queue.pending) {
      // A merged send is already scheduled; ride along with it.
      for (const sample of samples) queue.pending.push(sample)
      return
    }
    const now = Date.now()
    const sinceLast = now - queue.lastSentAt
    if (sinceLast >= pitchSendMinIntervalMs) {
      queue.lastSentAt = now
      send(IPC_CHANNELS.AUDIO_PITCH_BATCH.channel, { deviceId: captureKey, samples })
      return
    }
    queue.pending = samples
    queue.timer = setTimeout(() => flushPitch(captureKey), pitchSendMinIntervalMs - sinceLast)
  }

  function dropPitchQueue(captureKey) {
    const queue = pitchQueues.get(captureKey)
    if (queue?.timer) clearTimeout(queue.timer)
    pitchQueues.delete(captureKey)
  }

  ipcMain.handle(IPC_CHANNELS.AUDIO_LIST_DEVICES.channel, () => {
    knownDevices = bridge.listDevices()
    return knownDevices
  })

  ipcMain.handle(IPC_CHANNELS.AUDIO_REQUEST_PERMISSION.channel, () => permission.requestMicPermission())
  ipcMain.handle(IPC_CHANNELS.AUDIO_GET_PERMISSION_STATUS.channel, () => permission.getMicPermissionStatus())

  ipcMain.handle(IPC_CHANNELS.AUDIO_START_CAPTURE.channel, (_event, captureKey) => {
    // captureKey is a bare deviceId (channel 0) or `deviceId#channelIndex`
    // (captureKey.cjs) -- this is the only place that parses it back apart.
    const { deviceId, channelIndex } = parseCaptureKey(captureKey)
    activeCaptures.set(captureKey, { deviceId, channelIndex })

    // napi-rs delivers a Rust tuple callback arg as ONE JS array, not
    // positional args (see the compiled native/index.d.ts).
    // The device id the native layer echoes back is deliberately ignored: the
    // relay below keys off the caller's composite capture key, and the
    // disconnect branch re-enumerates rather than trusting the echo.
    bridge.startCapture(deviceId, channelIndex, ([, times, values]) => {
      // A null `times` is a defensive mid-stream disconnect/error sentinel
      // -- not a batch, so decode nothing and instead
      // relay the same AUDIO_DEVICE_LIST_CHANGED shape the device-watcher's
      // poll produces, computed the same way, from live enumeration.
      // NOTE: the current native crate doesn't emit this sentinel yet (a
      // cpal stream error only eprintln!s today); real disconnects are only
      // caught by device-watcher's ~2s poll until that's wired through. This
      // branch stays so the relay path is ready the moment it is.
      if (times === null) {
        bridge.stopCapture(deviceId, channelIndex)
        activeCaptures.delete(captureKey)
        dropPitchQueue(captureKey)
        // Re-enumerate rather than assuming the sentinel means this device is
        // gone. A dead stream is not the same fact as absent hardware, and the
        // difference matters to recovery: the device-watcher only ever reports
        // what changed since *its* last poll, so a removal fabricated here that
        // enumeration does not agree with is one the watcher will never undo
        // with a matching `added` -- the renderer would tear the seat down and
        // nothing would ever bring it back. Asking the bridge costs one
        // enumeration and is the only answer that can be right.
        const previousDevices = knownDevices
        knownDevices = bridge.listDevices()
        const { added, removed } = diffDeviceLists(previousDevices, knownDevices)
        send(IPC_CHANNELS.AUDIO_DEVICE_LIST_CHANGED.channel, { devices: knownDevices, added, removed })
        return
      }
      // Relay under the original composite capture key, not whatever raw
      // device id the native layer reports -- two channel subscriptions on
      // the same physical device must produce distinct payload.deviceId
      // values so the renderer's activeCaptures keying stays consistent.
      relayPitch(captureKey, decodeBatch(captureKey, times, values))
    })
  })

  ipcMain.handle(IPC_CHANNELS.AUDIO_STOP_CAPTURE.channel, (_event, captureKey) => {
    const { deviceId, channelIndex } = parseCaptureKey(captureKey)
    bridge.stopCapture(deviceId, channelIndex)
    activeCaptures.delete(captureKey)
    dropPitchQueue(captureKey)
  })

  ipcMain.handle(IPC_CHANNELS.AUDIO_START_RAW_SCOPE.channel, (_event, deviceId) => {
    activeRawScopes.add(deviceId)
    bridge.startRawScope(deviceId, ([id, chunk]) => {
      send(IPC_CHANNELS.AUDIO_RAW_SCOPE_CHUNK.channel, { deviceId: id, chunk })
    })
  })

  ipcMain.handle(IPC_CHANNELS.AUDIO_STOP_RAW_SCOPE.channel, (_event, deviceId) => {
    bridge.stopRawScope(deviceId)
    activeRawScopes.delete(deviceId)
  })

  const stopWatcher = startDeviceWatcher(
    bridge,
    (diff) => {
      knownDevices = diff.devices
      send(IPC_CHANNELS.AUDIO_DEVICE_LIST_CHANGED.channel, diff)
    },
    pollIntervalMs,
    { isPaused: isGameplayActive },
  )

  /** Re-enumerate now -- called when gameplay ends, so a mic unplugged mid-song is noticed at once. */
  const pollDevicesNow = () => stopWatcher.pollNow?.()

  /**
   * Quit-time teardown: stop polling, close every capture and raw scope this
   * module opened (so the native audio threads stop calling back into a
   * dying JS runtime), drop pending pitch sends, and let the addon release
   * whatever else it holds if it offers a way to.
   */
  function dispose() {
    stopWatcher()
    for (const [captureKey, { deviceId, channelIndex }] of activeCaptures) {
      try {
        bridge.stopCapture(deviceId, channelIndex)
      } catch {
        // Already stopped / device gone.
      }
      dropPitchQueue(captureKey)
    }
    activeCaptures.clear()
    for (const deviceId of activeRawScopes) {
      try {
        bridge.stopRawScope(deviceId)
      } catch {
        // Already stopped.
      }
    }
    activeRawScopes.clear()
    for (const captureKey of [...pitchQueues.keys()]) dropPitchQueue(captureKey)
    try {
      bridge.dispose?.()
    } catch {
      // Best effort on the way out.
    }
  }

  return { stopWatcher, pollDevicesNow, dispose }
}

module.exports = { registerAudioIpcHandlers, PITCH_SEND_MIN_INTERVAL_MS }
