import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chartSpellsWordBreaks, lineText, useSessionScoreReporting } from '../useSessionScoreReporting'
import { parseChartText } from '../../stage/chart/parseChartText'
import { MAX_RETAINED_HITS, useHitStore } from '../../game/state/useHitStore'
import { useScoreStore } from '../../game/state/useScoreStore'
import type { SongLine } from '../../contracts/types'

function note(startBeat: number, syllable: string): SongLine['notes'][number] {
  return { kind: 'normal', startBeat, length: 2, pitch: 9, syllable }
}

// UltraStar spelling: syllables carry their own word breaks (" night").
const LINES: SongLine[] = [
  { part: 'solo', notes: [note(0, 'Hel'), note(2, 'lo')] },
  { part: 'solo', notes: [note(4, 'world')] },
  { part: 'solo', notes: [note(8, 'Good'), note(10, ' night')] },
]

function hit(playerId: string, noteId: string, tier: 'epic' | 'good' | 'awful') {
  useHitStore.getState().recordHit({ playerId, tier, noteId, deviationCents: 0, t: Date.now() })
}

describe('useSessionScoreReporting', () => {
  beforeEach(() => {
    useHitStore.getState().reset()
    useScoreStore.getState().reset({ players: [], combo: 0, rank: [] })
    // @ts-expect-error -- only reportScoreState matters for this test
    window.api = { audience: { reportScoreState: vi.fn() } } as Window['api']
  })

  afterEach(() => {
    delete window.api
  })

  it('accumulates epic/good/awful tallies from real HitEvents', () => {
    const { result } = renderHook(() => useSessionScoreReporting(LINES))

    act(() => {
      hit('p1', 'note-0', 'epic')
      hit('p1', 'note-1', 'good')
      hit('p1', 'note-2', 'awful')
    })

    expect(result.current.p1.epicCount).toBe(1)
    expect(result.current.p1.goodCount).toBe(1)
    expect(result.current.p1.awfulCount).toBe(1)
  })

  it('tracks the best-scoring line by average tier weight', () => {
    const { result } = renderHook(() => useSessionScoreReporting(LINES))

    act(() => {
      // Line 0 (notes 0-1): both epic -> average 2. Line 1 (note 2): awful -> average 0.
      hit('p1', 'note-0', 'epic')
      hit('p1', 'note-1', 'epic')
      hit('p1', 'note-2', 'awful')
    })

    expect(result.current.p1.bestLine).toBe('Hello')
  })

  it('tallies each player independently when multiple players sing the same song at once', () => {
    const { result } = renderHook(() => useSessionScoreReporting(LINES))

    act(() => {
      hit('p1', 'note-0', 'epic')
      hit('p1', 'note-1', 'epic')
      hit('p2', 'note-0', 'awful')
      hit('p2', 'note-2', 'good')
    })

    expect(result.current.p1).toEqual({ epicCount: 2, goodCount: 0, awfulCount: 0, bestLine: 'Hello' })
    expect(result.current.p2).toEqual({ epicCount: 0, goodCount: 1, awfulCount: 1, bestLine: 'world' })
  })

  it('reports real (not mock) score state to the audience window via useReportScoreState', () => {
    renderHook(() => useSessionScoreReporting(LINES))

    act(() => {
      useScoreStore.setState({ players: [{ playerId: 'p1', name: 'Alex', score: 500, combo: 1, rank: 1 }], combo: 1, rank: ['p1'] })
    })

    expect(window.api!.audience.reportScoreState).toHaveBeenCalledWith(
      expect.objectContaining({ players: [expect.objectContaining({ playerId: 'p1', score: 500 })] }),
    )
  })

  // Review finding: the hit store keeps only the newest 256 hits, and the
  // tallies indexed into that window -- so they froze ~256 notes into a song.
  it('keeps counting past the retained window of the hit store', () => {
    const { result } = renderHook(() => useSessionScoreReporting(LINES))

    act(() => {
      for (let i = 0; i < MAX_RETAINED_HITS + 150; i += 1) hit('p1', `note-${i % 3}`, 'epic')
      useHitStore.getState().recordHits([
        { playerId: 'p1', tier: 'good', noteId: 'note-0', deviationCents: 0, t: 1 },
        { playerId: 'p1', tier: 'awful', noteId: 'note-1', deviationCents: 0, t: 1 },
      ])
    })

    expect(result.current.p1.epicCount).toBe(MAX_RETAINED_HITS + 150)
    expect(result.current.p1.goodCount).toBe(1)
    expect(result.current.p1.awfulCount).toBe(1)
  })

  it('starts counting over after the hit store is reset', () => {
    const { result } = renderHook(() => useSessionScoreReporting(LINES))

    act(() => {
      hit('p1', 'note-0', 'epic')
      hit('p1', 'note-1', 'epic')
      useHitStore.getState().reset()
      hit('p1', 'note-2', 'good')
    })

    expect(result.current.p1).toMatchObject({ epicCount: 2, goodCount: 1 })
  })

  // Review finding: note ids are numbered within each LANE's lines, so in a
  // duet P2's `note-0` is P2's first note -- not the chart's first note.
  it('reads each singer note id against their own lane lines in a duet', () => {
    const DUET: SongLine[] = [
      { part: 'p1', notes: [{ kind: 'normal', startBeat: 0, length: 2, pitch: 9, syllable: 'one' }] },
      { part: 'p2', notes: [{ kind: 'normal', startBeat: 4, length: 2, pitch: 9, syllable: 'two' }] },
      { part: 'p1', notes: [{ kind: 'normal', startBeat: 8, length: 2, pitch: 9, syllable: 'three' }] },
    ]
    const { result } = renderHook(() => useSessionScoreReporting(DUET, ['alex', 'sam']))

    act(() => {
      // Sam (lane 1, P2) has a single note: their `note-0` is "two".
      hit('sam', 'note-0', 'epic')
      // Alex (lane 0, P1): `note-1` is "three".
      hit('alex', 'note-0', 'awful')
      hit('alex', 'note-1', 'epic')
    })

    expect(result.current.sam.bestLine).toBe('two')
    expect(result.current.alex.bestLine).toBe('three')
  })

  it('shows no best line for a singer who hit nothing', () => {
    const { result } = renderHook(() => useSessionScoreReporting(LINES))

    act(() => {
      hit('p1', 'note-0', 'awful')
      hit('p1', 'note-2', 'awful')
    })

    expect(result.current.p1).toEqual({ epicCount: 0, goodCount: 0, awfulCount: 2, bestLine: null })
  })

  it('keeps the word breaks a line spells out in leading and trailing syllable spaces', () => {
    const SPACED: SongLine[] = [
      { part: 'solo', notes: [note(0, ' Wake '), note(4, 'up,'), note(6, '  the'), note(8, ' night '), note(12, 'fa'), note(14, 'ding')] },
    ]
    const { result } = renderHook(() => useSessionScoreReporting(SPACED))

    act(() => {
      hit('p1', 'note-0', 'epic')
      hit('p1', 'note-5', 'good')
    })

    expect(result.current.p1.bestLine).toBe('Wake up, the night fading')
  })

  // The demo song is written a word per note, with no spaces in any syllable:
  // its best line used to read "Wakeup,thenightisfadingslow".
  it('spaces a chart written a word per note, as the stage shows it (the demo song)', () => {
    const demo = parseChartText(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/sample-song/notes.txt'), 'utf8'))
    const { result } = renderHook(() => useSessionScoreReporting(demo.lines))

    act(() => {
      hit('p1', 'note-0', 'epic')
      hit('p1', 'note-1', 'good')
    })

    expect(result.current.p1.bestLine).toBe('Wake up, the night is fading slow')
  })
})

describe('lineText', () => {
  it('joins UltraStar syllables on their own spaces, collapsing and trimming the whitespace', () => {
    const line: SongLine = { part: 'solo', notes: [note(0, '  Hel'), note(2, 'lo '), note(4, ' '), note(6, ' dear  '), note(8, 'world ')] }
    expect(lineText(line, true)).toBe('Hello dear world')
  })

  it('puts a space between notes when the chart spells no word breaks of its own', () => {
    const line: SongLine = { part: 'solo', notes: [note(0, 'Wake'), note(4, 'up,'), note(6, 'the'), note(8, 'night')] }
    expect(lineText(line, false)).toBe('Wake up, the night')
  })

  it('reads whether a chart spells its word breaks from any syllable in it', () => {
    expect(chartSpellsWordBreaks(LINES)).toBe(true)
    expect(chartSpellsWordBreaks([{ part: 'solo', notes: [note(0, 'Wake'), note(4, 'up')] }])).toBe(false)
    expect(chartSpellsWordBreaks([{ part: 'solo', notes: [note(0, 'Wake '), note(4, 'up')] }])).toBe(true)
  })
})
