import { motion, type MotionValue } from 'framer-motion'
import type { CSSProperties } from 'react'
import type { SongLine } from '../../contracts/types'
import { textColor, tokens } from '../../design/tokens'
import { lyricAccent, lyricGlowShadow, lyricSweepGradient } from './lyricAccent'
import {
  LYRIC_CURRENT_FLOOR,
  LYRIC_CURRENT_FONT,
  LYRIC_LINE_HEIGHT,
  LYRIC_NEXT_FLOOR,
  LYRIC_NEXT_FONT,
  lyricFitFontSize,
  lyricLineSpanEm,
} from './lyricFit'

// Pure CSS sizing, no JS measurement: the clamp() sizes are a ceiling, and a
// line too long for its row is scaled down rather than wrapped (see
// lyricFit.ts). The fit rides one `--lyric-fit` custom property, which is what
// keeps it assertable under jsdom's CSS parser.
const CURRENT_LINE_TYPE_CLASS = 'tracking-[-0.03em] font-bold'
const NEXT_LINE_TYPE_CLASS = 'tracking-[-0.02em] font-semibold'

/** Words still to sing: bright, so the line is readable before it is reached. */
const UNSUNG_COLOR = textColor('primary')
/** The preview line: clearly secondary, still legible from the sofa. */
const NEXT_LINE_COLOR = textColor('tertiary')

/**
 * A tight dark halo on every glyph: a hard 2px edge plus a 6px lift. The box is
 * a plain scrim (no backdrop blur over video), so the type carries its own contrast.
 */
const LYRIC_TEXT_SHADOW = '0 1px 2px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.7)'

/**
 * A static, glyph-for-glyph copy of the active syllable that paints only its
 * shadow. Absolutely placed over the sweeping span (which keeps its inline box,
 * so nothing reflows), spanning its line box top to bottom, with the text
 * centred in it: that cancels the half-leading whatever the font, so the copy's
 * glyphs land exactly on the real ones. `will-change` gives it its own layer,
 * rastered once per syllable, not on every frame of the sweep beside it.
 */
const SWEEP_LAYER_STYLE: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  bottom: 0,
  display: 'flex',
  alignItems: 'center',
  color: 'transparent',
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  userSelect: 'none',
  willChange: 'transform',
}

interface LyricLineProps {
  line: SongLine
  activeSyllableIndex?: number
  /** A plain number (tests, static previews) or a MotionValue for the per-frame sweep, which writes the style without a React render. */
  progress?: number | MotionValue<number>
  variant?: 'current' | 'next'
  /**
   * A further upper bound on this line's size, as a CSS length.
   *
   * LyricBox passes the current line's own fitted size, scaled by
   * PREVIEW_SIZE_RATIO, to the preview -- see lyricFit.ts for why fitting the
   * two rows independently inverts the hierarchy on a long line.
   */
  sizeCeiling?: string
  /** The singer's colour: sung words and the sweep take it. Golden notes stay gold. */
  accentColor?: string
}

export function LyricLine({
  line,
  activeSyllableIndex = -1,
  progress = 0,
  variant = 'current',
  sizeCeiling,
  accentColor: accentColorProp,
}: LyricLineProps) {
  // Never a blank stop: an empty or invalid colour drops the whole gradient,
  // and the sweep would paint nothing but its shadow.
  const accentColor = lyricAccent(accentColorProp)
  const isNext = variant === 'next'
  const typeClass = isNext ? NEXT_LINE_TYPE_CLASS : CURRENT_LINE_TYPE_CLASS
  const fit = lyricFitFontSize(
    isNext ? LYRIC_NEXT_FONT : LYRIC_CURRENT_FONT,
    isNext ? LYRIC_NEXT_FLOOR : LYRIC_CURRENT_FLOOR,
    lyricLineSpanEm(line),
    ...(sizeCeiling ? [sizeCeiling] : []),
  )

  return (
    <div
      data-testid="lyric-line"
      data-variant={variant}
      // No wrapping: the fit only holds the row if the line cannot wrap, and
      // nothing clips it, so the only thing that gives is point size.
      className={`${typeClass} whitespace-nowrap`}
      style={{
        ['--lyric-fit' as string]: fit,
        fontSize: 'var(--lyric-fit)',
        lineHeight: LYRIC_LINE_HEIGHT,
        color: isNext ? NEXT_LINE_COLOR : undefined,
        textShadow: LYRIC_TEXT_SHADOW,
      }}
    >
      {line.notes.map((note, index) => {
        const isActive = variant === 'current' && index === activeSyllableIndex
        const accent = note.kind === 'golden' || note.kind === 'goldenRap' ? tokens.accent.gold : accentColor

        if (variant === 'current' && isActive) {
          // Sub-word sweep, party-karaoke-style: a hard-stop gradient at --progress
          // fills the sung part of the syllable in the singer's colour, the
          // rest bright white. Only --progress changes per frame, so the span
          // carries no shadow to re-rasterise; its dark halo and the original
          // 44px glow sit on static copies below and above it. The glow on top
          // is the original look: Chromium painted the sweep's own text-shadow
          // over its clipped gradient, so the bloom washes over the letters.
          const style = {
            '--progress': progress,
            backgroundImage: lyricSweepGradient(accent, UNSUNG_COLOR),
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            color: 'transparent',
            WebkitTextFillColor: 'transparent',
            textShadow: 'none',
            borderBottom: `5px solid ${accent}`,
            paddingBottom: '4px',
          } as CSSProperties

          return (
            // `isolation` keeps the halo's z-index -1 inside this syllable:
            // behind the sweep, never behind the lyric box's scrim.
            <span key={index} data-testid="lyric-active-syllable" style={{ position: 'relative', isolation: 'isolate' }}>
              <span
                aria-hidden
                data-testid="lyric-active-halo"
                style={{ ...SWEEP_LAYER_STYLE, zIndex: -1, textShadow: LYRIC_TEXT_SHADOW }}
              >
                {note.syllable}
              </span>
              <motion.span data-note-kind={note.kind} data-active style={style}>
                {note.syllable}{' '}
              </motion.span>
              <span
                aria-hidden
                data-testid="lyric-active-glow"
                style={{ ...SWEEP_LAYER_STYLE, zIndex: 1, textShadow: lyricGlowShadow(accent) }}
              >
                {note.syllable}
              </span>
            </span>
          )
        }

        // Already sung: the singer's colour. Still to come: bright white.
        const sung = variant === 'current' && activeSyllableIndex >= 0 && index < activeSyllableIndex
        const style: CSSProperties = variant === 'current' ? { color: sung ? accent : UNSUNG_COLOR } : {}

        return (
          <span key={index} data-note-kind={note.kind} style={style}>
            {note.syllable}{' '}
          </span>
        )
      })}
    </div>
  )
}
