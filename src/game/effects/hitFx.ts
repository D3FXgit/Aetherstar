import type { HitTier } from '../../contracts/types'
import type { SfxName } from '../../audio/sfxContract'
import { t } from '../../i18n'

/**
 * The vocabulary and deterministic geometry of the hit feedback burst.
 *
 * Pure data on purpose: the component that draws it owns no layout maths, so
 * the shape of a burst can be asserted directly instead of through inline
 * styles (session/confetti.ts does the same for the results confetti).
 */

/**
 * Language keys for the word a singer reads per tier. `epic`/`awful` are engine
 * vocabulary; "Excellent" and "Bad" are what they mean to the person singing.
 */
export const HIT_LABEL_KEY: Record<HitTier, string> = {
  epic: 'sing.hit.excellent',
  good: 'sing.hit.good',
  awful: 'sing.hit.bad',
}

/** One placeholder .wav per tier, so the sound reinforces the word rather than repeating it. */
export const HIT_SFX: Record<HitTier, SfxName> = {
  epic: 'hitExcellent',
  good: 'hitGood',
  awful: 'hitBad',
}

/**
 * What a landed golden note says instead of its tier: the one moment the game
 * can say *why* the score jumped (golden notes count double). A missed golden
 * note still reads "Bad".
 */
export const GOLDEN_LABEL_KEY = 'sing.hit.golden'

/** The golden note's own one-shot (assets/sfx/README.md). Never layered on top of a tier sound -- it replaces it. */
export const GOLDEN_SFX: SfxName = 'hitGolden'

/** The word the player reads for this outcome. */
export function hitLabelFor(tier: HitTier, golden = false): string {
  return t(golden && tier !== 'awful' ? GOLDEN_LABEL_KEY : HIT_LABEL_KEY[tier])
}

/** The one-shot this outcome plays. One sound per hit, always -- see hitSfxGate. */
export function hitSfxFor(tier: HitTier, golden = false): SfxName {
  return golden && tier !== 'awful' ? GOLDEN_SFX : HIT_SFX[tier]
}

/**
 * Spans built into every pooled burst slot.
 *
 * Fixed rather than per-tier: a slot is laid out once at mount and reused for
 * the whole song, so a lower tier hides the surplus instead of mounting fewer
 * nodes. The DOM never changes shape while the song is running.
 */
export const BURST_PARTICLE_CAPACITY = 12

/**
 * Concurrent bursts a single lane can show.
 *
 * A burst lives ~0.6s, so three overlapping slots covers five notes a second
 * on one lane -- past anything a real chart asks for. The fourth hit inside
 * that window recycles the oldest slot rather than allocating: DOM node count
 * is `lanes x BURST_POOL_SIZE x BURST_PARTICLE_CAPACITY` for the entire song,
 * whether the singer lands ten notes or ten thousand.
 */
export const BURST_POOL_SIZE = 3

export interface BurstParticle {
  id: number
  /** Where the particle ends up, relative to the hit. Read by CSS as a custom property. */
  dxPx: number
  dyPx: number
  sizePx: number
  /** A small stagger, so the burst blooms rather than snapping outward as one ring. */
  delayMs: number
  /**
   * The direction of travel, in degrees.
   *
   * Derived from (dx, dy) rather than stored alongside them, so a spark can
   * never point somewhere it is not going. It is what turns a spray of dots
   * into a spray of *sparks*: the element is drawn as a capsule lying along
   * this angle with a tapering streak trailing behind it, which is the whole
   * difference between "some circles moved" and "something was struck".
   */
  angleDeg: number
  /**
   * How elongated the capsule is, as a multiple of `sizePx`.
   *
   * A burst of identical dots reads as a decal. A mix of round embers (1) and
   * long shards (up to ~3) reads as debris, which is the thing being imitated.
   */
  stretch: number
  /**
   * How far the spark sags below its ballistic end point.
   *
   * Real debris does not travel in a straight line and then stop; giving the
   * back half of the flight a downward bias is the cheapest possible arc --
   * one extra term in a keyframe that was already there -- and it is most of
   * what makes the burst read as physical. Always downward (positive), never
   * more than a few pixels, because lanes are stacked and a spark must not
   * fall into the neighbour's.
   */
  gravityPx: number
  /** Degrees the shard turns over its flight, so the debris tumbles instead of sliding. */
  spinDeg: number
}

/**
 * Particles actually shown for an outcome.
 *
 * Golden is the only thing that gets the slot's full capacity: it is the
 * rarest good outcome in a song, so it is the one worth the biggest burst, and
 * an Excellent that already spent every particle would leave nothing above it.
 */
export function burstParticleCountFor(tier: HitTier, golden = false): number {
  if (golden && tier !== 'awful') return BURST_PARTICLE_CAPACITY
  if (tier === 'epic') return 10
  if (tier === 'good') return 6
  // A missed note is information, not a reward. Confetti for it would read as
  // celebration, and at eight lanes of a hard song it would also be the
  // single largest source of particles on the screen.
  return 0
}

/**
 * The diameter of the impact bloom -- the white-hot flash the burst opens on,
 * before the ring and the sparks are out of it.
 *
 * It is drawn on the slot's own `::before`, so it costs no node; what it does
 * cost is *light*, and eight lanes firing at once is the case that has to stay
 * bearable. Hence both bounds: nothing at all for a miss, and everything scaled
 * by how much lane there is, exactly as the word's travel is -- an eight-player
 * stack gives each lane 64px, and a bloom sized for a solo lane would be a wall
 * of white across all eight.
 */
export function burstBloomPx(laneHeightPx: number, tier: HitTier, golden = false): number {
  if (tier === 'awful') return 0
  const base = golden ? 78 : tier === 'epic' ? 58 : 38
  return Math.round(base * Math.min(1, Math.max(0.45, laneHeightPx / 320)))
}

/**
 * How long a burst runs.
 *
 * HIG Motion: "Aim for brevity and precision in feedback animations ... a
 * succinct animation that's precisely tied to a successful action" lets people
 * get the message "without being distracted from their gameplay". Every value
 * here is under a beat at any singable tempo, so feedback for one note is
 * always gone before the next one is judged.
 */
export function burstDurationMs(tier: HitTier, golden = false): number {
  // The one deliberate exception to the brevity rule, and it is bounded by the
  // sound rather than by taste: `placeholder_hit_golden.wav` is 740ms, and a
  // flourish that ended while its own sound was still ringing would read as a
  // glitch. A golden note is rare enough that it cannot become the texture the
  // rule exists to prevent.
  if (golden && tier !== 'awful') return 740
  if (tier === 'epic') return 620
  if (tier === 'good') return 460
  return 380
}

/**
 * How hard the whole lane leans into a hit, as a function of the run it lands on.
 *
 * A combo is already on screen as a number, which is exactly the channel a
 * player mid-song cannot spare attention for. This turns it into something
 * peripheral: the burst grows and the lane picks up a glow, so a good run is
 * visible without being read.
 *
 * Three levels, not a continuum -- an effect that creeps up by 3% a note reads
 * as nothing at all, while a step you can name ("it changed") reads as
 * progress. A missed note is level 0 whatever the run *was*, because the run
 * is about to be zero (useScoreStore resets combo on `awful`, and the hit
 * store notifies before the score store applies it, so `combo` here is still
 * the pre-hit value).
 */
export function comboHeatLevel(combo: number, tier: HitTier): 0 | 1 | 2 {
  if (tier === 'awful') return 0
  if (combo >= 15) return 2
  if (combo >= 6) return 1
  return 0
}

/**
 * The furthest, in either vertical direction, any part of a burst may travel
 * from the note it fired on -- the arc's droop included.
 *
 * An eight-player stack gives each lane 64px. A spark that left its own lane
 * would make it unreadable whose note was hit, which is the one thing this
 * layer exists to say.
 */
export const MAX_PARTICLE_REACH_Y_PX = 26

/**
 * A small LCG (Numerical Recipes constants), as in session/confetti.ts: seeded so
 * the burst geometry is stable across remounts and assertable in a test.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/**
 * The fixed spray a pooled slot animates along.
 *
 * Angles are evenly spaced around the circle with a little jitter, so the
 * burst always looks radial however few particles a tier lights up, and never
 * clumps to one side. The vertical reach is deliberately half the horizontal:
 * lanes are stacked only a few pixels apart, and debris landing in the
 * neighbouring lane would make it unreadable whose note was hit.
 *
 * Every field beyond `dx/dy` exists to make the *same twelve nodes* read as
 * something far better than twelve dots: they become tumbling capsules of
 * mixed lengths, each with a tapering streak behind it (a pseudo-element, so
 * still no node), thrown along an arc rather than a straight line. That is the
 * whole shape of this rework -- nothing was added to the DOM, the geometry just
 * stopped being round and straight.
 */
export function createBurstParticles(count: number = BURST_PARTICLE_CAPACITY, seed = 20260902): BurstParticle[] {
  const random = makeRandom(seed)
  const particles: BurstParticle[] = []

  for (let i = 0; i < count; i += 1) {
    const angle = ((i + 0.5) / count) * Math.PI * 2 + (random() - 0.5) * 0.5
    // Spends the whole horizontal budget the lane allows (48px), so the spray
    // clears the word rather than sitting underneath it.
    const distance = 30 + random() * 18
    const dxPx = Math.round(Math.cos(angle) * distance)
    const dyPx = Math.round(Math.sin(angle) * distance * 0.55)

    particles.push({
      id: i,
      dxPx,
      dyPx,
      sizePx: Math.round(3 + random() * 4),
      delayMs: Math.round(random() * 55),
      // The *drawn* angle, from the rounded offsets the element actually
      // travels along -- not from the unrounded polar angle above, or a long
      // shard would visibly point a degree or two off its own path.
      angleDeg: Math.round((Math.atan2(dyPx, dxPx) * 180) / Math.PI),
      // Two thirds shards, one third embers: enough round ones that the burst
      // still has a centre of mass rather than reading as a starburst decal.
      stretch: i % 3 === 0 ? 1 : Number((1.8 + random() * 1.4).toFixed(2)),
      // Bounded by what is left of the lane's vertical budget, not by taste:
      // `dy` is already held to +/-26px so a burst cannot spill into the
      // neighbouring lane of an eight-player stack, and an arc that broke that
      // would undo the constraint rather than decorate within it.
      gravityPx: Math.max(0, Math.min(Math.round(3 + random() * 5), MAX_PARTICLE_REACH_Y_PX - Math.abs(dyPx))),
      spinDeg: Math.round((random() - 0.5) * 180),
    })
  }

  return particles
}
