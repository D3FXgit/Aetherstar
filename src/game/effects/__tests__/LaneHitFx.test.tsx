import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import type { HitEvent, HitTier } from '../../../contracts/types'
import type { SfxName } from '../../../audio/sfxContract'
import { LaneHitFx, HIT_FX_LIFETIME_PADDING_MS } from '../LaneHitFx'
import { BURST_POOL_SIZE, BURST_PARTICLE_CAPACITY, burstDurationMs, burstParticleCountFor } from '../hitFx'
import { registerNoteKinds, resetNoteKinds } from '../noteKindRegistry'
import type { NoteWithId } from '../../types'
import { hitSfxGate } from '../hitSfxGate'
import { useHitStore } from '../../state/useHitStore'
import { useScoreStore } from '../../state/useScoreStore'
import { useSfx } from '../../../audio/useSfx'

const mocks = vi.hoisted(() => ({ reducedMotion: false }))

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => mocks.reducedMotion }
})

let play: ReturnType<typeof vi.fn<(name: SfxName) => void>>

function hit(overrides: Partial<HitEvent> = {}): HitEvent {
  return { playerId: 'p1', tier: 'epic', noteId: 'n1', deviationCents: 4, t: 1_000, ...overrides }
}

function record(event: HitEvent) {
  act(() => {
    useHitStore.getState().recordHit(event)
  })
}

function firingSlots() {
  return screen.getAllByTestId('hit-fx-slot').filter((slot) => slot.dataset.firing === 'true')
}

function renderLane(props: Partial<Parameters<typeof LaneHitFx>[0]> = {}) {
  return render(
    <LaneHitFx
      playerId="p1"
      color="oklch(0.78 0.19 195)"
      laneHeightPx={320}
      resolveNoteY={() => 42}
      {...props}
    />,
  )
}

describe('LaneHitFx', () => {
  beforeEach(() => {
    mocks.reducedMotion = false
    play = vi.fn<(name: SfxName) => void>()
    useSfx.setState({ play })
    useHitStore.getState().reset()
    useScoreStore.getState().reset({ players: [{ playerId: 'p1', name: 'Alex', score: 0, combo: 0, rank: 1 }], combo: 0, rank: ['p1'] })
    hitSfxGate.reset()
    resetNoteKinds()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetNoteKinds()
  })

  it('mounts its whole pool up front and shows nothing until a note is judged', () => {
    renderLane()

    // The pool is the guarantee: these nodes exist before the first note and
    // are the same nodes after the last one.
    expect(screen.getAllByTestId('hit-fx-slot')).toHaveLength(BURST_POOL_SIZE)
    expect(firingSlots()).toHaveLength(0)
  })

  it('pops the tier word the player reads, not the engine name for it', () => {
    renderLane()
    record(hit({ tier: 'epic' }))

    const slot = firingSlots()[0]
    expect(slot).toHaveAttribute('data-tier', 'epic')
    expect(within(slot).getByTestId('hit-fx-word')).toHaveTextContent('Excellent')
  })

  it.each<[HitTier, string]>([
    ['epic', 'Excellent'],
    ['good', 'Good'],
    ['awful', 'Bad'],
  ])('labels a %s hit "%s"', (tier, label) => {
    renderLane()
    record(hit({ tier }))
    expect(within(firingSlots()[0]).getByTestId('hit-fx-word')).toHaveTextContent(label)
  })


  it('lands the burst on the note that was cleared, not in the middle of the lane', () => {
    renderLane({ resolveNoteY: (noteId) => (noteId === 'n9' ? 118 : null) })
    record(hit({ noteId: 'n9' }))

    expect(firingSlots()[0].style.top).toBe('118px')
  })

  it('falls back to the lane centre when the note is no longer known', () => {
    renderLane({ laneHeightPx: 200, resolveNoteY: () => null })
    record(hit({ noteId: 'gone' }))

    expect(firingSlots()[0].style.top).toBe('100px')
  })

  // The lane clips its own content, and in an eight-player stack a lane is
  // only 64px tall -- a word that always rose would be cut in half by the top
  // edge for any note near the top of the singer's range.
  it('flips the word downward when the note sits at the top of the lane', () => {
    renderLane({ laneHeightPx: 320, resolveNoteY: () => 20 })
    record(hit({ tier: 'epic' }))

    expect(firingSlots()[0].style.getPropertyValue('--ae-hit-rise').startsWith('-')).toBe(false)
  })

  it('lifts a missed note\'s word instead of sinking it when the note is at the bottom', () => {
    renderLane({ laneHeightPx: 320, resolveNoteY: () => 300 })
    record(hit({ tier: 'awful' }))

    expect(firingSlots()[0].style.getPropertyValue('--ae-hit-rise').startsWith('-')).toBe(true)
  })

  it('keeps the burst off the very edge of the lane', () => {
    renderLane({ laneHeightPx: 64, resolveNoteY: () => 2 })
    record(hit())

    expect(Number.parseInt(firingSlots()[0].style.top, 10)).toBeGreaterThanOrEqual(12)
  })

  it('scales the word\'s travel down with the lane, so an eight-lane stack still contains it', () => {
    const riseFor = (laneHeightPx: number) => {
      const { unmount } = renderLane({ laneHeightPx, resolveNoteY: () => laneHeightPx / 2 })
      record(hit({ tier: 'epic' }))
      const rise = Math.abs(Number.parseFloat(firingSlots()[0].style.getPropertyValue('--ae-hit-rise')))
      unmount()
      return rise
    }

    expect(riseFor(64)).toBeLessThan(riseFor(320))
  })

  it('ignores another player\'s hits -- a lane only ever shows its own singer', () => {
    renderLane({ playerId: 'p1' })
    record(hit({ playerId: 'p2' }))

    expect(firingSlots()).toHaveLength(0)
  })

  it('lights particles for a landed note and none at all for a missed one', () => {
    renderLane()
    record(hit({ tier: 'epic' }))
    const epicSlot = firingSlots()[0]
    const visible = (slot: HTMLElement) =>
      within(slot)
        .getAllByTestId('hit-fx-particle')
        .filter((particle) => particle.style.display !== 'none')

    expect(visible(epicSlot)).toHaveLength(burstParticleCountFor('epic'))

    record(hit({ tier: 'awful', noteId: 'n2', t: 9_000 }))
    const awfulSlot = firingSlots().find((slot) => slot.dataset.tier === 'awful')!
    expect(visible(awfulSlot)).toHaveLength(0)
    // The spans still exist -- hidden, not unmounted, so nothing is allocated
    // on the next hit either.
    expect(within(awfulSlot).getAllByTestId('hit-fx-particle')).toHaveLength(BURST_PARTICLE_CAPACITY)
  })

  /**
   * The burst rework, as the two things it is allowed to cost: geometry
   * written once at mount, and a handful of custom properties written per hit.
   *
   * Everything that makes a spark read as a spark rather than a dot -- the
   * capsule shape, the angle it lies along, the tumble, the arc, the streak
   * behind it -- is one of those two, plus pseudo-elements. Not one node was
   * added for any of it, which is what `hitFxPerformance.test.tsx` pins from
   * the other side.
   */
  describe('what a spark is made of', () => {
    it('writes each spark\'s flight geometry once, at mount', () => {
      renderLane()

      for (const particle of screen.getAllByTestId('hit-fx-particle')) {
        expect(particle.style.getPropertyValue('--ae-hit-dx')).toMatch(/px$/)
        expect(particle.style.getPropertyValue('--ae-hit-dy')).toMatch(/px$/)
        expect(particle.style.getPropertyValue('--ae-hit-angle')).toMatch(/deg$/)
        expect(particle.style.getPropertyValue('--ae-hit-spin')).toMatch(/deg$/)
        expect(particle.style.getPropertyValue('--ae-hit-gravity')).toMatch(/px$/)
      }
    })

    it('draws a spark as a capsule lying along its path, not as a dot', () => {
      renderLane()

      const shapes = screen.getAllByTestId('hit-fx-particle').map((particle) => ({
        width: Number.parseFloat(particle.style.width),
        height: Number.parseFloat(particle.style.height),
      }))
      expect(shapes.some((shape) => shape.width > shape.height)).toBe(true)
      // ...and its own centre stays on the hit point, whatever its length: the
      // negative margin is half its own width and half its own height, so a
      // long shard is not thrown sideways by being long. (A round ember's two
      // halves are equal, which the DOM collapses to a single value.)
      for (const particle of screen.getAllByTestId('hit-fx-particle')) {
        const [vertical, horizontal = vertical] = particle.style.margin.split(' ')
        expect(Number.parseFloat(vertical)).toBeCloseTo(-Number.parseFloat(particle.style.height) / 2, 5)
        expect(Number.parseFloat(horizontal)).toBeCloseTo(-Number.parseFloat(particle.style.width) / 2, 5)
      }
    })

    it('opens the burst with an impact flash sized for the hit and the lane', () => {
      renderLane({ laneHeightPx: 320 })
      record(hit({ tier: 'epic' }))
      const solo = Number.parseFloat(firingSlots()[0].style.getPropertyValue('--ae-hit-bloom'))
      expect(solo).toBeGreaterThan(0)
    })

    it('gives a missed note no flash at all -- a miss is information, not a reward', () => {
      renderLane()
      record(hit({ tier: 'awful' }))
      expect(firingSlots()[0].style.getPropertyValue('--ae-hit-bloom')).toBe('0px')
    })
  })

  it('tears a finished burst down instead of leaving it on the compositor', () => {
    renderLane()
    record(hit({ tier: 'epic' }))
    expect(firingSlots()).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(burstDurationMs('epic') + HIT_FX_LIFETIME_PADDING_MS + 1)
    })

    expect(firingSlots()).toHaveLength(0)
    // ...and the node itself is still there, ready to be reused.
    expect(screen.getAllByTestId('hit-fx-slot')).toHaveLength(BURST_POOL_SIZE)
  })

  it('recycles the pool under a burst of hits rather than growing the DOM', () => {
    renderLane()
    for (let i = 0; i < 12; i += 1) {
      record(hit({ noteId: `n${i}`, t: 1_000 + i * 10 }))
    }

    expect(screen.getAllByTestId('hit-fx-slot')).toHaveLength(BURST_POOL_SIZE)
    expect(screen.getAllByTestId('hit-fx-particle')).toHaveLength(BURST_POOL_SIZE * BURST_PARTICLE_CAPACITY)
    expect(firingSlots().length).toBeLessThanOrEqual(BURST_POOL_SIZE)
  })

  it('clears its timers when the song ends, so a teardown can never fire into a dead node', () => {
    const { unmount } = renderLane()
    record(hit())
    unmount()

    expect(() => act(() => vi.advanceTimersByTime(5_000))).not.toThrow()
  })

  describe('sound', () => {
    it('plays the tier\'s own feedback sound', () => {
      renderLane()
      record(hit({ tier: 'good' }))
      expect(play).toHaveBeenCalledWith('hitGood')
    })

    it('leaves the shared gate to decide, so eight lanes judging at once make one sound', () => {
      render(
        <>
          <LaneHitFx playerId="p1" color="#0ff" laneHeightPx={80} resolveNoteY={() => 10} />
          <LaneHitFx playerId="p2" color="#f0f" laneHeightPx={80} resolveNoteY={() => 10} />
        </>,
      )

      record(hit({ playerId: 'p1', t: 4_000 }))
      record(hit({ playerId: 'p2', t: 4_000 }))

      expect(play).toHaveBeenCalledTimes(1)
    })

    it('still shows both players their own burst when the sound is gated', () => {
      render(
        <>
          <LaneHitFx playerId="p1" color="#0ff" laneHeightPx={80} resolveNoteY={() => 10} />
          <LaneHitFx playerId="p2" color="#f0f" laneHeightPx={80} resolveNoteY={() => 10} />
        </>,
      )

      record(hit({ playerId: 'p1', t: 4_000 }))
      record(hit({ playerId: 'p2', t: 4_000 }))

      // Gating is a property of the room's one pair of speakers; it must never
      // reach the screen, where every player has their own lane.
      expect(firingSlots()).toHaveLength(2)
    })

    it('still sounds under reduced motion, because that is the whole feedback channel left', () => {
      mocks.reducedMotion = true
      renderLane()
      record(hit({ tier: 'epic' }))

      expect(play).toHaveBeenCalledWith('hitExcellent')
    })
  })

  describe('reduced motion', () => {
    beforeEach(() => {
      mocks.reducedMotion = true
    })

    it('still tells the player what they hit', () => {
      renderLane()
      record(hit({ tier: 'good' }))

      const slot = firingSlots()[0]
      expect(within(slot).getByTestId('hit-fx-word')).toHaveTextContent('Good')
      expect(slot).toHaveAttribute('data-static', 'true')
    })

    it('drops the particles entirely rather than slowing them down', () => {
      renderLane()
      record(hit({ tier: 'epic' }))

      const shown = within(firingSlots()[0])
        .getAllByTestId('hit-fx-particle')
        .filter((particle) => particle.style.display !== 'none')
      expect(shown).toHaveLength(0)
    })

    // The impact flash and the golden starburst are pseudo-elements of the slot
    // itself, so there is no child to hide -- they are sized to nothing here,
    // and the stylesheet removes them outright (`content: none`) on top of it.
    // Without both, the loudest part of a burst would be the one part someone
    // who asked for less motion still got.
    it('drops the impact flash too', () => {
      renderLane()
      record(hit({ tier: 'epic' }))
      expect(firingSlots()[0].style.getPropertyValue('--ae-hit-bloom')).toBe('0px')
    })

    it('holds the word longer, since there is no motion to read it by', () => {
      renderLane()
      record(hit({ tier: 'epic' }))

      act(() => {
        vi.advanceTimersByTime(burstDurationMs('epic') + HIT_FX_LIFETIME_PADDING_MS + 1)
      })
      expect(firingSlots()).toHaveLength(1)

      act(() => {
        vi.advanceTimersByTime(2_000)
      })
      expect(firingSlots()).toHaveLength(0)
    })
  })
})

/**
 * A golden note is the chart's own double-points note (`scoreNote`'s
 * goldenMultiplier). Clearing one is the rarest good thing that happens in a
 * song, and it used to be indistinguishable from any other Excellent -- same
 * word, same sound, same burst. The only signal was the score climbing faster,
 * which is invisible while it is already climbing.
 *
 * The burst layer is a sibling of the note lane and is handed nothing but a
 * note *id*, so the lane publishes the chart's kinds for it; see
 * effects/noteKindRegistry.ts for why that is a table rather than a store.
 */
describe('LaneHitFx golden notes', () => {
  function golden(noteId = 'n1', kind: NoteWithId['kind'] = 'golden'): NoteWithId {
    return { noteId, kind, startBeat: 0, length: 2, pitch: 60, syllable: 'la' }
  }

  beforeEach(() => {
    mocks.reducedMotion = false
    play = vi.fn<(name: SfxName) => void>()
    useSfx.setState({ play })
    useHitStore.getState().reset()
    useScoreStore.getState().reset({
      players: [{ playerId: 'p1', name: 'Alex', score: 0, combo: 0, rank: 1 }],
      combo: 0,
      rank: ['p1'],
    })
    hitSfxGate.reset()
    resetNoteKinds()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetNoteKinds()
  })

  it('says "Golden!" rather than naming the tier, because the tier is not the news', () => {
    registerNoteKinds([golden()])
    renderLane()
    record(hit({ tier: 'good', noteId: 'n1' }))

    const slot = firingSlots()[0]
    expect(within(slot).getByTestId('hit-fx-word')).toHaveTextContent('Golden!')
    expect(slot).toHaveAttribute('data-golden', 'true')
  })

  it("plays its own sound instead of the tier's -- one sound, never two", () => {
    registerNoteKinds([golden()])
    renderLane()
    record(hit({ tier: 'epic', noteId: 'n1' }))

    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith('hitGolden')
  })

  it('spends the whole particle capacity, which nothing else does', () => {
    registerNoteKinds([golden()])
    renderLane()
    record(hit({ tier: 'epic', noteId: 'n1' }))

    const shown = within(firingSlots()[0])
      .getAllByTestId('hit-fx-particle')
      .filter((particle) => particle.style.display !== 'none')
    expect(shown).toHaveLength(BURST_PARTICLE_CAPACITY)
    // ...which is why an Excellent has somewhere left to escalate *to*.
    expect(shown.length).toBeGreaterThan(burstParticleCountFor('epic'))
  })

  it("is made of gold rather than of the lane's own colour", () => {
    registerNoteKinds([golden()])
    renderLane({ color: 'oklch(0.78 0.19 320)' })
    record(hit({ tier: 'epic', noteId: 'n1' }))

    // The one moment where *what* was cleared outranks *whose* lane cleared it.
    expect(firingSlots()[0].style.getPropertyValue('--ae-hit-spark')).not.toContain('320')
  })

  it('holds long enough to cover its own, longer sound', () => {
    registerNoteKinds([golden()])
    renderLane()
    record(hit({ tier: 'epic', noteId: 'n1' }))

    act(() => {
      vi.advanceTimersByTime(burstDurationMs('epic') + HIT_FX_LIFETIME_PADDING_MS + 1)
    })
    expect(firingSlots()).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(burstDurationMs('epic', true))
    })
    expect(firingSlots()).toHaveLength(0)
  })

  // Celebrating a miss because of the note's kind would be a lie: a golden note
  // you did not land is still a miss.
  it('reads, sounds and sparks as a miss when the golden note was missed', () => {
    registerNoteKinds([golden()])
    renderLane()
    record(hit({ tier: 'awful', noteId: 'n1' }))

    const slot = firingSlots()[0]
    expect(slot).toHaveAttribute('data-golden', 'false')
    expect(within(slot).getByTestId('hit-fx-word')).toHaveTextContent('Bad')
    expect(play).toHaveBeenCalledWith('hitBad')
  })

  it('leaves an ordinary note in a golden chart completely unchanged', () => {
    registerNoteKinds([golden('n1'), golden('n0', 'normal')])
    renderLane()
    record(hit({ tier: 'epic', noteId: 'n0' }))

    expect(firingSlots()[0]).toHaveAttribute('data-golden', 'false')
    expect(within(firingSlots()[0]).getByTestId('hit-fx-word')).toHaveTextContent('Excellent')
    expect(play).toHaveBeenCalledWith('hitExcellent')
  })

  // An unregistered id means "no golden information available" -- a lane whose
  // chart never registered (a lab, a preview) must behave exactly as before.
  it('falls back to plain tier behaviour for a note it knows nothing about', () => {
    renderLane()
    record(hit({ tier: 'epic', noteId: 'n1' }))

    expect(within(firingSlots()[0]).getByTestId('hit-fx-word')).toHaveTextContent('Excellent')
    expect(play).toHaveBeenCalledWith('hitExcellent')
  })

  it('still names itself under reduced motion, where the word is the whole channel', () => {
    mocks.reducedMotion = true
    registerNoteKinds([golden()])
    renderLane()
    record(hit({ tier: 'epic', noteId: 'n1' }))

    const slot = firingSlots()[0]
    expect(within(slot).getByTestId('hit-fx-word')).toHaveTextContent('Golden!')
    expect(slot).toHaveAttribute('data-golden', 'true')
    expect(play).toHaveBeenCalledWith('hitGolden')
  })
})

/**
 * Scoring has no combo any more (party-karaoke-style), so the burst carries no run
 * count and the lane no combo "heat" -- a number that is always 0 must not be
 * drawn, and a glow keyed to it must not cost a node.
 */
describe('LaneHitFx without combo', () => {
  beforeEach(() => {
    mocks.reducedMotion = false
    play = vi.fn<(name: SfxName) => void>()
    useSfx.setState({ play })
    useHitStore.getState().reset()
    hitSfxGate.reset()
    resetNoteKinds()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the word alone, never a combo count, even if a stale store still carries one', () => {
    useScoreStore.getState().reset({
      players: [{ playerId: 'p1', name: 'Alex', score: 900, combo: 7, rank: 1 }],
      combo: 7,
      rank: ['p1'],
    })
    renderLane()
    record(hit())

    expect(within(firingSlots()[0]).queryByTestId('hit-fx-combo')).not.toBeInTheDocument()
    expect(firingSlots()[0]).not.toHaveTextContent('×')
  })

  it('draws no combo heat glow', () => {
    const { container } = renderLane()
    expect(container.querySelectorAll('[data-testid="hit-fx-heat"]')).toHaveLength(0)
  })

  it('bursts where the note ended on a paged lane, when told where that was', () => {
    renderLane({ resolveNoteX: (noteId: string) => (noteId === 'n9' ? 62.5 : null) })
    record(hit({ noteId: 'n9' }))
    expect(firingSlots()[0].style.left).toBe('62.5%')
  })
})
