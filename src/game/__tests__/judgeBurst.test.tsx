import { describe, expect, it, beforeEach, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { motionValue } from 'framer-motion'
import { Gameplay } from '../Gameplay'
import { useHitStore } from '../state/useHitStore'
import { useScoreStore } from '../state/useScoreStore'
import { usePitchStore } from '../../audio/pitchStore'
import { usePlayersStore } from '../../players/store'
import type { SongLine, SongMeta } from '../../contracts/types'

const META: SongMeta = { artist: 'T', title: 'T', mp3Path: 'a.mp3', bpm: 120, gap: 0, videoGap: 0 }

/** 400 consecutive notes -- a realistic chart length, and long enough that a per-note store write is a storm. */
const LONG_LINES: SongLine[] = [
  {
    part: 'solo',
    notes: Array.from({ length: 400 }, (_, i) => ({
      kind: 'normal' as const,
      startBeat: i,
      length: 1,
      pitch: 9,
      syllable: `n${i}`,
    })),
  },
]

describe('judging a backlog of overdue notes', () => {
  beforeEach(() => {
    usePitchStore.setState({ devices: [], permissionStatus: 'granted', activeCaptures: {} })
    usePlayersStore.setState({ players: [{ id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' }] })
    useHitStore.getState().reset()
    useScoreStore.getState().reset({ players: [], combo: 0, rank: [] })
  })

  /**
   * The clock can arrive well ahead of the next unjudged note: the audio
   * element starts at a non-zero position, a stall drops a run of frames, or
   * the song is entered mid-way. The judging loop then has a backlog to clear.
   *
   * It used to clear it by calling `useHitStore.recordHit` and
   * `useScoreStore.applyHit` once *per note*, synchronously, inside a single
   * animation frame -- 400 notes meant 800 zustand writes, each notifying every
   * React subscriber, in one frame. React aborts that with "Maximum update
   * depth exceeded", which took the whole screen down.
   */
  it('clears a large backlog with a bounded number of store writes', async () => {
    const beat = motionValue(0)
    const hitWrites = vi.fn()
    const scoreWrites = vi.fn()
    const unsubHit = useHitStore.subscribe(hitWrites)
    const unsubScore = useScoreStore.subscribe(scoreWrites)

    render(<Gameplay meta={META} lines={LONG_LINES} beatPosition={beat} assignedPlayerIds={['p1']} />)
    await act(async () => {})
    hitWrites.mockClear()
    scoreWrites.mockClear()

    // One frame, far past the end of the chart.
    await act(async () => {
      beat.set(1000)
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })

    expect(useHitStore.getState().events.length).toBeGreaterThan(0)
    // The whole backlog must cost a handful of writes, not one per note.
    expect(hitWrites.mock.calls.length).toBeLessThanOrEqual(4)
    expect(scoreWrites.mock.calls.length).toBeLessThanOrEqual(4)

    unsubHit()
    unsubScore()
  })

  // A song is thousands of notes long and every hit was retained forever in a
  // spread-copied array, so the cost of recording hit N was O(N).
  it('keeps the recorded hit history bounded', async () => {
    const beat = motionValue(0)
    render(<Gameplay meta={META} lines={LONG_LINES} beatPosition={beat} assignedPlayerIds={['p1']} />)
    await act(async () => {})

    await act(async () => {
      beat.set(1000)
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })

    expect(useHitStore.getState().events.length).toBeLessThanOrEqual(256)
    // The most recent hit is always still available -- that is what the FX and
    // the HUD actually read.
    expect(useHitStore.getState().latest).not.toBeNull()
  })
})
