import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMicSlotStore } from '../store'
import { usePitchStore } from '../../audio/pitchStore'
import { toMicSlotArray, type MicSlot } from '../types'
import * as api from '../api'

vi.mock('../api')
vi.mock('../../audio/pitchStore', () => ({
  usePitchStore: { getState: vi.fn() },
}))

const MIC_1: MicSlot = { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 }

describe('useMicSlotStore', () => {
  let startCapture: ReturnType<typeof vi.fn>
  let stopCapture: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    useMicSlotStore.setState({
      slots: toMicSlotArray([]),
      bindings: [],
      runningCaptureKeys: [],
      captureHolders: [],
    })
    vi.mocked(api.listMicSlots).mockResolvedValue([MIC_1])
    vi.mocked(api.saveMicSlot).mockResolvedValue(undefined)
    vi.mocked(api.clearMicSlot).mockResolvedValue(undefined)

    startCapture = vi.fn()
    stopCapture = vi.fn()
    vi.mocked(usePitchStore.getState).mockReturnValue({
      startCapture,
      stopCapture,
    } as unknown as ReturnType<typeof usePitchStore.getState>)
  })

  describe('loading', () => {
    it('always exposes eight slots, configured or not', async () => {
      await useMicSlotStore.getState().load()

      const { slots } = useMicSlotStore.getState()
      expect(slots).toHaveLength(8)
      expect(slots.map((slot) => slot.slotNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      expect(slots[3]).toEqual({ slotNumber: 4, deviceId: null, channelIndex: 0 })
    })

    it('exposes the configured subset as `bindings` for cross-domain readers', async () => {
      await useMicSlotStore.getState().load()
      expect(useMicSlotStore.getState().bindings).toEqual([MIC_1])
    })

    it('restores all eight configured slots with no truncation', async () => {
      const eight = Array.from({ length: 8 }, (_, index) => ({
        slotNumber: index + 1,
        deviceId: `dev-${index + 1}`,
        channelIndex: 0,
      }))
      vi.mocked(api.listMicSlots).mockResolvedValue(eight)

      await useMicSlotStore.getState().load()

      expect(useMicSlotStore.getState().bindings).toEqual(eight)
    })
  })

  describe('editing a mic', () => {
    it('setSlotDevice persists the slot and reflects it in state', async () => {
      await useMicSlotStore.getState().setSlotDevice(2, 'dev-2', 1)

      expect(api.saveMicSlot).toHaveBeenCalledWith({ slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 })
      expect(useMicSlotStore.getState().slots[1]).toEqual({ slotNumber: 2, deviceId: 'dev-2', channelIndex: 0 })
    })

    it('setSlotDevice(null) clears the stored slot rather than storing a null device', async () => {
      await useMicSlotStore.getState().setSlotDevice(2, 'dev-2', 1)
      await useMicSlotStore.getState().setSlotDevice(2, null)

      expect(api.clearMicSlot).toHaveBeenCalledWith(2)
      expect(useMicSlotStore.getState().slots[1]).toEqual({ slotNumber: 2, deviceId: null, channelIndex: 0 })
    })

    it('keeps the channel when the same device is re-picked', async () => {
      await useMicSlotStore.getState().setSlotDevice(1, 'iface', 4)
      await useMicSlotStore.getState().setSlotChannel(1, 3)

      await useMicSlotStore.getState().setSlotDevice(1, 'iface', 4)

      expect(useMicSlotStore.getState().slots[0].channelIndex).toBe(3)
    })

    // The regression: pointing a mic that was on In 4 of an interface at a mono
    // USB mic must not leave it asking for a channel that device does not have.
    it('clamps the channel to what the newly chosen device actually has', async () => {
      await useMicSlotStore.getState().setSlotDevice(1, 'iface', 4)
      await useMicSlotStore.getState().setSlotChannel(1, 3)

      await useMicSlotStore.getState().setSlotDevice(1, 'mono-mic', 1)

      expect(useMicSlotStore.getState().slots[0]).toEqual({ slotNumber: 1, deviceId: 'mono-mic', channelIndex: 0 })
    })

    it('ignores a channel change on a mic with no device', async () => {
      await useMicSlotStore.getState().setSlotChannel(5, 2)

      expect(api.saveMicSlot).not.toHaveBeenCalled()
      expect(useMicSlotStore.getState().slots[4].channelIndex).toBe(0)
    })

    it('clearSlot empties just that mic', async () => {
      await useMicSlotStore.getState().load()

      await useMicSlotStore.getState().clearSlot(1)

      expect(api.clearMicSlot).toHaveBeenCalledWith(1)
      expect(useMicSlotStore.getState().bindings).toEqual([])
    })
  })

  /**
   * The contract the gameplay side relies on. These pin the behaviour that
   * replaced "captures start as a side effect of saving a binding" -- the bug
   * where a rig that was never edited this session captured nothing at all, and
   * where visiting the setup screen left eight native streams open forever.
   */
  describe('capture claims', () => {
    it('runs no captures at all until something acquires them', async () => {
      await useMicSlotStore.getState().load()

      expect(startCapture).not.toHaveBeenCalled()
    })

    it('acquireCaptures starts one capture per configured mic', async () => {
      await useMicSlotStore.getState().load()

      await useMicSlotStore.getState().acquireCaptures('session-play')

      expect(startCapture).toHaveBeenCalledWith('dev-1')
      expect(startCapture).toHaveBeenCalledTimes(1)
    })

    it('starts nothing for mics with no input configured', async () => {
      vi.mocked(api.listMicSlots).mockResolvedValue([])
      await useMicSlotStore.getState().load()

      await useMicSlotStore.getState().acquireCaptures('session-play')

      expect(startCapture).not.toHaveBeenCalled()
    })

    it('is idempotent under the same owner (StrictMode re-runs every effect)', async () => {
      await useMicSlotStore.getState().load()

      await useMicSlotStore.getState().acquireCaptures('mic-matrix')
      await useMicSlotStore.getState().acquireCaptures('mic-matrix')

      expect(startCapture).toHaveBeenCalledTimes(1)
    })

    it('releaseCaptures stops every capture once the last holder leaves', async () => {
      await useMicSlotStore.getState().load()
      await useMicSlotStore.getState().acquireCaptures('mic-matrix')

      await useMicSlotStore.getState().releaseCaptures('mic-matrix')

      expect(stopCapture).toHaveBeenCalledWith('dev-1')
      expect(useMicSlotStore.getState().runningCaptureKeys).toEqual([])
    })

    // Settings' matrix and a running song can both want the mics live. One
    // closing must not silence the other.
    it('keeps captures running while another holder still needs them', async () => {
      await useMicSlotStore.getState().load()
      await useMicSlotStore.getState().acquireCaptures('mic-matrix')
      await useMicSlotStore.getState().acquireCaptures('session-play')

      await useMicSlotStore.getState().releaseCaptures('mic-matrix')

      expect(stopCapture).not.toHaveBeenCalled()
      expect(useMicSlotStore.getState().runningCaptureKeys).toEqual(['dev-1'])
    })

    it('ignores a release from an owner that never acquired', async () => {
      await useMicSlotStore.getState().load()
      await useMicSlotStore.getState().acquireCaptures('mic-matrix')

      await useMicSlotStore.getState().releaseCaptures('somebody-else')

      expect(stopCapture).not.toHaveBeenCalled()
    })

    it('re-points a live capture when the mic is edited while held', async () => {
      await useMicSlotStore.getState().load()
      await useMicSlotStore.getState().acquireCaptures('mic-matrix')

      await useMicSlotStore.getState().setSlotDevice(1, 'dev-2', 1)

      expect(stopCapture).toHaveBeenCalledWith('dev-1')
      expect(startCapture).toHaveBeenCalledWith('dev-2')
    })

    it('does not restart a capture that two mics share when only one of them moves', async () => {
      vi.mocked(api.listMicSlots).mockResolvedValue([
        { slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 },
        { slotNumber: 2, deviceId: 'dev-1', channelIndex: 0 },
      ])
      await useMicSlotStore.getState().load()
      await useMicSlotStore.getState().acquireCaptures('mic-matrix')
      startCapture.mockClear()

      await useMicSlotStore.getState().setSlotDevice(2, 'dev-2', 1)

      expect(stopCapture).not.toHaveBeenCalledWith('dev-1')
      expect(startCapture).toHaveBeenCalledWith('dev-2')
    })

    it('starts nothing on edit while nothing holds a claim', async () => {
      await useMicSlotStore.getState().load()

      await useMicSlotStore.getState().setSlotDevice(2, 'dev-2', 1)

      expect(startCapture).not.toHaveBeenCalled()
    })
  })
})
