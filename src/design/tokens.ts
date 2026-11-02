/**
 * Design tokens. The CSS side lives in src/styles/tokens.css (custom
 * properties plus Tailwind theme colours); tokens.test.ts keeps them in step.
 *
 * Material rule: menus are solid and colour-blocked (`surface`), so they read
 * from a sofa. Glass (`glassSurfaceClass`) is only for overlays on video.
 */

/**
 * The ceiling on any `backdrop-filter: blur()` radius. Every glass surface sits
 * over playing video, so it is re-blurred every frame; past 12px the cost keeps
 * climbing for a difference nobody sees. Enforced by blurBudget.test.ts.
 */
export const MAX_BACKDROP_BLUR_PX = 12

export const tokens = {
  /** Glass blur radii, capped by MAX_BACKDROP_BLUR_PX. */
  blur: { min: 8, max: MAX_BACKDROP_BLUR_PX },
  saturate: { min: 105, max: 180 },

  palette: {
    background: '#08080b',
    backgroundAlt: '#0d0b16',
    text: '#f2f2f4',
  },

  /**
   * Solid menu surfaces, darkest to lightest: a panel, a control sitting on it,
   * and that control hovered or focused. `line` is the hairline border.
   * Tailwind: `bg-surface-panel`, `bg-surface-raised`, `bg-surface-hover`, `border-line`.
   */
  surface: {
    panel: '#15131d',
    raised: '#1f1c2a',
    hover: '#2a2638',
    line: 'rgba(255, 255, 255, 0.09)',
  },

  /**
   * The three levels of text emphasis, as opacities of `palette.text`.
   * Tertiary is the floor: 0.5 keeps ~4.8:1 contrast on the near-black
   * background. Use `textClass` (Tailwind) or `textColor()` (inline styles).
   */
  textOpacity: {
    primary: 0.92,
    secondary: 0.68,
    tertiary: 0.5,
  },

  accent: {
    coral: 'oklch(0.72 0.20 25)',
    cyan: 'oklch(0.78 0.19 195)',
    gold: 'oklch(0.85 0.16 85)',
    magenta: 'oklch(0.78 0.19 320)',
  },

  fontStack: '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, sans-serif',

  spring: {
    hover: { stiffness: 400, damping: 30 },
    panelEnter: { stiffness: 260, damping: 26 },
    sceneTransition: { stiffness: 220, damping: 28 },
    /** Focus landing on a card: a small overshoot so the move reads from across the room. */
    tvOS: { stiffness: 300, damping: 25 },
    /** The shared press/hover feedback (see design/motion.ts): quick and barely overshooting. */
    press: { stiffness: 520, damping: 34 },
  },
} as const

/**
 * Per-mic colours, P1..P8: THE source of truth for a player's strong colour.
 *
 * Assigned by mic slot, never stored on a profile, because whoever picks up
 * mic 3 tonight is player 3. Constant lightness and chroma so no slot looks
 * more "active"; hues alternate across the blue/yellow axis so neighbours stay
 * apart for common colour blindness. The number badge stays the primary
 * identifier. Mirrored as `--ae-mic-1..8` in src/styles/tokens.css.
 */
export const MIC_RIM_COLORS = [
  'oklch(0.78 0.19 195)', // P1 cyan
  'oklch(0.78 0.19 25)', //  P2 coral
  'oklch(0.80 0.17 130)', // P3 green
  'oklch(0.78 0.19 320)', // P4 magenta
  'oklch(0.85 0.16 85)', //  P5 gold
  'oklch(0.72 0.19 265)', // P6 indigo
  'oklch(0.80 0.16 55)', //  P7 amber-orange
  'oklch(0.78 0.17 350)', // P8 rose
] as const

/** Colour for a zero-indexed mic slot; wraps if there are ever more slots than colours. */
export function micRimColor(slotIndex: number): string {
  const count = MIC_RIM_COLORS.length
  return MIC_RIM_COLORS[((slotIndex % count) + count) % count]
}

/** Colour for a one-based mic number (mic 1 = P1), the form most UI code holds. */
export function micColor(micNumber: number): string {
  return micRimColor(micNumber - 1)
}

/** An `oklch(...)` colour at the given alpha, e.g. for a tinted fill behind a mic colour. */
export function withAlpha(color: string, alpha: number): string {
  return color.replace(/\)$/, ` / ${alpha})`)
}

/**
 * Easing curves as framer-motion cubic-bezier arrays: `standard` for everyday
 * moves, `emphasized` for something arriving, `exit` for something leaving.
 */
export const easing = {
  standard: [0.4, 0.0, 0.2, 1],
  emphasized: [0.16, 1, 0.3, 1],
  exit: [0.4, 0.0, 1, 1],
} as const

export type SpringPreset = keyof typeof tokens.spring

export type TextEmphasis = keyof typeof tokens.textOpacity

/** `palette.text` at one of the three emphasis levels, as an rgba() string for inline styles. */
export function textColor(emphasis: TextEmphasis): string {
  return `rgba(242, 242, 244, ${tokens.textOpacity[emphasis]})`
}

/**
 * The Tailwind class for each emphasis level. Literal strings so Tailwind's
 * scanner sees them; prefer these over ad-hoc `text-white/NN`.
 */
export const textClass = {
  primary: 'text-ink-primary',
  secondary: 'text-ink-secondary',
  tertiary: 'text-ink-tertiary',
} as const satisfies Record<TextEmphasis, string>

/** A spring transition for a preset, or an instant cut under reduced motion. */
export function springTransition(
  preset: SpringPreset,
  reducedMotion = false,
): { duration: 0 } | { type: 'spring'; stiffness: number; damping: number } {
  if (reducedMotion) return { duration: 0 }
  return { type: 'spring', ...tokens.spring[preset] }
}

/** The solid menu surface: an opaque panel with a hairline border. The default material. */
export function solidSurfaceClass(): string {
  return 'bg-surface-panel border border-line'
}

/**
 * The glass surface, for overlays on video only. Written as a literal (never
 * interpolated) so Tailwind generates it and blurBudget.test.ts can read it.
 */
export function glassSurfaceClass(): string {
  return 'backdrop-blur-[12px] backdrop-saturate-[150%] bg-white/[0.08] border border-white/10'
}
