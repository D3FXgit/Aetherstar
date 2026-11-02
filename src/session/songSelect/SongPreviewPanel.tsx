// The selected song: media, details, records and the commit buttons.
import { motion, useReducedMotion } from 'framer-motion'
import { useT } from '../../i18n'
import { SongPreviewMedia } from '../../library/SongPreviewMedia'
import type { LibrarySong } from '../../library/types'
import { tokens } from '../../design/tokens'
import type { LeaderboardEntry } from '../types'
import { SongHighscores } from './SongHighscores'
import { ACCENT_CYAN, ACCENT_GOLD, SURFACE, TEXT, formatDuration, mediaUrl, metaChipStyle, u } from './layout'

interface SongPreviewPanelProps {
  selected: LibrarySong | null
  isFavorite: boolean
  /** Jukebox mode: "Play now" and "Add to queue" instead of "Start singing", and no records. */
  jukebox: boolean
  highscores: LeaderboardEntry[]
  players: { id: string; name: string }[]
  onStart: () => void
  onToggleFavorite: () => void
  onAddToQueue: () => void
}

const secondaryButtonClass = 'transition-colors duration-150 hover:bg-[var(--ae-surface-hover,#2a2638)]'

export function SongPreviewPanel({
  selected,
  isFavorite,
  jukebox,
  highscores,
  players,
  onStart,
  onToggleFavorite,
  onAddToQueue,
}: SongPreviewPanelProps) {
  const t = useT()
  const reduceMotion = useReducedMotion()

  const secondaryButtonStyle = {
    padding: `${u(14)} ${u(18)}`,
    borderRadius: u(14),
    fontSize: u(18),
    fontWeight: 600,
    background: SURFACE.raised,
    border: `1px solid ${SURFACE.line}`,
    color: TEXT.primary,
  }

  return (
    <div
      className="flex flex-col self-start"
      style={{
        width: u(400),
        maxHeight: '100%',
        padding: u(26),
        borderRadius: u(28),
        background: SURFACE.panel,
        border: `1px solid ${SURFACE.line}`,
      }}
      data-testid="song-preview-panel"
    >
      {selected ? (
        <>
          {/* Keyed on the song: a new selection gets a new element, so no frame of the previous one survives. */}
          <SongPreviewMedia
            key={selected.path}
            videoUrl={selected.hasVideo && selected.videoPath ? mediaUrl(selected.videoPath) : null}
            coverUrl={selected.thumbnailPath ? mediaUrl(selected.thumbnailPath) : null}
            className="w-full shrink"
            style={{ height: u(300), minHeight: u(150), borderRadius: u(20) }}
          />
          {/* One motion node for the caption; a distinct key from the media's, or React keeps both videos mounted. */}
          <motion.div
            key={`${selected.path}#caption`}
            className="flex min-h-0 flex-col"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
          >
            <div className="flex flex-col" style={{ marginTop: u(22), gap: u(6) }}>
              <h2 style={{ fontSize: u(38), fontWeight: 700, lineHeight: 1.08, color: TEXT.primary }}>{selected.title}</h2>
              <p style={{ fontSize: u(24), fontWeight: 500, lineHeight: 1.2, color: TEXT.secondary }}>{selected.artist}</p>
            </div>
            <div className="flex flex-wrap items-center" style={{ marginTop: u(18), gap: u(10) }}>
              <span style={metaChipStyle}>{formatDuration(selected.durationMs)}</span>
              {selected.isDuet && <span style={metaChipStyle}>{t('songSelect.meta.duet')}</span>}
              {selected.hasVideo && <span style={metaChipStyle}>{t('songSelect.meta.video')}</span>}
              {selected.language && <span style={metaChipStyle}>{selected.language}</span>}
            </div>
            {!jukebox && <SongHighscores entries={highscores} players={players} />}
          </motion.div>
          <div className="flex flex-col" style={{ marginTop: u(22), gap: u(10) }}>
            <button
              type="button"
              onClick={onStart}
              disabled={!selected.isPlayable}
              className="transition-[filter] duration-150 enabled:hover:brightness-110"
              style={{
                padding: u(18),
                borderRadius: u(16),
                fontSize: u(22),
                fontWeight: 700,
                textAlign: 'center',
                // The one saturated surface on the screen; a disabled one goes quiet.
                ...(selected.isPlayable
                  ? { background: ACCENT_CYAN, color: '#06121a' }
                  : { background: SURFACE.raised, border: `1px solid ${SURFACE.line}`, color: TEXT.tertiary }),
              }}
            >
              {!selected.isPlayable
                ? t('songSelect.start.unplayable')
                : jukebox
                  ? t('songSelect.jukebox.playNow')
                  : t('songSelect.start.sing')}
            </button>
            <div className="flex" style={{ gap: u(10) }}>
              {jukebox && selected.isPlayable && (
                <button type="button" onClick={onAddToQueue} className={`flex-1 ${secondaryButtonClass}`} style={secondaryButtonStyle}>
                  {t('songSelect.jukebox.addToQueue')}
                </button>
              )}
              <button
                type="button"
                aria-pressed={isFavorite}
                onClick={onToggleFavorite}
                className={`flex flex-1 items-center justify-center ${secondaryButtonClass}`}
                style={{ ...secondaryButtonStyle, gap: u(8) }}
              >
                <span aria-hidden="true" style={{ color: isFavorite ? ACCENT_GOLD : TEXT.tertiary }}>
                  {isFavorite ? '★' : '☆'}
                </span>
                {t('songSelect.favorite.label')}
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="m-auto" style={{ fontSize: u(20), color: TEXT.secondary, fontFamily: tokens.fontStack }}>
          {t('songSelect.empty.noMatches')}
        </p>
      )}
    </div>
  )
}
