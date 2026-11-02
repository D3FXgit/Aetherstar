// Shown while a song's chart and media load, between the countdown and the stage.
import { motion } from 'framer-motion'
import { useT } from '../i18n'
import { tokens } from '../design/tokens'
import { CARD_STYLE, SESSION_COLORS, TEXT, displayType } from './sessionTheme'

interface SongLoadingScreenProps {
  title?: string
  artist?: string
  coverUrl?: string
  statusMessage?: string
}

export function SongLoadingScreen({ title, artist, coverUrl, statusMessage }: SongLoadingScreenProps) {
  const t = useT()
  const shownTitle = title ?? t('songLoading.title')
  return (
    <div
      data-testid="song-loading-screen"
      role="status"
      aria-label={t('songLoading.label', { title: shownTitle })}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ background: SESSION_COLORS.ground, color: TEXT.primary }}
    >
      <div
        className="relative z-10 flex w-full max-w-lg flex-col items-center gap-6 p-10 text-center"
        style={CARD_STYLE}
      >
        {coverUrl && (
          <div className="relative size-36 shrink-0 overflow-hidden rounded-[24px]">
            <img src={coverUrl} alt={t('songLoading.cover')} data-testid="song-loading-cover" className="size-full object-cover" />
          </div>
        )}

        <div className="flex flex-col items-center gap-1.5">
          <h1 className="line-clamp-1" style={displayType(32, { fontSize: '1.75rem' })}>
            {shownTitle}
          </h1>
          {artist && <p style={{ fontWeight: 700, color: TEXT.secondary }}>{artist}</p>}
        </div>

        <div className="mt-2 flex w-full flex-col items-center gap-3">
          <div className="relative h-2 w-48 overflow-hidden rounded-full" style={{ background: SESSION_COLORS.raised }}>
            <motion.div
              className="absolute bottom-0 top-0 w-24 rounded-full"
              style={{ background: tokens.accent.cyan }}
              animate={{ left: ['-50%', '100%'] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
            />
          </div>
          <p className="text-sm" style={{ fontWeight: 600, color: TEXT.tertiary }}>
            {statusMessage ?? t('songLoading.status')}
          </p>
        </div>
      </div>
    </div>
  )
}
