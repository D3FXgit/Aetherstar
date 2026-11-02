import { memo } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { motionValue } from 'framer-motion'
import type { NoteWithId } from '../../types'

/**
 * What the throttled `currentBeat` commit actually costs.
 *
 * Gameplay.tsx's frame loop writes the pitch line through a MotionValue and
 * commits `setCurrentBeat` at most every CURRENT_BEAT_THROTTLE_MS (100ms), so
 * React sees ~10 commits a second, not 60-120. That much was already true
 * before this phase. The open question was the one this file answers: does that
 * 10Hz commit re-render the lane's subtree -- up to eight lanes of forty-odd
 * NoteBlocks each -- or does it bail out?
 *
 * It bails out. The commit re-runs NoteLane's own body (one array filter over
 * the chart) and then performs one shallow prop comparison per mounted note,
 * every one of which passes, so not a single NoteBlock re-renders and not a
 * single DOM node is touched. The only NoteBlocks that ever render are the ones
 * genuinely entering the visible window.
 *
 * That is why nothing in Gameplay.tsx was changed to chase it: there is no
 * per-frame React render to remove, and the 10Hz render that does happen is
 * already O(notes entering the window) rather than O(notes on screen).
 *
 * This file exists to keep it that way. The bail-out depends on four things
 * staying referentially stable across a commit -- the `note` objects
 * (flattenNotes is memoised), `scale` (memoised in Gameplay), `accentColor`
 * and `heightPx`. Break any one of them, by inlining an object literal or
 * dropping a useMemo, and every mounted note re-renders ten times a second on
 * every lane. The assertions below fail loudly when that happens.
 */

let noteBlockRenders = 0

vi.mock('../NoteBlock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../NoteBlock')>()
  const Real = actual.NoteBlock
  // Wrapped in memo exactly as the real one is, so the wrapper's render count
  // is the real component's render count and not an artefact of the spy.
  const Counting = memo(function CountingNoteBlock(props: Parameters<typeof Real>[0]) {
    noteBlockRenders++
    return <Real {...props} />
  })
  return { ...actual, NoteBlock: Counting }
})

const { NoteLane, DEFAULT_VISIBLE_BEAT_WINDOW } = await import('../NoteLane')
const { computePitchRangeScaleFromPitches } = await import('../pitchRangeScale')

/**
 * A chart at roughly the density of a real song: a note every two beats for
 * 1200 notes. At the corrected clock (~16.7 beats/s at the 250 BPM fixture)
 * that is a couple of minutes of singing, and the +/-68-beat visible window
 * mounts a few dozen of them at a time.
 */
const NOTES: NoteWithId[] = Array.from({ length: 1200 }, (_, index) => ({
  noteId: `n${index}`,
  kind: 'normal' as const,
  startBeat: index * 2,
  length: 1,
  pitch: 60 + (index % 12),
  syllable: 'la',
}))

// Memoised once, as Gameplay.tsx memoises it -- the whole point is that the
// same scale object is handed to every commit.
const SCALE = computePitchRangeScaleFromPitches(NOTES.map((note) => note.pitch))

function renderLane(currentBeat: number) {
  return render(
    <NoteLane
      notes={NOTES}
      currentBeat={currentBeat}
      beatPosition={motionValue(currentBeat)}
      laneHeightPx={360}
      scale={SCALE}
      accentColor="oklch(0.78 0.19 195)"
    />,
  )
}

describe('the throttled currentBeat commit', () => {
  beforeEach(() => {
    noteBlockRenders = 0
  })
  afterEach(cleanup)

  it('mounts only the notes inside the visible window, not the whole chart', () => {
    renderLane(400)

    const mounted = screen.getAllByTestId('note-block').length
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThan(NOTES.length / 4)
    // +/- the window, one note every two beats.
    expect(mounted).toBe(DEFAULT_VISIBLE_BEAT_WINDOW + 1)
  })

  // The load-bearing assertion. A commit whose beat moved but whose visible set
  // did not must cost zero NoteBlock renders -- every memo comparison passes.
  it('re-renders no NoteBlock at all when the beat advances without changing the visible set', () => {
    // 401, not 400: the window is inclusive at both edges, so a beat that
    // lands exactly on a note's own beat sits one note wider than its
    // neighbours and any advance at all would drop it. Starting between notes
    // is what a running clock actually does.
    const { rerender } = renderLane(401)
    const mounted = screen.getAllByTestId('note-block').length
    const nodesBefore = screen.getAllByTestId('note-block')
    noteBlockRenders = 0

    // 1.67 beats is one 100ms tick at the 250 BPM fixture's corrected clock:
    // a real throttled commit, small enough that the window's edges land
    // between notes and the mounted set is unchanged.
    rerender(
      <NoteLane
        notes={NOTES}
        currentBeat={401.9}
        beatPosition={motionValue(401.9)}
        laneHeightPx={360}
        scale={SCALE}
        accentColor="oklch(0.78 0.19 195)"
      />,
    )

    expect(screen.getAllByTestId('note-block')).toHaveLength(mounted)
    expect(noteBlockRenders).toBe(0)
    // And nothing was re-created either: the same DOM nodes are still there.
    expect(screen.getAllByTestId('note-block')).toEqual(nodesBefore)
  })

  // When the window does move over a note boundary, the cost is the arrivals
  // only -- never a re-render of everything already on screen.
  it('renders only the notes entering the window, never the ones already on it', () => {
    const { rerender } = renderLane(401)
    noteBlockRenders = 0

    // Far enough to pull several new notes in at the leading edge and drop
    // several at the trailing one.
    rerender(
      <NoteLane
        notes={NOTES}
        currentBeat={410}
        beatPosition={motionValue(410)}
        laneHeightPx={360}
        scale={SCALE}
        accentColor="oklch(0.78 0.19 195)"
      />,
    )

    const mounted = screen.getAllByTestId('note-block').length
    expect(noteBlockRenders).toBeGreaterThan(0) // some notes really did arrive
    expect(noteBlockRenders).toBeLessThan(mounted / 2)
  })

  // The stability that makes the bail-out work, stated as its own guard: an
  // unstable `scale` is the easiest way to lose it by accident, and it would
  // fail silently -- the screen looks identical, it just costs forty times more.
  it('loses the bail-out if the scale prop identity changes, which is why Gameplay memoises it', () => {
    const { rerender } = renderLane(401)
    const mounted = screen.getAllByTestId('note-block').length
    noteBlockRenders = 0

    rerender(
      <NoteLane
        notes={NOTES}
        currentBeat={401.9}
        beatPosition={motionValue(401.9)}
        laneHeightPx={360}
        // A fresh, equal-but-not-identical scale -- what an un-memoised
        // computePitchRangeScaleFromPitches() call would hand over.
        scale={computePitchRangeScaleFromPitches(NOTES.map((note) => note.pitch))}
        accentColor="oklch(0.78 0.19 195)"
      />,
    )

    expect(noteBlockRenders).toBe(mounted)
  })
})
