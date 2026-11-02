import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useRawScopeStore } from '../rawScopeStore'

describe('useRawScopeStore', () => {
  let chunkCallback: ((payload: { deviceId: string; chunk: Float32Array }) => void) | null

  beforeEach(() => {
    chunkCallback = null
    window.api = {
      audio: {
        listDevices: vi.fn(),
        requestPermission: vi.fn(),
        getPermissionStatus: vi.fn(),
        startCapture: vi.fn(),
        stopCapture: vi.fn(),
        startRawScope: vi.fn().mockResolvedValue(undefined),
        stopRawScope: vi.fn().mockResolvedValue(undefined),
        onPitchBatch: vi.fn().mockReturnValue(() => {}),
        onDeviceListChanged: vi.fn().mockReturnValue(() => {}),
        onRawScopeChunk: vi.fn((cb) => {
          chunkCallback = cb
          return () => {}
        }),
      },
    } as unknown as Window['api']

    useRawScopeStore.setState({ activeDeviceId: null, latestChunk: null })
  })

  it('startScope calls window.api.audio.startRawScope and records the active device', async () => {
    await act(async () => {
      await useRawScopeStore.getState().startScope('mic-1')
    })
    expect(window.api!.audio.startRawScope).toHaveBeenCalledWith('mic-1')
    expect(useRawScopeStore.getState().activeDeviceId).toBe('mic-1')
  })

  it('subscribeToChunks only updates latestChunk for the active device', async () => {
    useRawScopeStore.getState().subscribeToChunks()
    await act(async () => {
      await useRawScopeStore.getState().startScope('mic-1')
    })

    const otherChunk = new Float32Array([9, 9])
    act(() => chunkCallback?.({ deviceId: 'mic-2', chunk: otherChunk }))
    expect(useRawScopeStore.getState().latestChunk).toBeNull()

    const chunk = new Float32Array([0.1, 0.2])
    act(() => chunkCallback?.({ deviceId: 'mic-1', chunk }))
    expect(useRawScopeStore.getState().latestChunk).toEqual(chunk)
  })

  it('stopScope calls window.api.audio.stopRawScope and clears state', async () => {
    await act(async () => {
      await useRawScopeStore.getState().startScope('mic-1')
    })
    await act(async () => {
      await useRawScopeStore.getState().stopScope()
    })
    expect(window.api!.audio.stopRawScope).toHaveBeenCalledWith('mic-1')
    expect(useRawScopeStore.getState().activeDeviceId).toBeNull()
    expect(useRawScopeStore.getState().latestChunk).toBeNull()
  })
})
