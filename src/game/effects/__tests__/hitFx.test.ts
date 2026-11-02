import { describe, expect, it } from 'vitest'
import type { HitTier } from '../../../contracts/types'
import {
  BURST_PARTICLE_CAPACITY,
  BURST_POOL_SIZE,
  GOLDEN_SFX,
  HIT_SFX,
  MAX_PARTICLE_REACH_Y_PX,
  burstBloomPx,
  burstDurationMs,
  burstParticleCountFor,
  comboHeatLevel,
  createBurstParticles,
  hitLabelFor,
  hitSfxFor,
} from '../hitFx'

const TIERS: HitTier[] = ['epic', 'good', 'awful']

describe('hit tier vocabulary', () => {
  // The words the player actually reads. The internal tier names ('epic',
  // 'awful') are engine vocabulary and were never meant to be shown to a
  // singer mid-song.
  it('maps every tier to the word the player is shown', () => {
    expect(hitLabelFor('epic')).toBe('Excellent')
    expect(hitLabelFor('good')).toBe('Good')
    expect(hitLabelFor('awful')).toBe('Bad')
  })

  it('maps every tier to its own feedback sound', () => {
    expect(HIT_SFX.epic).toBe('hitExcellent')
    expect(HIT_SFX.good).toBe('hitGood')
    expect(HIT_SFX.awful).toBe('hitBad')
    expect(new Set(Object.values(HIT_SFX)).size).toBe(TIERS.length)
  })
})

describe('createBurstParticles', () => {
  it('is deterministic, so a pooled slot can be laid out once and reused forever', () => {
    expect(createBurstParticles()).toEqual(createBurstParticles())
  })

  it('fills the pool slot to its fixed capacity regardless of tier', () => {
    // Every slot is built once at mount with the same number of spans; a
    // lower tier hides the surplus rather than mounting fewer nodes, so the
    // DOM never changes shape while the song is running.
    expect(createBurstParticles()).toHaveLength(BURST_PARTICLE_CAPACITY)
  })

  it('throws the particles outward in every direction rather than in one clump', () => {
    const particles = createBurstParticles()
    expect(particles.some((p) => p.dxPx > 0)).toBe(true)
    expect(particles.some((p) => p.dxPx < 0)).toBe(true)
    expect(particles.some((p) => p.dyPx < 0)).toBe(true)
    expect(particles.some((p) => p.dyPx > 0)).toBe(true)
  })

  it('keeps every particle inside the lane it belongs to', () => {
    // A burst is a *localized* event on one player's lane. Throwing debris
    // into the neighbouring lane would make it unreadable whose hit it was.
    for (const particle of createBurstParticles()) {
      expect(Math.abs(particle.dyPx)).toBeLessThanOrEqual(MAX_PARTICLE_REACH_Y_PX)
      expect(Math.abs(particle.dxPx)).toBeLessThanOrEqual(48)
      // Checked against a real browser over a cream-white video frame: at
      // 2px, mid-flight and part-faded, a spark is simply not there. The
      // floor is what survives the brightest backdrop the song can throw up.
      expect(particle.sizePx).toBeGreaterThanOrEqual(3)
      expect(particle.sizePx).toBeLessThanOrEqual(7)
      expect(particle.delayMs).toBeGreaterThanOrEqual(0)
      expect(particle.delayMs).toBeLessThanOrEqual(60)
    }
  })

  /**
   * What turns twelve dots into a burst worth looking at, without adding a
   * single node: each particle is drawn as a capsule lying along its own path,
   * with a tapering streak on its `::after`, thrown along an arc and tumbling
   * as it goes. Every one of these is geometry the CSS reads -- if any of it
   * stops being derived from the particle's actual travel, the burst goes back
   * to looking like a decal.
   */
  describe('the shape of a spark', () => {
    it('points every particle along the direction it actually travels', () => {
      for (const particle of createBurstParticles()) {
        const expected = (Math.atan2(particle.dyPx, particle.dxPx) * 180) / Math.PI
        // Within a degree of its own path -- a long shard aimed even slightly
        // off reads as broken rather than as fast.
        expect(Math.abs(particle.angleDeg - expected), `particle ${particle.id}`).toBeLessThanOrEqual(1)
      }
    })

    it('mixes long shards with round embers rather than throwing twelve identical dots', () => {
      const particles = createBurstParticles()
      expect(particles.some((p) => p.stretch === 1)).toBe(true)
      expect(particles.some((p) => p.stretch > 1.5)).toBe(true)
      // Nothing so long it stops reading as a spark.
      for (const p of particles) expect(p.stretch).toBeLessThanOrEqual(3.5)
    })

    it('gives every spark a downward sag, so the flight is an arc and not a line', () => {
      for (const particle of createBurstParticles()) {
        expect(particle.gravityPx).toBeGreaterThanOrEqual(0)
      }
      expect(createBurstParticles().some((p) => p.gravityPx > 0)).toBe(true)
    })

    /**
     * The arc has to live *inside* the vertical budget the burst already had.
     * An eight-player stack gives each lane 64px, so a spark that dropped out
     * of its own lane would undo the constraint the spray was designed around
     * rather than decorate within it.
     */
    it('never lets the arc carry a spark out of its own lane', () => {
      for (const particle of createBurstParticles()) {
        expect(Math.abs(particle.dyPx) + particle.gravityPx, `particle ${particle.id}`).toBeLessThanOrEqual(
          MAX_PARTICLE_REACH_Y_PX,
        )
      }
    })

    it('tumbles the debris both ways, rather than spinning it all one way', () => {
      const particles = createBurstParticles()
      expect(particles.some((p) => p.spinDeg > 0)).toBe(true)
      expect(particles.some((p) => p.spinDeg < 0)).toBe(true)
      for (const p of particles) expect(Math.abs(p.spinDeg)).toBeLessThanOrEqual(90)
    })

    it('is as deterministic as the rest of the geometry, so a slot is still laid out once', () => {
      expect(createBurstParticles()).toEqual(createBurstParticles())
    })
  })
})

/**
 * The impact bloom -- the white flash a hit opens on.
 *
 * It is the loudest thing in a burst and it costs no node (it is the slot's
 * own `::before`), so the only things worth pinning are the two that keep it
 * from being too much: nothing at all for a miss, and sized by how much lane
 * there is.
 */
describe('burstBloomPx', () => {
  it('gives a missed note no flash at all', () => {
    expect(burstBloomPx(320, 'awful')).toBe(0)
    expect(burstBloomPx(320, 'awful', true)).toBe(0)
  })

  it('escalates with the outcome, golden loudest', () => {
    expect(burstBloomPx(320, 'epic', true)).toBeGreaterThan(burstBloomPx(320, 'epic'))
    expect(burstBloomPx(320, 'epic')).toBeGreaterThan(burstBloomPx(320, 'good'))
  })

  /**
   * Eight lanes firing at once is the case that has to stay bearable. A bloom
   * sized for a solo lane, drawn eight times in a 64px-per-lane stack, is a
   * wall of white -- so it scales with the lane exactly as the word's travel
   * does.
   */
  it('shrinks with the lane, so an eight-player stack is not a strobe', () => {
    expect(burstBloomPx(64, 'epic')).toBeLessThan(burstBloomPx(320, 'epic'))
    expect(burstBloomPx(64, 'epic')).toBeGreaterThan(0)
  })

  it('never grows past a solo lane, however tall the lane is', () => {
    expect(burstBloomPx(1200, 'epic')).toBe(burstBloomPx(320, 'epic'))
  })
})

describe('burst intensity by tier', () => {
  it('spends the most particles on the rarest, best outcome', () => {
    expect(burstParticleCountFor('epic')).toBeGreaterThan(burstParticleCountFor('good'))
    expect(burstParticleCountFor('epic')).toBeLessThanOrEqual(BURST_PARTICLE_CAPACITY)
  })

  // A missed note is information, not a reward -- confetti for it would be
  // both confusing and, at 8 lanes of mostly-missed notes, the single biggest
  // source of particles on screen.
  it('spends no particles at all on a missed note', () => {
    expect(burstParticleCountFor('awful')).toBe(0)
  })

  it('keeps every burst brief and precise, per HIG feedback motion', () => {
    for (const tier of TIERS) {
      expect(burstDurationMs(tier)).toBeGreaterThan(0)
      expect(burstDurationMs(tier)).toBeLessThanOrEqual(720)
    }
    expect(burstDurationMs('epic')).toBeGreaterThan(burstDurationMs('awful'))
  })
})

describe('pool sizing', () => {
  // The pool is what bounds the DOM. Three concurrent bursts per lane covers
  // the fastest realistic note run (a burst lives ~0.6s; three overlapping
  // means five notes a second on one lane), and 8 lanes x 3 slots x capacity
  // is a fixed, known node count for the whole song.
  it('is small, fixed, and enough for the fastest note run', () => {
    expect(BURST_POOL_SIZE).toBeGreaterThanOrEqual(3)
    expect(BURST_POOL_SIZE).toBeLessThanOrEqual(4)
    expect(BURST_POOL_SIZE * BURST_PARTICLE_CAPACITY * 8).toBeLessThanOrEqual(320)
  })
})

describe('a golden note', () => {
  // A golden note is worth double (scoreNote's goldenMultiplier) and that is
  // completely invisible in a score that is climbing anyway. These are the
  // channels that say *why* the number jumped.
  it('says "Golden!" instead of naming the tier it was judged at', () => {
    expect(hitLabelFor('epic', true)).toBe('Golden!')
    expect(hitLabelFor('good', true)).toBe('Golden!')
  })

  // The one thing that must not happen: celebrating a note because of its
  // kind when the singer did not actually land it.
  it('still reads "Bad" and sounds like a miss when the golden note was missed', () => {
    expect(hitLabelFor('awful', true)).toBe('Bad')
    expect(hitSfxFor('awful', true)).toBe(HIT_SFX.awful)
    expect(burstParticleCountFor('awful', true)).toBe(0)
    expect(burstDurationMs('awful', true)).toBe(burstDurationMs('awful'))
  })

  it('plays its own sound instead of the tier\'s, never on top of it', () => {
    expect(hitSfxFor('epic', true)).toBe(GOLDEN_SFX)
    expect(GOLDEN_SFX).not.toBe(HIT_SFX.epic)
    // One sound per hit: the caller picks, it never layers two.
    expect(hitSfxFor('epic', false)).toBe(HIT_SFX.epic)
  })

  it('is the only outcome that spends the slot\'s whole particle capacity', () => {
    expect(burstParticleCountFor('epic', true)).toBe(BURST_PARTICLE_CAPACITY)
    // ...which means an Excellent has somewhere left to escalate *to*.
    expect(burstParticleCountFor('epic')).toBeLessThan(BURST_PARTICLE_CAPACITY)
  })

  it('runs long enough to cover its own 740ms sound, and no longer', () => {
    // The single exception to the brevity rule above, bounded by the asset
    // rather than by taste: a flourish that ended while its own sound was
    // still ringing would read as a glitch.
    expect(burstDurationMs('epic', true)).toBeGreaterThan(burstDurationMs('epic'))
    expect(burstDurationMs('epic', true)).toBeLessThanOrEqual(780)
  })

  it('leaves every non-golden outcome exactly as it was', () => {
    for (const tier of TIERS) {
      expect(burstParticleCountFor(tier, false)).toBe(burstParticleCountFor(tier))
      expect(burstDurationMs(tier, false)).toBe(burstDurationMs(tier))
      expect(hitLabelFor(tier, false)).toBe(hitLabelFor(tier))
    }
  })
})

describe('comboHeatLevel', () => {
  it('stays cold until a run is genuinely a run', () => {
    expect(comboHeatLevel(0, 'good')).toBe(0)
    expect(comboHeatLevel(5, 'good')).toBe(0)
  })

  // Steps, not a continuum: an effect that grows 3% a note reads as nothing,
  // while a change you can name reads as progress.
  it('steps up twice, at a run you can feel and a run you can brag about', () => {
    expect(comboHeatLevel(6, 'good')).toBe(1)
    expect(comboHeatLevel(14, 'epic')).toBe(1)
    expect(comboHeatLevel(15, 'epic')).toBe(2)
    expect(comboHeatLevel(200, 'epic')).toBe(2)
  })

  // useScoreStore resets combo on a miss, and the hit store notifies *before*
  // the score store applies the hit -- so the combo read here is still the
  // pre-hit one. Without this the lane would keep glowing for one more note
  // after the run it is celebrating had already ended.
  it('goes cold the instant a note is missed, whatever the run was', () => {
    expect(comboHeatLevel(40, 'awful')).toBe(0)
  })
})
