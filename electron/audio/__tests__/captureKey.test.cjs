// @vitest-environment node
const { formatCaptureKey, parseCaptureKey } = require('../captureKey.cjs')

describe('formatCaptureKey', () => {
  it('returns the bare deviceId for channel 0 (backward-compatible)', () => {
    expect(formatCaptureKey('dev-1', 0)).toBe('dev-1')
  })

  it('appends a #channelIndex suffix for any other channel', () => {
    expect(formatCaptureKey('dev-1', 2)).toBe('dev-1#2')
  })
})

describe('parseCaptureKey', () => {
  it('parses a bare deviceId as channel 0', () => {
    expect(parseCaptureKey('dev-1')).toEqual({ deviceId: 'dev-1', channelIndex: 0 })
  })

  it('parses a composite key into deviceId + channelIndex', () => {
    expect(parseCaptureKey('dev-1#2')).toEqual({ deviceId: 'dev-1', channelIndex: 2 })
  })
})
