import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as api from '../api'

const MIC_1 = { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }

describe('audio api', () => {
  beforeEach(() => {
    window.api = {
      audio: {
        listDevices: vi.fn().mockResolvedValue([MIC_1]),
        requestPermission: vi.fn().mockResolvedValue('granted'),
        getPermissionStatus: vi.fn().mockResolvedValue('granted'),
        startCapture: vi.fn().mockResolvedValue(undefined),
        stopCapture: vi.fn().mockResolvedValue(undefined),
        startRawScope: vi.fn().mockResolvedValue(undefined),
        stopRawScope: vi.fn().mockResolvedValue(undefined),
        onPitchBatch: vi.fn().mockReturnValue(() => {}),
        onDeviceListChanged: vi.fn().mockReturnValue(() => {}),
        onRawScopeChunk: vi.fn().mockReturnValue(() => {}),
      },
    } as unknown as Window['api']
  })

  it('listDevices returns window.api.audio.listDevices result', async () => {
    expect(await api.listDevices()).toEqual([MIC_1])
  })

  it('requestPermission calls window.api.audio.requestPermission', async () => {
    expect(await api.requestPermission()).toBe('granted')
    expect(window.api!.audio.requestPermission).toHaveBeenCalled()
  })

  it('getPermissionStatus calls window.api.audio.getPermissionStatus', async () => {
    expect(await api.getPermissionStatus()).toBe('granted')
  })

  it('startCapture/stopCapture call through with deviceId', async () => {
    await api.startCapture('mic-1')
    await api.stopCapture('mic-1')
    expect(window.api!.audio.startCapture).toHaveBeenCalledWith('mic-1')
    expect(window.api!.audio.stopCapture).toHaveBeenCalledWith('mic-1')
  })

  it('startRawScope/stopRawScope call through with deviceId', async () => {
    await api.startRawScope('mic-1')
    await api.stopRawScope('mic-1')
    expect(window.api!.audio.startRawScope).toHaveBeenCalledWith('mic-1')
    expect(window.api!.audio.stopRawScope).toHaveBeenCalledWith('mic-1')
  })

  it('onPitchBatch/onDeviceListChanged/onRawScopeChunk subscribe via window.api.audio', () => {
    const cb = vi.fn()
    api.onPitchBatch(cb)
    api.onDeviceListChanged(cb)
    api.onRawScopeChunk(cb)
    expect(window.api!.audio.onPitchBatch).toHaveBeenCalledWith(cb)
    expect(window.api!.audio.onDeviceListChanged).toHaveBeenCalledWith(cb)
    expect(window.api!.audio.onRawScopeChunk).toHaveBeenCalledWith(cb)
  })
})

describe('audio api — window.api unavailable (e.g. rendered outside Electron)', () => {
  beforeEach(() => {
    window.api = undefined
  })

  it('listDevices resolves to an empty array instead of throwing', async () => {
    await expect(api.listDevices()).resolves.toEqual([])
  })

  it('requestPermission/getPermissionStatus resolve to not-determined instead of throwing', async () => {
    await expect(api.requestPermission()).resolves.toBe('not-determined')
    await expect(api.getPermissionStatus()).resolves.toBe('not-determined')
  })

  it('startCapture resolves instead of throwing', async () => {
    await expect(api.startCapture('mic-1')).resolves.toBeUndefined()
  })

  it('onPitchBatch returns a no-op unsubscribe instead of throwing', () => {
    expect(() => api.onPitchBatch(() => {})()).not.toThrow()
  })
})
