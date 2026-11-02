// Manual smoke check -- confirms the compiled addon loads and its JS-facing
// API doesn't throw. Not part of `npm test`: JS tests always use the fake
// bridge, never the real compiled addon.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { AudioBridge } = require('./index.node')

const bridge = new AudioBridge()
const devices = bridge.listDevices()

if (!Array.isArray(devices)) {
  throw new Error(`listDevices() did not return an array: ${JSON.stringify(devices)}`)
}

for (const device of devices) {
  if (typeof device.id !== 'string' || typeof device.name !== 'string') {
    throw new Error(`malformed device entry: ${JSON.stringify(device)}`)
  }
}

console.log(`smoke-test: AudioBridge loaded OK, listDevices() returned ${devices.length} device(s):`)
for (const d of devices) {
  console.log(`  - ${d.name} (id=${d.id}, channels=${d.channelCount}, rate=${d.sampleRate})`)
}
