import { withAlpha } from '../design/tokens'

/**
 * Profile tints: the colour of a player's avatar badge, picked in the roster.
 * During a night the strong player colour is the per-mic colour
 * (`micColor`/`micRimColor` in src/design/tokens.ts); this is only the profile tint.
 * One family, same lightness and chroma, four hues.
 */
const PLAYER_HUES = [195, 320, 140, 70]

export const PLAYER_ACCENT_COLORS = PLAYER_HUES.map((hue) => `oklch(0.78 0.19 ${hue})`)

/** Kept for existing imports; the same as `withAlpha` in src/design/tokens.ts. */
export const colorWithAlpha = withAlpha

/** For a scoreboard entry with no matching profile: a neutral grey, outside the tint family. */
export const NEUTRAL_FALLBACK_COLOR = 'oklch(0.60 0 0)'
