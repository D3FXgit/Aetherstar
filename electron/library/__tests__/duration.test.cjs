// @vitest-environment node
const { computeDurationMs } = require('../duration.cjs')

describe('computeDurationMs', () => {
  it('converts the last note end beat to ms via gap + bpm', () => {
    const chart = {
      meta: { bpm: 250, gap: 24065 },
      lines: [{ part: 'solo', notes: [{ startBeat: 2712, length: 10, kind: 'normal', pitch: 65, syllable: 'you' }] }],
    }
    const msPerBeat = 60000 / (250 * 4)
    expect(computeDurationMs(chart)).toBe(24065 + (2712 + 10) * msPerBeat)
  })

  it('returns exactly gap when the chart has no lines', () => {
    const chart = { meta: { bpm: 250, gap: 24065 }, lines: [] }
    expect(computeDurationMs(chart)).toBe(24065)
  })

  it('returns a finite duration instead of Infinity/NaN when #BPM is 0 or missing (real-world malformed charts)', () => {
    const chart = {
      meta: { bpm: 0, gap: 1000 },
      lines: [{ part: 'solo', notes: [{ startBeat: 100, length: 10, kind: 'normal', pitch: 65, syllable: 'x' }] }],
    }
    const result = computeDurationMs(chart)
    expect(Number.isFinite(result)).toBe(true)
    expect(result).toBe(1000)
  })

  it('returns 0, not NaN, when both #BPM and #GAP are missing', () => {
    const chart = { meta: { bpm: 0, gap: 0 }, lines: [] }
    expect(computeDurationMs(chart)).toBe(0)
  })
})
