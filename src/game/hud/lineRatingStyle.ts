import type { LineRating } from '../types'
import { tokens } from '../../design/tokens'

/** How long a line verdict stays on a score card. */
export const LINE_RATING_POP_MS = 1600

/** The colour each line verdict pops in. `poor` is never shown. */
export const LINE_RATING_COLOR: Record<LineRating, string> = {
  perfect: tokens.accent.gold,
  great: tokens.accent.cyan,
  good: tokens.accent.magenta,
  ok: 'rgba(255,255,255,0.75)',
  poor: 'transparent',
}
