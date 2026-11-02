/** The rig tops out at eight physical inputs, so mic numbers are 1..8. */
export const MIC_SLOT_COUNT = 8

/**
 * One numbered hardware input: Mic 1 .. Mic 8.
 *
 * This is the *hardware* half of the model and it names no person. A slot is a
 * device plus a channel on that device, pre-calibrated in Settings and left
 * there; who sings into Mic 3 is decided per song on the Player Selection
 * screen and is never persisted.
 *
 * It replaces `RoutingBinding` (`{ playerId, deviceId, channelIndex }`), which
 * could not express a configured input that nobody owns -- so a party's rig
 * could not be set up before the guests existed, and a guest picking up
 * someone else's microphone had to be re-bound mid-party.
 */
export interface MicSlot {
  /** 1-based, and it *is* the mic number a person reads on screen: 1..MIC_SLOT_COUNT. */
  slotNumber: number
  /** The native device this input arrives on, or null when the mic is unconfigured. */
  deviceId: string | null
  /** 0-based channel on that device. 0 for a mono mic; 0/1 for a stereo pair; 0..N-1 on an interface. */
  channelIndex: number
}

/** A mic slot that actually has hardware behind it -- the only kind that can capture. */
export interface ConfiguredMicSlot extends MicSlot {
  deviceId: string
}

export function isConfigured(slot: MicSlot): slot is ConfiguredMicSlot {
  return slot.deviceId !== null
}

/** The eight slots with nothing configured -- the shape every consumer can rely on being present. */
export function emptyMicSlots(): MicSlot[] {
  return Array.from({ length: MIC_SLOT_COUNT }, (_, index) => ({
    slotNumber: index + 1,
    deviceId: null,
    channelIndex: 0,
  }))
}

/**
 * Fill the eight-slot array from whatever subset persistence returned.
 *
 * The renderer always works with all eight rows -- Settings shows Mic 1..8
 * whether or not anything is plugged in -- while the database only stores the
 * configured ones. This is the one place that gap is closed.
 */
export function toMicSlotArray(stored: MicSlot[]): MicSlot[] {
  const slots = emptyMicSlots()
  for (const slot of stored) {
    const index = slot.slotNumber - 1
    if (index < 0 || index >= MIC_SLOT_COUNT) continue
    slots[index] = { slotNumber: slot.slotNumber, deviceId: slot.deviceId, channelIndex: slot.channelIndex }
  }
  return slots
}
