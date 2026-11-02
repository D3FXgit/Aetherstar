// One of the mystery songs on offer, as a gallery card: the whole cover, then
// title, artist, the facts the library knows (length, duet, video, language,
// edition) and the song's record. Focus or a resting pointer previews it;
// click (or A) picks it; double-click starts straight away.
//
// Its width comes from the gallery (`--party-card-w`, see galleryLayout.ts)
// and its caption has a fixed height, so the card can never be taller than
// the band it sits in: the cover is a square exactly as wide as the card.
import { motion, useReducedMotion } from 'framer-motion'
import type { CSSProperties } from 'react'
import { useT } from '../../i18n'
import type { LibrarySong } from '../../library/types'
import { toLibraryMediaUrl } from '../../library/mediaUrl'
import { du } from '../../scenes/designUnits'
import { PRESS_SCALE, pressMotion } from '../../design/motion'
import type { LeaderboardEntry } from '../types'
import { SESSION_COLORS, TEXT, colorChipStyle, displayType } from '../sessionTheme'
import { CARD_INFO_HEIGHT } from './galleryLayout'

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

/** One line, ellipsised: every caption row has a fixed line box, so the caption height is known. */
const ONE_LINE: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

interface PartySongCardProps {
  song: LibrarySong
  index: number
  selected: boolean
  /** The drawn singer's colour the selection is painted in. */
  accentColor: string
  /** The song's record, null for none yet, undefined while it loads. */
  best: LeaderboardEntry | null | undefined
  /** Display name of the record holder. */
  bestHolder: string | null
  onSelect: () => void
  onQuickStart: () => void
  onPreviewIntent: () => void
  onFocusPreview: () => void
}

export function PartySongCard({
  song,
  index,
  selected,
  accentColor,
  best,
  bestHolder,
  onSelect,
  onQuickStart,
  onPreviewIntent,
  onFocusPreview,
}: PartySongCardProps) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const onColor = selected ? SESSION_COLORS.ink : TEXT.primary
  const chip = (extra?: CSSProperties): CSSProperties => ({
    fontWeight: 700,
    fontSize: `max(0.75rem, ${du(14)})`,
    lineHeight: 1.1,
    padding: `${du(5)} ${du(12)}`,
    borderRadius: '999px',
    whiteSpace: 'nowrap',
    background: selected ? 'rgba(18, 17, 24, 0.16)' : SESSION_COLORS.raised,
    color: selected ? SESSION_COLORS.ink : TEXT.secondary,
    fontVariantNumeric: 'tabular-nums',
    ...extra,
  })
  const facts = [
    formatDuration(song.durationMs),
    song.isDuet ? t('party.songs.duet') : null,
    song.hasVideo ? t('party.songs.video') : null,
    song.language || null,
    song.edition || null,
  ].filter((fact): fact is string => Boolean(fact))

  const record =
    best === undefined
      ? ' '
      : best === null
        ? t('party.songs.noBest')
        : t('party.songs.best', { score: best.score.toLocaleString(), name: bestHolder ?? t('party.unknownPlayer') })

  return (
    <motion.button
      type="button"
      aria-pressed={selected}
      initial={reduceMotion ? false : { opacity: 0, y: 20, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.25, delay: reduceMotion ? 0 : index * 0.06 }}
      // The shared press feel, with its own spring so it does not inherit the deal's stagger delay.
      whileHover={reduceMotion ? undefined : { scale: PRESS_SCALE.hover, transition: pressMotion.transition }}
      whileTap={reduceMotion ? undefined : { scale: PRESS_SCALE.tap, transition: pressMotion.transition }}
      onClick={onSelect}
      onDoubleClick={onQuickStart}
      onMouseEnter={onPreviewIntent}
      onFocus={onFocusPreview}
      className="flex flex-none flex-col overflow-hidden text-left"
      style={{
        width: 'var(--party-card-w)',
        borderRadius: du(24),
        background: selected ? accentColor : SESSION_COLORS.surface,
        color: onColor,
        cursor: 'pointer',
        border: 'none',
        padding: 0,
        // A ring in the singer's colour, so the pick reads from the sofa even
        // with a pale cover. Inside the gallery's padding, never clipped.
        boxShadow: selected ? `0 0 0 ${du(5)} ${accentColor}` : 'none',
        transitionProperty: 'background-color, box-shadow',
        transitionDuration: reduceMotion ? '0ms' : '150ms',
      }}
      data-testid={`party-song-card-${index}`}
      data-selected={selected}
    >
      {/* The cover: a square as wide as the card, so all of it is always on screen. */}
      <div
        data-testid={`party-song-cover-${index}`}
        className="relative w-full flex-none overflow-hidden"
        style={{ aspectRatio: '1 / 1', background: SESSION_COLORS.raised }}
      >
        {song.thumbnailPath ? (
          <img
            src={toLibraryMediaUrl(song.thumbnailPath)}
            alt=""
            decoding="async"
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center"
            style={{ ...displayType(72), color: TEXT.tertiary }}
          >
            ♪
          </span>
        )}
      </div>

      <div
        data-testid={`party-song-info-${index}`}
        className="flex w-full flex-none flex-col overflow-hidden"
        style={{ height: CARD_INFO_HEIGHT, padding: `max(0.5rem, ${du(14)}) max(0.75rem, ${du(18)})`, gap: `max(0.25rem, ${du(4)})` }}
      >
        <h3 style={{ ...displayType(22, { fontWeight: 800, lineHeight: 1.2 }), ...ONE_LINE }}>{song.title}</h3>
        <p style={{ fontSize: `max(0.875rem, ${du(16)})`, lineHeight: 1.25, fontWeight: 600, opacity: 0.78, ...ONE_LINE }}>
          {song.artist}
        </p>
        <div className="flex items-center overflow-hidden" style={{ gap: du(6) }} data-testid={`party-song-facts-${index}`}>
          {facts.map((fact, factIndex) => (
            <span key={`${fact}-${factIndex}`} style={chip({ flexShrink: factIndex === 0 ? 0 : 1, overflow: 'hidden', textOverflow: 'ellipsis' })}>
              {fact}
            </span>
          ))}
        </div>
        <div className="mt-auto flex items-center justify-between" style={{ gap: du(8) }}>
          <span
            data-testid={`party-song-best-${index}`}
            style={{ fontSize: `max(0.8125rem, ${du(15)})`, lineHeight: 1.3, fontWeight: 700, opacity: 0.8, ...ONE_LINE }}
          >
            {record}
          </span>
          {selected && (
            <span style={colorChipStyle(SESSION_COLORS.ink, { color: accentColor, flexShrink: 0 })}>
              {t('party.songs.selected')}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  )
}
