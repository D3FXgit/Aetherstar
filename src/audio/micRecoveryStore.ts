// Microphone-disconnect recovery.
//
// `usePitchStore` already sheds the *capture* for hardware that vanished --
// that keeps the audio store honest, but it is silent. This store is the
// policy layer on top: it decides who at the party just lost their input, in
// the Mic 1..Mic 8 vocabulary of src/multiplayer/slots.ts, and it puts them back
// when the mic reappears.
//
// It lives here rather than in pitchStore because it is cross-domain (audio +
// routing + roster) and because the import has to run this way round:
// multiplayer/store.ts already imports pitchStore, so pitchStore must never
// import it back.
import { create } from 'zustand'
import type { AudioDevice, DeviceListChangedPayload } from './types'
import * as api from './api'
import { usePitchStore } from './pitchStore'
import { useMicSlotStore } from '../multiplayer/store'
import { usePlayersStore } from '../players/store'
import { useSessionStore } from '../session/sessionStore'
import { claimableMicNumbers, micNumberFor } from '../multiplayer/slots'
import { captureKeyOfSlot } from '../multiplayer/captureKey'
import { isConfigured } from '../multiplayer/types'

/** One configured microphone whose physical input is no longer plugged in. */
export interface LostInput {
  /** The key `activeCaptures` was (and will again be) filed under. */
  captureKey: string
  deviceId: string
  channelIndex: number
  /** Last known human name of the hardware, e.g. "Scarlett 2i2". */
  deviceName: string
  /**
   * The microphone's number (3 for "Mic 3") -- the identity the UI leads with.
   * A number rather than the label so the overlay names it in the current language.
   */
  micNumber: number
  /**
   * Whoever is holding that microphone right now, or '' outside a song.
   *
   * Empty is a real and common state now that hardware and people are separate:
   * a mic can be unplugged in Settings, when nobody has claimed anything. The
   * overlay names the person only when there is one to name.
   */
  playerName: string
}

interface MicRecoveryState {
  /** Every seated player whose bound input is currently absent. */
  lostInputs: LostInput[]
  /**
   * The user chose "continue without them". Hides the overlay while the loss
   * itself stands -- a reconnect still restores the seat, and a *new* loss
   * still interrupts.
   */
  dismissed: boolean
  /** deviceId -> last known name, so gone hardware can still be named. */
  knownDeviceNames: Record<string, string>
}

interface MicRecoveryStore extends MicRecoveryState {
  handleDeviceListChanged: (payload: DeviceListChangedPayload) => void
  rememberDeviceNames: (devices: AudioDevice[]) => void
  dismiss: () => void
  /** Mirror of usePitchStore.subscribeToEvents: listen, return the unsubscribe. */
  subscribeToDeviceChanges: () => () => void
}

const INITIAL_STATE: MicRecoveryState = {
  lostInputs: [],
  dismissed: false,
  knownDeviceNames: {},
}

function namesOf(devices: AudioDevice[]): Record<string, string> {
  return Object.fromEntries(devices.map((device) => [device.id, device.name]))
}

export const useMicRecoveryStore = create<MicRecoveryStore>((set, get) => ({
  ...INITIAL_STATE,

  rememberDeviceNames: (devices) => {
    set((state) => ({ knownDeviceNames: { ...state.knownDeviceNames, ...namesOf(devices) } }))
  },

  handleDeviceListChanged: ({ devices, removed }) => {
    // `removed` carries the only surviving record of a vanished device's name,
    // so fold it in *before* the list that no longer mentions it.
    const knownDeviceNames = { ...get().knownDeviceNames, ...namesOf(removed), ...namesOf(devices) }
    const presentDeviceIds = new Set(devices.map((device) => device.id))

    // Microphones, not people: a mic slot is the thing that has hardware behind
    // it, so it is the thing that can lose it. Who is holding that mic is a
    // separate question, answered below only if a song is actually in progress.
    const slots = useMicSlotStore.getState().slots
    const claimable = claimableMicNumbers(slots)
    const assignedPlayerIds = useSessionStore.getState().assignedPlayerIds
    const players = usePlayersStore.getState().players

    /** The singer currently holding this mic, if any -- '' in Settings, where nobody holds anything. */
    const holderNameOf = (micNumber: number): string => {
      const holderId = assignedPlayerIds.find((playerId) => micNumberFor(assignedPlayerIds, playerId, claimable) === micNumber)
      return players.find((player) => player.id === holderId)?.name ?? ''
    }

    const lostInputs: LostInput[] = slots.flatMap((slot) => {
      if (!isConfigured(slot) || presentDeviceIds.has(slot.deviceId)) return []
      return [
        {
          captureKey: captureKeyOfSlot(slot) as string,
          deviceId: slot.deviceId,
          channelIndex: slot.channelIndex,
          deviceName: knownDeviceNames[slot.deviceId] ?? slot.deviceId,
          micNumber: slot.slotNumber,
          playerName: holderNameOf(slot.slotNumber),
        },
      ]
    })

    const previouslyLost = get().lostInputs
    const previousKeys = new Set(previouslyLost.map((input) => input.captureKey))
    const currentKeys = new Set(lostInputs.map((input) => input.captureKey))

    // Whatever was missing and is now back: restart it under the exact key it
    // ran under before. This is the "plug it back into the same port and it
    // just works" path, and it is only possible because the binding was never
    // deleted -- see dismiss() below.
    previouslyLost
      .filter((input) => !currentKeys.has(input.captureKey))
      .forEach((input) => {
        void Promise.resolve(usePitchStore.getState().startCapture(input.captureKey)).catch(() => {})
      })

    // A dismissal covers the losses it was made about. It survives the
    // watcher's repeat payloads (it polls every ~2s and re-sends on any
    // change) but never suppresses a fresh one: a second mic going down is
    // news, and so is the whole thing being over.
    const hasNewLoss = lostInputs.some((input) => !previousKeys.has(input.captureKey))
    const dismissed = lostInputs.length === 0 || hasNewLoss ? false : get().dismissed

    set({ lostInputs, dismissed, knownDeviceNames })
  },

  // Deliberately does not touch the mic matrix. The slot's device is how the
  // mic finds its way back on reconnect, and re-doing the eight-row matrix
  // mid-party is exactly the work this whole feature exists to avoid.
  dismiss: () => set({ dismissed: true }),

  // Its own IPC subscription rather than a hook into pitchStore's: the two are
  // independent policies over the same event (pitchStore sheds dead captures,
  // this decides what to tell the room), and preload's onDeviceListChanged is
  // a plain ipcRenderer.on, so a second listener is free.
  subscribeToDeviceChanges: () => {
    // Seeds names for hardware enumerated before anything went wrong -- a
    // device that vanishes may never be named by a payload again.
    get().rememberDeviceNames(usePitchStore.getState().devices)
    return api.onDeviceListChanged((payload) => get().handleDeviceListChanged(payload))
  },
}))
