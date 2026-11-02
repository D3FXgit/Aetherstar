import { describe, expect, it } from 'vitest'
import {
  captureKeyOfSlot,
  captureKeysForSlots,
  deviceIdOfCaptureKey,
  diffCaptureKeys,
  formatCaptureKey,
} from '../captureKey'
import type { MicSlot } from '../types'

function slot(slotNumber: number, deviceId: string | null, channelIndex = 0): MicSlot {
  return { slotNumber, deviceId, channelIndex }
}

describe('formatCaptureKey', () => {
  it('returns the bare deviceId for channel 0 (backward-compatible)', () => {
    expect(formatCaptureKey('dev-1', 0)).toBe('dev-1')
  })

  it('appends a #channelIndex suffix for any other channel', () => {
    expect(formatCaptureKey('dev-1', 2)).toBe('dev-1#2')
  })
})

describe('deviceIdOfCaptureKey', () => {
  it('returns a bare channel-0 key unchanged', () => {
    expect(deviceIdOfCaptureKey('dev-1')).toBe('dev-1')
  })

  it('strips the #channelIndex suffix', () => {
    expect(deviceIdOfCaptureKey('dev-1#2')).toBe('dev-1')
  })

  it('splits on the first # exactly like the main process parseCaptureKey does', () => {
    // electron/audio/captureKey.cjs uses indexOf('#'). The two must agree
    // character-for-character: main decides which native stream to stop, the
    // renderer decides which activeCaptures entry to drop, and a disconnect
    // where they disagree tears down the wrong one.
    expect(deviceIdOfCaptureKey('dev#1#2')).toBe('dev')
  })

  it('leaves a key with nothing before the # alone rather than returning an empty device id', () => {
    expect(deviceIdOfCaptureKey('#2')).toBe('#2')
  })
})

describe('captureKeyOfSlot', () => {
  it('is null for a mic with no input configured', () => {
    expect(captureKeyOfSlot(slot(3, null))).toBeNull()
  })

  it('is the device id for a mic on channel 0', () => {
    expect(captureKeyOfSlot(slot(1, 'dev-1'))).toBe('dev-1')
  })

  it('carries the channel for a mic on an interface input', () => {
    expect(captureKeyOfSlot(slot(2, 'dev-1', 3))).toBe('dev-1#3')
  })
})

describe('captureKeysForSlots', () => {
  it('skips unconfigured mics rather than emitting an empty key', () => {
    expect(captureKeysForSlots([slot(1, null), slot(2, 'dev-1')])).toEqual(['dev-1'])
  })

  // Two mics pointed at one physical input are one native stream, not two.
  // Opening it twice is what a naive per-row start would do.
  it('de-duplicates two mics sharing one device and channel', () => {
    expect(captureKeysForSlots([slot(1, 'dev-1'), slot(2, 'dev-1')])).toEqual(['dev-1'])
  })

  it('keeps two channels of one interface apart', () => {
    expect(captureKeysForSlots([slot(1, 'dev-1', 0), slot(2, 'dev-1', 1)])).toEqual(['dev-1', 'dev-1#1'])
  })
})

describe('diffCaptureKeys', () => {
  it('starts a brand-new key', () => {
    expect(diffCaptureKeys([], ['dev-1'])).toEqual({ toStart: ['dev-1'], toStop: [] })
  })

  it('stops a key that is no longer wanted', () => {
    expect(diffCaptureKeys(['dev-1'], [])).toEqual({ toStart: [], toStop: ['dev-1'] })
  })

  it('starts the new key and stops the old one when a mic moves device', () => {
    expect(diffCaptureKeys(['dev-1'], ['dev-2'])).toEqual({ toStart: ['dev-2'], toStop: ['dev-1'] })
  })

  it('leaves an unchanged key alone rather than restarting it', () => {
    expect(diffCaptureKeys(['dev-1'], ['dev-1'])).toEqual({ toStart: [], toStop: [] })
  })

  it('treats a repeated key in either list as one key', () => {
    expect(diffCaptureKeys(['dev-1', 'dev-1'], ['dev-1'])).toEqual({ toStart: [], toStop: [] })
  })
})
