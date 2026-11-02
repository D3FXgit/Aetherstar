import { create } from 'zustand'
import type { CalibrationSettings, Difficulty } from './types'
import { DEFAULT_CALIBRATION_SETTINGS } from './types'
import * as api from './calibrationApi'
import { clampCalibrationOffsetMs, isPlausibleOffsetMs } from './offsets'

/**
 * Settings as loaded, with any offset no working measurement could produce
 * (see offsets.ts) treated as never measured: an out-of-range output offset
 * reads as 0 and an out-of-range mic entry is dropped. Clamping such a value
 * to the bound instead would still shift every song by a full second.
 */
export function sanitizeCalibrationSettings(settings: CalibrationSettings | null | undefined): CalibrationSettings {
  if (!settings || typeof settings !== 'object') return DEFAULT_CALIBRATION_SETTINGS
  const inputDevices: CalibrationSettings['inputDevices'] = {}
  for (const [deviceId, entry] of Object.entries(settings.inputDevices ?? {})) {
    if (isPlausibleOffsetMs(entry?.offsetMs)) inputDevices[deviceId] = entry
  }
  return {
    ...settings,
    outputOffsetMs: isPlausibleOffsetMs(settings.outputOffsetMs) ? settings.outputOffsetMs : 0,
    inputDevices,
    players: settings.players ?? {},
  }
}

/**
 * Who and what the wizard should measure, handed over by whoever navigated to
 * the 'calibration' scene. Scene navigation carries no parameters
 * (src/scenes/sceneStore.ts), so the target rides in the calibration domain's
 * own store rather than widening the router for one caller.
 */
export interface CalibrationTarget {
  playerId: string
  deviceId: string
}

interface CalibrationStoreState {
  settings: CalibrationSettings
  /** True once the persisted settings have been read at least once. */
  loaded: boolean
  target: CalibrationTarget | null
  setTarget: (target: CalibrationTarget | null) => void
  load: () => Promise<void>
  /** Load once (shared between callers); resolves even if the read fails. */
  ensureLoaded: () => Promise<void>
  setOutputOffset: (ms: number) => Promise<void>
  setInputDeviceOffset: (deviceId: string, ms: number) => Promise<void>
  setPlayerCalibration: (playerId: string, calibration: { difficulty: Difficulty; transpositionSemitones: number }) => Promise<void>
  /** Change only a singer's difficulty, keeping their transposition. */
  setPlayerDifficulty: (playerId: string, difficulty: Difficulty) => Promise<void>
}

/** The difficulty a singer last chose, or 'normal' for someone who never has. */
export function difficultyForPlayer(settings: CalibrationSettings, playerId: string): Difficulty {
  return settings.players[playerId]?.difficulty ?? 'normal'
}

let pendingLoad: Promise<void> | null = null

/** Same load/merge-then-persist shape as usePlayersStore. */
export const useCalibrationStore = create<CalibrationStoreState>((set, get) => {
  /**
   * Every write is a read-merge-write of the *whole* settings object, so it
   * must never run against the in-memory defaults: that would persist an empty
   * calibration over everyone's saved offsets and difficulties. Writers wait
   * for the first load instead.
   *
   * The in-memory copy changes before the write goes out: gameplay reads it
   * every frame, and a difficulty picked on the way into a song must already
   * be in force when the first note arrives, not whenever the IPC returns.
   */
  async function persist(update: (current: CalibrationSettings) => CalibrationSettings) {
    await get().ensureLoaded()
    const settings = update(get().settings)
    set({ settings })
    await api.set(settings)
  }

  return {
    settings: DEFAULT_CALIBRATION_SETTINGS,
    loaded: false,
    target: null,

    setTarget: (target) => set({ target }),

    load: async () => {
      set({ settings: sanitizeCalibrationSettings(await api.get()), loaded: true })
    },

    ensureLoaded: () => {
      if (get().loaded) return Promise.resolve()
      pendingLoad ??= get()
        .load()
        .catch(() => undefined)
        .finally(() => {
          pendingLoad = null
        })
      return pendingLoad
    },

    setOutputOffset: (ms) => persist((current) => ({ ...current, outputOffsetMs: clampCalibrationOffsetMs(ms) })),

    setInputDeviceOffset: (deviceId, ms) =>
      persist((current) => ({
        ...current,
        inputDevices: { ...current.inputDevices, [deviceId]: { offsetMs: clampCalibrationOffsetMs(ms) } },
      })),

    setPlayerCalibration: (playerId, calibration) =>
      persist((current) => ({
        ...current,
        players: { ...current.players, [playerId]: calibration },
      })),

    setPlayerDifficulty: (playerId, difficulty) =>
      persist((current) => ({
        ...current,
        players: {
          ...current.players,
          [playerId]: {
            transpositionSemitones: current.players[playerId]?.transpositionSemitones ?? 0,
            difficulty,
          },
        },
      })),
  }
})
