import { afterEach, describe, expect, it } from 'vitest'
import type { NoteWithId } from '../../types'
import { isGoldenNote, registerNoteKinds, resetNoteKinds } from '../noteKindRegistry'

function note(noteId: string, kind: NoteWithId['kind']): NoteWithId {
  return { noteId, kind, startBeat: 0, length: 1, pitch: 60, syllable: 'la' }
}

const CHART = [note('n0', 'normal'), note('n1', 'golden'), note('n2', 'freestyle')]

describe('noteKindRegistry', () => {
  afterEach(resetNoteKinds)

  it('treats golden rap notes as golden too -- they are worth double as well', () => {
    registerNoteKinds([note('r0', 'rap'), note('r1', 'goldenRap')])
    expect(isGoldenNote('r1')).toBe(true)
    expect(isGoldenNote('r0')).toBe(false)
  })

  it('answers the one question a HitEvent cannot: was that note golden', () => {
    registerNoteKinds(CHART)
    expect(isGoldenNote('n1')).toBe(true)
    expect(isGoldenNote('n0')).toBe(false)
    expect(isGoldenNote('n2')).toBe(false)
  })

  // A burst layer given a note id from a chart nobody registered is still a
  // burst -- just not a golden one. It must never throw on the frame path.
  it('says "not golden" for an id it has never seen', () => {
    expect(isGoldenNote('who')).toBe(false)
  })

  it('forgets the chart when the last lane showing it leaves', () => {
    const release = registerNoteKinds(CHART)
    release()
    expect(isGoldenNote('n1')).toBe(false)
  })

  // The case this is ref-counted for: MultiplayerGameplay renders one Gameplay
  // (and so one NoteLane) per singer, all over the *same* chart. The first lane
  // to unmount must not blind the other seven.
  it('survives one of eight lanes unmounting while the other seven still show the chart', () => {
    const releases = Array.from({ length: 8 }, () => registerNoteKinds(CHART))
    releases[0]()
    expect(isGoldenNote('n1')).toBe(true)

    for (const release of releases.slice(1)) release()
    expect(isGoldenNote('n1')).toBe(false)
  })

  it('ignores a release called twice, so a double teardown cannot orphan a live chart', () => {
    const first = registerNoteKinds(CHART)
    const second = registerNoteKinds(CHART)
    first()
    first()
    expect(isGoldenNote('n1')).toBe(true)
    second()
    expect(isGoldenNote('n1')).toBe(false)
  })

  // Note ids are chart-local ("0-3"), so the next song reuses them. A stale
  // entry would make an ordinary note in song two celebrate as golden.
  it('lets the next song\'s chart win on an id the previous song also used', () => {
    const release = registerNoteKinds([note('n0', 'golden')])
    registerNoteKinds([note('n0', 'normal')])
    expect(isGoldenNote('n0')).toBe(false)
    release()
  })
})
