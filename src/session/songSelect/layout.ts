// Shared sizing and surfaces for the song selector.
//
// Every dimension is `n` reference pixels (1920x1080) times one design unit, so
// the screen fills a 4K television the way it fills a 1080p one.
import type { CSSProperties } from 'react'
import { previewAudioPath } from '../previewAudioPath'
import { toLibraryMediaUrl } from '../../library/mediaUrl'
import type { LibrarySong } from '../../library/types'
import { FOCUS_OUTLINE_GUTTER_PX } from '../songGridGeometry'
import { tokens } from '../../design/tokens'

/**
 * One design unit: 1px at 1080p, 2px at 2160p, following the tighter axis. The
 * floor keeps a small dev window readable; the ceiling stops runaway growth.
 */
export const DESIGN_UNIT = 'clamp(0.62px, min(100vw / 1920, 100vh / 1080), 2.4px)'

/** The design unit in CSS pixels, for layout math CSS cannot do (the virtualized grid). */
export function designUnitPx(): number {
  const raw = Math.min(window.innerWidth / 1920, window.innerHeight / 1080)
  return Math.min(Math.max(raw, 0.62), 2.4)
}

/** `n` reference pixels, in design units. */
export function u(n: number): string {
  return `calc(${n} * var(--u))`
}

/** Room inside every scroll container for the fixed-pixel focus outline. */
export const FOCUS_OUTLINE_GUTTER = `${FOCUS_OUTLINE_GUTTER_PX}px`

/** Pinned to the viewport (the shell is only a min-height), so only the song list scrolls. */
export const VIEWPORT_HEIGHT = '100dvh'

/** Text emphasis, from the app tokens. */
export const TEXT = {
  primary: 'var(--ae-text-primary)',
  secondary: 'var(--ae-text-secondary)',
  tertiary: 'var(--ae-text-tertiary)',
} as const

/** Opaque, colour-blocked surfaces; glass is reserved for things over video. */
export const SURFACE = {
  panel: 'var(--ae-surface-panel, #15131d)',
  raised: 'var(--ae-surface-raised, #1f1c2a)',
  hover: 'var(--ae-surface-hover, #2a2638)',
  line: 'var(--ae-line, rgba(255, 255, 255, 0.09))',
} as const

export const ACCENT_CYAN = tokens.accent.cyan
export const ACCENT_GOLD = tokens.accent.gold

/** Back, in design units but never under the app-wide 3.5rem (44pt) floor. */
export const BACK_BUTTON_STYLE: CSSProperties = {
  height: `max(3.5rem, ${u(56)})`,
  paddingInline: `max(1.5rem, ${u(24)})`,
  fontSize: `max(1rem, ${u(17)})`,
  gap: `max(0.5rem, ${u(8)})`,
}

/** A small stat chip in the preview panel (duration, duet, language). */
export const metaChipStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: u(16),
  padding: `${u(6)} ${u(12)}`,
  borderRadius: u(8),
  background: SURFACE.raised,
  color: TEXT.secondary,
}

/** A filter chip in the bottom bar. */
export const filterChipStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: u(17),
  padding: `${u(10)} ${u(18)}`,
  borderRadius: u(12),
  background: SURFACE.raised,
  border: `1px solid ${SURFACE.line}`,
  color: TEXT.secondary,
}

export const filterChipActiveStyle: CSSProperties = {
  ...filterChipStyle,
  background: 'oklch(0.78 0.19 195 / .2)',
  border: '1px solid oklch(0.78 0.19 195 / .55)',
  color: TEXT.primary,
}

/** A small section label ("Highscore", "Jump to"). */
export const sectionLabelStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: u(15),
  color: TEXT.tertiary,
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export const mediaUrl = toLibraryMediaUrl

/** The exact track this song would put on the preview bus, or null if it has none. */
export function previewTrackFor(song: LibrarySong | null): string | null {
  const path = previewAudioPath(song)
  return path ? mediaUrl(path) : null
}
