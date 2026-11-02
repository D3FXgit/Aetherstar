import type { MotionValue } from 'framer-motion'
import type { SongLine } from '../../contracts/types'
import { colorWithAlpha } from '../../players/colors'
import { isUsableLyricColor } from './lyricAccent'
import { paginateLines } from './paginateLines'
import { LyricLine } from './LyricLine'
import {
  LYRIC_BOX_HEIGHT,
  LYRIC_BOX_PADDING_Y,
  LYRIC_CURRENT_FLOOR,
  LYRIC_CURRENT_FONT,
  LYRIC_LINE_HEIGHT,
  LYRIC_NEXT_FONT,
  LYRIC_ROW_GAP,
  PREVIEW_SIZE_RATIO,
  lyricFitFontSize,
  lyricLineSpanEm,
} from './lyricFit'

/** A duet's two boxes share the solo box's space, so each is set at this share of its type and size. */
export const COMPACT_LYRIC_SCALE = 0.56

const COMPACT_PADDING_Y = '0.55rem'
const COMPACT_ROW_GAP = '0.25rem'
const COMPACT_CURRENT_CEILING = `calc(${LYRIC_CURRENT_FONT} * ${COMPACT_LYRIC_SCALE})`
const COMPACT_BOX_HEIGHT =
  `calc((${LYRIC_CURRENT_FONT} + ${LYRIC_NEXT_FONT}) * ${LYRIC_LINE_HEIGHT} * ${COMPACT_LYRIC_SCALE}` +
  ` + ${COMPACT_ROW_GAP} + ${COMPACT_PADDING_Y} * 2)`

/**
 * The floating lyric box: a dark scrim, not glass. It is the largest surface
 * over playing video, and a live backdrop blur there was the most expensive
 * thing on screen (see design/__tests__/blurBudget.test.ts); the scrim plus the
 * glyphs' own halo hold the words up for nothing per frame.
 */
const LYRIC_BOX_SURFACE_STYLE = {
  background: 'linear-gradient(180deg, rgba(9,9,12,0.78) 0%, rgba(9,9,12,0.90) 100%)',
} as const

const LYRIC_BOX_CLASS = 'border border-white/15 rounded-[34px] shadow-[0_30px_90px_rgba(0,0,0,0.55)]'

/** Most of the bottom row's width: the wider the box, the fewer lines need scaling down (see lyricFit.ts). */
const LYRIC_BOX_MAX_WIDTH = 'min(100%, 82vw)'

/**
 * Room the clip leaves around the words (their halo and the sweep's underline).
 * The clip itself is the backstop for a line so long even the fit's floor
 * cannot hold it, so it can never push the status pill off screen.
 */
const LYRIC_GLOW_CLIP_MARGIN = '3rem'

interface LyricBoxProps {
  lines: SongLine[]
  currentLineIndex: number
  activeSyllableIndex?: number
  progress: number | MotionValue<number>
  /** A duet's half-height box (see COMPACT_LYRIC_SCALE). */
  compact?: boolean
  /** The singer's colour: the box rim and the sweep. */
  accentColor?: string
  /** Which duet part this box carries, for tests and the accessibility tree. */
  part?: string
}

/**
 * Party-karaoke-style two-line box: current line + next-line preview, at a fixed
 * height so the words never twitch between long and short lines (see
 * lyricFit.ts). `container-type: inline-size` is load-bearing: the per-line
 * `100cqw` fit resolves against it, with no measurement on the main thread.
 */
export function LyricBox({
  lines,
  currentLineIndex,
  activeSyllableIndex,
  progress,
  compact = false,
  accentColor,
  part,
}: LyricBoxProps) {
  const { currentLine, nextLine } = paginateLines(lines, currentLineIndex)

  // The preview is held to a fraction of the current line's fitted size (see
  // PREVIEW_SIZE_RATIO) -- the one thing the two rows must know about each other.
  const currentCeilings = compact ? [COMPACT_CURRENT_CEILING] : []
  const currentFit = currentLine
    ? lyricFitFontSize(LYRIC_CURRENT_FONT, LYRIC_CURRENT_FLOOR, lyricLineSpanEm(currentLine), ...currentCeilings)
    : null

  return (
    <div
      data-testid="lyric-box"
      data-part={part}
      data-compact={compact ? 'true' : undefined}
      style={{
        ...LYRIC_BOX_SURFACE_STYLE,
        ['--lyric-box-height' as string]: compact ? COMPACT_BOX_HEIGHT : LYRIC_BOX_HEIGHT,
        height: 'var(--lyric-box-height)',
        maxWidth: LYRIC_BOX_MAX_WIDTH,
        paddingBlock: compact ? COMPACT_PADDING_Y : LYRIC_BOX_PADDING_Y,
        rowGap: compact ? COMPACT_ROW_GAP : LYRIC_ROW_GAP,
        containerType: 'inline-size',
        overflow: 'clip',
        overflowClipMargin: LYRIC_GLOW_CLIP_MARGIN,
        ...(isUsableLyricColor(accentColor) ? { borderColor: colorWithAlpha(accentColor, 0.7) } : {}),
      }}
      className={`${LYRIC_BOX_CLASS} w-full mx-auto px-[clamp(1.5rem,2.5vw,3.5rem)] flex flex-col justify-center items-center text-center`}
    >
      {currentLine && (
        <LyricLine
          line={currentLine}
          activeSyllableIndex={activeSyllableIndex}
          progress={progress}
          variant="current"
          sizeCeiling={compact ? COMPACT_CURRENT_CEILING : undefined}
          accentColor={accentColor}
        />
      )}
      {nextLine && (
        <LyricLine
          line={nextLine}
          variant="next"
          sizeCeiling={currentFit ? `calc((${currentFit}) * ${PREVIEW_SIZE_RATIO})` : undefined}
        />
      )}
    </div>
  )
}
