// Lab-only store for the raw waveform scope, apart from pitchStore: the stream
// runs only while /lab/mic is mounted (it is ~20x the pitch bandwidth).
import { create } from 'zustand'
import * as api from './api'

interface RawScopeStoreState {
  activeDeviceId: string | null
  latestChunk: Float32Array | null
  startScope: (deviceId: string) => Promise<void>
  stopScope: () => Promise<void>
  subscribeToChunks: () => () => void
}

export const useRawScopeStore = create<RawScopeStoreState>((set, get) => ({
  activeDeviceId: null,
  latestChunk: null,

  startScope: async (deviceId) => {
    await api.startRawScope(deviceId)
    set({ activeDeviceId: deviceId, latestChunk: null })
  },

  stopScope: async () => {
    const deviceId = get().activeDeviceId
    if (deviceId) await api.stopRawScope(deviceId)
    set({ activeDeviceId: null, latestChunk: null })
  },

  subscribeToChunks: () =>
    api.onRawScopeChunk(({ deviceId, chunk }) => {
      if (deviceId !== get().activeDeviceId) return
      set({ latestChunk: chunk })
    }),
}))
