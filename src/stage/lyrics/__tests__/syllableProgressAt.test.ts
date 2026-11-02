import { describe, expect, it } from 'vitest'
import { syllableProgressAt } from '../syllableProgressAt'
import type { SongNote } from '../../../contracts/types'

const note: SongNote = { kind: 'normal', startBeat: 10, length: 4, pitch: 60, syllable: 'test' }

describe('syllableProgressAt', () => {
  it('is 0 before the note starts', () => {
    expect(syllableProgressAt(note, 10)).toBe(0)
  })

  it('is 0.5 halfway through the note', () => {
    expect(syllableProgressAt(note, 12)).toBe(0.5)
  })

  it('is 1 at the note\'s end', () => {
    expect(syllableProgressAt(note, 14)).toBe(1)
  })

  it('clamps to 1 past the note\'s end', () => {
    expect(syllableProgressAt(note, 20)).toBe(1)
  })

  it('clamps to 0 before the note starts', () => {
    expect(syllableProgressAt(note, 0)).toBe(0)
  })
})
