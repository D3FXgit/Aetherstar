import { create } from 'zustand'
import { isConfigured, toMicSlotArray, type ConfiguredMicSlot, type MicSlot } from './types'
import * as api from './api'
import { captureKeysForSlots, diffCaptureKeys } from './captureKey'
import { usePitchStore } from '../audio/pitchStore'

interface MicSlotStoreState {
  /** Always MIC_SLOT_COUNT entries; index i is Mic i+1, configured or not. */
  slots: MicSlot[]
  /**
   * The configured subset of `slots`.
   *
   * Kept under the old `bindings` name deliberately: it is read across a module
   * boundary this change does not own (`src/scenes/Sing.tsx` asks
   * `bindings.length > 0` to decide whether any hardware exists at all, which
   * is still exactly what this answers). Derived, never written to on its own --
   * `applySlots` below is the only writer of either field, so the two can't drift.
   */
  bindings: MicSlot[]
  /** Capture keys this store currently has running. */
  runningCaptureKeys: string[]
  /** Named holders that currently need the configured mics live. See `acquireCaptures`. */
  captureHolders: string[]
}

interface MicSlotStore extends MicSlotStoreState {
  load: () => Promise<void>
  /**
   * Point one mic at a device (or at nothing). `channelCount` is the device's
   * real channel count from native enumeration, used to keep the channel valid.
   */
  setSlotDevice: (slotNumber: number, deviceId: string | null, channelCount?: number) => Promise<void>
  setSlotChannel: (slotNumber: number, channelIndex: number) => Promise<void>
  clearSlot: (slotNumber: number) => Promise<void>
  acquireCaptures: (owner: string) => Promise<void>
  releaseCaptures: (owner: string) => Promise<void>
}

const INITIAL_STATE: MicSlotStoreState = {
  slots: toMicSlotArray([]),
  bindings: [],
  runningCaptureKeys: [],
  captureHolders: [],
}

/**
 * When a capture runs -- the contract
 *
 * Captures are explicitly *held*, not implied. Anything that needs the
 * configured mics live -- the Settings mic matrix while it is on screen, a song
 * while it is being sung -- calls `acquireCaptures(owner)` and calls
 * `releaseCaptures(owner)` when it is done. Captures run while at least one
 * holder exists and stop when the last one leaves, and a configuration change
 * while held re-syncs immediately, so a mic re-pointed mid-setup starts
 * metering without a second action.
 *
 * Holders are named rather than counted so a double-acquire from the same
 * screen (React 18 StrictMode re-runs every effect) is idempotent.
 */
export const useMicSlotStore = create<MicSlotStore>((set, get) => {
  /** Write both `slots` and its derived `bindings` in one place, then re-sync captures. */
  async function applySlots(slots: MicSlot[]): Promise<void> {
    set({ slots, bindings: slots.filter(isConfigured) })
    await syncCaptures()
  }

  /** Bring the running captures in line with what the holders and configuration ask for. */
  async function syncCaptures(): Promise<void> {
    const { slots, captureHolders, runningCaptureKeys } = get()
    const desired = captureHolders.length === 0 ? [] : captureKeysForSlots(slots)
    const { toStart, toStop } = diffCaptureKeys(runningCaptureKeys, desired)
    if (toStart.length === 0 && toStop.length === 0) return

    // Recorded before awaiting: an interleaved second sync must see the
    // intended end state, not the state before this one finished.
    set({ runningCaptureKeys: desired })

    const pitchStore = usePitchStore.getState()
    // Stop first: on a single-channel device, re-pointing a mic can mean the
    // same hardware is being reopened, and stopping after starting would tear
    // the new capture straight back down.
    await Promise.all(toStop.map((key) => Promise.resolve(pitchStore.stopCapture(key)).catch(() => {})))
    await Promise.all(toStart.map((key) => Promise.resolve(pitchStore.startCapture(key)).catch(() => {})))
  }

  async function persistSlot(slot: MicSlot): Promise<void> {
    if (isConfigured(slot)) {
      await api.saveMicSlot(slot as ConfiguredMicSlot)
    } else {
      await api.clearMicSlot(slot.slotNumber)
    }
  }

  /** Replace one slot in place and persist it. Slot numbers outside 1..8 are ignored. */
  async function writeSlot(slotNumber: number, next: (current: MicSlot) => MicSlot): Promise<void> {
    const slots = get().slots
    const index = slots.findIndex((slot) => slot.slotNumber === slotNumber)
    if (index === -1) return

    const updated = next(slots[index])
    await persistSlot(updated)
    await applySlots(slots.map((slot, i) => (i === index ? updated : slot)))
  }

  return {
    ...INITIAL_STATE,

    load: async () => {
      await applySlots(toMicSlotArray(await api.listMicSlots()))
    },

    setSlotDevice: async (slotNumber, deviceId, channelCount = 1) => {
      await writeSlot(slotNumber, (current) => {
        if (deviceId === null) return { slotNumber, deviceId: null, channelIndex: 0 }
        // Keep the channel when the same device is re-picked, but never carry
        // channel 2 of an interface over onto a mono mic that has no such channel.
        const channelIndex =
          current.deviceId === deviceId ? Math.min(current.channelIndex, Math.max(0, channelCount - 1)) : 0
        return { slotNumber, deviceId, channelIndex }
      })
    },

    setSlotChannel: async (slotNumber, channelIndex) => {
      await writeSlot(slotNumber, (current) =>
        // A channel on no device is not a thing; ignore it rather than persist
        // half a configuration.
        current.deviceId === null ? current : { ...current, channelIndex },
      )
    },

    clearSlot: async (slotNumber) => {
      await writeSlot(slotNumber, () => ({ slotNumber, deviceId: null, channelIndex: 0 }))
    },

    /**
     * Start (and keep running) a capture for every configured mic slot.
     *
     * `owner` names the thing that needs them -- 'settings-mic-matrix',
     * 'session-play', a Dev Lab screen. Acquiring twice under the same name is a
     * no-op; captures stop only when every holder has released.
     */
    acquireCaptures: async (owner) => {
      if (get().captureHolders.includes(owner)) return
      set((state) => ({ captureHolders: [...state.captureHolders, owner] }))
      await syncCaptures()
    },

    /** Drop this holder's claim; the last one out stops every capture. */
    releaseCaptures: async (owner) => {
      if (!get().captureHolders.includes(owner)) return
      set((state) => ({ captureHolders: state.captureHolders.filter((held) => held !== owner) }))
      await syncCaptures()
    },
  }
})

/**
 * The store's previous name, kept because it is imported across module
 * boundaries this change does not own (src/scenes/Sing.tsx, src/audio/**).
 * There is exactly one store; this is an alias, not a second one.
 */
export const useMultiplayerStore = useMicSlotStore
