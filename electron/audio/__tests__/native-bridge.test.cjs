// @vitest-environment node
const { PITCH_VALUES_PER_FRAME, decodeBatch, createNativeBridge } = require('../native-bridge.cjs')
const { createFakeAudioBridge } = require('../test-helpers/fakeAudioBridge.cjs')

describe('decodeBatch', () => {
  it('decodes times/values into well-formed PitchSample objects', () => {
    const times = new Float64Array([1_700_000_000_123, 1_700_000_000_133])
    const values = new Float32Array([220, 0.9, 0.25, 225, 0.85, 0.3])

    const samples = decodeBatch('mic-1', times, values)

    expect(samples).toHaveLength(2)
    expect(samples[0].t).toBe(1_700_000_000_123)
    expect(samples[0].hz).toBeCloseTo(220, 4)
    expect(samples[0].confidence).toBeCloseTo(0.9, 4)
    expect(samples[0].rms).toBeCloseTo(0.25, 4)
    expect(samples[0].deviceId).toBe('mic-1')
    expect(samples[1].t).toBe(1_700_000_000_133)
    expect(samples[1].hz).toBeCloseTo(225, 4)
    expect(samples[1].confidence).toBeCloseTo(0.85, 4)
    expect(samples[1].rms).toBeCloseTo(0.3, 4)
  })

  it('preserves full epoch-ms precision that a Float32Array could not', () => {
    // 2^24 is the largest integer Float32 can represent exactly; epoch-ms is well past it.
    const epochMs = Date.now()
    const times = new Float64Array([epochMs])
    const values = new Float32Array([440, 1, 0.5])

    const [sample] = decodeBatch('mic-1', times, values)

    expect(sample.t).toBe(epochMs)
  })

  it('returns an empty array for an empty batch', () => {
    expect(decodeBatch('mic-1', new Float64Array(), new Float32Array())).toEqual([])
  })

  it('carries the level of a frame the native noise gate rejected', () => {
    // What the native side emits for a silent-but-live mic: no pitch, real rms.
    // If these frames were dropped, a working-but-quiet input would look
    // identical to an unplugged one -- the exact misread the meter prevents.
    const times = new Float64Array([1_700_000_000_123])
    const values = new Float32Array([0, 0, 0.004])

    const [sample] = decodeBatch('mic-1', times, values)

    expect(sample.hz).toBe(0)
    expect(sample.confidence).toBe(0)
    expect(sample.rms).toBeCloseTo(0.004, 5)
  })

  it('keeps every timestamp paired with its own frame across a long batch', () => {
    // The stride bug's signature is a slow drift: frame 0 looks fine and later
    // frames read someone else's values. Ten frames make that visible.
    const frameCount = 10
    const times = new Float64Array(Array.from({ length: frameCount }, (_, i) => 1_700_000_000_000 + i * 30))
    const values = new Float32Array(
      Array.from({ length: frameCount }, (_, i) => [100 + i, i / 100, i / 1000]).flat(),
    )

    const samples = decodeBatch('mic-1', times, values)

    expect(values.length).toBe(times.length * PITCH_VALUES_PER_FRAME)
    samples.forEach((sample, i) => {
      expect(sample.t).toBe(1_700_000_000_000 + i * 30)
      expect(sample.hz).toBeCloseTo(100 + i, 4)
      expect(sample.confidence).toBeCloseTo(i / 100, 4)
      expect(sample.rms).toBeCloseTo(i / 1000, 5)
    })
  })

  it('throws rather than silently mis-pairing when values/times lengths disagree', () => {
    // A stale native/index.node built with the old 2-per-frame stride: without
    // this guard the decode "succeeds" and every timestamp lands on the wrong
    // frame, with nothing anywhere pointing at the missed rebuild.
    const times = new Float64Array([1_700_000_000_123, 1_700_000_000_133])
    const staleTwoPerFrame = new Float32Array([220, 0.9, 225, 0.85])

    expect(() => decodeBatch('mic-1', times, staleTwoPerFrame)).toThrow(/stride mismatch/)
    expect(() => decodeBatch('mic-1', times, staleTwoPerFrame)).toThrow(/build:native/)
  })
})

describe('createNativeBridge', () => {
  it('returns null when no addon is available (not yet built)', () => {
    expect(createNativeBridge(null)).toBeNull()
  })

  it('constructs an AudioBridge from an injected addon', () => {
    let constructed = false
    class FakeAudioBridgeClass {
      constructor() {
        constructed = true
      }
    }
    const bridge = createNativeBridge({ AudioBridge: FakeAudioBridgeClass })
    expect(constructed).toBe(true)
    expect(bridge).toBeInstanceOf(FakeAudioBridgeClass)
  })

  it('the fake test bridge matches the real AudioBridge JS-facing shape', () => {
    const bridge = createFakeAudioBridge([{ id: 'mic-1', name: 'Mic', channelCount: 1, sampleRate: 48000 }])
    expect(typeof bridge.listDevices).toBe('function')
    expect(typeof bridge.startCapture).toBe('function')
    expect(typeof bridge.stopCapture).toBe('function')
    expect(typeof bridge.startRawScope).toBe('function')
    expect(typeof bridge.stopRawScope).toBe('function')
  })
})
