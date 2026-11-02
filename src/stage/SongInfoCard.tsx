import { useEffect, useState, type RefObject } from 'react'
import type { SongMeta } from '../contracts/types'
import { useT } from '../i18n'

// A glanceable corner chip, capped against the viewport in both axes. Solid
// scrim, no backdrop blur: it sits over playing video for the whole song.
const CARD_CLASS =
  'flex items-center gap-4 rounded-[26px] border border-white/15 bg-black/65 px-5 py-3 max-w-[min(30rem,38vw)] min-w-0'

/**
 * The cover thumb's size, clamped on the container so the image's own pixel
 * size (UltraStar covers are often 3000px) can never influence layout.
 */
const COVER_CLASS =
  'size-[clamp(2.75rem,3.95vw,4.75rem)] shrink-0 overflow-hidden rounded-[18px] border border-white/15 bg-white/10'

// Seconds are all this line shows, so a 500ms poll is enough; the per-frame
// stage clock stays out of React.
const CLOCK_TICK_MS = 500

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

interface SongInfoCardProps {
  meta: SongMeta
  /** Already resolved by the caller the same way StageMedia resolves it (`resolveMediaPath(sourceDir, meta.coverPath)`). */
  coverUrl: string | null
  /** The song's audio element -- the same one the timing clock reads, so elapsed time can never disagree with playback. */
  audioRef: RefObject<HTMLAudioElement | null>
}

/** Top-left "what am I singing" card: cover art, title, and `artist · BPM · elapsed / duration`. */
export function SongInfoCard({ meta, coverUrl, audioRef }: SongInfoCardProps) {
  const t = useT()
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => {
      const audio = audioRef.current
      if (!audio) return
      // Floored, so identical values bail out: one render per displayed second.
      setElapsedSeconds(Math.floor(audio.currentTime))
      setDurationSeconds(Number.isFinite(audio.duration) && audio.duration > 0 ? Math.floor(audio.duration) : null)
    }
    tick()
    const interval = setInterval(tick, CLOCK_TICK_MS)
    return () => clearInterval(interval)
  }, [audioRef])

  // The cover URL that failed to load, if any (a new song gets a fresh try).
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null)
  const showCover = coverUrl !== null && coverUrl !== failedCoverUrl

  // Until the element has metadata, the elapsed time is shown alone.
  const timeLabel = durationSeconds
    ? `${formatClock(elapsedSeconds)} / ${formatClock(durationSeconds)}`
    : formatClock(elapsedSeconds)

  return (
    <div data-testid="song-info-card" className={CARD_CLASS}>
      {/* No picture, no box: an empty dark square reads as something broken. */}
      {showCover && (
        <div data-testid="song-info-cover-thumb" className={COVER_CLASS}>
          <img
            data-testid="song-info-cover"
            src={coverUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setFailedCoverUrl(coverUrl)}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-1">
        <div
          data-testid="song-info-title"
          className="truncate font-bold tracking-[-0.02em] text-[var(--ae-text-primary)] text-[clamp(1.1rem,1.8vw,2.125rem)] leading-tight"
          style={{ textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}
        >
          {meta.title}
        </div>
        <div
          data-testid="song-info-meta"
          className="truncate font-medium tabular-nums text-[var(--ae-text-secondary)] text-[clamp(0.75rem,0.95vw,1.125rem)]"
          style={{ textShadow: '0 1px 3px rgba(0,0,0,0.85)' }}
        >
          {t('sing.songCard.meta', { artist: meta.artist, bpm: Math.round(meta.bpm), time: timeLabel })}
        </div>
      </div>
    </div>
  )
}
