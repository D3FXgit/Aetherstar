// Capture keys: a bare deviceId means channel 0, `${deviceId}#${channelIndex}`
// any other channel, so startCapture/stopCapture keep a single-string
// signature. Only ipc-handlers.cjs parses this before calling the addon.
function formatCaptureKey(deviceId, channelIndex) {
  return channelIndex === 0 ? deviceId : `${deviceId}#${channelIndex}`
}

function parseCaptureKey(key) {
  const separatorIndex = key.indexOf('#')
  if (separatorIndex === -1) return { deviceId: key, channelIndex: 0 }
  return { deviceId: key.slice(0, separatorIndex), channelIndex: Number(key.slice(separatorIndex + 1)) }
}

module.exports = { formatCaptureKey, parseCaptureKey }
