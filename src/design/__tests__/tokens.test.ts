import { describe, expect, it } from 'vitest'
import {
  MAX_BACKDROP_BLUR_PX,
  MIC_RIM_COLORS,
  easing,
  glassSurfaceClass,
  micColor,
  micRimColor,
  solidSurfaceClass,
  springTransition,
  textClass,
  textColor,
  tokens,
  withAlpha,
} from '../tokens'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TOKENS_CSS = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8')

describe('design tokens', () => {
  // The blur range is capped by the app-wide budget; see blurBudget.test.ts.
  it('exposes a glass blur range capped by the app-wide backdrop-blur budget', () => {
    expect(tokens.blur.max).toBe(MAX_BACKDROP_BLUR_PX)
    expect(tokens.blur.min).toBe(8)
    expect(tokens.saturate.min).toBe(105)
    expect(tokens.saturate.max).toBe(180)
  })

  it('caps the app-wide backdrop-blur budget at 12px', () => {
    expect(MAX_BACKDROP_BLUR_PX).toBe(12)
  })

  // The glass surface (over-video only) at the capped radius.
  it('builds the glass surface at the capped radius', () => {
    expect(glassSurfaceClass()).toContain('backdrop-blur-[12px]')
    expect(glassSurfaceClass()).toContain('bg-white/[0.08]')
    expect(glassSurfaceClass()).not.toContain('backdrop-blur-[32px]')
  })

  it('exposes the near-black base palette and off-white text color', () => {
    expect(tokens.palette.background).toBe('#08080b')
    expect(tokens.palette.text).toBe('#f2f2f4')
  })

  it('exposes a four-hue neon accent set as oklch() strings', () => {
    expect(tokens.accent.coral).toContain('oklch(0.72 0.20 25')
    expect(tokens.accent.cyan).toContain('oklch(0.78 0.19 195')
    expect(tokens.accent.gold).toContain('oklch(0.85 0.16 85')
    expect(tokens.accent.magenta).toBe('oklch(0.78 0.19 320)')
  })

  it('exposes the SF Pro-first font stack', () => {
    expect(tokens.fontStack).toContain('-apple-system')
    expect(tokens.fontStack).toContain('SF Pro Display')
  })

  it('exposes spring presets for hover, press, panel-enter, and scene-transition weights', () => {
    expect(tokens.spring.press).toMatchObject({ stiffness: expect.any(Number), damping: expect.any(Number) })
    expect(tokens.spring.hover).toMatchObject({ stiffness: expect.any(Number), damping: expect.any(Number) })
    expect(tokens.spring.panelEnter).toMatchObject({ stiffness: expect.any(Number), damping: expect.any(Number) })
    expect(tokens.spring.sceneTransition).toMatchObject({ stiffness: expect.any(Number), damping: expect.any(Number) })
  })

  it('exposes the tvOS focus spring at its specified stiffness and damping', () => {
    expect(tokens.spring.tvOS).toEqual({ stiffness: 300, damping: 25 })
  })

  it('springTransition() returns a framer-motion spring transition for a preset', () => {
    expect(springTransition('tvOS')).toEqual({ type: 'spring', stiffness: 300, damping: 25 })
  })

  it('springTransition() collapses to a zero-duration tween when motion is reduced', () => {
    expect(springTransition('tvOS', true)).toEqual({ duration: 0 })
  })

  // One colour per mic slot, so eight must always exist and differ.
  it('exposes one rim colour per microphone slot, all distinct', () => {
    expect(MIC_RIM_COLORS).toHaveLength(8)
    expect(new Set(MIC_RIM_COLORS).size).toBe(8)
  })

  it('micRimColor maps a zero-indexed slot to its colour and wraps past the end', () => {
    expect(micRimColor(0)).toBe(MIC_RIM_COLORS[0])
    expect(micRimColor(7)).toBe(MIC_RIM_COLORS[7])
    expect(micRimColor(8)).toBe(MIC_RIM_COLORS[0])
    expect(micRimColor(-1)).toBe(MIC_RIM_COLORS[7])
  })

  it('micColor takes the one-based mic number the UI holds', () => {
    expect(micColor(1)).toBe(MIC_RIM_COLORS[0])
    expect(micColor(8)).toBe(MIC_RIM_COLORS[7])
  })

  it('withAlpha adds an alpha channel to an oklch colour', () => {
    expect(withAlpha('oklch(0.78 0.19 195)', 0.4)).toBe('oklch(0.78 0.19 195 / 0.4)')
  })

  it('builds the solid menu surface from the theme tokens, with no blur', () => {
    expect(solidSurfaceClass()).toContain('bg-surface-panel')
    expect(solidSurfaceClass()).toContain('border-line')
    expect(solidSurfaceClass()).not.toMatch(/backdrop-blur/)
  })

  it('exposes cubic-bezier easing curves as four-number arrays', () => {
    for (const curve of [easing.standard, easing.emphasized, easing.exit]) {
      expect(curve).toHaveLength(4)
      curve.forEach((n) => expect(typeof n).toBe('number'))
    }
  })

  describe('text emphasis scale', () => {
    it('orders primary > secondary > tertiary, with a legible floor', () => {
      const { primary, secondary, tertiary } = tokens.textOpacity
      expect(primary).toBeGreaterThan(secondary)
      expect(secondary).toBeGreaterThan(tertiary)
      expect(tertiary).toBeGreaterThanOrEqual(0.5)
    })

    it('renders each level as the palette text colour at that opacity', () => {
      expect(textColor('primary')).toBe('rgba(242, 242, 244, 0.92)')
      expect(textColor('tertiary')).toBe('rgba(242, 242, 244, 0.5)')
    })

    it('is mirrored exactly by the CSS custom properties in styles/tokens.css', () => {
      for (const level of ['primary', 'secondary', 'tertiary'] as const) {
        expect(TOKENS_CSS).toContain(`--ae-text-${level}: ${textColor(level)};`)
      }
    })

    it('has a Tailwind class per level, backed by a theme colour', () => {
      for (const level of ['primary', 'secondary', 'tertiary'] as const) {
        expect(textClass[level]).toBe(`text-ink-${level}`)
        expect(TOKENS_CSS).toContain(`--color-ink-${level}: var(--ae-text-${level});`)
      }
    })
  })

  describe('CSS mirror', () => {
    it('mirrors the solid surfaces', () => {
      expect(TOKENS_CSS).toContain(`--ae-surface-panel: ${tokens.surface.panel};`)
      expect(TOKENS_CSS).toContain(`--ae-surface-raised: ${tokens.surface.raised};`)
      expect(TOKENS_CSS).toContain(`--ae-surface-hover: ${tokens.surface.hover};`)
      expect(TOKENS_CSS).toContain(`--ae-line: ${tokens.surface.line};`)
    })

    it('mirrors every mic colour as --ae-mic-N', () => {
      MIC_RIM_COLORS.forEach((color, index) => {
        expect(TOKENS_CSS).toContain(`--ae-mic-${index + 1}: ${color};`)
      })
    })
  })
})
