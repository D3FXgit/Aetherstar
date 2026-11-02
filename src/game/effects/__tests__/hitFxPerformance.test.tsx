import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { LaneHitFx } from '../LaneHitFx'
import { LaneSustainFx, SUSTAIN_SPARK_COUNT, type SustainHandle } from '../LaneSustainFx'
import { BURST_PARTICLE_CAPACITY, BURST_POOL_SIZE } from '../hitFx'
import { hitSfxGate } from '../hitSfxGate'
import { registerNoteKinds, resetNoteKinds } from '../noteKindRegistry'
import { NoteLane } from '../../lane/NoteLane'
import { computePitchRangeScaleFromPitches } from '../../lane/pitchRangeScale'
import type { NoteWithId } from '../../types'
import { useHitStore } from '../../state/useHitStore'
import { useScoreStore } from '../../state/useScoreStore'
import { useSfx } from '../../../audio/useSfx'
import type { HitTier } from '../../../contracts/types'
import type { SfxName } from '../../../audio/sfxContract'

/**
 * The guarantees this screen's frame budget rests on, pinned as assertions.
 *
 * This is the one screen in the app where a dropped frame is unmissable: eight
 * lanes, a live audio clock, and eight pitch detectors, all on one thread. The
 * two ways a hit effect ruins that are (a) leaking DOM for the length of a
 * song and (b) re-rendering React on every judged note. Both are cheap to
 * assert and neither survives a refactor unnoticed.
 */

const LANES = 8
const HITS = 2_000
const TIERS: HitTier[] = ['epic', 'good', 'awful']

function LaneStack() {
  return (
    <>
      {Array.from({ length: LANES }, (_, index) => (
        <LaneHitFx
          key={index}
          playerId={`p${index + 1}`}
          color="oklch(0.78 0.19 195)"
          laneHeightPx={64}
          resolveNoteY={() => 32}
        />
      ))}
    </>
  )
}

describe('hit FX under an eight-lane party', () => {
  beforeEach(() => {
    useSfx.setState({ play: vi.fn<(name: SfxName) => void>() })
    useHitStore.getState().reset()
    useScoreStore.getState().reset({
      players: Array.from({ length: LANES }, (_, i) => ({
        playerId: `p${i + 1}`,
        name: `P${i + 1}`,
        score: 0,
        combo: 0,
        rank: i + 1,
      })),
      combo: 0,
      rank: Array.from({ length: LANES }, (_, i) => `p${i + 1}`),
    })
    hitSfxGate.reset()
    resetNoteKinds()
  })

  // The absolute number, written down rather than merely compared against
  // itself: it is the whole reason this layer is a pool and not a render, and
  // it is the number that will quietly triple the first time someone adds a
  // node "just for golden notes". 8 lanes x (the layer, and 3 slots of 17
  // nodes each: the slot, a shockwave ring, 12 particles, an anchor, a word
  // group and the word) = 416. (The combo count and the combo "heat" glow went
  // with the combo itself.)
  it('is a known, fixed number of nodes for the whole song', () => {
    const { container } = render(<LaneStack />)
    const perSlot = 1 + 1 + BURST_PARTICLE_CAPACITY + 1 + 1 + 1
    expect(container.querySelectorAll('*').length).toBe(LANES * (1 + BURST_POOL_SIZE * perSlot))
    expect(container.querySelectorAll('*').length).toBe(416)
  })

  it('ends a two-thousand-note song with exactly the DOM it started with', () => {
    const { container } = render(<LaneStack />)
    const nodesAtMount = container.querySelectorAll('*').length

    act(() => {
      for (let i = 0; i < HITS; i += 1) {
        useHitStore.getState().recordHit({
          playerId: `p${(i % LANES) + 1}`,
          tier: TIERS[i % TIERS.length],
          noteId: `note-${i}`,
          deviationCents: 0,
          t: 1_000 + i * 12,
        })
      }
    })

    // A pool, not an allocation: the burst that fired on note 1 is the same
    // set of nodes that fires on note 2000.
    expect(container.querySelectorAll('*').length).toBe(nodesAtMount)
  })

  it('never re-renders a lane when a note is judged', () => {
    let renders = 0
    function CountingLane() {
      renders += 1
      return <LaneHitFx playerId="p1" color="#0ff" laneHeightPx={64} resolveNoteY={() => 32} />
    }

    render(<CountingLane />)
    const rendersAfterMount = renders

    act(() => {
      for (let i = 0; i < 200; i += 1) {
        useHitStore.getState().recordHit({
          playerId: 'p1',
          tier: 'epic',
          noteId: `note-${i}`,
          deviationCents: 0,
          t: 2_000 + i * 12,
        })
      }
    })

    // The store subscription is imperative on purpose. A hook here would
    // re-render this component -- and, in the real tree, force React to
    // reconcile the note lane above it -- several times a second per lane.
    expect(renders).toBe(rendersAfterMount)
  })

  // Golden notes light up more of the pool than anything else does, so they are
  // the case most likely to be "fixed" into an allocation.
  it('leaks nothing over a song made entirely of golden notes', () => {
    registerNoteKinds(
      Array.from({ length: HITS }, (_, i) => ({
        noteId: `note-${i}`,
        kind: 'golden' as const,
        startBeat: i,
        length: 1,
        pitch: 60,
        syllable: 'la',
      })),
    )

    const { container } = render(<LaneStack />)
    const nodesAtMount = container.querySelectorAll('*').length

    act(() => {
      for (let i = 0; i < HITS; i += 1) {
        useHitStore.getState().recordHit({
          playerId: `p${(i % LANES) + 1}`,
          tier: 'epic',
          noteId: `note-${i}`,
          deviationCents: 0,
          t: 1_000 + i * 12,
        })
      }
    })

    expect(container.querySelectorAll('*').length).toBe(nodesAtMount)
  })
})

/**
 * The same two guarantees for the note strip, which is the bigger of the two
 * subtrees: eight lanes of forty-odd note pills, each of which now *clears*.
 *
 * Clearing is written as two attributes on the note's own element, with the
 * fill and the flash drawn on `::before`/`::after`. The failure mode this
 * pins is the obvious implementation -- a `hitTiers` state object rebuilt per
 * judged note -- which re-renders every mounted note on every lane several
 * times a second, and the second-most-obvious one, a `<span>` appended per
 * clear, which leaks a node per note for the length of the song.
 */
describe('clearing notes under an eight-lane party', () => {
  const NOTES: NoteWithId[] = Array.from({ length: 400 }, (_, index) => ({
    noteId: `n${index}`,
    kind: index % 8 === 0 ? ('golden' as const) : ('normal' as const),
    startBeat: index * 2,
    length: 1,
    pitch: 60 + (index % 12),
    syllable: 'la',
  }))
  const SCALE = computePitchRangeScaleFromPitches(NOTES.map((note) => note.pitch))

  function LaneStack() {
    return (
      <>
        {Array.from({ length: LANES }, (_, index) => (
          <div key={index} data-player-id={`p${index + 1}`}>
            <NoteLane notes={NOTES} currentBeat={100} laneHeightPx={64} scale={SCALE} noteHeightPx={8} />
          </div>
        ))}
      </>
    )
  }

  beforeEach(() => {
    useHitStore.getState().reset()
    resetNoteKinds()
  })

  it('adds not one node while every note in the chart is cleared', () => {
    const { container } = render(<LaneStack />)
    const nodesAtMount = container.querySelectorAll('*').length

    act(() => {
      for (let i = 0; i < NOTES.length; i += 1) {
        for (let lane = 0; lane < LANES; lane += 1) {
          useHitStore.getState().recordHit({
            playerId: `p${lane + 1}`,
            tier: TIERS[i % TIERS.length],
            noteId: NOTES[i].noteId,
            deviationCents: 0,
            t: 1_000 + i * 12,
          })
        }
      }
    })

    expect(container.querySelectorAll('*').length).toBe(nodesAtMount)
    // ...and the notes really were cleared, so this is not measuring nothing.
    expect(container.querySelectorAll('[data-cleared]').length).toBeGreaterThan(0)
  })

  it('never re-renders a lane when its notes are judged', () => {
    let renders = 0
    function CountingLane() {
      renders += 1
      return (
        <div data-player-id="p1">
          <NoteLane notes={NOTES} currentBeat={100} laneHeightPx={64} scale={SCALE} noteHeightPx={8} />
        </div>
      )
    }

    render(<CountingLane />)
    const rendersAfterMount = renders

    act(() => {
      for (let i = 0; i < 200; i += 1) {
        useHitStore.getState().recordHit({
          playerId: 'p1',
          tier: 'epic',
          noteId: NOTES[i].noteId,
          deviationCents: 0,
          t: 2_000 + i * 12,
        })
      }
    })

    expect(renders).toBe(rendersAfterMount)
  })
})

/**
 * The sustained golden starburst (LaneSustainFx) -- the reference frame's
 * feedback for the note being landed *right now*.
 *
 * It is held to exactly the same budget as the burst pool above, and for a
 * harder reason: a burst is alive for half a second per note, whereas this is
 * alive for as long as the singer is on pitch, which on a good song is most of
 * it. Anything that allocates or animates per frame here would be the single
 * largest cost on the screen.
 */
describe('the sustained starburst under an eight-lane party', () => {
  function SustainStack() {
    return (
      <>
        {Array.from({ length: LANES }, (_, index) => (
          <LaneSustainFx key={index} handle={{ current: null }} color="#22d3ee" />
        ))}
      </>
    )
  }

  // Written down as an absolute, exactly as the burst pool's 448 is: 8 lanes x
  // (the layer, its core, and SUSTAIN_SPARK_COUNT trailing sparks) = 64. Added
  // to the 448 already there, the singer view's whole effects layer is 512
  // nodes for a song of any length.
  it('is a known, fixed number of nodes for the whole song', () => {
    const { container } = render(<SustainStack />)
    expect(container.querySelectorAll('*').length).toBe(LANES * (1 + 1 + SUSTAIN_SPARK_COUNT))
    expect(container.querySelectorAll('*').length).toBe(64)
  })

  it('adds not one node over ten thousand on-and-off transitions', () => {
    const handles = Array.from({ length: LANES }, () => ({ current: null as SustainHandle | null }))
    const { container } = render(
      <>
        {handles.map((handle, index) => (
          <LaneSustainFx key={index} handle={handle} color="#22d3ee" />
        ))}
      </>,
    )
    const nodesAtMount = container.querySelectorAll('*').length

    for (let i = 0; i < 10_000; i += 1) {
      for (const handle of handles) handle.current?.set(i % 3 === 0 ? null : (i % 200))
    }

    expect(container.querySelectorAll('*').length).toBe(nodesAtMount)
  })

  /**
   * A singer holding one steady note is the common case, and it must cost
   * nothing at all after the first frame of it -- the handle skips the DOM
   * write entirely when the value has not moved.
   */
  it('writes nothing to the DOM for a note that is being held steady', () => {
    const handle: { current: SustainHandle | null } = { current: null }
    render(<LaneSustainFx handle={handle} color="#22d3ee" />)
    const element = screen.getByTestId('lane-sustain-fx')

    handle.current!.set(120)
    expect(element.style.transform).toMatch(/translate3d/)

    // A value the component would never itself produce for this note, so any
    // write at all is visible.
    const sentinel = 'translate3d(0, 9999px, 0)'
    element.style.transform = sentinel
    for (let frame = 0; frame < 500; frame += 1) handle.current!.set(120)

    // Untouched: had the handler written unconditionally, this would have been
    // overwritten 500 times.
    expect(element.style.transform).toBe(sentinel)
  })

  // `top` is layout-affecting, and this sits inside a lane holding forty
  // mounted note pills. The same rule, and the same reason, as PitchLine.
  it('moves by transform only, never by a layout-affecting property', () => {
    const handle: { current: SustainHandle | null } = { current: null }
    render(<LaneSustainFx handle={handle} color="#22d3ee" />)
    const element = screen.getByTestId('lane-sustain-fx')

    handle.current!.set(87)
    expect(element.style.transform).toBe('translate3d(0, 87px, 0)')
    expect(element.style.top).toBe('0px')
  })

  it('goes dark the moment the singer comes off the note', () => {
    const handle: { current: SustainHandle | null } = { current: null }
    render(<LaneSustainFx handle={handle} color="#22d3ee" />)
    const element = screen.getByTestId('lane-sustain-fx')

    handle.current!.set(40)
    expect(element.dataset.on).toBe('true')
    handle.current!.set(null)
    expect(element.dataset.on).toBe('false')
  })

  it('drops its handle at unmount, so a stale frame loop cannot write to a dead node', () => {
    const handle: { current: SustainHandle | null } = { current: null }
    const { unmount } = render(<LaneSustainFx handle={handle} color="#22d3ee" />)
    expect(handle.current).not.toBeNull()
    unmount()
    expect(handle.current).toBeNull()
  })
})
