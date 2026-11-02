/**
 * sRGB -> OKLCh, the colour space the rest of the design language is written
 * in (`tokens.ts`'s accents are all `oklch(...)`).
 *
 * OKLab is used rather than HSL because the thresholds in `dominantColor.ts`
 * are perceptual judgements ("too dark to read a hue from", "too grey to be
 * worth morphing to"). HSL's `L` and `S` are geometric, not perceptual --
 * `hsl(60 100% 50%)` (yellow) and `hsl(240 100% 50%)` (blue) claim identical
 * lightness while differing by a factor of ~14 in luminance -- so any fixed
 * cutoff over HSL rejects the wrong colours. OKLab's L tracks perceived
 * lightness closely enough that one number works across all hues.
 */

export interface Oklch {
  /** Perceptual lightness, 0 (black) to 1 (white). */
  l: number
  /** Chroma (colourfulness). ~0 is grey; sRGB tops out around 0.32. */
  c: number
  /** Hue angle in degrees, [0, 360). */
  h: number
}

/** Inverse of the sRGB transfer function: gamma-encoded 0..1 channel -> linear-light. */
function srgbChannelToLinear(channel: number): number {
  const v = channel / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** Björn Ottosson's OKLab conversion (linear sRGB -> LMS -> cube root -> Lab), then Lab -> LCh. */
export function srgbToOklch(r: number, g: number, b: number): Oklch {
  const lr = srgbChannelToLinear(r)
  const lg = srgbChannelToLinear(g)
  const lb = srgbChannelToLinear(b)

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.629978709 * lb)

  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  const chroma = Math.hypot(okA, okB)
  // atan2 returns (-180, 180]; the whole codebase writes hues as 0..360.
  const hue = (Math.atan2(okB, okA) * 180) / Math.PI
  return { l: okL, c: chroma, h: (hue + 360) % 360 }
}

/** Fixed precision so the same colour always produces byte-identical CSS (and stable test assertions). */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Renders an OKLCh colour as the `oklch(L C H)` / `oklch(L C H / A)` CSS the design tokens use. */
export function formatOklch(color: Oklch, alpha?: number): string {
  const base = `${round(color.l, 3)} ${round(color.c, 3)} ${round(color.h, 2)}`
  return alpha === undefined ? `oklch(${base})` : `oklch(${base} / ${round(alpha, 3)})`
}
