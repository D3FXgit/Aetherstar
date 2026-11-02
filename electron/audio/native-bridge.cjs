// Loads the compiled native/ napi-rs addon and decodes its batched
// pitch-stream callback format into PitchSample[].
//
// Each capture callback fires as (deviceId, times, values):
//   times  - Float64Array, one epoch-ms timestamp per analysed frame
//   values - Float32Array, interleaved [hz, confidence, rms] triples, three per frame
// Timestamps get their own Float64 channel because epoch-ms (~1.7e12) exceeds
// Float32's exact-integer range (2^24) -- packing t into the same Float32Array
// as hz/confidence/rms would silently corrupt every timestamp by up to ~100s.
//
// A frame whose pitch was rejected (below the native noise gate, or no YIN
// threshold crossing) still arrives, carrying hz = confidence = 0 and its real
// measured rms -- that's how the renderer's input meters keep reading while a
// mic is silent. src/audio/pitchStore.ts is what keeps those level-only frames
// out of the pitch stream proper.

/**
 * Floats each frame contributes to `values`. The Rust counterpart is
 * `VALUES_PER_FRAME` in native/src/worker.rs, and the two MUST agree: getting
 * this wrong doesn't fail loudly on its own, it just pairs values[i * stride]
 * with the wrong times[i] and shifts every timestamp in the stream. The
 * length check in decodeBatch below is what turns that silent corruption into
 * an immediate, named failure.
 */
const PITCH_VALUES_PER_FRAME = 3

function decodeBatch(deviceId, times, values) {
  if (values.length !== times.length * PITCH_VALUES_PER_FRAME) {
    // Only reachable if the loaded .node binary was built against a different
    // stride than this file expects -- i.e. a stale native/index.node. Failing
    // here beats emitting a stream of plausible-looking but wrongly-timestamped
    // pitches that nobody can trace back to a missed `npm run build:native`.
    throw new Error(
      `native pitch batch stride mismatch: ${times.length} timestamps but ${values.length} values ` +
        `(expected ${times.length * PITCH_VALUES_PER_FRAME} at ${PITCH_VALUES_PER_FRAME} per frame). ` +
        'The compiled native addon is out of date -- run `npm run build:native`.',
    )
  }

  const samples = []
  for (let i = 0; i < times.length; i++) {
    const base = i * PITCH_VALUES_PER_FRAME
    samples.push({
      t: times[i],
      hz: values[base],
      confidence: values[base + 1],
      rms: values[base + 2],
      deviceId,
    })
  }
  return samples
}

function loadNativeAddon() {
  try {
    // Resolved at runtime, only present once native/ is built.
    return require('../../native')
  } catch {
    return null
  }
}

// `addon` is injectable so callers (and tests) can pass a fake in place of
// the real compiled module -- see test-helpers/fakeAudioBridge.cjs.
function createNativeBridge(addon = loadNativeAddon()) {
  if (!addon) return null
  return new addon.AudioBridge()
}

module.exports = { PITCH_VALUES_PER_FRAME, decodeBatch, loadNativeAddon, createNativeBridge }
