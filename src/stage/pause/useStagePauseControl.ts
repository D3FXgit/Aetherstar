import { useEffect, type RefObject } from 'react'
import { logSongLoadError } from '../../diagnostics/log'
import { useStageStore, type StageStatus } from '../stageStore'
import { VIDEO_SEEK_THRESHOLD_MS, videoSeekTargetSec, videoTargetMs } from '../timing/driftCorrection'
import { usePauseStore } from './pauseStore'

/**
 * Starts the clock element and brings the guide-vocal stem and the video along
 * from wherever it stands: the stem on the same position, the video at audio +
 * `#VIDEOGAP` (a negative gap holds its first frame; the clock loop releases it).
 *
 * Shared by the song's first start and every resume, so both land in sync in
 * the same task instead of leaving the drift loop to drag things into place.
 */
export function playFromClock(
  audio: HTMLMediaElement,
  stem: HTMLMediaElement | null,
  video: HTMLMediaElement | null,
  videoGapMs: number,
): void {
  void Promise.resolve(audio.play()).catch((error) => {
    // Chromium's autoplay policy can still refuse this; surface it rather than
    // leaving a silent, frozen stage.
    logSongLoadError('media:play-rejected', error instanceof Error ? error : new Error(String(error)), {
      src: audio.currentSrc || audio.src,
    })
  })

  if (stem) {
    stem.currentTime = audio.currentTime
    void Promise.resolve(stem.play()).catch(() => {})
  }

  if (video) {
    const targetMs = videoTargetMs(audio.currentTime * 1000, videoGapMs)
    if (targetMs < 0) {
      if (video.currentTime !== 0) {
        try {
          video.currentTime = 0
        } catch {
          // Not seekable yet; the clock loop holds and releases it.
        }
      }
      return
    }
    const seekTo = videoSeekTargetSec(targetMs, video.duration)
    // Past its end, a video shorter than the song simply stays ended.
    if (seekTo === null) return
    // Seeked only when it is actually out of step (the song's first start, a
    // jump while paused). A resume finds it frozen on the frame it was paused
    // on, a few ms off the clock at most, and plays on from there: the drift
    // loop's rate nudge absorbs the rest. An unconditional seek here was what
    // restarted the video on resume -- a seek into a large video that is not
    // in the media cache can land on its first frame (see the Stage pause
    // tests) -- and costs a decoder flush and a visible hitch even when it lands.
    if (Math.abs(targetMs - video.currentTime * 1000) > VIDEO_SEEK_THRESHOLD_MS) {
      try {
        video.currentTime = seekTo
      } catch {
        // Not seekable yet; the clock loop seeks it once it is.
      }
    }
    void Promise.resolve(video.play()).catch(() => {})
  }
}

interface StagePauseControlInput {
  audioRef: RefObject<HTMLMediaElement | null>
  vocalStemRef: RefObject<HTMLMediaElement | null>
  videoRef: RefObject<HTMLMediaElement | null>
  videoGapMs: number
  /** True once the stage's start gate has let the song begin; a resume before that leaves the start to the gate. */
  startedRef: RefObject<boolean>
}

/**
 * Freezes and thaws the stage's media for the pause menu.
 *
 * Audio is the clock, so pausing it freezes the beat, the lanes, the lyrics and
 * judging with it; the stem and video are paused explicitly so nothing runs on
 * for a frame. The stage status goes to `paused` and back to whatever it was,
 * so a pause during the lead-in resumes into the lead-in.
 */
export function useStagePauseControl({ audioRef, vocalStemRef, videoRef, videoGapMs, startedRef }: StagePauseControlInput): void {
  useEffect(() => {
    let statusBeforePause: StageStatus | null = null

    const freeze = () => {
      const stage = useStageStore.getState()
      if (stage.status !== 'paused') {
        statusBeforePause = stage.status
        stage.setStatus('paused')
      }
      audioRef.current?.pause()
      vocalStemRef.current?.pause()
      videoRef.current?.pause()
    }

    const thaw = () => {
      const stage = useStageStore.getState()
      if (stage.status === 'paused') stage.setStatus(statusBeforePause ?? 'playing')
      statusBeforePause = null
      const audio = audioRef.current
      if (!audio || !startedRef.current || audio.ended) return
      playFromClock(audio, vocalStemRef.current, videoRef.current, videoGapMs)
    }

    if (usePauseStore.getState().phase !== 'running') freeze()

    const unsubscribe = usePauseStore.subscribe((state, previous) => {
      const wasPaused = previous.phase !== 'running'
      const isPaused = state.phase !== 'running'
      if (isPaused && !wasPaused) freeze()
      // Only a finished resume plays on. A restart remounts the stage and a
      // reset means the song is being left: neither may make a sound on the way out.
      else if (!isPaused && wasPaused && state.lastTransition === 'resume') thaw()
    })

    return () => {
      unsubscribe()
      // Never leave a stale `paused` behind for the next lane that reads it.
      const stage = useStageStore.getState()
      if (stage.status === 'paused') stage.setStatus('idle')
    }
  }, [audioRef, vocalStemRef, videoRef, videoGapMs, startedRef])
}
