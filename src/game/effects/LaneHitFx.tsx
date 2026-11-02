import { useCallback, useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import type { HitEvent, HitTier } from '../../contracts/types'
import { useSfx } from '../../audio/useSfx'
import { useHitStore } from '../state/useHitStore'
import { PLAYHEAD_OFFSET_PERCENT } from '../lane/LanePanel'
import { GOLDEN_COLOR, TIER_COLOR } from '../hud/tierColor'
import {
  BURST_PARTICLE_CAPACITY,
  BURST_POOL_SIZE,
  burstBloomPx,
  burstDurationMs,
  burstParticleCountFor,
  createBurstParticles,
  hitLabelFor,
  hitSfxFor,
} from './hitFx'
import { hitSfxGate } from './hitSfxGate'
import { isGoldenNote } from './noteKindRegistry'

/** The word outlives its burst by this much, so the last thing to fade is the thing you read. */
export const HIT_FX_LIFETIME_PADDING_MS = 140

/**
 * How long the word is held when the player has asked for reduced motion.
 *
 * With no motion there is nothing to catch the eye, so the word has to hold
 * still long enough to be *found* and read -- HIG Accessibility warns that
 * time-boxed elements are hard for people who need longer to process what
 * they see, and this is the one channel left once the burst is gone.
 */
export const REDUCED_MOTION_DWELL_MS = 1400

/** One shared geometry for every slot of every lane -- deterministic, so it is built exactly once per process. */
const BURST_PARTICLES = createBurstParticles()

/**
 * A pool slot's nodes, resolved once at mount.
 *
 * The whole point of the pool is that a hit is a handful of property writes;
 * re-finding the same four nodes with `querySelector` on every judged note, on
 * every lane, would have put the DOM query back into the hot path it was
 * removed from.
 */
interface SlotHandle {
  root: HTMLDivElement
  word: HTMLElement
  particles: HTMLElement[]
  /** How many particles are currently shown, so an unchanged count writes nothing. */
  visibleParticles: number
}

function createSlotHandle(root: HTMLDivElement): SlotHandle {
  return {
    root,
    word: root.querySelector<HTMLElement>('[data-testid="hit-fx-word"]')!,
    particles: Array.from(root.querySelectorAll<HTMLElement>('[data-testid="hit-fx-particle"]')),
    visibleParticles: 0,
  }
}

/** How far the word travels, per tier: a landed note gets the bigger gesture. */
function riseMagnitudeForTier(tier: HitTier, golden: boolean): number {
  if (golden && tier !== 'awful') return 38
  if (tier === 'epic') return 30
  if (tier === 'good') return 20
  return 14
}

/** Keeps the burst clear of the lane's clipped edges. */
const EDGE_MARGIN_PX = 12

/**
 * Which way the word travels, and how far.
 *
 * Landed notes lift and missed ones sink -- direction, not just colour,
 * carries the outcome (HIG: convey information with more than colour alone).
 * But the lane clips its own content, and an eight-player stack gives each
 * lane 64px, so a note near an edge would have its word cut in half. Near an
 * edge the gesture flips to point into the lane instead: the meaning survives
 * in the pairing (up/down still separates a hit from a miss everywhere except
 * within a few pixels of an edge), and the word stays readable, which matters
 * more. The travel also scales with the lane so eight lanes don't throw their
 * words into each other.
 */
function riseForHit(tier: HitTier, noteY: number, laneHeightPx: number, golden: boolean): number {
  const magnitude = Math.round(riseMagnitudeForTier(tier, golden) * Math.min(1, Math.max(0.45, laneHeightPx / 320)))
  const preferUp = tier !== 'awful'
  const nearTop = noteY < laneHeightPx * 0.42
  const nearBottom = noteY > laneHeightPx * 0.58
  const up = preferUp ? !nearTop : nearBottom
  return up ? -magnitude : magnitude
}

/**
 * Popup type size for a lane of this height.
 *
 * Capped well below the lyric text on purpose. HIG Typography: "in a game,
 * people are often more interested in a character's dialog than in transient
 * hit-damage values" -- the words being sung must stay the biggest thing on
 * the screen, and a hit popup that competes with them is a bug, not polish.
 * The floor is the platform's default desktop body size, so the word stays
 * readable from a sofa even in an eight-lane stack.
 */
function popupFontPx(laneHeightPx: number): number {
  return Math.max(13, Math.min(28, Math.round(laneHeightPx * 0.115)))
}

interface LaneHitFxProps {
  /** Only this player's hits fire this layer. */
  playerId: string
  /** The lane's mic-slot colour -- what the sparks are made of, so a burst says *whose* lane lit up. */
  color: string
  laneHeightPx: number
  /** Lane-local Y for a judged note, so the burst lands on the note that was cleared. Null when the note is no longer known. */
  resolveNoteY: (noteId: string) => number | null
  /**
   * Where across the lane (percent of its width) a judged note *ended*, on a
   * paged lane -- the playhead moves there, so the burst has to follow it.
   * Omitted (or null for a note), the burst sits on the scrolling lane's fixed
   * playhead.
   */
  resolveNoteX?: (noteId: string) => number | null
}

/**
 * The payoff: a localized spark burst and a tier word, fired on the note that
 * was just cleared, on this player's lane only.
 *
 * Three deliberate performance properties, because up to eight of these are
 * live at once on the frame-critical screen:
 *
 *  1. **No React render per hit.** The layer subscribes to `useHitStore`
 *     imperatively and writes to its own pooled DOM nodes. A landing hit costs
 *     a handful of attribute writes -- not a render, and certainly not a
 *     render of the note lane, which must stay off React's render path
 *     entirely.
 *  2. **No JavaScript per frame.** Every animation is a CSS keyframe on
 *     `transform`/`opacity` only (the same choice, for the same reasons, as
 *     ResultsConfetti). A framer-motion spring per particle
 *     would be ~30 JS-driven animations per lane per hit on the same thread as
 *     pitch detection; the compositor does this for free. The overshoot curves
 *     below are `tokens.spring.tvOS` expressed as a bezier, so the feel
 *     matches the rest of the app without the runtime cost.
 *  3. **A fixed DOM.** The pool is allocated at mount and reused forever. A
 *     song with ten thousand notes ends with exactly the node count it
 *     started with, and a finished burst is genuinely torn down --
 *     `display: none`, animations removed, no compositor layer retained.
 *
 * Retriggering is done by flipping a `data-phase` attribute between two
 * identical keyframe sets rather than the usual `animation: none` + forced
 * reflow, precisely because the reflow would be a synchronous layout on every
 * hit, on every lane -- the one cost this screen cannot pay.
 */
export function LaneHitFx({ playerId, color, laneHeightPx, resolveNoteY, resolveNoteX }: LaneHitFxProps) {
  const reduceMotion = useReducedMotion() ?? false
  const play = useSfx((state) => state.play)

  const slotsRef = useRef<(SlotHandle | null)[]>([])
  const timersRef = useRef<(ReturnType<typeof setTimeout> | null)[]>([])
  const cursorRef = useRef(0)

  // Everything the imperative handler needs, kept current without making the
  // handler itself a new function (which would re-subscribe the store).
  const latestRef = useRef({ playerId, color, laneHeightPx, resolveNoteY, resolveNoteX, reduceMotion, play })
  useEffect(() => {
    latestRef.current = { playerId, color, laneHeightPx, resolveNoteY, resolveNoteX, reduceMotion, play }
  })

  const fire = useCallback((event: HitEvent) => {
    const {
      color: sparkColor,
      laneHeightPx: laneHeight,
      resolveNoteY: resolveY,
      resolveNoteX: resolveX,
      reduceMotion: reduced,
      play: playSfx,
    } =
      latestRef.current

    const slotIndex = cursorRef.current % BURST_POOL_SIZE
    cursorRef.current += 1
    const handle = slotsRef.current[slotIndex]
    if (!handle) return
    const slot = handle.root

    const noteY = resolveY(event.noteId) ?? laneHeight / 2
    const y = Math.min(Math.max(noteY, EDGE_MARGIN_PX), Math.max(EDGE_MARGIN_PX, laneHeight - EDGE_MARGIN_PX))
    const noteX = resolveX?.(event.noteId) ?? null
    // The chart, not the judgement, says whether this was a double-points note
    // (see noteKindRegistry) -- and a golden note that was *missed* gets none
    // of the celebration, because it is still a miss.
    const golden = isGoldenNote(event.noteId) && event.tier !== 'awful'
    const particleCount = reduced ? 0 : burstParticleCountFor(event.tier, golden)

    slot.style.top = `${y}px`
    // A paged lane bursts where the note ended; the scrolling lane's slots
    // already sit on its fixed playhead.
    if (noteX !== null) slot.style.left = `${Math.min(100, Math.max(0, noteX))}%`
    slot.dataset.tier = event.tier
    slot.dataset.golden = golden ? 'true' : 'false'
    slot.dataset.static = reduced ? 'true' : 'false'
    slot.style.setProperty('--ae-hit-color', golden ? GOLDEN_COLOR : TIER_COLOR[event.tier])
    // A golden burst is made of gold rather than of the lane's colour: it is
    // the one moment where *what* was cleared outranks *whose* lane cleared it.
    slot.style.setProperty('--ae-hit-spark', golden ? GOLDEN_COLOR : sparkColor)
    slot.style.setProperty('--ae-hit-rise', `${riseForHit(event.tier, y, laneHeight, golden)}px`)
    slot.style.setProperty('--ae-hit-duration', `${burstDurationMs(event.tier, golden)}ms`)
    // The impact flash, sized for this lane and this outcome. Zero for a miss,
    // which is what switches the bloom off entirely -- a scale-to-zero element
    // paints nothing.
    slot.style.setProperty('--ae-hit-bloom', `${reduced ? 0 : burstBloomPx(laneHeight, event.tier, golden)}px`)

    // The word only. Scoring has no combo any more (party-karaoke-style), so there
    // is no run count to show and no combo "heat" to glow with.
    handle.word.textContent = hitLabelFor(event.tier, golden)

    // Only rewritten when the count actually changes: consecutive hits of the
    // same tier -- overwhelmingly the common case in a run -- touch no
    // particle styles at all.
    if (handle.visibleParticles !== particleCount) {
      const from = Math.min(handle.visibleParticles, particleCount)
      const to = Math.max(handle.visibleParticles, particleCount)
      for (let index = from; index < to; index += 1) {
        handle.particles[index].style.display = index < particleCount ? 'block' : 'none'
      }
      handle.visibleParticles = particleCount
    }

    // Two identical keyframe sets, alternated: a restart with no forced layout.
    slot.dataset.phase = slot.dataset.phase === 'a' ? 'b' : 'a'
    slot.dataset.firing = 'true'

    const existing = timersRef.current[slotIndex]
    if (existing) clearTimeout(existing)
    timersRef.current[slotIndex] = setTimeout(
      () => {
        slot.dataset.firing = 'false'
      },
      reduced ? REDUCED_MOTION_DWELL_MS : burstDurationMs(event.tier, golden) + HIT_FX_LIFETIME_PADDING_MS,
    )

    // The gate is shared by every lane: the room has one pair of speakers, so
    // eight simultaneous judgements have to become one clean sound. See
    // hitSfxGate.ts. Never allowed to suppress the *visual* -- that is
    // per-player and has already happened above. A golden note sits at the top
    // of the gate's priority order and plays its own sound *instead of* the
    // tier's, never on top of it.
    if (hitSfxGate.admit(event.tier, event.t, golden)) playSfx(hitSfxFor(event.tier, golden))
  }, [])

  useEffect(() => {
    const timers = timersRef.current
    hitSfxGate.reset()
    // Subscribed imperatively rather than with the useHitStore hook: a hook
    // would re-render this component (and re-run its children's reconciliation)
    // on every judged note, for every lane, several times a second.
    const unsubscribe = useHitStore.subscribe((state, previous) => {
      const event = state.latest
      if (!event || event === previous.latest) return
      if (event.playerId !== latestRef.current.playerId) return
      fire(event)
    })

    return () => {
      unsubscribe()
      timers.forEach((timer) => timer && clearTimeout(timer))
    }
  }, [fire])

  return (
    <div
      data-testid="lane-hit-fx"
      aria-hidden="true"
      className="ae-hit-layer pointer-events-none absolute inset-0"
      style={{
        ['--ae-hit-font' as string]: `${popupFontPx(laneHeightPx)}px`,
      }}
    >
      {Array.from({ length: BURST_POOL_SIZE }, (_, slotIndex) => (
        <div
          key={slotIndex}
          data-testid="hit-fx-slot"
          data-firing="false"
          data-phase="a"
          data-golden="false"
          data-static="false"
          ref={(element) => {
            // Queried exactly once, at mount. A hit then costs attribute
            // writes only -- no selector lookups, no NodeList allocation.
            slotsRef.current[slotIndex] = element ? createSlotHandle(element) : null
          }}
          className="ae-hit-slot absolute"
          style={{ left: `${PLAYHEAD_OFFSET_PERCENT}%`, top: 0 }}
        >
          <span aria-hidden className="ae-hit-ring" />
          {BURST_PARTICLES.map((particle) => (
            <span
              key={particle.id}
              data-testid="hit-fx-particle"
              className="ae-hit-particle"
              style={{
                display: 'none',
                // A capsule lying along its own direction of travel, not a
                // dot: the length is geometry (written once, at mount), and
                // the rotation that aims it is part of the keyframe's single
                // transform, so a shard costs exactly what a dot did.
                width: `${particle.sizePx * particle.stretch}px`,
                height: `${particle.sizePx}px`,
                margin: `${-particle.sizePx / 2}px ${(-particle.sizePx * particle.stretch) / 2}px`,
                animationDelay: `${particle.delayMs}ms`,
                ['--ae-hit-dx' as string]: `${particle.dxPx}px`,
                ['--ae-hit-dy' as string]: `${particle.dyPx}px`,
                ['--ae-hit-angle' as string]: `${particle.angleDeg}deg`,
                ['--ae-hit-spin' as string]: `${particle.spinDeg}deg`,
                ['--ae-hit-gravity' as string]: `${particle.gravityPx}px`,
              }}
            />
          ))}
          <span className="ae-hit-anchor">
            <span className="ae-hit-word-group">
              {/* White core with a tier-coloured glow, not tier-coloured text:
                  the word already names the tier, so colour is free to stay
                  legible over an arbitrary video frame instead of carrying
                  meaning on its own (HIG: convey information with more than
                  colour alone). */}
              <span data-testid="hit-fx-word" className="ae-hit-word" />
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}

export { BURST_POOL_SIZE, BURST_PARTICLE_CAPACITY }
