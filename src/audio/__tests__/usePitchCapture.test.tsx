import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { usePitchCapture } from '../usePitchCapture'
import { resetPitchBatchSubscriptionForTests, usePitchStore } from '../pitchStore'
import type { PitchSample } from '../../contracts/types'

const MIC = { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }

function Harness({ enabled = true }: { enabled?: boolean }) {
  usePitchCapture(enabled)
  return null
}

describe('usePitchCapture', () => {
  let batchCallback: ((payload: { deviceId: string; samples: PitchSample[] }) => void) | null

  beforeEach(() => {
    resetPitchBatchSubscriptionForTests()
    batchCallback = null
    window.api = {
      audio: {
        listDevices: vi.fn().mockResolvedValue([MIC]),
        requestPermission: vi.fn(),
        getPermissionStatus: vi.fn(),
        startCapture: vi.fn().mockResolvedValue(undefined),
        stopCapture: vi.fn().mockResolvedValue(undefined),
        startRawScope: vi.fn(),
        stopRawScope: vi.fn(),
        onPitchBatch: vi.fn((cb) => {
          batchCallback = cb
          return () => {}
        }),
        onDeviceListChanged: vi.fn().mockReturnValue(() => {}),
        onRawScopeChunk: vi.fn().mockReturnValue(() => {}),
      },
    } as unknown as Window['api']
    usePitchStore.setState({ activeCaptures: {}, devices: [] })
  })

  afterEach(() => {
    delete window.api
  })

  // The regression this exists for: no screen that subscribes to pitch batches
  // is mounted during `session-play`, so before this hook the matcher had no
  // pitch to score against for the whole song.
  it('delivers pitch into the store while only gameplay is on screen', async () => {
    render(<Harness />)
    await act(async () => {
      await usePitchStore.getState().startCapture(MIC.id)
    })

    act(() => {
      batchCallback!({
        deviceId: MIC.id,
        samples: [{ t: 1000, hz: 220, confidence: 0.9, deviceId: MIC.id, rms: 0.3 }],
      })
    })

    const capture = usePitchStore.getState().activeCaptures[MIC.id]
    expect(capture.latest?.hz).toBe(220)
    expect(capture.samples).toHaveLength(1)
  })

  it('subscribes for the whole life of the app, not per scene', () => {
    const { rerender } = render(<Harness />)
    rerender(<Harness />)

    expect(window.api!.audio.onPitchBatch).toHaveBeenCalledTimes(1)
  })

  it('releases the subscription on unmount', () => {
    const release = vi.fn()
    ;(window.api!.audio.onPitchBatch as ReturnType<typeof vi.fn>).mockReturnValue(release)

    const { unmount } = render(<Harness />)
    unmount()

    expect(release).toHaveBeenCalledTimes(1)
  })

  // The audience window renders a scoreboard from relayed state and owns no
  // microphone; subscribing there would be a second listener for nothing.
  it('does not subscribe when disabled (audience window)', () => {
    render(<Harness enabled={false} />)

    expect(window.api!.audio.onPitchBatch).not.toHaveBeenCalled()
  })
})
