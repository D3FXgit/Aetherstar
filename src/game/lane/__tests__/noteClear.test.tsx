import { memo } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { motionValue } from 'framer-motion'
import type { HitTier } from '../../../contracts/types'
import type { JudgedHit, NoteWithId } from '../../types'
import { useHitStore } from '../../state/useHitStore'
import { isGoldenNote, resetNoteKinds } from '../../effects/noteKindRegistry'

/**
 * Clearing a note: the thing that makes a landed note feel landed.
 *
 * A note used to scroll past unchanged whatever the singer did with it -- the
 * only acknowledgement was a word popping up somewhere near it. Now the note
 * itself fills in with the colour it earned, swells, flashes, and stays lit
 * behind the playhead, so the trail of cleared notes *is* the score.
 *
 * The reason this file exists is that all of that had to be added to the
 * single most frame-critical subtree in the app -- eight lanes, forty note
 * pills each, on the same thread as eight pitch detectors and the audio clock.
 * So every assertion below is either "the player can see what they did" or
 * "and it cost nothing", and the second kind is the one that will fail first
 * when someone reaches for the obvious `useState` implementation.
 */

const mocks = vi.hoisted(() => ({ reducedMotion: false }))

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => mocks.reducedMotion }
})

let noteBlockRenders = 0

vi.mock('../NoteBlock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../NoteBlock')>()
  const Real = actual.NoteBlock
  const Counting = memo(function CountingNoteBlock(props: Parameters<typeof Real>[0]) {
    noteBlockRenders++
    return <Real {...props} />
  })
  return { ...actual, NoteBlock: Counting }
})

const { NoteLane } = await import('../NoteLane')
const { computePitchRangeScaleFromPitches } = await import('../pitchRangeScale')

const NOTES: NoteWithId[] = [
  { noteId: 'n0', kind: 'normal', startBeat: 0, length: 2, pitch: 60, syllable: 'a' },
  { noteId: 'n1', kind: 'golden', startBeat: 4, length: 2, pitch: 64, syllable: 'b' },
  { noteId: 'n2', kind: 'normal', startBeat: 8, length: 2, pitch: 67, syllable: 'c' },
]
const SCALE = computePitchRangeScaleFromPitches(NOTES.map((note) => note.pitch))

function hit(overrides: Partial<JudgedHit> = {}): JudgedHit {
  return { playerId: 'p1', tier: 'epic', noteId: 'n0', deviationCents: 3, t: 1_000, ...overrides }
}

function record(event: JudgedHit) {
  act(() => {
    useHitStore.getState().recordHit(event)
  })
}

function noteEl(noteId: string): HTMLElement {
  return screen.getByTestId('note-lane').querySelector<HTMLElement>(`[data-note-id="${noteId}"]`)!
}

function renderLane(props: Partial<Parameters<typeof NoteLane>[0]> = {}, notes: NoteWithId[] = NOTES) {
  return render(
    <NoteLane
      notes={notes}
      currentBeat={4}
      beatPosition={motionValue(4)}
      laneHeightPx={320}
      scale={SCALE}
      accentColor="oklch(0.78 0.19 195)"
      {...props}
    />,
  )
}

/** Gameplay's own root, which is what a lane in the real tree finds its singer from. */
function renderInGameplayRoot(playerId: string, notes: NoteWithId[] = NOTES) {
  return render(
    <div data-testid="gameplay" data-player-id={playerId}>
      <NoteLane
        notes={notes}
        currentBeat={4}
        beatPosition={motionValue(4)}
        laneHeightPx={320}
        scale={SCALE}
      />
    </div>,
  )
}

describe('clearing a note', () => {
  beforeEach(() => {
    mocks.reducedMotion = false
    noteBlockRenders = 0
    useHitStore.getState().reset()
    resetNoteKinds()
  })
  afterEach(cleanup)

  it('fills the note in with the tier it earned, on the note itself', () => {
    renderLane()
    record(hit({ noteId: 'n0', tier: 'good' }))

    // `data-cleared` is what the whole `.ae-note` stylesheet keys off: the
    // fill colour, the swell, the flash and the resting lit state.
    expect(noteEl('n0')).toHaveAttribute('data-cleared', 'good')
  })

  it.each<HitTier>(['epic', 'good', 'awful'])('records a %s judgement on the note that earned it', (tier) => {
    renderLane()
    record(hit({ noteId: 'n2', tier }))
    expect(noteEl('n2')).toHaveAttribute('data-cleared', tier)
  })

  it('leaves every other note in the lane un-sung', () => {
    renderLane()
    record(hit({ noteId: 'n0' }))

    expect(noteEl('n1')).not.toHaveAttribute('data-cleared')
    expect(noteEl('n2')).not.toHaveAttribute('data-cleared')
  })

  it('starts every note un-sung, so the lane reads as outlines ahead of the playhead', () => {
    renderLane()
    for (const note of NOTES) expect(noteEl(note.noteId)).not.toHaveAttribute('data-cleared')
  })

  describe('golden notes', () => {
    it('marks a landed golden note as golden, on top of its tier', () => {
      renderLane()
      record(hit({ noteId: 'n1', tier: 'good' }))

      const element = noteEl('n1')
      expect(element).toHaveAttribute('data-cleared', 'good')
      expect(element).toHaveAttribute('data-cleared-golden', 'true')
    })

    // The one thing that must not happen: a note celebrating because of its
    // kind when the singer did not actually land it.
    it('gives a *missed* golden note the miss treatment, not the gold one', () => {
      renderLane()
      record(hit({ noteId: 'n1', tier: 'awful' }))

      const element = noteEl('n1')
      expect(element).toHaveAttribute('data-cleared', 'awful')
      expect(element).toHaveAttribute('data-cleared-golden', 'false')
    })

    it('never marks an ordinary note golden', () => {
      renderLane()
      record(hit({ noteId: 'n0', tier: 'epic' }))
      expect(noteEl('n0')).toHaveAttribute('data-cleared-golden', 'false')
    })

    // LaneHitFx is a *sibling* of the lane and is handed a note id with no view
    // of the chart, so the lane publishes its golden notes for it. Without this
    // the golden burst and the golden sound never fire in the real tree.
    it('publishes which notes are golden for the burst layer that only has ids', () => {
      const { unmount } = renderLane()
      expect(isGoldenNote('n1')).toBe(true)
      expect(isGoldenNote('n0')).toBe(false)

      unmount()
      expect(isGoldenNote('n1')).toBe(false)
    })
  })

  /**
   * Partial credit, as the singer sees it: the pill fills *as far as they sang*.
   *
   * This is the user's own request -- "partial points ... also visualized by
   * the bar partially filled" -- and it is deliberately built as an extension
   * of the staged clear rather than a replacement for it. The same sweep, the
   * same swell, the same flash; only the end point of the sweep changes, which
   * is why it arrives as one custom property and not as a second mechanism.
   */
  describe('a partly sung note', () => {
    function fillOf(noteId: string): number {
      return Number(noteEl(noteId).style.getPropertyValue('--ae-note-fill'))
    }

    it('fills the pill as far as the note was credited', () => {
      renderLane()
      record(hit({ noteId: 'n0', tier: 'good', credit: 0.62 }))
      expect(fillOf('n0')).toBeCloseTo(0.62, 5)
    })

    it('marks itself partial, so the fill can carry an edge where the singing stopped', () => {
      renderLane()
      record(hit({ noteId: 'n0', tier: 'good', credit: 0.5 }))
      expect(noteEl('n0')).toHaveAttribute('data-partial', 'true')
    })

    it('fills a fully sung note all the way, and does not mark it partial', () => {
      renderLane()
      record(hit({ noteId: 'n0', tier: 'epic', credit: 1 }))
      expect(fillOf('n0')).toBe(1)
      expect(noteEl('n0')).toHaveAttribute('data-partial', 'false')
    })

    // Every producer that predates partial credit -- a lab, a preview, a test,
    // the declarative `hitTiers` prop -- means "a whole note", and must keep
    // rendering exactly as it did.
    it('treats a hit with no credit as a whole note', () => {
      renderLane()
      record(hit({ noteId: 'n0', tier: 'epic' }))
      expect(fillOf('n0')).toBe(1)
      expect(noteEl('n0')).toHaveAttribute('data-partial', 'false')
    })

    /**
     * A miss keeps the un-filled wash its own rule draws (`[data-cleared=
     * 'awful']::before`). Collapsing it to a zero-width fill would replace a
     * deliberate, established look with a bare outline -- and a miss is already
     * unmistakable. Partial fill is a statement about notes that *earned*
     * something.
     */
    it('leaves a missed note\'s treatment alone', () => {
      renderLane()
      record(hit({ noteId: 'n0', tier: 'awful', credit: 0 }))
      expect(fillOf('n0')).toBe(1)
      expect(noteEl('n0')).toHaveAttribute('data-partial', 'false')
    })

    it('still shows the partial fill when the note scrolls away and comes back', () => {
      const { rerender } = renderLane({ visibleBeatWindow: 4 })
      record(hit({ noteId: 'n0', tier: 'good', credit: 0.4 }))

      rerender(<NoteLane notes={NOTES} currentBeat={80} laneHeightPx={320} scale={SCALE} visibleBeatWindow={4} />)
      rerender(<NoteLane notes={NOTES} currentBeat={0} laneHeightPx={320} scale={SCALE} visibleBeatWindow={4} />)

      expect(fillOf('n0')).toBeCloseTo(0.4, 5)
      expect(noteEl('n0')).toHaveAttribute('data-partial', 'true')
    })

    it('does not carry a partial fill into the next song through a re-used note id', () => {
      const { rerender } = renderLane()
      record(hit({ noteId: 'n0', tier: 'good', credit: 0.3 }))

      const nextSong: NoteWithId[] = NOTES.map((note) => ({ ...note }))
      rerender(<NoteLane notes={nextSong} currentBeat={4} laneHeightPx={320} scale={SCALE} />)

      expect(noteEl('n0').style.getPropertyValue('--ae-note-fill')).toBe('')
      expect(noteEl('n0')).not.toHaveAttribute('data-partial')
    })

    // The fill is a custom property read by `.ae-note::before`'s own transform.
    // Writing the note element's `transform` instead would put geometry back on
    // the hot path this lane exists to keep it off -- and would fight the
    // swell keyframe for the same property.
    it('costs one custom property, not a transform on the note', () => {
      renderLane()
      record(hit({ noteId: 'n0', tier: 'good', credit: 0.5 }))
      expect(noteEl('n0').style.transform).toBe('')
      expect(noteEl('n0').style.width).toBe(`${2 * 24}px`)
    })
  })

  describe('whose hit it was', () => {
    // Every singer's lane draws the same chart with the same note ids. Without
    // an owner, player 1 nailing a note would light it up in all eight lanes.
    it('ignores another singer\'s judgement of the same note', () => {
      renderInGameplayRoot('p1')
      record(hit({ playerId: 'p2', noteId: 'n0' }))
      expect(noteEl('n0')).not.toHaveAttribute('data-cleared')
    })

    it('finds its singer from the gameplay root it is rendered inside', () => {
      renderInGameplayRoot('p1')
      record(hit({ playerId: 'p1', noteId: 'n0' }))
      expect(noteEl('n0')).toHaveAttribute('data-cleared', 'epic')
    })

    it('takes an explicit playerId over the ancestor, when a caller has one', () => {
      render(
        <div data-player-id="p9">
          <NoteLane notes={NOTES} currentBeat={4} laneHeightPx={320} scale={SCALE} playerId="p1" />
        </div>,
      )
      record(hit({ playerId: 'p1', noteId: 'n0' }))
      expect(noteEl('n0')).toHaveAttribute('data-cleared', 'epic')
    })

    // A lab or a static preview has no player identity at all; it should still
    // show what clearing looks like rather than nothing.
    it('clears on any hit when there is no singer to attribute it to', () => {
      renderLane()
      record(hit({ playerId: 'whoever', noteId: 'n0' }))
      expect(noteEl('n0')).toHaveAttribute('data-cleared', 'epic')
    })
  })

  describe('what it costs', () => {
    // The load-bearing one. The obvious implementation -- a `hitTiers` state
    // object rebuilt per judged note -- re-renders the strip several times a
    // second on every lane -- the render path the note lane is kept off so it
    // cannot cost frames while pitch detection runs.
    it('re-renders no note at all when notes are judged', () => {
      renderLane()
      noteBlockRenders = 0

      for (let i = 0; i < 200; i += 1) {
        record(hit({ noteId: NOTES[i % NOTES.length].noteId, t: 2_000 + i * 12 }))
      }

      expect(noteBlockRenders).toBe(0)
    })

    it('ends a two-thousand-note run with exactly the DOM it started with', () => {
      const { container } = renderLane()
      const nodesAtMount = container.querySelectorAll('*').length

      act(() => {
        for (let i = 0; i < 2_000; i += 1) {
          useHitStore.getState().recordHit(hit({ noteId: NOTES[i % NOTES.length].noteId, t: 3_000 + i * 9 }))
        }
      })

      // The fill and the flash are the note's own ::before/::after: a clear
      // adds no node, so there is nothing to leak however long the song is.
      expect(container.querySelectorAll('*').length).toBe(nodesAtMount)
    })

    it('never writes a layout-affecting property to clear a note', () => {
      renderLane()
      record(hit({ noteId: 'n0' }))

      const element = noteEl('n0')
      // Geometry is written once at mount and never again -- clearing must not
      // put `left`/`top`/`width`/`height`/`transform` back on the hot path.
      expect(element.style.left).toBe('0px')
      expect(element.style.transform).toBe('')
      expect(element.style.width).toBe(`${2 * 24}px`)
    })
  })

  describe('a note that leaves the mounted window and comes back', () => {
    // The lane mounts only a beat-window's worth of notes. A cleared note that
    // is culled and later re-mounted (a seek, a resize, a lab scrubbing the
    // beat) must come back still cleared instead of silently un-singing itself.
    it('is still cleared when it re-enters', () => {
      const { rerender } = renderLane({ visibleBeatWindow: 4 })
      record(hit({ noteId: 'n0', tier: 'good' }))
      expect(noteEl('n0')).toHaveAttribute('data-cleared', 'good')

      const away = (
        <NoteLane
          notes={NOTES}
          currentBeat={80}
          laneHeightPx={320}
          scale={SCALE}
          visibleBeatWindow={4}
        />
      )
      rerender(away)
      expect(screen.getByTestId('note-lane').querySelector('[data-note-id="n0"]')).toBeNull()

      rerender(
        <NoteLane notes={NOTES} currentBeat={0} laneHeightPx={320} scale={SCALE} visibleBeatWindow={4} />,
      )
      expect(noteEl('n0')).toHaveAttribute('data-cleared', 'good')
    })

    // Note ids are chart-local, so the next song reuses them. Carrying a
    // judgement across would show song two's first note already sung.
    it('does not inherit the previous song\'s judgements through a re-used note id', () => {
      const { rerender } = renderLane()
      record(hit({ noteId: 'n0', tier: 'epic' }))

      const nextSong: NoteWithId[] = NOTES.map((note) => ({ ...note }))
      rerender(<NoteLane notes={nextSong} currentBeat={4} laneHeightPx={320} scale={SCALE} />)

      expect(noteEl('n0')).not.toHaveAttribute('data-cleared')
    })
  })

  describe('reduced motion', () => {
    // HIG Accessibility: motion is *replaced*, not slowed. The note still
    // fills in and still keeps the colour and the golden rim it earned -- the
    // information is not optional, only the sweep and the flash are.
    it('still says what was cleared, and whether it was golden', () => {
      mocks.reducedMotion = true
      renderLane()
      record(hit({ noteId: 'n1', tier: 'epic' }))

      expect(screen.getByTestId('note-lane')).toHaveAttribute('data-static', 'true')
      expect(noteEl('n1')).toHaveAttribute('data-cleared', 'epic')
      expect(noteEl('n1')).toHaveAttribute('data-cleared-golden', 'true')
    })

    it('animates normally when motion is welcome', () => {
      renderLane()
      expect(screen.getByTestId('note-lane')).toHaveAttribute('data-static', 'false')
    })
  })

  // A lab or a static preview knows its judgements up front. It has to land on
  // exactly the same pixels as the live game, or the thing being previewed is
  // not the thing that ships -- so both go through one painter.
  describe('a judgement handed in as a prop', () => {
    it('paints the same attributes the live game writes', () => {
      renderLane({ hitTiers: { n0: 'good', n1: 'epic' } })

      expect(noteEl('n0')).toHaveAttribute('data-cleared', 'good')
      expect(noteEl('n1')).toHaveAttribute('data-cleared', 'epic')
      expect(noteEl('n1')).toHaveAttribute('data-cleared-golden', 'true')
      expect(noteEl('n2')).not.toHaveAttribute('data-cleared')
    })

    it('keeps up when the preview steps forward', () => {
      const { rerender } = renderLane({ hitTiers: {} })
      expect(noteEl('n0')).not.toHaveAttribute('data-cleared')

      rerender(
        <NoteLane notes={NOTES} currentBeat={4} laneHeightPx={320} scale={SCALE} hitTiers={{ n0: 'awful' }} />,
      )
      expect(noteEl('n0')).toHaveAttribute('data-cleared', 'awful')
    })
  })

  it('hands the clear palette to the lane once, not to every note', () => {
    // Three custom properties per lane, inherited by forty notes -- rather
    // than three inline style writes on each note at mount.
    const lane = renderLane().container.querySelector<HTMLElement>('[data-testid="note-lane"]')!
    expect(lane.style.getPropertyValue('--ae-note-epic')).not.toBe('')
    expect(lane.style.getPropertyValue('--ae-note-golden')).not.toBe('')
    expect(noteEl('n0').style.getPropertyValue('--ae-note-epic')).toBe('')
  })
})

/**
 * The pill's own read, before and after it is sung.
 *
 * The reference frame is built on one contrast: **ahead of the playhead every
 * note is the same neutral translucent grey, whoever is singing it; behind it,
 * notes are solid and carry the singer's own colour with a glossy, slightly
 * domed fill.** Tinting the un-sung notes with the player's colour -- which is
 * what this used to do -- spent the colour before it meant anything, so a field
 * of notes looked identical whether or not a word had been sung.
 */
describe('how a note reads before and after it is sung', () => {
  beforeEach(() => {
    mocks.reducedMotion = false
    useHitStore.getState().reset()
    resetNoteKinds()
  })
  afterEach(cleanup)

  it('draws every un-sung ordinary note the same neutral grey, whoever owns the lane', () => {
    const { unmount } = renderLane({ accentColor: 'rgb(0, 200, 120)' })
    const withAccent = noteEl('n0').style.background
    unmount()

    renderLane({ accentColor: 'rgb(255, 0, 0)' })
    expect(noteEl('n0').style.background).toBe(withAccent)
    // Neutral, and translucent enough to keep the video readable through it.
    expect(withAccent).toMatch(/rgba\(226, ?230, ?240, ?0\.3\)/)
  })

  /**
   * The singer's colour is published once per lane and inherited by every note
   * in it, rather than written onto each of forty note elements at mount --
   * clearing a note must not put per-note style writes back into a hot path
   * they were deliberately removed from.
   */
  it('publishes the singer\'s colour once, on the lane, as what a cleared note fills with', () => {
    renderLane({ accentColor: 'rgb(0, 200, 120)' })
    const lane = screen.getByTestId('note-lane')

    expect(lane.style.getPropertyValue('--ae-note-sung')).toBe('rgb(0, 200, 120)')
    // Never written onto the note itself.
    expect(noteEl('n0').style.getPropertyValue('--ae-note-sung')).toBe('')
  })

  it('falls back to a judgement colour when no singer owns the lane (a lab or preview)', () => {
    renderLane({ accentColor: undefined })
    expect(screen.getByTestId('note-lane').style.getPropertyValue('--ae-note-sung')).not.toBe('')
  })
})
