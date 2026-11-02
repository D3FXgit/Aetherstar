// The selector's preview well. Cover art is always the base layer and video is
// painted over it; a video Chromium cannot decode (old .mpg/.avi) is removed,
// leaving the cover rather than a black box.
import { useEffect, useState, type CSSProperties } from 'react'
import { useReducedMotion } from 'framer-motion'
import { logSongLoadError } from '../diagnostics/log'
import { useT } from '../i18n'

interface SongPreviewMediaProps {
  /** Already wrapped as an `aetherstar-media://` URL, or null when the song tags no video. */
  videoUrl: string | null
  /** Already wrapped as an `aetherstar-media://` URL, or null when the song has no cover. */
  coverUrl: string | null
  className?: string
  /**
   * Size and radius, when the caller draws this at a resolution-scaled size.
   * The 22px radius below is the 1080p value; a caller working in
   * design units passes the scaled equivalent here, and inline wins over the
   * class either way.
   */
  style?: CSSProperties
}

export function SongPreviewMedia({ videoUrl, coverUrl, className = '', style }: SongPreviewMediaProps) {
  const t = useT()
  const [videoFailed, setVideoFailed] = useState(false)
  const reduceMotion = useReducedMotion()

  // Belt and braces with the `key={song.path}` remount at the call site: a
  // rerender that only swaps the src must still give the new song a fresh
  // attempt at its own video.
  useEffect(() => {
    setVideoFailed(false)
  }, [videoUrl])

  // Undecodable extensions are attempted rather than filtered out: the
  // aetherstar-media:// handler (electron/protocols.cjs) substitutes a
  // transcoded .mp4/.webm sibling when the user has dropped one next to the
  // .mpg, so the only honest test of "can this play" is trying it.
  //
  // Reduce Motion is the one case where a perfectly playable video is skipped:
  // an unprompted loop in the periphery of a browse screen is the automatic,
  // repetitive motion the setting exists to suppress, and the cover is the same
  // artwork holding still.
  const showVideo = videoUrl !== null && !videoFailed && !reduceMotion

  return (
    <div
      className={`relative overflow-hidden rounded-[22px] border border-white/[.14] bg-white/[.06] ${className}`}
      style={style}
      data-testid="song-preview-media"
    >
      {coverUrl ? (
        <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" data-testid="song-preview-cover" />
      ) : (
        !showVideo && (
          <span
            className="absolute inset-0 flex items-end p-4 text-[14px] text-[var(--ae-text-tertiary)]"
            data-testid="song-preview-empty"
          >
            {t('songSelect.preview.noCover')}
          </span>
        )
      )}
      {showVideo && (
        <video
          src={videoUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          data-testid="song-preview-video"
          onError={(event) => {
            const element = event.currentTarget as HTMLVideoElement
            logSongLoadError('preview:video', new Error('The song-preview <video> failed to load its source'), {
              src: element.currentSrc || element.src,
              mediaError: element.error?.message ?? null,
              mediaErrorCode: element.error?.code ?? null,
            })
            // Non-fatal by design -- the cover underneath becomes the preview.
            setVideoFailed(true)
          }}
        />
      )}
    </div>
  )
}
