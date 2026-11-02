/**
 * Deterministic layout maths for the results confetti: no DOM here, so the
 * distribution is unit-tested and stable across remounts. The burst itself is
 * one-shot CSS keyframes (ResultsConfetti.tsx), costing no JavaScript per frame.
 */

/**
 * Particle cap. A hard cap, not a default: a burst whose cost grew with the
 * score or the player count would eventually be too expensive.
 */
export const CONFETTI_COUNT = 36

/** OKLCH hues, drawn from tokens.accent -- coral, gold, cyan, magenta. */
const CONFETTI_HUES = [25, 85, 195, 320]

export interface ConfettiPiece {
  id: number
  /** Horizontal start, as a percentage of the burst container. */
  xPercent: number
  /** Vertical start, as a percentage -- a narrow band around the crown, not a line. */
  yPercent: number
  widthPx: number
  heightPx: number
  hue: number
  /** Horizontal travel; signed, so the burst spreads both ways. */
  driftXPx: number
  /** Downward travel. Always positive: gravity wins, so nothing hangs in the air. */
  fallYPx: number
  /** Total rotation over the piece's life, in degrees. Signed. */
  spinDeg: number
  durationSec: number
  /** Always >= 0 -- a burst starts, it does not drop in mid-cycle the way an ambient field does. */
  delaySec: number
}

/** Numerical Recipes LCG (the same one game/effects/hitFx.ts uses) -- seeded so the burst is reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function createConfetti(count: number = CONFETTI_COUNT, seed = 20260902): ConfettiPiece[] {
  const random = makeRandom(seed)
  const pieces: ConfettiPiece[] = []

  for (let i = 0; i < count; i += 1) {
    // Spread across the full width rather than a point source: the crown lands
    // on one head, but the cheer belongs to the whole room, and a point source
    // reads as a single firework rather than a celebration.
    const xPercent = (i + random()) * (100 / count)

    pieces.push({
      id: i,
      xPercent,
      yPercent: random() * 18,
      widthPx: 5 + random() * 4,
      heightPx: 9 + random() * 6,
      // Cycled rather than random so all four accents are always present and
      // evenly spread, however few pieces are asked for.
      hue: CONFETTI_HUES[i % CONFETTI_HUES.length],
      // Signed drift, biased away from the centre so the burst opens outward
      // instead of raining straight down.
      driftXPx: (xPercent - 50) * 1.4 + (random() * 2 - 1) * 40,
      fallYPx: 320 + random() * 220,
      spinDeg: (random() * 2 - 1) * 540,
      durationSec: 1.5 + random() * 0.7,
      delaySec: random() * 0.22,
    })
  }

  return pieces
}
