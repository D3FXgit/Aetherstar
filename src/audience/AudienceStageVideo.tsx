import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import type { SongMeta } from '../contracts/types'
import { AmbientFallback } from '../stage/media/AmbientFallback'
import { resolveMediaPath } from '../stage/media/resolveMediaPath'
import {
  computeVideoPlaybackRate,
  createVideoSeekTracker,
  shouldHardSeekVideo,
  videoTargetMs,
} from '../stage/timing/driftCorrection'
import { playbackPositionMs } from './useAudienceStageClock'
import type { AudiencePlayback } from './types'

/**
 * The song's video, behind the audience display.
 *
 * ---------------------------------------------------------------------------
 * THE ONE ABSOLUTE RULE: this window makes no sound, ever
 *
 * The second screen is a screen, not a second speaker. Karaoke videos routinely
 * carry the studio recording on their own audio track, so an unmuted `<video>`
 * here would play the whole song a second time, out of phase, out of the
 * television.
 *
 * It is muted four ways, and every one of them is load-bearing:
 *
 *   - the `muted` **attribute**, set through the ref. React treats `muted` as a
 *     *property* and deliberately does not reflect the content attribute -- and
 *     the content attribute is what a freshly-created element consults for its
 *     initial state. An element re-created by a `src` swap would otherwise be
 *     audible for the frames before React's property write lands.
 *   - `defaultMuted`, which is that attribute's IDL alias, so a `load()` (which
 *     resets the element to its defaults) cannot un-mute it.
 *   - the `muted` **property**, the live state.
 *   - `volume = 0`, belt and braces: nothing in this window ever un-mutes a
 *     video, so there is no reason for the gain to be anything else.
 *
 * This is exactly the treatment `StageMedia.attachVideo` gives the host's video,
 * copied deliberately rather than adapted -- the singer view has the same
 * problem and solved it, and two different answers to "how is a video muted"
 * would be one answer too many.
 *
 * ---------------------------------------------------------------------------
 * Two decodes of one file
 *
 * There is now a second decode of the song's video, in a second process, and it
 * is not frame-locked to the host's. That is the right trade for a *backdrop*:
 * nothing in the room is reading it against anything, unlike the lyrics (which
 * are frame-exact because they come from the same chart and the same clock) or
 * the notes (which are within a frame of the host because they run off the same
 * anchor). What it must not do is be visibly *wrong* -- a chorus playing over
 * the wrong verse -- so it is kept within a few hundred milliseconds by the same
 * two-part policy the host uses on its own video:
 *
 *   - a **seek** when it is more than `SEEK_THRESHOLD_MS` out, which is how it
 *     catches up at the start (the audience window learns where the song is only
 *     once the first anchor arrives, by which time the host's video has a head
 *     start) and how it recovers from a stall;
 *   - `computeVideoPlaybackRate` otherwise -- the *same function* the host's
 *     `useStageClock` nudges its own video with, so both videos are chasing the
 *     same target with the same gain, and therefore each other.
 *
 * Checked four times a second rather than per frame: the correction is a ±5%
 * rate nudge that takes seconds to act, so re-deciding it every 16 ms would be
 * pure overhead on the window that also has to scroll eight note lanes.
 *
 * ---------------------------------------------------------------------------
 * When it cannot decode
 *
 * Real UltraStar libraries are full of MPEG-2 `.mpg` and DivX `.avi` that
 * Chromium cannot play. The `app-media://` handler substitutes a transcoded
 * sibling when one exists, so the attempt is always worth making -- and when it
 * genuinely fails, this degrades to the same ambient cover art the host degrades
 * to, painted *underneath* rather than swapped in, so there is never a flash of
 * black. A backdrop that cannot load must never be a black rectangle.
 */

/** How far out of step the backdrop may drift before it is seeked rather than nudged. */
const SEEK_THRESHOLD_MS = 400

/** Never seek more often than this: a seek costs a decoder flush, and the rate nudge needs time to work. */
const MIN_SEEK_INTERVAL_MS = 1500

/** How often the backdrop's alignment is re-decided. */
const SYNC_INTERVAL_MS = 250

interface AudienceStageVideoProps {
  meta: SongMeta
  /** The chart's own directory, as `useChartLoader` resolved it -- media tags are relative to it. */
  sourceDir: string
  playback: AudiencePlayback | null
}

export function AudienceStageVideo({ meta, sourceDir, playback }: AudienceStageVideoProps) {
  const reduceMotion = useReducedMotion() ?? false
  const videoUrl = meta.videoPath ? resolveMediaPath(sourceDir, meta.videoPath) : null
  const coverUrl = resolveMediaPath(sourceDir, meta.coverPath)
  const [videoFailed, setVideoFailed] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playbackRef = useRef<AudiencePlayback | null>(playback)
  playbackRef.current = playback
  const seekTrackerRef = useRef(createVideoSeekTracker())

  // A new song gets a fresh chance at its video.
  useEffect(() => {
    setVideoFailed(false)
    seekTrackerRef.current = createVideoSeekTracker()
  }, [videoUrl])

  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element
    if (!element) return
    element.setAttribute('muted', '')
    element.defaultMuted = true
    element.muted = true
    element.volume = 0
  }, [])

  const showVideo = videoUrl !== null && !videoFailed && !reduceMotion

  useEffect(() => {
    if (!showVideo) return

    const tick = () => {
      const video = videoRef.current
      const anchor = playbackRef.current
      if (!video || !anchor) return

      // Re-asserted every tick, not just at attach: this is the one invariant
      // of this whole window, and it costs two comparisons.
      if (!video.muted) video.muted = true
      if (video.volume !== 0) video.volume = 0

      if (anchor.paused) {
        if (!video.paused) video.pause()
        return
      }

      const audioMs = playbackPositionMs(anchor, Date.now())
      // In UltraStar, #VIDEOGAP is in seconds (e.g. 1.0 or 1.5), and the video
      // frame shown is audio + VIDEOGAP (UltraStar Deluxe's convention -- see
      // driftCorrection.videoTargetMs), exactly as on the host.
      const videoGapMs = (meta.videoGap ?? 0) * 1000
      const videoDurationMs =
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : 0

      // A video shorter than the song loops (it is a backdrop), so the target
      // wraps against its duration and is never past its end.
      const rawTargetMs = videoTargetMs(audioMs, videoGapMs)
      const targetVideoMs =
        videoDurationMs > 0 && rawTargetMs >= videoDurationMs ? rawTargetMs % videoDurationMs : rawTargetMs

      // A negative gap: hold the first frame until the audio reaches -gap.
      if (targetVideoMs < 0) {
        if (!video.paused) video.pause()
        if (video.currentTime !== 0) {
          try {
            video.currentTime = 0
          } catch {}
        }
        return
      }

      if (video.paused) {
        // Muted autoplay is always permitted, so this does not need a gesture --
        // which is just as well, because the audience window is created
        // `focusable: false` and can never receive one.
        void Promise.resolve(video.play()).catch(() => {})
      }

      const videoMs = video.currentTime * 1000
      const desyncMs = targetVideoMs - videoMs

      // Hard seeks are bookkept per source: after three that did not land, the
      // backdrop is only rate-nudged (see driftCorrection.shouldHardSeekVideo).
      if (
        shouldHardSeekVideo(seekTrackerRef.current, {
          src: videoUrl,
          desyncMs,
          nowMs: Date.now(),
          seeking: video.seeking,
          canSeek: video.readyState >= HTMLMediaElement.HAVE_METADATA,
          thresholdMs: SEEK_THRESHOLD_MS,
          minIntervalMs: MIN_SEEK_INTERVAL_MS,
        })
      ) {
        try {
          video.currentTime = targetVideoMs / 1000
          if (video.playbackRate !== 1) video.playbackRate = 1
        } catch {
          // Best-effort seek: media decoder might be busy
        }
        return
      }

      // Quantised, with a deadband, and written only when it changes.
      const rate = computeVideoPlaybackRate({ audioMs: targetVideoMs, videoMs, videoGapMs: 0 })
      if (video.playbackRate !== rate) video.playbackRate = rate
    }

    tick()
    const timer = setInterval(tick, SYNC_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [showVideo, meta.videoGap, videoUrl])

  return (
    <div data-testid="audience-stage-media" aria-hidden className="absolute inset-0 overflow-hidden bg-black">
      {/* Always the base layer, exactly as on the host: an undecodable video
          degrades to the cover with no flash of empty black. */}
      <AmbientFallback coverUrl={coverUrl} />

      {showVideo && (
        <video
          ref={attachVideo}
          data-testid="audience-stage-video"
          src={videoUrl}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          loop
          muted
          preload="auto"
          onCanPlay={() => {
            const video = videoRef.current
            const anchor = playbackRef.current
            if (video && anchor && !anchor.paused && video.paused) {
              void Promise.resolve(video.play()).catch(() => {})
            }
          }}
          // Never fatal. The backdrop is decoration; the cover art underneath is
          // already on screen and simply becomes visible again.
          onError={() => setVideoFailed(true)}
        />
      )}

      {/*
        Legibility, without a single backdrop blur (MAX_BACKDROP_BLUR_PX, and
        this is the largest surface the app draws -- a whole television).

        Three painted layers instead, all of which cost one composited quad:
        a flat wash that takes the video's contrast down far enough for white
        text to survive a white frame, and two vertical scrims anchored where
        the content is -- the song header at the top, the lyric box and the
        score strip at the bottom. The note lanes sit in the middle, where the
        video is least covered, because they carry their own contrast (every
        pill has a dark ring, every hairline a dark shadow -- see LanePanel).
      */}
      <div className="absolute inset-0" style={{ background: 'rgba(6,5,12,0.46)' }} />
      <div
        className="absolute inset-x-0 top-0 h-[30%]"
        style={{ background: 'linear-gradient(to bottom, rgba(4,3,10,0.82), rgba(4,3,10,0))' }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-[42%]"
        style={{ background: 'linear-gradient(to top, rgba(4,3,10,0.88), rgba(4,3,10,0))' }}
      />
    </div>
  )
}
