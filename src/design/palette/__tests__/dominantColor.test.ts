import { describe, it, expect } from 'vitest'
import {
  dominantColorFromPixels,
  ambientPaletteFrom,
  DEFAULT_AMBIENT_PALETTE,
  MIN_LIGHTNESS,
  MAX_LIGHTNESS,
  MIN_CHROMA,
  PRIMARY_LIGHTNESS_RANGE,
  PRIMARY_CHROMA_RANGE,
  SECONDARY_HUE_OFFSET,
} from '../dominantColor'

/** Builds an RGBA pixel buffer from `[r, g, b, count]` runs, the shape getImageData hands back. */
function pixels(...runs: [number, number, number, number, number?][]): Uint8ClampedArray {
  const total = runs.reduce((sum, [, , , count]) => sum + count, 0)
  const data = new Uint8ClampedArray(total * 4)
  let i = 0
  for (const [r, g, b, count, alpha = 255] of runs) {
    for (let n = 0; n < count; n++) {
      data[i++] = r
      data[i++] = g
      data[i++] = b
      data[i++] = alpha
    }
  }
  return data
}

describe('dominantColorFromPixels', () => {
  it('returns the most frequent usable colour', () => {
    const color = dominantColorFromPixels(pixels([200, 30, 30, 40], [30, 30, 200, 10]))
    expect(color).not.toBeNull()
    expect(color!.h).toBeLessThan(90) // red (~29), not blue (~264)
  })

  it('quantises near-identical shades into one bucket so a gradient beats a rarer exact repeat', () => {
    // Four *different* reds that all quantise to the same 4-bit bucket, versus
    // three pixels of one exact blue. Without quantisation the blue wins with a
    // count of 3 against four buckets of 1 -- this is the regression that makes
    // photographic (never pixel-identical) album art usable at all.
    const color = dominantColorFromPixels(
      pixels([196, 28, 26, 1], [199, 31, 29, 1], [202, 26, 31, 1], [205, 29, 27, 1], [30, 30, 200, 3]),
    )
    expect(color).not.toBeNull()
    expect(color!.h).toBeLessThan(90) // red family
  })

  it('rejects an all-but-black image rather than returning muddy near-black', () => {
    expect(dominantColorFromPixels(pixels([10, 10, 12, 64]))).toBeNull()
  })

  it('rejects a greyscale image, whose hue is meaningless as a gradient', () => {
    expect(dominantColorFromPixels(pixels([128, 128, 128, 64]))).toBeNull()
  })

  it('rejects a near-white image, which would wash the frame out', () => {
    expect(dominantColorFromPixels(pixels([255, 250, 200, 64]))).toBeNull()
  })

  it('skips the dark background and returns the vivid accent, the real album-art case', () => {
    // 60 near-black pixels (a dark sleeve) against 20 magenta ones: "most
    // frequent pixel" would return the near-black.
    const color = dominantColorFromPixels(pixels([8, 8, 10, 60], [214, 32, 178, 20]))
    expect(color).not.toBeNull()
    expect(color!.c).toBeGreaterThanOrEqual(MIN_CHROMA)
    expect(color!.l).toBeGreaterThanOrEqual(MIN_LIGHTNESS)
    expect(color!.l).toBeLessThanOrEqual(MAX_LIGHTNESS)
    expect(color!.h).toBeGreaterThan(300)
    expect(color!.h).toBeLessThan(360)
  })

  it('ignores fully transparent pixels', () => {
    const color = dominantColorFromPixels(pixels([30, 30, 200, 100, 0], [200, 30, 30, 10]))
    expect(color).not.toBeNull()
    expect(color!.h).toBeLessThan(90) // the opaque red, not the transparent blue
  })

  it('returns null for an empty buffer', () => {
    expect(dominantColorFromPixels(new Uint8ClampedArray(0))).toBeNull()
  })
})

describe('ambientPaletteFrom', () => {
  it('keeps the extracted hue', () => {
    const palette = ambientPaletteFrom({ l: 0.5, c: 0.12, h: 265 })
    expect(palette.primary.h).toBeCloseTo(265, 5)
  })

  it('pulls an over-bright colour down into the contrast-safe primary band', () => {
    const palette = ambientPaletteFrom({ l: 0.9, c: 0.4, h: 85 })
    expect(palette.primary.l).toBeLessThanOrEqual(PRIMARY_LIGHTNESS_RANGE[1])
    expect(palette.primary.c).toBeLessThanOrEqual(PRIMARY_CHROMA_RANGE[1])
  })

  it('lifts a dim, barely-saturated colour up into the band so the morph is visible', () => {
    const palette = ambientPaletteFrom({ l: 0.26, c: 0.05, h: 200 })
    expect(palette.primary.l).toBeGreaterThanOrEqual(PRIMARY_LIGHTNESS_RANGE[0])
    expect(palette.primary.c).toBeGreaterThanOrEqual(PRIMARY_CHROMA_RANGE[0])
  })

  it('offsets the secondary light in hue so the frame keeps its two-light structure', () => {
    const palette = ambientPaletteFrom({ l: 0.5, c: 0.12, h: 300 })
    expect(palette.secondary.h).toBeCloseTo((300 + SECONDARY_HUE_OFFSET) % 360, 5)
    expect(palette.secondary.l).toBeGreaterThan(palette.primary.l)
  })
})

describe('DEFAULT_AMBIENT_PALETTE', () => {
  it('is the magenta/cyan pair the transition already used, so "no cover" is not a visual regression', () => {
    expect(DEFAULT_AMBIENT_PALETTE.primary).toEqual({ l: 0.42, c: 0.15, h: 320 })
    expect(DEFAULT_AMBIENT_PALETTE.secondary).toEqual({ l: 0.8, c: 0.17, h: 195 })
  })
})
