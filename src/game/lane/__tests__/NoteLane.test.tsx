import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { motionValue } from 'framer-motion'
import { NoteLane, DEFAULT_VISIBLE_BEAT_WINDOW } from '../NoteLane'
import { PX_PER_BEAT } from '../NoteBlock'
import { flattenNotes } from '../../matching/flattenNotes'
import type { SongLine } from '../../../contracts/types'

const LINES: SongLine[] = [
  {
    part: 'solo',
    notes: [
      { kind: 'normal', startBeat: 0, length: 2, pitch: 60, syllable: 'a' },
      { kind: 'normal', startBeat: 4, length: 2, pitch: 65, syllable: 'b' },
      // Far outside any reasonable visible window from currentBeat=4.
      { kind: 'normal', startBeat: 500, length: 2, pitch: 70, syllable: 'c' },
    ],
  },
]

describe('NoteLane', () => {
  it('renders one NoteBlock per note within the visible beat window', () => {
    render(<NoteLane notes={flattenNotes(LINES)} currentBeat={4} laneHeightPx={400} visibleBeatWindow={32} />)
    const blocks = screen.getAllByTestId('note-block')
    expect(blocks).toHaveLength(2) // the far-away note (startBeat 500) is culled
  })

  it('passes the lane\'s note thickness down to every block it renders', () => {
    render(
      <NoteLane notes={flattenNotes(LINES)} currentBeat={4} laneHeightPx={64} visibleBeatWindow={32} noteHeightPx={8} />,
    )
    for (const block of screen.getAllByTestId('note-block')) {
      expect(block.style.height).toBe('8px')
    }
  })

  it('scrolls the whole strip with one transform instead of moving every note', async () => {
    const beatPosition = motionValue(8)
    render(
      <NoteLane notes={flattenNotes(LINES)} currentBeat={4} beatPosition={beatPosition} laneHeightPx={400} />,
    )

    const strip = screen.getByTestId('note-strip')
    expect(strip.style.transform).toContain(`translateX(${-8 * PX_PER_BEAT}px)`)

    beatPosition.set(9)
    await new Promise((resolve) => requestAnimationFrame(resolve))

    // One compositor-only property written once per frame, for the entire
    // lane -- rather than a layout-triggering `left` per visible note.
    expect(strip.style.transform).toContain(`translateX(${-9 * PX_PER_BEAT}px)`)
    // ...and not one note moved.
    expect(screen.getAllByTestId('note-block')[0].style.left).toBe('0px')
  })

  // The strip moves on every single frame for the whole song, so it is one of
  // exactly two elements in a lane worth a permanent compositor layer (the
  // other is the pitch line). `will-change` is advisory and can be dropped
  // under memory pressure; the 3D transform is the harder hint, and
  // framer-motion emits a bare 2D `translateX()` for a single-axis motion
  // value unless something appends it.
  it('is promoted to its own compositor layer, with both hints', () => {
    render(<NoteLane notes={flattenNotes(LINES)} currentBeat={4} laneHeightPx={400} />)

    const strip = screen.getByTestId('note-strip')
    expect(strip.style.willChange).toContain('transform')
    expect(strip.style.transform).toContain('translateZ(0)')
  })

  it('falls back to the plain beat number when there is no live clock (labs, static previews)', () => {
    render(<NoteLane notes={flattenNotes(LINES)} currentBeat={4} laneHeightPx={400} />)
    expect(screen.getByTestId('note-strip').style.transform).toContain(`translateX(${-4 * PX_PER_BEAT}px)`)
  })

  it('looks far enough ahead that notes enter from off-screen rather than popping in', () => {
    // The lane can be ~2400 CSS px wide on a large display, with the playhead
    // at 35%, so it shows ~1560px of upcoming chart. Anything less than that
    // in the window and notes appear out of nothing inside the lane.
    expect(DEFAULT_VISIBLE_BEAT_WINDOW * PX_PER_BEAT).toBeGreaterThanOrEqual(1560)
  })
})
