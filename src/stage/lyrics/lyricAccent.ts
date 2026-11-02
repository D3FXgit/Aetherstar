import { tokens } from '../../design/tokens'

/**
 * The sweep's colour when nobody's colour is known (no mic rig, several people
 * on the same words, a preview): the cyan the lyric box has always used.
 */
export const LYRIC_FALLBACK_ACCENT: string = tokens.accent.cyan

/** Strings that reach a style as text but paint nothing (or nothing useful). */
const NOT_A_COLOUR = new Set(['', 'undefined', 'null', 'none', 'transparent', 'inherit', 'initial', 'unset', 'currentcolor'])

/**
 * Whether `color` is a colour a gradient stop can use.
 *
 * An empty or unparseable stop does not degrade gracefully: the browser drops
 * the whole `background-image`, and text whose fill is `background-clip: text`
 * on a transparent `color` then paints nothing but its shadow, i.e. black.
 * Where the platform can say (a real browser), CSS.supports has the last word.
 */
export function isUsableLyricColor(color: unknown): color is string {
  if (typeof color !== 'string') return false
  const trimmed = color.trim()
  if (NOT_A_COLOUR.has(trimmed.toLowerCase())) return false
  if (trimmed.includes('undefined') || trimmed.includes('NaN')) return false
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') return CSS.supports('color', trimmed)
  return true
}

/** `color` when it is a usable colour, otherwise `fallback` (by default the original cyan). */
export function lyricAccent(color: string | null | undefined, fallback: string = LYRIC_FALLBACK_ACCENT): string {
  return isUsableLyricColor(color) ? color.trim() : fallback
}

/**
 * The karaoke wipe: a hard stop at `--progress`, the sung part in `sung`, the
 * rest in `unsung`. Painted through the glyphs with `background-clip: text`.
 */
export function lyricSweepGradient(sung: string, unsung: string): string {
  return `linear-gradient(90deg, ${sung} calc(var(--progress) * 100%), ${unsung} calc(var(--progress) * 100%))`
}

/** The active syllable's glow: the original 44px bloom in the singer's colour. */
export function lyricGlowShadow(accent: string): string {
  return `0 0 44px ${accent}`
}
