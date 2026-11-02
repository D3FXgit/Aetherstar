// Hand-written stand-in for the real native/ AudioBridge (JS-side tests never require a compiled .node addon). Matches
// AudioBridge's real shape (listDevices/startCapture/stopCapture/startRawScope/
// stopRawScope) so ipc-handlers.cjs/native-bridge.cjs tests can exercise the
// real decode/relay logic against controllable fake data, plus a few
// test-only emit*/is* helpers that aren't part of the real native surface.
//
// startCapture/stopCapture take (deviceId, channelIndex, ...) for multi-channel
// routing -- keyed internally by `${deviceId}:${channelIndex}`
// so two channel subscriptions on the same device don't collide.
function createFakeAudioBridge(initialDevices = []) {
  const captureCallbacks = new Map()
  const scopeCallbacks = new Map()
  let devices = initialDevices
  // Matches the real addon's default: monitoring starts off and silent.
  let micMonitoring = { enabled: false, level: 0 }

  const captureKey = (deviceId, channelIndex) => `${deviceId}:${channelIndex}`

  return {
    listDevices: () => devices,

    startCapture: (deviceId, channelIndex, callback) => {
      captureCallbacks.set(captureKey(deviceId, channelIndex), callback)
    },
    stopCapture: (deviceId, channelIndex) => {
      captureCallbacks.delete(captureKey(deviceId, channelIndex))
    },

    startRawScope: (deviceId, callback) => {
      scopeCallbacks.set(deviceId, callback)
    },
    stopRawScope: (deviceId) => {
      scopeCallbacks.delete(deviceId)
    },

    setMicMonitoring: (enabled, level) => {
      micMonitoring = { enabled, level }
    },

    // --- test-only helpers, not part of the real AudioBridge surface ---
    getMicMonitoring: () => micMonitoring,
    // Re-enumeration is what actually happens when hardware is unplugged, so a
    // disconnect test has to change what listDevices() reports, not just fire
    // an event about it.
    setDevices: (next) => {
      devices = next
    },
    // Callbacks are invoked with a single array arg, matching napi-rs's real
    // tuple-callback marshaling (verified against the compiled native/index.d.ts
    // -- see native-bridge.cjs's comment). Kept as separate params here purely
    // for test-call readability.
    emitBatch: (deviceId, times, values, channelIndex = 0) => {
      captureCallbacks.get(captureKey(deviceId, channelIndex))?.([deviceId, times, values])
    },
    emitScopeChunk: (deviceId, chunk) => {
      scopeCallbacks.get(deviceId)?.([deviceId, chunk])
    },
    isCapturing: (deviceId, channelIndex = 0) => captureCallbacks.has(captureKey(deviceId, channelIndex)),
    isScoping: (deviceId) => scopeCallbacks.has(deviceId),
  }
}

module.exports = { createFakeAudioBridge }
