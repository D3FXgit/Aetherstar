import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMicRecoveryStore } from '../micRecoveryStore'
import { usePitchStore } from '../pitchStore'
import { useMicSlotStore } from '../../multiplayer/store'
import { usePlayersStore } from '../../players/store'
import { useSessionStore } from '../../session/sessionStore'
import { toMicSlotArray, type MicSlot } from '../../multiplayer/types'
import type { PlayerProfile } from '../../contracts/types'

const MIC_1 = { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }
const MIC_2 = { id: 'mic-2', name: 'Scarlett 2i2', channelCount: 2, sampleRate: 48000 }

function player(id: string, name: string): PlayerProfile {
  return { id, name, color: '#ffffff', avatarUrl: '' }
}

const ADA = player('ada', 'Ada')
const GRACE = player('grace', 'Grace')

/** Mic 1 is the USB mic; Mic 2 is channel 2 of the interface. */
const MIC_SLOT_1: MicSlot = { slotNumber: 1, deviceId: MIC_1.id, channelIndex: 0 }
const MIC_SLOT_2: MicSlot = { slotNumber: 2, deviceId: MIC_2.id, channelIndex: 1 }

function setMicSlots(stored: MicSlot[]) {
  useMicSlotStore.setState({ slots: toMicSlotArray(stored), bindings: stored })
}

describe('useMicRecoveryStore', () => {
  let startCapture: ReturnType<typeof vi.fn>

  beforeEach(() => {
    startCapture = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(usePitchStore, 'getState').mockReturnValue({
      startCapture,
    } as unknown as ReturnType<typeof usePitchStore.getState>)

    usePlayersStore.setState({ players: [ADA, GRACE] })
    setMicSlots([MIC_SLOT_1, MIC_SLOT_2])
    // Mid-song by default: Ada picked first (so she holds Mic 1), Grace second.
    useSessionStore.setState({ assignedPlayerIds: ['ada', 'grace'] })
    useMicRecoveryStore.setState({ lostInputs: [], dismissed: false, knownDeviceNames: {} })
  })

  function deviceListChanged(payload: {
    devices: typeof MIC_1[]
    added?: typeof MIC_1[]
    removed?: typeof MIC_1[]
  }) {
    useMicRecoveryStore
      .getState()
      .handleDeviceListChanged({ devices: payload.devices, added: payload.added ?? [], removed: payload.removed ?? [] })
  }

  describe('losing a device', () => {
    it('reports the lost input by mic number and holder, not by device id', () => {
      // The whole point of the overlay: "Mic 1 · Ada" is something someone on a
      // sofa can act on. "mic-1" is not.
      deviceListChanged({ devices: [MIC_2], removed: [MIC_1] })

      expect(useMicRecoveryStore.getState().lostInputs).toEqual([
        {
          captureKey: 'mic-1',
          deviceId: 'mic-1',
          channelIndex: 0,
          deviceName: 'USB Mic',
          micNumber: 1,
          playerName: 'Ada',
        },
      ])
    })

    it('names a lost channel of a multi-channel interface by its capture key', () => {
      deviceListChanged({ devices: [MIC_1], removed: [MIC_2] })

      const [lost] = useMicRecoveryStore.getState().lostInputs
      expect(lost).toMatchObject({ captureKey: 'mic-2#1', channelIndex: 1, micNumber: 2, playerName: 'Grace' })
    })

    /**
     * The model change, right here: a microphone can lose its hardware when
     * nobody is holding it -- in Settings, before the party starts. That is a
     * real loss worth reporting, and the previous player-keyed model could not
     * express it at all.
     */
    it('reports a mic nobody is holding, naming no player', () => {
      useSessionStore.setState({ assignedPlayerIds: [] })

      deviceListChanged({ devices: [MIC_2], removed: [MIC_1] })

      expect(useMicRecoveryStore.getState().lostInputs).toMatchObject([{ micNumber: 1, playerName: '' }])
    })

    it('ignores a device that no mic is pointed at', () => {
      setMicSlots([MIC_SLOT_1])

      deviceListChanged({ devices: [MIC_1], removed: [MIC_2] })

      expect(useMicRecoveryStore.getState().lostInputs).toEqual([])
    })

    it('reports every mic sharing one vanished device, so nobody is left unexplained', () => {
      setMicSlots([MIC_SLOT_1, { slotNumber: 2, deviceId: MIC_1.id, channelIndex: 0 }])

      deviceListChanged({ devices: [], removed: [MIC_1] })

      expect(useMicRecoveryStore.getState().lostInputs.map((input) => input.micNumber)).toEqual([1, 2])
    })

    it('re-opens a dismissed overlay when a *different* input is then lost', () => {
      deviceListChanged({ devices: [MIC_2], removed: [MIC_1] })
      useMicRecoveryStore.getState().dismiss()

      deviceListChanged({ devices: [], removed: [MIC_2] })

      expect(useMicRecoveryStore.getState().dismissed).toBe(false)
      expect(useMicRecoveryStore.getState().lostInputs).toHaveLength(2)
    })

    it('does not re-open the overlay for a device list that repeats a loss already dismissed', () => {
      // The watcher polls every ~2s and re-sends on any change. "Continue
      // without Mic 1" has to stay dismissed across those, or it is a modal
      // that reappears every two seconds for the rest of the song.
      deviceListChanged({ devices: [MIC_2], removed: [MIC_1] })
      useMicRecoveryStore.getState().dismiss()

      deviceListChanged({ devices: [MIC_2], removed: [] })

      expect(useMicRecoveryStore.getState().dismissed).toBe(true)
      expect(useMicRecoveryStore.getState().lostInputs).toHaveLength(1)
    })
  })

  describe('reconnecting', () => {
    it('restarts the capture and clears the loss when the same device comes back', () => {
      deviceListChanged({ devices: [MIC_2], removed: [MIC_1] })
      expect(useMicRecoveryStore.getState().lostInputs).toHaveLength(1)

      deviceListChanged({ devices: [MIC_1, MIC_2], added: [MIC_1] })

      expect(startCapture).toHaveBeenCalledWith('mic-1')
      expect(useMicRecoveryStore.getState().lostInputs).toEqual([])
    })

    it('restarts a capture whose loss the user had already dismissed', () => {
      // Preserving the mic slot is what makes this work: "continue without
      // Mic 1" is a decision about the overlay, not about the matrix, so
      // plugging the mic back in still returns Ada to the song.
      deviceListChanged({ devices: [MIC_2], removed: [MIC_1] })
      useMicRecoveryStore.getState().dismiss()

      deviceListChanged({ devices: [MIC_1, MIC_2], added: [MIC_1] })

      expect(startCapture).toHaveBeenCalledWith('mic-1')
      expect(useMicRecoveryStore.getState().dismissed).toBe(false)
    })

    it('restarts every channel that was lost with a multi-channel interface', () => {
      // Both mics on one two-input interface: Mic 1 on channel 0, Mic 2 on 1.
      setMicSlots([{ slotNumber: 1, deviceId: MIC_2.id, channelIndex: 0 }, MIC_SLOT_2])

      deviceListChanged({ devices: [MIC_1], removed: [MIC_2] })
      deviceListChanged({ devices: [MIC_1, MIC_2], added: [MIC_2] })

      expect(startCapture).toHaveBeenCalledWith('mic-2')
      expect(startCapture).toHaveBeenCalledWith('mic-2#1')
    })

    it('does not restart a capture for a device that was never lost', () => {
      deviceListChanged({ devices: [MIC_1, MIC_2], added: [MIC_2] })
      expect(startCapture).not.toHaveBeenCalled()
    })
  })

  describe('dismiss', () => {
    it('hides the overlay without clearing the mic, so the setup survives the song', () => {
      deviceListChanged({ devices: [MIC_2], removed: [MIC_1] })

      useMicRecoveryStore.getState().dismiss()

      expect(useMicRecoveryStore.getState().dismissed).toBe(true)
      expect(useMicSlotStore.getState().bindings).toEqual([MIC_SLOT_1, MIC_SLOT_2])
    })
  })

  it('falls back to the device id when no name for the vanished device was ever seen', () => {
    // `removed` is the only place the name of gone hardware survives; a
    // watcher payload that omits it must still produce readable copy.
    deviceListChanged({ devices: [MIC_2], removed: [] })

    expect(useMicRecoveryStore.getState().lostInputs[0]).toMatchObject({ deviceName: 'mic-1' })
  })

  it('still reports the mic when its holder is no longer on the roster', () => {
    // A player row can be deleted mid-session. The microphone is still real and
    // still unplugged, so the loss is reported -- just without a name attached.
    usePlayersStore.setState({ players: [] })

    deviceListChanged({ devices: [MIC_2], removed: [MIC_1] })

    expect(useMicRecoveryStore.getState().lostInputs).toMatchObject([{ micNumber: 1, playerName: '' }])
  })
})
