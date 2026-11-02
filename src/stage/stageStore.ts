import { create } from 'zustand'

export type StageStatus = 'idle' | 'countdown' | 'playing' | 'paused' | 'ended'

interface StageStoreState {
  currentLineIndex: number
  activeSyllableIndex: number
  status: StageStatus
  setCurrentLineIndex: (index: number) => void
  setActiveSyllableIndex: (index: number) => void
  setStatus: (status: StageStatus) => void
  reset: () => void
}

const INITIAL_STATE = { currentLineIndex: 0, activeSyllableIndex: -1, status: 'idle' as StageStatus }

/** Low-frequency, line/syllable-boundary-only playback state -- the per-frame beat/sweep position lives in motion values, never here. */
export const useStageStore = create<StageStoreState>((set) => ({
  ...INITIAL_STATE,
  setCurrentLineIndex: (index) => set({ currentLineIndex: index }),
  setActiveSyllableIndex: (index) => set({ activeSyllableIndex: index }),
  setStatus: (status) => set({ status }),
  reset: () => set(INITIAL_STATE),
}))
