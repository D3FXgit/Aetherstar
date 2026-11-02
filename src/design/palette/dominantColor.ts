/**
 * Pure dominant-colour extraction: RGBA pixels in, one OKLCh accent out.
 *
 * Deliberately knows nothing about images, canvases or the DOM -- all of that
 * lives in `imagePixelSampler.ts` behind an injectable seam, because jsdom
 * implements neither `createImageBitmap` nor `HTMLCanvasElement#getContext`.
 * The maths below is the part worth testing, and it is testable over a plain
 * `Uint8ClampedArray` with no environment stubs at all.
 */
import { srgbToOklch, type Oklch } from './oklch'

/**
 * Bits kept per channel when bucketing. 4 bits = 16 levels/channel = 4096
 * buckets.
 *
 * Quantisation is the whole reason this works on real artwork. A naive
 * "most frequent exact pixel" histogram over a photograph finds nothing: no
 * two pixels of a JPEG-compressed sleeve are bit-identical, so every bucket
 * has a count of ~1 and the winner is noise. 4 bits collapses a ±8-per-channel
 * neighbourhood into one bucket, which is coarse enough to make a shaded
 * region of artwork accumulate into a single tall bucket, and fine enough that
 * two genuinely different accents (say a red and an orange) stay apart.
 */
export const QUANTISE_BITS = 4
const CHANNEL_SHIFT = 8 - QUANTISE_BITS
const LEVELS = 1 << QUANTISE_BITS

/**
 * Reject thresholds, all in OKLab lightness / OKLCh chroma.
 *
 * `MIN_LIGHTNESS` (0.25): below roughly this lightness sRGB has so few code
 * points left that the a/b axes are dominated by 8-bit rounding -- the hue you
 * read off a near-black pixel is quantisation noise, not the artwork. It is
 * also where the single most common bucket on real album art lives (black
 * sleeves, letterboxed scans, drop shadows), which is exactly the muddy
 * near-black a naive histogram returns. Set low enough that a genuinely deep
 * saturated colour still passes: a deep blood red (#780a0a) sits at L 0.37.
 *
 * `MAX_LIGHTNESS` (0.92): the mirror argument at the other end. A bucket this
 * bright is a white border or a blown-out highlight, its hue is barely
 * perceptible, and using it as a gradient light washes the frame out and
 * destroys the contrast of the white text sitting on it.
 *
 * `MIN_CHROMA` (0.04): below this the colour is a neutral grey. A black-and-
 * white cover has no accent to offer, and tinting the ambient gradient by a
 * grey produces something visually indistinguishable from the default -- so
 * rather than animate a no-op morph, we keep the default gradient.
 */
export const MIN_LIGHTNESS = 0.25
export const MAX_LIGHTNESS = 0.92
export const MIN_CHROMA = 0.04

/** Pixels below this alpha are treated as absent (transparent PNG sleeves). */
const MIN_ALPHA = 128

interface Bucket {
  r: number
  g: number
  b: number
  count: number
}

/**
 * The dominant *usable* colour of an RGBA buffer, or null if the image offers
 * none (all-black, all-grey, all-white, empty).
 *
 * Note the order: buckets are filtered by the thresholds *first*, then the
 * most populous survivor wins. Filtering after picking would return null for
 * the extremely common "dark sleeve with one vivid accent" cover, where the
 * accent is the only interesting thing in the frame but is nowhere near the
 * most frequent colour.
 */
export function dominantColorFromPixels(pixels: ArrayLike<number>): Oklch | null {
  const buckets = new Map<number, Bucket>()

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const a = pixels[i + 3]
    if (a < MIN_ALPHA) continue

    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    const key = ((r >> CHANNEL_SHIFT) * LEVELS + (g >> CHANNEL_SHIFT)) * LEVELS + (b >> CHANNEL_SHIFT)

    const bucket = buckets.get(key)
    if (bucket) {
      bucket.r += r
      bucket.g += g
      bucket.b += b
      bucket.count++
    } else {
      buckets.set(key, { r, g, b, count: 1 })
    }
  }

  let best: Oklch | null = null
  let bestCount = 0

  for (const bucket of buckets.values()) {
    // The bucket's mean, not its quantised corner: averaging inside the bucket
    // recovers most of the precision the 4-bit key threw away.
    const color = srgbToOklch(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count)
    if (color.l < MIN_LIGHTNESS || color.l > MAX_LIGHTNESS || color.c < MIN_CHROMA) continue

    // Ties break on chroma so the result is deterministic (Map iteration order
    // otherwise decides it) and biased toward the more vivid of two equals.
    if (bucket.count > bestCount || (bucket.count === bestCount && best !== null && color.c > best.c)) {
      best = color
      bestCount = bucket.count
    }
  }

  return best
}

export interface AmbientPalette {
  /** The near light: the big radial rushing at the viewer. */
  primary: Oklch
  /** The far light: smaller, lighter, hue-offset, drawn over the primary at low alpha. */
  secondary: Oklch
}

/**
 * Bands the two ambient lights are normalised into.
 *
 * The primary's lightness ceiling (0.55) is a contrast budget, not taste: the
 * primary radial reaches ~90% opacity at the centre of the frame, so at its
 * brightest it is very nearly the flat colour behind the white title. White on
 * `oklch(0.55 ...)` is about 4.9:1, clearing the 4.5:1 minimum for body text;
 * one step brighter and the title starts failing on light-covered albums.
 * The floor (0.36) is the point below which the morph stops being visible
 * against the near-black base.
 */
export const PRIMARY_LIGHTNESS_RANGE: readonly [number, number] = [0.36, 0.55]
export const PRIMARY_CHROMA_RANGE: readonly [number, number] = [0.09, 0.18]
export const SECONDARY_LIGHTNESS_RANGE: readonly [number, number] = [0.7, 0.84]
export const SECONDARY_CHROMA_RANGE: readonly [number, number] = [0.1, 0.19]

/**
 * Hue offset of the far light from the near one. Wide enough to keep the
 * frame's two-light structure legible (the hand-picked default pair,
 * magenta 320 / cyan 195, is 125 degrees apart), but off the exact 180-degree
 * complement, which reads as a colour clash rather than as a lit space.
 */
export const SECONDARY_HUE_OFFSET = 150

/** Lightness the far light sits above the near one, before clamping. */
const SECONDARY_LIGHTNESS_LIFT = 0.34

function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * The ambient gradient the transition already ships: magenta near light, cyan
 * far light. Used verbatim whenever there is no cover, no readable cover, or
 * no usable colour in it, so every fallback lands on today's exact look rather
 * than on something merely similar.
 */
export const DEFAULT_AMBIENT_PALETTE: AmbientPalette = {
  primary: { l: 0.42, c: 0.15, h: 320 },
  secondary: { l: 0.8, c: 0.17, h: 195 },
}

/**
 * Turns one extracted accent into the two-light ambient palette.
 *
 * Only the *hue* survives from the cover. Lightness and chroma are pinned into
 * the bands above, which is what makes an arbitrary album safe to point at the
 * screen: whatever the artwork does, the frame keeps a predictable brightness
 * and the text on it keeps a predictable contrast ratio.
 */
export function ambientPaletteFrom(color: Oklch): AmbientPalette {
  const primary = {
    l: clamp(color.l, PRIMARY_LIGHTNESS_RANGE),
    c: clamp(color.c, PRIMARY_CHROMA_RANGE),
    h: color.h,
  }
  return {
    primary,
    secondary: {
      l: clamp(primary.l + SECONDARY_LIGHTNESS_LIFT, SECONDARY_LIGHTNESS_RANGE),
      c: clamp(color.c, SECONDARY_CHROMA_RANGE),
      h: (color.h + SECONDARY_HUE_OFFSET) % 360,
    },
  }
}
