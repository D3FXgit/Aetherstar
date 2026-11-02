import { captureKeyOfSlot, formatCaptureKey } from './captureKey'
import { MIC_SLOT_COUNT, isConfigured, type MicSlot } from './types'
import { micRimColor } from '../design/tokens'
import { t } from '../i18n'

/**
 * One numbering model: "Mic N". Settings owns what Mic N *is* -- a device and a
 * channel, pre-calibrated and persisted (see types.ts). Player Selection owns
 * who is *holding* it tonight -- a claim made in pick order, never persisted.
 * The number means the same thing on every screen and in gameplay.
 */

/** There are eight physical inputs, so eight mics. */
export const MAX_MICS = MIC_SLOT_COUNT

/** One numbered microphone, held by whoever claimed it for this song. */
export interface MicAssignment {
  /** 1-based, and it is the input number: 1..MAX_MICS. */
  micNumber: number
  /** "Mic 3". The identifier a person reads; the rim colour only reinforces it. */
  label: string
  playerId: string
  /**
   * Rim colour for this microphone. A property of the *slot*, never of the
   * profile -- a person is whoever picked up mic 3 tonight, so two different
   * people claiming first on two different nights both wear mic 1's colour.
   */
  rimColor: string
}

/** "Mic 3" -- the one place the user-facing name of a slot is spelled. */
export function micLabel(micNumber: number): string {
  return t('mic.slot', { number: String(micNumber) })
}

/** The identity of one physical input: a device plus a channel on it. */
export function captureKeyOf(deviceId: string, channelIndex: number): string {
  return formatCaptureKey(deviceId, channelIndex)
}

/**
 * The mic numbers a singer can actually be given, lowest first.
 *
 * Only configured mics, because claiming Mic 5 when Mic 5 has no input behind
 * it hands someone a microphone that cannot score them. The fallback matters
 * just as much: on a fresh install nothing is configured yet, and refusing to
 * let anyone sing until they have visited Settings would be a worse answer than
 * the single-microphone default the app already falls back to during gameplay.
 * So an empty rig offers all eight, exactly as the pick-order model did.
 */
export function claimableMicNumbers(slots: MicSlot[]): number[] {
  const configured = slots.filter(isConfigured).map((slot) => slot.slotNumber)
  if (configured.length > 0) return [...configured].sort((a, b) => a - b)
  return Array.from({ length: MAX_MICS }, (_, index) => index + 1)
}

const ALL_MIC_NUMBERS = Array.from({ length: MAX_MICS }, (_, index) => index + 1)

/**
 * Turn a claim order into numbered microphones.
 *
 * Position in `selectedPlayerIds` is the position in `claimable`: the first
 * singer picked takes the lowest-numbered configured mic, the second takes the
 * next, and so on. Anyone past the last claimable mic gets none, because there
 * is no further input to give them.
 */
export function assignMics(selectedPlayerIds: string[], claimable: number[] = ALL_MIC_NUMBERS): MicAssignment[] {
  return selectedPlayerIds.slice(0, claimable.length).map((playerId, index) => {
    const micNumber = claimable[index]
    return {
      micNumber,
      label: micLabel(micNumber),
      playerId,
      rimColor: micRimColor(micNumber - 1),
    }
  })
}

/** The mic a player holds, or null if they were not picked (or picked past the last free mic). */
export function micNumberFor(
  selectedPlayerIds: string[],
  playerId: string,
  claimable: number[] = ALL_MIC_NUMBERS,
): number | null {
  const index = selectedPlayerIds.indexOf(playerId)
  if (index === -1 || index >= claimable.length) return null
  return claimable[index]
}

/**
 * Claim or release a mic for a singer, keeping the claimed run contiguous.
 *
 * Removing someone closes the gap rather than leaving a configured input idle
 * in the middle of the run: the mics are numbered channels on a rig, and "Mic 2
 * is live but Mic 1 is dark" is not a state a party can act on. Everyone behind
 * the leaver moves down one, which is the cost of the model and the reason the
 * number is drawn large enough to notice changing.
 */
export function toggleMicAssignment(
  selectedPlayerIds: string[],
  playerId: string,
  claimable: number[] = ALL_MIC_NUMBERS,
): string[] {
  if (selectedPlayerIds.includes(playerId)) {
    return selectedPlayerIds.filter((id) => id !== playerId)
  }
  if (selectedPlayerIds.length >= claimable.length) return selectedPlayerIds
  return [...selectedPlayerIds, playerId]
}

/**
 * Mic numbers that share a physical input with another mic, keyed by mic number.
 *
 * Two mics on one capture key hear each other, which is occasionally deliberate
 * (a shared room mic) and usually a mistake. Either way the matrix has to say so
 * in words, naming the other mic -- a tinted row would leave a colour-blind user
 * with no way to know.
 */
export function conflictsByMicNumber(slots: MicSlot[]): Record<number, number[]> {
  const byKey = new Map<string, number[]>()
  for (const slot of slots) {
    const key = captureKeyOfSlot(slot)
    if (key === null) continue
    byKey.set(key, [...(byKey.get(key) ?? []), slot.slotNumber])
  }

  const conflicts: Record<number, number[]> = {}
  for (const micNumbers of byKey.values()) {
    if (micNumbers.length < 2) continue
    for (const micNumber of micNumbers) {
      conflicts[micNumber] = micNumbers.filter((other) => other !== micNumber)
    }
  }
  return conflicts
}
