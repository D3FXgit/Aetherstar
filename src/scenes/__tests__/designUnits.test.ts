import { describe, expect, it } from 'vitest'
import { SCENE_BACK_BUTTON_STYLE, SCENE_DESIGN_UNIT, designUnitScale, du } from '../designUnits'

/**
 * The 4K regression, pinned as arithmetic.
 *
 * Screenshots of the old app at 3840x2160 showed the results panel at exactly
 * its 1080p size -- a stamp occupying about a thirtieth of the display -- and
 * Back as a 109x53px pill in the corner of it, because every dimension was a
 * fixed pixel value. Everything below is what stops that recurring.
 */
describe('design units', () => {
  it('is 1px at 1080p and 2px at 4K', () => {
    expect(designUnitScale(1920, 1080)).toBe(1)
    expect(designUnitScale(3840, 2160)).toBe(2)
  })

  // Scaling by the *more constrained* axis is what keeps 16:9 proportions on an
  // ultrawide: the layout does not stretch, the screen simply fits more of it.
  it('scales by the more constrained axis, so an ultrawide keeps its proportions', () => {
    expect(designUnitScale(2560, 1080)).toBe(1)
    expect(designUnitScale(1920, 2160)).toBe(1)
  })

  // Both ends of the clamp are load-bearing: the floor keeps a small
  // development window legible, the ceiling stops an 8K display rendering a
  // poster.
  it('clamps at both ends', () => {
    expect(designUnitScale(320, 240)).toBeCloseTo(0.62)
    expect(designUnitScale(16000, 9000)).toBeCloseTo(2.4)
  })

  // The CSS expression and the JavaScript one are two spellings of the same
  // formula, used side by side on the same screen (`--u` for CSS lengths, the
  // number for PlayerBadge's inline pixel `size`). If they drift, a badge stops
  // matching the layout around it.
  it('spells the same clamp in CSS as the numeric version computes', () => {
    expect(SCENE_DESIGN_UNIT).toContain('0.62px')
    expect(SCENE_DESIGN_UNIT).toContain('2.4px')
    expect(SCENE_DESIGN_UNIT).toContain('100vw / 1920')
    expect(SCENE_DESIGN_UNIT).toContain('100vh / 1080')
  })

  // The fallback is not defensive noise: `calc(N * var(--u))` with no `--u` in
  // scope is an *invalid* value, so the browser drops the whole declaration and
  // the element silently loses its size. With `1px`, a component written in
  // design units renders at exactly its 1080p size anywhere no screen has
  // declared the unit -- which is what lets MicMatrix be both the body of the
  // full-screen Mic Setup scene and a panel inside Settings.
  it('writes a 1080p pixel value as a multiple of the unit, falling back to 1px', () => {
    expect(du(56)).toBe('calc(56 * var(--u, 1px))')
  })

  /**
   * The 44pt floor, kept under a scaling control.
   *
   * `--u` clamps down to 0.62px in a small window, and 56 design units of that
   * is 35px -- under the minimum the HIG asks of a frequently used control
   * (Game controls: "Make sure frequently used controls are a minimum size of
   * 44x44 points"). Every metric is therefore a `max()` against the fixed size
   * the control has everywhere else, so it can grow but never shrink.
   */
  it('floors every Back metric at the size it has everywhere else', () => {
    expect(SCENE_BACK_BUTTON_STYLE.height).toBe('max(3.5rem, calc(56 * var(--u, 1px)))')
    expect(String(SCENE_BACK_BUTTON_STYLE.paddingInline)).toContain('max(')
    expect(String(SCENE_BACK_BUTTON_STYLE.fontSize)).toContain('max(')
    for (const value of Object.values(SCENE_BACK_BUTTON_STYLE)) {
      expect(String(value)).toContain('var(--u, 1px)')
    }
  })
})
