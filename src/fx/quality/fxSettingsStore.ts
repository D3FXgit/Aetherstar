import { create } from 'zustand'

const STORAGE_KEY = 'aetherstar:fx-settings'

interface PersistedFxSettings {
  reduceEffects: boolean
}

interface FxSettingsState {
  reduceEffects: boolean
  setReduceEffects: (value: boolean) => void
}

function readPersisted(): PersistedFxSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { reduceEffects: false }
    return JSON.parse(raw) as PersistedFxSettings
  } catch {
    return { reduceEffects: false }
  }
}

function writePersisted(settings: PersistedFxSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

/** The persisted "reduce effects" preference, shared by the Settings toggle and the FX layer. */
export const useFxSettingsStore = create<FxSettingsState>((set) => ({
  ...readPersisted(),
  setReduceEffects: (value) => {
    writePersisted({ reduceEffects: value })
    set({ reduceEffects: value })
  },
}))
