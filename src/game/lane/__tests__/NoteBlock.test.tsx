import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NoteBlock, NOTE_HEIGHT_PX, PX_PER_BEAT } from '../NoteBlock'
import { computePitchRangeScale } from '../pitchRangeScale'
import type { NoteWithId } from '../../types'

const NOTE: NoteWithId = { noteId: 'note-0', kind: 'normal', startBeat: 10, length: 2, pitch: 65, syllable: 'la' }
const SCALE = computePitchRangeScale([{ part: 'solo', notes: [NOTE] }])

describe('NoteBlock -- rap notes', () => {
  // Rap notes score voice at any pitch, so they must not look like a pitch
  // target: hatched with a dashed rim, as UltraStar draws them.
  it('draws rap and golden-rap notes hatched, with a dashed rim', () => {
    render(<NoteBlock note={{ ...NOTE, kind: 'rap' }} scale={SCALE} laneHeightPx={400} />)
    render(<NoteBlock note={{ ...NOTE, noteId: 'note-1', kind: 'goldenRap' }} scale={SCALE} laneHeightPx={400} />)
    const [rap, goldenRap] = screen.getAllByTestId('note-block')
    for (const block of [rap, goldenRap]) {
      expect(block.style.border).toContain('dashed')
      expect(block.style.background).toContain('repeating-linear-gradient')
    }
    // Golden stays picked out by its halo, hatched or not.
    expect(goldenRap.style.boxShadow).not.toBe(rap.style.boxShadow)
  })

  it('lays out by percent on a paged lane', () => {
    render(<NoteBlock note={NOTE} scale={SCALE} laneHeightPx={400} layout={{ leftPercent: 12.5, widthPercent: 20 }} />)
    const block = screen.getByTestId('note-block')
    expect(block.style.left).toBe('12.5%')
    expect(block.style.width).toBe('20%')
  })

  it('carries a live fill that grows from one custom property, starting empty', () => {
    render(<NoteBlock note={NOTE} scale={SCALE} laneHeightPx={400} />)
    const live = screen.getByTestId('note-live-fill')
    expect(live).toHaveAttribute('aria-hidden')
    expect(live.style.transform).toBe('scaleX(var(--ae-note-live, 0))')
  })
})

describe('NoteBlock', () => {
  it('applies a class distinguishing note kind', () => {
    render(<NoteBlock note={NOTE} scale={SCALE} laneHeightPx={400} />)
    expect(screen.getByTestId('note-block')).toHaveAttribute('data-note-kind', 'normal')

    const golden = { ...NOTE, kind: 'golden' as const }
    render(<NoteBlock note={golden} scale={SCALE} laneHeightPx={400} />)
    expect(screen.getAllByTestId('note-block')[1]).toHaveAttribute('data-note-kind', 'golden')
  })

  // A note's position in the chart never changes; only the lane's scroll
  // offset does. Positioning each note by `(startBeat - beat) * PX_PER_BEAT`
  // wrote a new `left` to every visible note on every frame -- `left` is a
  // layout property, so that invalidated layout for the whole lane 60+ times a
  // second, on every lane. See NoteLane: the strip is now translated once.
  it('sits at its own fixed place in the strip and never moves again', () => {
    render(<NoteBlock note={NOTE} scale={SCALE} laneHeightPx={400} />)
    expect(screen.getByTestId('note-block').style.left).toBe(`${10 * PX_PER_BEAT}px`)
  })

  it('positions vertically per the pitch scale', () => {
    render(<NoteBlock note={NOTE} scale={SCALE} laneHeightPx={400} />)
    const block = screen.getByTestId('note-block')
    expect(block.style.top).toBe(`${SCALE.toY(NOTE.pitch, 400)}px`)
  })

  it('takes the pill thickness a crowded lane needs, keeping its ends round', () => {
    // A 20px pill in the 64px lane of an eight-player stack is a third of the
    // whole pitch range, so notes an octave apart would visually overlap.
    render(<NoteBlock note={NOTE} scale={SCALE} laneHeightPx={400} heightPx={8} />)
    const block = screen.getByTestId('note-block')
    expect(block.style.height).toBe('8px')
    expect(block.style.borderRadius).toBe('4px')
  })

  it('keeps the solo-lane pill size when no thickness is asked for', () => {
    render(<NoteBlock note={NOTE} scale={SCALE} laneHeightPx={400} />)
    expect(screen.getByTestId('note-block').style.height).toBe(`${NOTE_HEIGHT_PX}px`)
  })

  it('adds a tier-specific fill class once judged', () => {
    render(<NoteBlock note={NOTE} scale={SCALE} laneHeightPx={400} hitTier="epic" />)
    expect(screen.getByTestId('note-block')).toHaveAttribute('data-hit-tier', 'epic')
  })

  it('writes no layout-affecting geometry that a scrolling lane would have to redo', () => {
    render(<NoteBlock note={NOTE} scale={SCALE} laneHeightPx={400} />)
    // Nothing here animates: every one of these is written once, at mount.
    expect(screen.getByTestId('note-block').style.transform).toBe('')
  })
})
