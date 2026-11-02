import type { HitTier } from '../../contracts/types'

/**
 * Rate limiter for the per-note feedback sounds.
 *
 * Hit sounds are not per-player: everyone in the room shares one pair of
 * speakers, so the question is never "did *my* hit make a sound" but "does the
 * room hear a clean one-shot". Three things make an ungated stream untenable:
 *
 *  1. A duet's shared line ends on the same beat for every singer, so up to
 *     eight lanes judge inside the same millisecond. Eight copies of the same
 *     wav starting in phase sum to roughly +18dB and read as a click, not as
 *     eight hits.
 *  2. sfxPlayer.ts allocates a fresh HTMLAudioElement per play (deliberately
 *     -- one-shots must overlap), so an ungated stream is also 40+ media
 *     elements a second for the GC while pitch detection is running.
 *  3. `hitGood` is 160ms and `hitBad` 200ms. Retriggering far inside those
 *     durations turns three distinct one-shots into one texture, which
 *     carries strictly less information than a single clean hit.
 *
 * So a *shared* gate, not one per lane, and one deliberate exception: an
 * Excellent may cut in early. A run of Goods flooding the gate must never be
 * what silences the rare hit the player was reaching for.
 */

/** Comfortably clear of `hitGood`'s 160ms body, so consecutive sounds stay countable. */
export const HIT_SFX_MIN_GAP_MS = 90

/** An Excellent's override window. Two of these close together read as emphasis, not mud. */
export const EPIC_MIN_GAP_MS = 45

/**
 * A golden note's override window -- the shortest in the gate, i.e. the top of
 * the priority order: golden > Excellent > everything else.
 *
 * The justification is that the gate models *one specific problem* -- eight
 * lanes judging the same beat summing into a click -- and 30ms still solves
 * that completely, because the eight copies of a simultaneous judgement land
 * inside the same millisecond, not 30 of them apart. What 30ms buys is that a
 * golden note can never be the sound that gets eaten. It is the rarest good
 * outcome a song contains, it is the only one the score doubles, and it is the
 * one the player was consciously reaching for; being silenced because someone
 * else's ordinary Good landed 40ms earlier would invert the whole point of
 * having a priority order at all.
 *
 * It is not zero, because golden notes come in *runs* in an UltraStar chart
 * (a whole golden phrase, one note per syllable). Consecutive syllables from
 * one singer are ~100ms apart at the very fastest, so 30ms never gates a real
 * run -- but it does keep a pathological chart, or a backlog flushed in one
 * frame, from stacking eight 740ms sounds on top of each other.
 */
export const GOLDEN_MIN_GAP_MS = 30

export interface HitSfxGate {
  /**
   * True when this hit should actually be played.
   *
   * `golden` is the note's *kind*, not its tier -- a golden note that was
   * missed is judged `awful` and has no claim on the priority order.
   */
  admit: (tier: HitTier, nowMs: number, golden?: boolean) => boolean
  /** Forgets the last play -- call between songs. */
  reset: () => void
}

export function createHitSfxGate(
  minGapMs: number = HIT_SFX_MIN_GAP_MS,
  epicMinGapMs: number = EPIC_MIN_GAP_MS,
  goldenMinGapMs: number = GOLDEN_MIN_GAP_MS,
): HitSfxGate {
  let lastAtMs: number | null = null

  return {
    admit: (tier, nowMs, golden = false) => {
      // A clock that ran backwards means a restart, a seek, or the next song:
      // never let a stale timestamp from the future mute the rest of the night.
      if (lastAtMs === null || nowMs < lastAtMs) {
        lastAtMs = nowMs
        return true
      }
      const elapsed = nowMs - lastAtMs
      const landedGolden = golden && tier !== 'awful'
      const gap = landedGolden ? goldenMinGapMs : tier === 'epic' ? epicMinGapMs : minGapMs
      if (elapsed < gap) return false
      lastAtMs = nowMs
      return true
    },
    reset: () => {
      lastAtMs = null
    },
  }
}

/**
 * The one gate every lane shares. Module-level because the constraint being
 * modelled is the room's speakers, which do not multiply with the players.
 */
export const hitSfxGate = createHitSfxGate()
