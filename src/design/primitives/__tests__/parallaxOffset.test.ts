import { describe, expect, it } from 'vitest'
import {
  PARALLAX_PLANE_PX,
  clampBias,
  planeShift,
  pointerBias,
  spanBias,
} from '../parallaxOffset'

describe('clampBias', () => {
  it('passes through values already inside -1..1', () => {
    expect(clampBias(0)).toBe(0)
    expect(clampBias(0.42)).toBeCloseTo(0.42)
    expect(clampBias(-0.42)).toBeCloseTo(-0.42)
  })

  it('clamps out-of-range values to the -1..1 envelope', () => {
    expect(clampBias(4)).toBe(1)
    expect(clampBias(-4)).toBe(-1)
  })

  // A pointer event that arrives before layout, or a rect of zero size, can
  // produce NaN/Infinity. A NaN reaching a MotionValue silently kills the
  // whole layer's transform, so it is neutralised here at the source.
  it('collapses non-finite input to a neutral 0 rather than propagating NaN', () => {
    expect(clampBias(Number.NaN)).toBe(0)
    expect(clampBias(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampBias(Number.NEGATIVE_INFINITY)).toBe(-1)
  })
})

describe('pointerBias', () => {
  const rect = { left: 0, top: 0, width: 1920, height: 1080 }

  it('reads 0,0 at the exact centre of the container', () => {
    expect(pointerBias(960, 540, rect)).toEqual({ x: 0, y: 0 })
  })

  it('reads -1,-1 at the top-left corner and 1,1 at the bottom-right', () => {
    expect(pointerBias(0, 0, rect)).toEqual({ x: -1, y: -1 })
    expect(pointerBias(1920, 1080, rect)).toEqual({ x: 1, y: 1 })
  })

  it('is relative to the container origin, not the viewport origin', () => {
    expect(pointerBias(100, 100, { left: 100, top: 100, width: 200, height: 200 })).toEqual({ x: -1, y: -1 })
    expect(pointerBias(200, 200, { left: 100, top: 100, width: 200, height: 200 })).toEqual({ x: 0, y: 0 })
  })

  it('clamps a pointer that has left the container instead of over-deflecting', () => {
    expect(pointerBias(-5000, 5000, rect)).toEqual({ x: -1, y: 1 })
  })

  // jsdom reports every getBoundingClientRect as 0x0, and so does a real
  // browser for one frame before first layout. Dividing by that width is the
  // NaN source this guard exists for.
  it('returns a neutral bias for a zero-sized container', () => {
    expect(pointerBias(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('spanBias', () => {
  // The controller/no-pointer model: the focused control's position is
  // normalised against the span of the focusable controls, not the whole
  // screen, so moving focus between two adjacent buttons produces a full
  // -1..1 swing rather than the ~0.08 the raw screen fraction would give.
  it('maps the two ends of a focus span onto -1 and 1', () => {
    expect(spanBias(880, 880, 1040)).toBe(-1)
    expect(spanBias(1040, 880, 1040)).toBe(1)
  })

  it('maps the middle of a focus span onto 0', () => {
    expect(spanBias(960, 880, 1040)).toBe(0)
  })

  it('returns 0 when the span has no extent -- a single focusable control cannot tilt the scene', () => {
    expect(spanBias(500, 500, 500)).toBe(0)
    expect(spanBias(500, 600, 400)).toBe(0)
  })

  it('clamps a centre outside the span', () => {
    expect(spanBias(2000, 880, 1040)).toBe(1)
  })
})

describe('planeShift', () => {
  it('gives each depth plane a different amplitude, deepest plane moving most', () => {
    expect(PARALLAX_PLANE_PX.glow).toBeGreaterThan(PARALLAX_PLANE_PX.lights)
    expect(PARALLAX_PLANE_PX.lights).toBeGreaterThan(PARALLAX_PLANE_PX.content)
  })

  // Layers translate *against* the pointer, the way a scene seen through a
  // window slides opposite to the viewer's head.
  it('translates against the bias direction', () => {
    expect(planeShift(1, 'glow')).toBe(-PARALLAX_PLANE_PX.glow)
    expect(planeShift(-1, 'glow')).toBe(PARALLAX_PLANE_PX.glow)
  })

  it('is zero at a neutral bias, so an untouched menu sits perfectly still', () => {
    expect(planeShift(0, 'glow')).toBe(0)
    expect(planeShift(0, 'lights')).toBe(0)
    expect(planeShift(0, 'content')).toBe(0)
  })

  it('clamps rather than extrapolating beyond the plane amplitude', () => {
    expect(planeShift(9, 'content')).toBe(-PARALLAX_PLANE_PX.content)
  })

  // The title has to stay readable while the scene moves behind it -- HIG
  // Motion, "Add motion purposefully, supporting the experience without
  // overshadowing it."
  it('keeps the content plane under 6px so the title never visibly swims', () => {
    expect(PARALLAX_PLANE_PX.content).toBeLessThanOrEqual(6)
  })
})
