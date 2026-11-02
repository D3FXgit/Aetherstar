// The look of the session screens around a song (party draw, assign,
// starting, results, leaderboard): opaque, colour-blocked surfaces where each
// singer is drawn in their own mic colour. Glass stays reserved for UI that
// sits over video.
import type { CSSProperties } from 'react'
import { du, designUnitRootStyle } from '../scenes/designUnits'
import { tokens } from '../design/tokens'

export const SESSION_COLORS = {
  /** The screen itself. Flat, so the colour blocks carry the composition. */
  ground: '#100f15',
  /** A card on the ground. */
  surface: '#1c1b24',
  /** A control or a row inside a card. */
  raised: '#282733',
  /** Hairline between two surfaces of the same colour. */
  line: 'rgba(242, 242, 244, 0.1)',
  /** Text and numerals printed on a player's colour. The mic colours all sit at L≈0.78, so dark ink always reads. */
  ink: '#121118',
  gold: tokens.accent.gold,
} as const

/** Text emphasis, from the shared `--ae-text-*` tokens (src/index.css). */
export const TEXT = {
  primary: 'var(--ae-text-primary)',
  secondary: 'var(--ae-text-secondary)',
  tertiary: 'var(--ae-text-tertiary)',
} as const

/** Rounded where the platform has it; heavy weights do the rest. */
export const DISPLAY_FONT = `ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", ${tokens.fontStack}`

/** The root of a full-screen session scene: defines `--u` and paints the flat ground. */
export function sessionScreenStyle(extra?: CSSProperties): CSSProperties {
  return {
    ...designUnitRootStyle(),
    background: SESSION_COLORS.ground,
    color: TEXT.primary,
    fontFamily: tokens.fontStack,
    ...extra,
  }
}

/** A big heavy heading. */
export function displayType(sizeUnits: number, extra?: CSSProperties): CSSProperties {
  return {
    fontFamily: DISPLAY_FONT,
    fontWeight: 900,
    fontSize: `max(1rem, ${du(sizeUnits)})`,
    lineHeight: 1.02,
    letterSpacing: '-0.01em',
    ...extra,
  }
}

/** A solid card on the ground. */
export const CARD_STYLE: CSSProperties = {
  background: SESSION_COLORS.surface,
  borderRadius: du(28),
}

/**
 * Hover feedback for the solid buttons: a brightness step, not a spring.
 * `motion-reduce` keeps it a cut.
 */
export const BUTTON_HOVER_CLASS =
  'transition-[filter,background-color] duration-150 hover:brightness-110 motion-reduce:transition-none disabled:hover:brightness-100'

/** The one action a screen is for, in a solid colour (a player's, or the default). */
export function primaryButtonStyle(color: string = tokens.accent.cyan, extra?: CSSProperties): CSSProperties {
  return {
    background: color,
    color: SESSION_COLORS.ink,
    fontFamily: DISPLAY_FONT,
    fontWeight: 800,
    fontSize: `max(1rem, ${du(22)})`,
    padding: `${du(18)} ${du(32)}`,
    borderRadius: du(18),
    minHeight: `max(2.75rem, ${du(60)})`,
    border: 'none',
    cursor: 'pointer',
    ...extra,
  }
}

/** Everything that is not the primary action. */
export function secondaryButtonStyle(extra?: CSSProperties): CSSProperties {
  return {
    background: SESSION_COLORS.raised,
    color: TEXT.primary,
    fontWeight: 700,
    fontSize: `max(0.875rem, ${du(17)})`,
    padding: `${du(12)} ${du(22)}`,
    borderRadius: du(14),
    minHeight: `max(2.75rem, ${du(48)})`,
    border: 'none',
    cursor: 'pointer',
    ...extra,
  }
}

/** A small label set in a singer's colour -- "Mic 2", "New highscore!". */
export function colorChipStyle(color: string, extra?: CSSProperties): CSSProperties {
  return {
    background: color,
    color: SESSION_COLORS.ink,
    fontWeight: 800,
    fontSize: `max(0.75rem, ${du(14)})`,
    padding: `${du(5)} ${du(12)}`,
    borderRadius: '999px',
    whiteSpace: 'nowrap',
    lineHeight: 1.1,
    ...extra,
  }
}

/** A neutral chip on a dark surface -- a count, a duration. */
export function neutralChipStyle(extra?: CSSProperties): CSSProperties {
  return {
    background: SESSION_COLORS.raised,
    color: TEXT.secondary,
    fontWeight: 700,
    fontSize: `max(0.75rem, ${du(14)})`,
    padding: `${du(5)} ${du(12)}`,
    borderRadius: '999px',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    ...extra,
  }
}

/** The Back pill at the size these screens' headers use. */
export const SESSION_BACK_BUTTON_STYLE: CSSProperties = {
  height: du(48),
  paddingLeft: du(18),
  paddingRight: du(22),
  borderRadius: '999px',
  fontSize: du(16),
  gap: du(10),
}

/** Gap between a picked singer's name and their difficulty chip (SingerDifficultyPicker). */
export const DIFFICULTY_CHIP_MARGIN_TOP = 8

/** The difficulty chip's height under a badge of `badgeSize`: never under the 44px minimum target. */
export function difficultyChipHeightFor(badgeSize: number): number {
  return Math.max(44, Math.round(badgeSize * 0.19))
}

/**
 * The band a Player Selection cell reserves below the badge for the chip,
 * picked or not, so picking a singer never reflows the grid.
 */
export function difficultyRowHeightFor(badgeSize: number): number {
  return difficultyChipHeightFor(badgeSize) + DIFFICULTY_CHIP_MARGIN_TOP
}
