/**
 * The geometry of the sustained golden starburst (see LaneSustainFx).
 *
 * Pure data, for the same reason hitFx.ts is: the component that draws it owns
 * no layout maths, so the shape of the burst can be asserted directly instead
 * of through inline styles.
 */

/**
 * Trailing sparks in the burst.
 *
 * Small on purpose. This layer is *always live* whenever anyone is singing on
 * pitch, which is most of a good song -- unlike a hit burst, which fires for
 * half a second per note. Six is enough to read as a spray at the tip of the
 * note; twelve, running continuously on eight lanes, would be the largest
 * source of animated nodes on the screen by a wide margin.
 */
export const SUSTAIN_SPARK_COUNT = 6

export interface SustainSpark {
  id: number
  /**
   * Where the spark ends up, relative to the intersection.
   *
   * Always negative in x: the burst **trails**, drifting back over the part of
   * the note that has already been sung, the way a spark leaves an ember. A
   * symmetric spray would read as an explosion at a fixed point; a trail reads
   * as motion along the note, which is what is actually happening.
   */
  dxPx: number
  dyPx: number
  sizePx: number
  /** Staggered so the trail is continuous rather than pulsing as one ring. */
  delayMs: number
}

/**
 * A small LCG (Numerical Recipes constants), matching hitFx.ts: seeded so the
 * geometry is stable across remounts and assertable in a test.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/**
 * The fixed trail a lane's sustain spark animates along.
 *
 * The vertical spread is deliberately a third of the horizontal: the sparks
 * have to stay inside the note pill they are coming off, and in a crowded field
 * a lane is under a hundred pixels tall -- debris landing in the neighbouring
 * lane would make it unreadable whose note was lit.
 */
export function createSustainSparks(count: number = SUSTAIN_SPARK_COUNT, seed = 20260903): SustainSpark[] {
  const random = makeRandom(seed)
  const sparks: SustainSpark[] = []

  for (let i = 0; i < count; i += 1) {
    sparks.push({
      id: i,
      dxPx: -Math.round(16 + random() * 22),
      dyPx: Math.round((random() - 0.5) * 14),
      sizePx: Math.round(2 + random() * 3),
      delayMs: Math.round((i / count) * 600),
    })
  }

  return sparks
}
