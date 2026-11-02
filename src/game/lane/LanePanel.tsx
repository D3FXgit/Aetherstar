import type { CSSProperties, ReactNode } from 'react'
import { motion } from 'framer-motion'
import { micLabel } from '../../multiplayer/slots'
import { useT } from '../../i18n'
import { guideLineCount, SOLO_LANE_HEIGHT_PX } from './laneStack'
import { useLanePaging } from './LanePagingContext'

/**
 * Default lane content height in px. The pitch scale maps a song's note range
 * onto exactly this many pixels (see pitchRangeScale), so the clipped content
 * box is sized to match rather than stretched to fill. A crowded stack passes
 * a smaller height (see laneStack.ts).
 */
export const LANE_HEIGHT_PX = SOLO_LANE_HEIGHT_PX

/**
 * Where "now" sits across a scrolling lane's width: sung notes to its left,
 * upcoming ones to its right. The content is shifted, never the note maths.
 */
export const PLAYHEAD_OFFSET_PERCENT = 35

/** A dark edge under a light hairline: the line keeps an edge over both bright and dark video. */
const LANE_HAIRLINE_SHADOW = '0 1px 0 rgba(0,0,0,0.4)'

const PLAYHEAD_STYLE: CSSProperties = {
  background: 'rgba(255,255,255,0.22)',
  boxShadow: '0 0 0 1px rgba(0,0,0,0.28)',
}

interface LanePanelProps {
  /** This singer's note layer(s). */
  children: ReactNode
  /** 1-based microphone number ("Mic 3"): the lane's non-colour identity, spelled through micLabel(). */
  slotNumber: number
  /** Who is holding that microphone right now, when the roster knows. */
  singerName?: string | null
  /** The mic slot's rim colour (see micRimColor) -- reinforcement for the number, never a replacement. */
  accentColor?: string
  /** Defaults to the full-height solo lane. */
  laneHeightPx?: number
}

/**
 * One singer's pitch lane. No background and no frame -- it floats over the
 * song's video; only the notes, faint pitch hairlines, a hairline at "now" and
 * a small identity chip (the one thing with a scrim, since it is small text
 * over video) are drawn.
 */
export function LanePanel({
  children,
  slotNumber,
  singerName,
  accentColor = 'rgba(255,255,255,0.7)',
  laneHeightPx = LANE_HEIGHT_PX,
}: LanePanelProps) {
  useT()
  const lines = guideLineCount(laneHeightPx)
  // A paged lane (see linePaging.ts) moves "now" across the line instead of
  // scrolling the line past a fixed "now".
  const paging = useLanePaging()

  return (
    <div data-testid="lane-panel" className="relative flex w-full items-stretch gap-2">
      {/* The singer's colour at the margin: how they find their lane in a
          stack. A dark outline, not a glow, keeps it visible over any frame. */}
      <div
        data-testid="lane-rim"
        aria-hidden
        className="w-1 shrink-0 rounded-full"
        style={{ background: accentColor, boxShadow: '0 0 0 1px rgba(0,0,0,0.45)' }}
      />

      <div
        data-testid="lane-track"
        className="relative w-full overflow-hidden rounded-[14px]"
        style={{
          height: `${laneHeightPx}px`,
          // Up to eight of these are stacked, each busy every frame: `contain`
          // keeps an invalidation in one lane from dirtying the others.
          contain: 'layout style paint',
        }}
      >
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            data-testid="lane-guide-line"
            aria-hidden
            className="absolute left-0 right-0 h-px"
            style={{
              top: `${((index + 1) / (lines + 1)) * 100}%`,
              background: 'rgba(255,255,255,0.06)',
              boxShadow: LANE_HAIRLINE_SHADOW,
            }}
          />
        ))}

        {children}

        {/* "Now", as a quiet hairline: the pitch arrow's tip is what marks the
            instant, and a bright bar beside it would compete with it. */}
        {paging ? (
          // Paged: the hairline rides a full-width layer translated by the
          // playhead's percentage (compositor-only, no React render).
          <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ x: paging.playheadX }}>
            <div data-testid="lane-playhead" aria-hidden className="absolute top-0 bottom-0 w-px" style={{ left: 0, ...PLAYHEAD_STYLE }} />
          </motion.div>
        ) : (
          <div
            data-testid="lane-playhead"
            aria-hidden
            className="absolute top-0 bottom-0 w-px"
            style={{ left: `${PLAYHEAD_OFFSET_PERCENT}%`, ...PLAYHEAD_STYLE }}
          />
        )}

        {/* Inside the lane, not under it: eight captions between eight lanes
            would cost more height than the lanes. A solid chip, no blur. */}
        <div
          data-testid="lane-identity"
          className="absolute left-2 top-1.5 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1"
        >
          <span
            data-testid="lane-slot-badge"
            className="text-xs font-bold leading-none"
            style={{ color: accentColor }}
          >
            {micLabel(slotNumber)}
          </span>
          {singerName && (
            <span
              data-testid="lane-singer-name"
              className="max-w-[10rem] truncate text-xs font-semibold leading-none text-[var(--ae-text-primary)]"
            >
              {singerName}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
