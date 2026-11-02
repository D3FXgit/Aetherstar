import { describe, expect, it, vi, afterEach } from 'vitest'
import * as api from '../api'
import type { MicSlot } from '../types'

afterEach(() => {
  delete window.api
})

describe('multiplayer api with no preload bridge', () => {
  it('degrades to empty results rather than throwing', async () => {
    expect(await api.listMicSlots()).toEqual([])
    expect(await api.getCpuUsage()).toEqual({ percent: 0 })
    await expect(api.saveMicSlot({ slotNumber: 1, deviceId: 'mic-1', channelIndex: 0 })).resolves.toBeUndefined()
    await expect(api.clearMicSlot(1)).resolves.toBeUndefined()
  })
})

// A *present* bridge whose call rejects is a different failure from an absent
// one, and it was unguarded. Real cause seen in the wild: `electron/**` is
// CommonJS loaded directly and does not hot-reload, so after the mic-slot IPC
// rename the renderer hot-reloaded onto the new channels while a main process
// started before the rename had no handler for them. Every call rejected with
// "No handler registered for 'multiplayer:list-mic-slots'", escaped as an
// unhandled rejection, and was reported as an app crash.
//
// A DB that failed to open, or any throw inside a handler, produces exactly the
// same shape. None of it should crash the app: not knowing the mic
// configuration means "no mics configured yet", which the UI already renders.
describe('multiplayer api when the bridge rejects', () => {
  function stubRejectingBridge(message = "No handler registered for 'multiplayer:list-mic-slots'") {
    const reject = () => Promise.reject(new Error(message))
    // @ts-expect-error -- only the multiplayer namespace matters for these tests
    window.api = {
      multiplayer: {
        listMicSlots: vi.fn(reject),
        saveMicSlot: vi.fn(reject),
        clearMicSlot: vi.fn(reject),
        getCpuUsage: vi.fn(reject),
      },
    }
  }

  it('degrades to empty results instead of rejecting', async () => {
    stubRejectingBridge()

    await expect(api.listMicSlots()).resolves.toEqual([])
    await expect(api.getCpuUsage()).resolves.toEqual({ percent: 0 })
    await expect(api.saveMicSlot({ slotNumber: 1, deviceId: 'mic-1', channelIndex: 0 })).resolves.toBeUndefined()
    await expect(api.clearMicSlot(1)).resolves.toBeUndefined()
  })

  it('reports the failure once per call rather than swallowing it silently', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubRejectingBridge()

    await api.listMicSlots()

    expect(consoleError).toHaveBeenCalledOnce()
    expect(consoleError.mock.calls[0][0]).toContain('multiplayer:list-mic-slots')
    consoleError.mockRestore()
  })
})

describe('multiplayer api over the preload bridge', () => {
  const SLOTS: MicSlot[] = [{ slotNumber: 1, deviceId: 'mic-1', channelIndex: 0 }]

  function stubBridge() {
    const multiplayer = {
      listMicSlots: vi.fn().mockResolvedValue(SLOTS),
      saveMicSlot: vi.fn().mockResolvedValue(undefined),
      clearMicSlot: vi.fn().mockResolvedValue(undefined),
      getCpuUsage: vi.fn().mockResolvedValue({ percent: 42 }),
    }
    // @ts-expect-error -- only the multiplayer namespace matters for these tests
    window.api = { multiplayer }
    return multiplayer
  }

  it('forwards every call to window.api.multiplayer', async () => {
    const multiplayer = stubBridge()

    expect(await api.listMicSlots()).toEqual(SLOTS)
    await api.saveMicSlot({ slotNumber: 3, deviceId: 'mic-3', channelIndex: 1 })
    await api.clearMicSlot(3)
    expect(await api.getCpuUsage()).toEqual({ percent: 42 })

    expect(multiplayer.listMicSlots).toHaveBeenCalledOnce()
    expect(multiplayer.saveMicSlot).toHaveBeenCalledWith({ slotNumber: 3, deviceId: 'mic-3', channelIndex: 1 })
    expect(multiplayer.clearMicSlot).toHaveBeenCalledWith(3)
    expect(multiplayer.getCpuUsage).toHaveBeenCalledOnce()
  })
})
