import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTapToIdentify } from '../useTapToIdentify'
import { getCaptureStream, usePitchStore } from '../../audio/pitchStore'
import type { DeviceCaptureState } from '../../audio/types'

vi.mock('../../audio/pitchStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../audio/pitchStore')>()
  return {
    freshLatestPitch: actual.freshLatestPitch,
    getCaptureStream: vi.fn(() => undefined),
    usePitchStore: {
      getState: vi.fn(),
      subscribe: vi.fn(),
    },
  }
})

type Listener = (state: { activeCaptures: Record<string, DeviceCaptureState> }) => void

describe('useTapToIdentify', () => {
  let listeners: Listener[]
  let activeCaptures: Record<string, DeviceCaptureState>
  let startCapture: ReturnType<typeof vi.fn>
  let stopCapture: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.mocked(getCaptureStream).mockReset().mockReturnValue(undefined)
    listeners = []
    activeCaptures = {}
    startCapture = vi.fn()
    stopCapture = vi.fn()

    vi.mocked(usePitchStore.getState).mockImplementation(
      () =>
        ({
          activeCaptures,
          startCapture,
          stopCapture,
        }) as unknown as ReturnType<typeof usePitchStore.getState>,
    )
    vi.mocked(usePitchStore.subscribe).mockImplementation(((listener: Listener) => {
      listeners.push(listener)
      return () => {
        listeners = listeners.filter((l) => l !== listener)
      }
    }) as typeof usePitchStore.subscribe)
  })

  function emitConfidence(deviceId: string, confidence: number) {
    activeCaptures[deviceId] = { latest: { t: Date.now(), hz: 200, confidence, deviceId }, samples: [], latencyMs: 0 }
    listeners.forEach((listener) => listener({ activeCaptures }))
  }

  it('starts capture on every device in the given list', () => {
    void useTapToIdentify(['dev-1', 'dev-2', 'dev-3'])

    expect(startCapture).toHaveBeenCalledWith('dev-1')
    expect(startCapture).toHaveBeenCalledWith('dev-2')
    expect(startCapture).toHaveBeenCalledWith('dev-3')
  })

  it('resolves with the device whose confidence crosses the threshold and stops capture on the others', async () => {
    const result = useTapToIdentify(['dev-1', 'dev-2', 'dev-3'])

    emitConfidence('dev-2', 0.9)

    await expect(result).resolves.toBe('dev-2')
    expect(stopCapture).toHaveBeenCalledWith('dev-1')
    expect(stopCapture).toHaveBeenCalledWith('dev-3')
    expect(stopCapture).not.toHaveBeenCalledWith('dev-2')
  })

  it('ignores a confidence burst below the threshold', () => {
    void useTapToIdentify(['dev-1', 'dev-2'])

    emitConfidence('dev-1', 0.1)

    expect(stopCapture).not.toHaveBeenCalled()
  })

  // `latest` is never cleared by silence: a device that was already capturing
  // must not win on a note sung long before the tap.
  it('ignores a stale pitch left over from before the tap', () => {
    const old = { t: 0, hz: 200, confidence: 0.9, deviceId: 'dev-1' }
    vi.mocked(getCaptureStream).mockImplementation((key) =>
      key === 'dev-1' ? ({ latest: old, latestAt: Date.now() - 5000 } as ReturnType<typeof getCaptureStream>) : undefined,
    )
    void useTapToIdentify(['dev-1', 'dev-2'])

    activeCaptures['dev-1'] = { latest: old, samples: [], latencyMs: 0 }
    listeners.forEach((listener) => listener({ activeCaptures }))

    expect(stopCapture).not.toHaveBeenCalled()
  })

  it('accepts a fresh pitch from the live stream', async () => {
    const fresh = { t: 0, hz: 200, confidence: 0.9, deviceId: 'dev-1' }
    vi.mocked(getCaptureStream).mockImplementation((key) =>
      key === 'dev-1' ? ({ latest: fresh, latestAt: Date.now() } as ReturnType<typeof getCaptureStream>) : undefined,
    )
    const result = useTapToIdentify(['dev-1', 'dev-2'])

    activeCaptures['dev-1'] = { latest: fresh, samples: [], latencyMs: 0 }
    listeners.forEach((listener) => listener({ activeCaptures }))

    await expect(result).resolves.toBe('dev-1')
  })
})
