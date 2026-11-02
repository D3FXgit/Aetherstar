import { create } from 'zustand'
import { t } from '../../i18n'

/**
 * Why a singer's notes are (or are not) being judged.
 *
 * This exists because the failure it names was, for a long time, completely
 * invisible. `Gameplay` reads one entry out of `usePitchStore.activeCaptures`;
 * when that entry is missing, `judgeNote` sees zero in-span samples and returns
 * `awful` with the NO_SIGNAL sentinel for *every* note. The lane still scrolls,
 * notes still pass the playhead, the hit FX still fires -- and the score sits
 * at zero for the whole song with nothing anywhere saying why. A player whose
 * mic is not actually running has to be told, not quietly given 0.
 */
export type MicHealth =
  /** A capture is running and frames are arriving. */
  | 'ok'
  /** Gameplay is starting a capture for this singer; nothing is wrong yet. */
  | 'starting'
  /** No audio input device exists to capture from at all. */
  | 'no-device'
  /** No capture is running for the device this singer's lane reads from. */
  | 'no-capture'
  /** A capture is running but the audio thread has stopped delivering frames. */
  | 'no-frames'

export interface MicHealthEntry {
  status: MicHealth
  /** The capture key this lane reads, or null when none could be resolved. */
  deviceId: string | null
}

interface MicHealthStoreState {
  byPlayerId: Record<string, MicHealthEntry>
  /**
   * Idempotent by design: the gameplay frame loop calls this every animation
   * frame, so an unchanged status must not produce a new state object (which
   * would re-render every subscriber 60-120 times a second).
   */
  report: (playerId: string, status: MicHealth, deviceId: string | null) => void
  clear: (playerId: string) => void
  reset: () => void
}

export const useMicHealthStore = create<MicHealthStoreState>((set, get) => ({
  byPlayerId: {},

  report: (playerId, status, deviceId) => {
    const existing = get().byPlayerId[playerId]
    if (existing && existing.status === status && existing.deviceId === deviceId) return
    set((state) => ({ byPlayerId: { ...state.byPlayerId, [playerId]: { status, deviceId } } }))
  },

  clear: (playerId) => {
    if (!get().byPlayerId[playerId]) return
    set((state) => {
      const byPlayerId = { ...state.byPlayerId }
      delete byPlayerId[playerId]
      return { byPlayerId }
    })
  },

  reset: () => set({ byPlayerId: {} }),
}))

/** Human-readable, actionable text for a health status -- one place, so the lane warning and any HUD read the same words. */
export function micHealthMessage(status: MicHealth): string | null {
  switch (status) {
    case 'no-device':
      return t('sing.micHealth.noDevice')
    case 'no-capture':
      return t('sing.micHealth.noCapture')
    case 'no-frames':
      return t('sing.micHealth.noFrames')
    default:
      return null
  }
}
