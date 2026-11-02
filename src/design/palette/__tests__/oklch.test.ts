import { describe, it, expect } from 'vitest'
import { srgbToOklch, formatOklch } from '../oklch'

describe('srgbToOklch', () => {
  // Reference values from Björn Ottosson's OKLab definition (the same numbers
  // any oklch() colour picker reports for these sRGB primaries). Pinning them
  // means a typo in one of the 3x3 matrix constants fails loudly instead of
  // quietly shifting every extracted hue.
  it('converts sRGB white to L=1 with no chroma', () => {
    const white = srgbToOklch(255, 255, 255)
    expect(white.l).toBeCloseTo(1, 3)
    expect(white.c).toBeCloseTo(0, 3)
  })

  it('converts sRGB black to L=0 with no chroma', () => {
    const black = srgbToOklch(0, 0, 0)
    expect(black.l).toBeCloseTo(0, 3)
    expect(black.c).toBeCloseTo(0, 3)
  })

  it('converts pure red to its reference lightness, chroma and hue', () => {
    const red = srgbToOklch(255, 0, 0)
    expect(red.l).toBeCloseTo(0.628, 2)
    expect(red.c).toBeCloseTo(0.258, 2)
    expect(red.h).toBeCloseTo(29.23, 1)
  })

  it('converts pure blue to its reference lightness, chroma and hue', () => {
    const blue = srgbToOklch(0, 0, 255)
    expect(blue.l).toBeCloseTo(0.452, 2)
    expect(blue.c).toBeCloseTo(0.313, 2)
    expect(blue.h).toBeCloseTo(264.05, 1)
  })

  it('reports hue in [0, 360) rather than the raw signed atan2 range', () => {
    const green = srgbToOklch(0, 255, 0)
    expect(green.h).toBeGreaterThanOrEqual(0)
    expect(green.h).toBeLessThan(360)
    expect(green.h).toBeCloseTo(142.5, 0)
  })
})

describe('formatOklch', () => {
  it('renders a CSS oklch() string the design language already uses', () => {
    expect(formatOklch({ l: 0.42, c: 0.15, h: 320 })).toBe('oklch(0.42 0.15 320)')
  })

  it('renders the alpha form when one is given', () => {
    expect(formatOklch({ l: 0.8, c: 0.17, h: 195 }, 0.35)).toBe('oklch(0.8 0.17 195 / 0.35)')
  })

  it('rounds to a stable precision so the same colour always stringifies identically', () => {
    expect(formatOklch({ l: 0.6280431, c: 0.2576833, h: 29.2338 })).toBe('oklch(0.628 0.258 29.23)')
  })
})
