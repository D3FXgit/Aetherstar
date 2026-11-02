import { describe, expect, it } from 'vitest'
import {
  MAX_MICS,
  assignMics,
  captureKeyOf,
  claimableMicNumbers,
  conflictsByMicNumber,
  micLabel,
  micNumberFor,
  toggleMicAssignment,
} from '../slots'
import { MIC_SLOT_COUNT, toMicSlotArray, type MicSlot } from '../types'
import { MIC_RIM_COLORS } from '../../design/tokens'

function configured(...entries: [number, string, number?][]): MicSlot[] {
  return toMicSlotArray(
    entries.map(([slotNumber, deviceId, channelIndex = 0]) => ({ slotNumber, deviceId, channelIndex })),
  )
}

describe('claimableMicNumbers', () => {
  it('offers only the mics that actually have an input behind them', () => {
    expect(claimableMicNumbers(configured([1, 'dev-1'], [3, 'dev-3']))).toEqual([1, 3])
  })

  it('sorts by mic number however the slots arrive', () => {
    expect(claimableMicNumbers(configured([5, 'dev-5'], [2, 'dev-2']))).toEqual([2, 5])
  })

  // A fresh install has nothing set up, and refusing to let anyone sing until
  // they visit Settings would be a worse answer than the app's existing
  // single-microphone fallback.
  it('offers all eight when nothing has been configured yet', () => {
    expect(claimableMicNumbers(toMicSlotArray([]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})

describe('assignMics', () => {
  it('returns nothing for nobody', () => {
    expect(assignMics([])).toEqual([])
  })

  it('hands out the claimable mics in pick order', () => {
    const mics = assignMics(['bea', 'al'], [2, 5])
    expect(mics.map((mic) => mic.micNumber)).toEqual([2, 5])
    expect(mics.map((mic) => mic.playerId)).toEqual(['bea', 'al'])
  })

  it('labels each assignment by its mic number', () => {
    expect(assignMics(['a', 'b'], [3, 4]).map((mic) => mic.label)).toEqual(['Mic 3', 'Mic 4'])
  })

  // The colour follows the microphone, never the person: whoever picks up Mic 1
  // tonight wears Mic 1's colour.
  it('colours by mic number, not by who was picked', () => {
    expect(assignMics(['al'], [1]).at(0)!.rimColor).toBe(MIC_RIM_COLORS[0])
    expect(assignMics(['bea'], [1]).at(0)!.rimColor).toBe(MIC_RIM_COLORS[0])
    expect(assignMics(['al'], [4]).at(0)!.rimColor).toBe(MIC_RIM_COLORS[3])
  })

  it('gives no mic to anyone picked past the last claimable one', () => {
    const mics = assignMics(['a', 'b', 'c'], [1, 2])
    expect(mics).toHaveLength(2)
    expect(mics.some((mic) => mic.playerId === 'c')).toBe(false)
  })

  it('tops out at eight, matching the number of physical inputs', () => {
    expect(MAX_MICS).toBe(MIC_SLOT_COUNT)
    expect(assignMics(Array.from({ length: 9 }, (_, i) => `p${i}`))).toHaveLength(MAX_MICS)
  })
})

describe('micNumberFor', () => {
  it('resolves a picked player to the mic they claimed', () => {
    expect(micNumberFor(['bea', 'al'], 'al', [2, 5])).toBe(5)
  })

  it('is null for someone who was never picked', () => {
    expect(micNumberFor(['bea'], 'al', [1, 2])).toBeNull()
  })

  it('is null for someone picked past the last claimable mic', () => {
    expect(micNumberFor(['a', 'b', 'c'], 'c', [1, 2])).toBeNull()
  })
})

describe('toggleMicAssignment', () => {
  it('adds an unpicked player to the end of the claim order', () => {
    expect(toggleMicAssignment(['al'], 'bea', [1, 2])).toEqual(['al', 'bea'])
  })

  it('removes an already-picked player', () => {
    expect(toggleMicAssignment(['al', 'bea'], 'al', [1, 2])).toEqual(['bea'])
  })

  // "Mic 2 is live but Mic 1 is dark" is not a state a party can act on.
  it('closes the gap so the claimed mics stay a contiguous run', () => {
    const after = toggleMicAssignment(['al', 'bea', 'cy'], 'al', [1, 2, 3])
    expect(micNumberFor(after, 'bea', [1, 2, 3])).toBe(1)
    expect(micNumberFor(after, 'cy', [1, 2, 3])).toBe(2)
  })

  it('refuses a pick once every claimable mic is taken', () => {
    expect(toggleMicAssignment(['al', 'bea'], 'cy', [1, 2])).toEqual(['al', 'bea'])
  })

  it('still lets someone be un-picked when every mic is taken', () => {
    expect(toggleMicAssignment(['al', 'bea'], 'al', [1, 2])).toEqual(['bea'])
  })
})

describe('conflictsByMicNumber', () => {
  it('reports nothing when every mic is on its own input', () => {
    expect(conflictsByMicNumber(configured([1, 'dev-1'], [2, 'dev-2']))).toEqual({})
  })

  it('names the other mic on both sides of a shared input', () => {
    expect(conflictsByMicNumber(configured([1, 'dev-1'], [3, 'dev-1']))).toEqual({ 1: [3], 3: [1] })
  })

  it('does not treat two channels of one interface as a conflict', () => {
    expect(conflictsByMicNumber(configured([1, 'iface', 0], [2, 'iface', 1]))).toEqual({})
  })

  it('ignores unconfigured mics rather than reporting eight mutual conflicts', () => {
    expect(conflictsByMicNumber(toMicSlotArray([]))).toEqual({})
  })
})

describe('micLabel / captureKeyOf', () => {
  it('spells the mic name one way everywhere', () => {
    expect(micLabel(3)).toBe('Mic 3')
  })

  it('builds the composite key for a device and channel', () => {
    expect(captureKeyOf('dev-1', 2)).toBe('dev-1#2')
  })
})
