import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { SongChart } from '../../contracts/types'
import { useSongGain } from '../../audio/useSongGain'
import { SONGLOAD_PREFIX, logSongLoad, logSongLoadError } from '../../diagnostics/log'
import { GlassErrorState } from '../../design/primitives/GlassErrorState'
import { useT } from '../../i18n'
import { AmbientFallback } from './AmbientFallback'
import { isNativelyPlayableVideo } from './isNativelyPlayableVideo'
import { resolveBackgroundUrl, resolveCoverUrl, resolveExactMediaPath, resolveMediaPath } from './resolveMediaPath'
import { planStemPlayback } from './stemPlan'
import { useStemAudio } from './useStemAudio'

interface StageMediaProps {
  chart: SongChart
  sourceDir: string
  /** The single authoritative timing element. Whatever `src` it ends up with, this ref is the clock. */
  audioRef?: RefObject<HTMLAudioElement | null>
  /** The separated guide vocal, when the chart ships stems. Null-ref on every ordinary song. */
  vocalStemRef?: RefObject<HTMLAudioElement | null>
  videoRef?: RefObject<HTMLVideoElement | null>
  /** Told which plan was chosen, so Stage knows whether to run the ducking loop. */
  onStemPlan?: (usingStems: boolean) => void
  /** True once the clock element has started playing — gates the one clock swap the plan allows. */
  playbackStarted?: boolean
  /** Notified when the active clock audio URL changes (e.g. Stem fallback to mix) */
  onClockUrlChange?: (url: string | null) => void
  /** Called when all audio clock sources are completely unreadable */
  onFatalError?: () => void
}

/** Video (or the ambient fallback) behind the glass UI, plus the always-present audio element the timing clock reads from. */
export function StageMedia({
  chart,
  sourceDir,
  audioRef,
  vocalStemRef,
  videoRef,
  onStemPlan,
  playbackStarted = false,
  onClockUrlChange,
  onFatalError,
}: StageMediaProps) {
  const t = useT()
  const { meta } = chart
  const mixUrl = resolveMediaPath(sourceDir, meta.mp3Path)
  // Stems resolve *exactly*: see resolveExactMediaPath. A missing stem must
  // resolve to nothing, never to the neighbouring full mix.
  const vocalsUrl = resolveExactMediaPath(sourceDir, meta.vocalsPath)
  const instrumentalUrl = resolveExactMediaPath(sourceDir, meta.instrumentalPath)

  /**
   * Loudness normalisation (see src/audio/loudness.ts).
   *
   * `sourceDir` is the song's own folder, which is exactly its primary key in
   * the library index, so the gain is looked up here rather than threaded down
   * as a prop from four screens away. It is a plain number written to
   * `element.volume` -- no Web Audio graph on the clock element, nothing on the
   * audio path, and nothing per frame.
   */
  const [vocalStemFailed, setVocalStemFailed] = useState(false)
  /** Every clock URL that has failed to load; none is ever offered again (see stemPlan). */
  const [failedClockUrls, setFailedClockUrls] = useState<ReadonlySet<string>>(() => new Set())
  const songGain = useSongGain(sourceDir, meta.volume, { mediaUrl: mixUrl })
  const plan = planStemPlayback({ mixUrl, vocalsUrl, instrumentalUrl, vocalStemFailed, failedClockUrls, playbackStarted })
  const audioUrl = plan.clockUrl
  /**
   * The guide vocal's own level: the same normalisation, through the mixer's
   * guide-vocal channel, so that fader actually moves the stem.
   */
  const guideVolume = useSongGain(sourceDir, meta.volume, { channel: 'guideVocals', mediaUrl: mixUrl ?? audioUrl })

  useEffect(() => {
    onClockUrlChange?.(audioUrl)
  }, [audioUrl, onClockUrlChange])

  // Attempt the video whenever the chart tags one, even if the tag's own
  // extension isn't decodable: the app-media handler substitutes a
  // transcoded .mp4/.webm sibling when one exists, so a user can drop a
  // converted file next to an .mpg without editing the #VIDEO tag. If it
  // genuinely can't play, onError below degrades to the ambient cover --
  // a broken video must never blank the stage.
  const hasPlayableVideo = isNativelyPlayableVideo(meta.videoPath)
  const videoUrl = meta.videoPath ? resolveMediaPath(sourceDir, meta.videoPath) : null
  const coverUrl = resolveCoverUrl(sourceDir, meta)
  const backgroundUrl = resolveBackgroundUrl(sourceDir, meta)
  const [videoFailed, setVideoFailed] = useState(false)

  /**
   * The `<audio>` element is the *only* sound source on this stage. Karaoke
   * videos routinely carry the studio recording on their own audio track,
   * which would play as a second, drifting copy of the song.
   *
   * Muted three ways on purpose. `muted` as a JSX prop is a React *property*
   * write, and the `muted` content attribute (which is what a freshly-created
   * element consults for its initial state) is deliberately not reflected by
   * React -- so a video element re-created by a `src` swap or a codec
   * fallback could come back audible for the frames before React's property
   * write lands. Setting the attribute, the property and the volume in one
   * ref callback closes that window; `volume = 0` is the belt-and-braces
   * third, since nothing in this app ever unmutes a video.
   */
  const attachVideo = useCallback(
    (element: HTMLVideoElement | null) => {
      if (videoRef) (videoRef as { current: HTMLVideoElement | null }).current = element
      if (!element) return
      element.setAttribute('muted', '')
      element.defaultMuted = true
      element.muted = true
      element.volume = 0
    },
    [videoRef],
  )

  /**
   * The clock element, plus the normalisation gain, in one attach point.
   *
   * Same shape and the same reason as `attachVideo` below: the element is
   * re-created whenever its `src` changes (the `key`), and a freshly-created
   * `<audio>` starts at `volume === 1`. Setting the gain in the ref callback is
   * what closes the window between that element existing and an effect getting
   * round to it -- which, on a song measured 12 dB hot, is the difference
   * between a normalised song and a burst of the un-normalised one.
   */
  const clockElementRef = useRef<HTMLAudioElement | null>(null)
  /** The stem element, whether or not the caller asked to see it. */
  const ownStemRef = useRef<HTMLAudioElement | null>(null)
  const stemRef = vocalStemRef ?? ownStemRef
  // The guide vocal follows the clock, ducks under a singer who is landing
  // notes, and rides its own mixer channel. Inert unless the plan uses stems.
  useStemAudio({ clockRef: clockElementRef, stemRef, enabled: plan.usingStems, guideVolume })
  // Read through a ref rather than closed over, so this callback keeps a stable
  // identity. A ref callback whose identity changes is detached and re-attached
  // by React -- old(null), then new(element) -- and the one thing that must
  // never look momentarily absent is the element the whole game reads its clock
  // from.
  const songGainRef = useRef(songGain)
  songGainRef.current = songGain
  const attachClock = useCallback(
    (element: HTMLAudioElement | null) => {
      clockElementRef.current = element
      if (audioRef) (audioRef as { current: HTMLAudioElement | null }).current = element
      if (element) element.volume = songGainRef.current
    },
    [audioRef],
  )

  // The measurement arrives one IPC round trip after mount on a song that has
  // not been played this session, which is normally still long before the first
  // sample (the element is loading its source, and the stage has its own start
  // gate) -- but "normally" is not "always", so the gain is re-applied the
  // moment it resolves rather than only at attach time.
  useEffect(() => {
    const element = clockElementRef.current
    if (element) element.volume = songGain
  }, [songGain, audioUrl])

  // A new song gets a fresh chance at its video and its stems.
  useEffect(() => {
    setVideoFailed(false)
  }, [videoUrl])
  useEffect(() => {
    setVocalStemFailed(false)
    setFailedClockUrls(new Set())
  }, [mixUrl, vocalsUrl, instrumentalUrl])

  useEffect(() => {
    onStemPlan?.(plan.usingStems)
  }, [plan.usingStems, onStemPlan])

  // The last step of the load trace: exactly which URLs the <audio>/<video>
  // elements were handed. An empty/absent #MP3 tag resolves to null here,
  // which means no <audio> element at all -- and with no audio there is no
  // clock, so the stage sits in its countdown forever. That is invisible
  // without this line.
  useEffect(() => {
    logSongLoad('media:resolved', {
      sourceDir,
      mp3Tag: meta.mp3Path || '(empty)',
      vocalsTag: meta.vocalsPath ?? null,
      instrumentalTag: meta.instrumentalPath ?? null,
      usingStems: plan.usingStems,
      audioUrl,
      vocalStemUrl: plan.vocalStemUrl,
      videoTag: meta.videoPath ?? null,
      videoNativelyPlayable: hasPlayableVideo,
      videoUrl,
      coverUrl,
      backgroundUrl,
    })
    if (!audioUrl) {
      logSongLoadError('media:resolved', new Error('No audio URL — this chart has no usable #AUDIO/#MP3 tag, so playback has no clock source.'), { sourceDir })
    }
  }, [sourceDir, meta.mp3Path, meta.videoPath, meta.vocalsPath, meta.instrumentalPath, audioUrl, videoUrl, coverUrl, backgroundUrl, hasPlayableVideo, plan.usingStems, plan.vocalStemUrl])

  // Only once every candidate clock source is exhausted is this fatal --
  // losing the clock is losing gameplay, so the plan gets to try the
  // alternatives first, each at most once.
  if (failedClockUrls.size > 0 && !audioUrl) {
    return (
      <div className="absolute inset-0 bg-black flex z-50">
        <GlassErrorState
          title={t('sing.mediaError.title')}
          message={t('sing.mediaError.message')}
          actionLabel={onFatalError ? t('sing.mediaError.action') : undefined}
          onAction={onFatalError}
        />
      </div>
    )
  }

  return (
    <div className="absolute inset-0 bg-black">
      {/* The #BACKGROUND image (else the blurred cover, else a tinted
          gradient) is always the base layer, with video painted over it when
          there is one. That way a missing or undecodable video (UltraStar
          libraries are full of MPEG-2 .mpg, and of #VIDEO tags naming files
          that were never copied) degrades to a picture with no flash of empty
          black, and never blanks the stage. */}
      <div data-testid="stage-ambient-fallback">
        <AmbientFallback backgroundUrl={backgroundUrl} coverUrl={coverUrl} />
      </div>
      {videoUrl && !videoFailed && (
        <video
          ref={attachVideo}
          src={videoUrl}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
          preload="auto"
          onError={(event) => {
            // Non-fatal, so not a crash: audio is the clock source, video is
            // decoration, and the background takes its place.
            logVideoUnavailable(event.currentTarget)
            setVideoFailed(true)
          }}
        />
      )}
      {audioUrl && (
        <audio
          key={audioUrl}
          ref={attachClock}
          src={audioUrl}
          data-testid="stage-clock-audio"
          preload="auto"
          onError={(event) => {
            logMediaElementError(event.currentTarget)
            const failedUrl = audioUrl
            setFailedClockUrls((previous) =>
              previous.has(failedUrl) ? previous : new Set([...previous, failedUrl]),
            )
          }}
        />
      )}
      {plan.vocalStemUrl && (
        <audio
          key={plan.vocalStemUrl}
          ref={stemRef}
          src={plan.vocalStemUrl}
          data-testid="stage-vocal-stem-audio"
          preload="auto"
          onError={(event) => {
            logMediaElementError(event.currentTarget)
            // Never fatal, and never allowed to take the clock down with it:
            // the plan degrades to a single element instead.
            setVocalStemFailed(true)
          }}
        />
      )}
    </div>
  )
}

/** A video that will not load (missing file, unplayable codec) is expected in real libraries: a warning, not a crash. */
function logVideoUnavailable(element: HTMLMediaElement) {
  console.warn(`${SONGLOAD_PREFIX} media:video-unavailable -- showing the background instead`, {
    src: element.currentSrc || element.src,
    mediaError: element.error?.message ?? null,
    mediaErrorCode: element.error?.code ?? null,
  })
}

function logMediaElementError(element: HTMLMediaElement) {
  logSongLoadError('media:element-error', new Error('A <video>/<audio> element failed to load its source'), {
    src: element.currentSrc || element.src,
    mediaError: element.error?.message ?? null,
    mediaErrorCode: element.error?.code ?? null,
  })
}
