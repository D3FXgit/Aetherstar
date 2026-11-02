import { cancelFrame, frame, useMotionValue, type MotionValue } from 'framer-motion'
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import type { SongLine, SongMeta, SongNote } from '../../contracts/types'
import { useStageStore } from '../stageStore'
import { syllableProgressAt } from '../lyrics/syllableProgressAt'
import {
  computeVideoPlaybackRate,
  createVideoSeekTracker,
  shouldHardSeekVideo,
  videoSeekTargetSec,
  videoTargetMs,
  VIDEO_SEEK_THRESHOLD_MS,
} from './driftCorrection'
import { findLineIndexForBeat } from './findLineIndexForBeat'
import { msToBeat } from './beatMs'

interface UseStageClockInput {
  audioRef: RefObject<HTMLMediaElement | null>
  videoRef: RefObject<HTMLMediaElement | null>
  meta: SongMeta | null
  lines: SongLine[]
}

export interface StageClock {
  beatPosition: MotionValue<number>
  progress: MotionValue<number>
  /**
   * The beat *right now*, read synchronously from the audio element -- not the
   * value the last frame wrote. For anything that has to act on the exact
   * instant (a judgement, a seek) rather than draw it.
   */
  getBeat(): number
}

/** Greatest note index in a line whose startBeat has already passed, or -1 for none yet. */
function findActiveSyllableIndex(notes: SongNote[], beat: number): number {
  let index = -1
  for (let i = 0; i < notes.length; i++) {
    if (notes[i].startBeat <= beat) index = i
  }
  return index
}

const MIN_SEEK_INTERVAL_MS = 800
/** A paused video is asked to play at most this often, not every frame while its play() is pending. */
const MIN_PLAY_ATTEMPT_INTERVAL_MS = 500

const lastPlayAttemptAt = new WeakMap<HTMLMediaElement, number>()
/** The resize resync is a one-off correction, so it acts on a smaller error than the per-frame seek. */
const RESIZE_SEEK_THRESHOLD_MS = 150

/**
 * Keeps the decorative video on the audio clock: audio + `#VIDEOGAP` (see
 * driftCorrection.videoTargetMs).
 *
 * - Before the target reaches 0 (a negative gap), the video holds its first
 *   frame, paused, and starts the moment the audio gets there.
 * - Large errors are hard-seeked -- but never past the video's end, and a
 *   source that has failed MAX_FAILED_VIDEO_SEEKS seeks in a row is only
 *   rate-nudged from then on.
 * - Small errors are a quantised playback-rate nudge, assigned only when it
 *   changes.
 */
function syncVideo(
  audio: HTMLMediaElement,
  video: HTMLMediaElement,
  videoGapMs: number,
  tracker: ReturnType<typeof createVideoSeekTracker>,
  nowMs: number,
): void {
  const audioMs = audio.currentTime * 1000
  const targetMs = videoTargetMs(audioMs, videoGapMs)

  if (targetMs < 0) {
    // Hold the first frame until the audio reaches -gap.
    if (!video.paused) video.pause()
    if (video.currentTime !== 0 && !video.seeking) video.currentTime = 0
    return
  }

  if (video.paused) {
    // Started (or released from a negative-gap hold) only while the song is
    // actually playing, and never restarted once it has run to its end.
    if (!audio.paused && !video.ended && nowMs - (lastPlayAttemptAt.get(video) ?? -Infinity) > MIN_PLAY_ATTEMPT_INTERVAL_MS) {
      lastPlayAttemptAt.set(video, nowMs)
      void Promise.resolve(video.play()).catch(() => {})
    }
    return
  }

  // The song stopped (paused, ended, or cut at #END): the picture stops with it.
  if (audio.paused) {
    video.pause()
    return
  }

  const videoMs = video.currentTime * 1000
  const desyncMs = targetMs - videoMs
  const seekTo = videoSeekTargetSec(targetMs, video.duration)
  if (
    seekTo !== null &&
    shouldHardSeekVideo(tracker, {
      src: video.currentSrc || video.getAttribute('src'),
      desyncMs,
      nowMs,
      seeking: video.seeking,
      canSeek: video.readyState >= 2,
      thresholdMs: VIDEO_SEEK_THRESHOLD_MS,
      minIntervalMs: MIN_SEEK_INTERVAL_MS,
    })
  ) {
    video.currentTime = seekTo
    if (video.playbackRate !== 1) video.playbackRate = 1
    return
  }

  const rate = computeVideoPlaybackRate({ audioMs, videoMs, videoGapMs })
  if (video.playbackRate !== rate) video.playbackRate = rate
}

/**
 * Drives the per-frame beat position and active-syllable sweep progress off
 * audio `currentTime` (always the source of truth) via framer-motion
 * MotionValues -- never React state, so it never causes a per-frame re-render.
 * Only line/syllable-boundary crossings reach useStageStore, and only on change.
 *
 * ## Why `frame.read`, not `useAnimationFrame`
 *
 * Gameplay judges notes from `beatPosition` inside its own `useAnimationFrame`
 * (framer-motion's *update* step), which is registered before this hook's. The
 * *read* step is flushed before update, so every consumer sees this frame's
 * beat rather than the previous one.
 */
export function useStageClock({ audioRef, videoRef, meta, lines }: UseStageClockInput): StageClock {
  const beatPosition = useMotionValue(0)
  const progress = useMotionValue(0)
  const lastLineIndexRef = useRef(0)
  const lastSyllableIndexRef = useRef(-1)
  const seekTrackerRef = useRef(createVideoSeekTracker())

  // Read by the frame callback and getBeat without re-subscribing the loop.
  const metaRef = useRef(meta)
  const linesRef = useRef(lines)
  useEffect(() => {
    metaRef.current = meta
    linesRef.current = lines
  }, [meta, lines])

  // Resync immediately when the window finishes resizing, so video does not lag behind audio
  useEffect(() => {
    const onResize = () => {
      const audio = audioRef.current
      const video = videoRef.current
      const songMeta = metaRef.current
      if (!audio || !video || video.paused || video.readyState < 2 || !songMeta) return
      const targetMs = videoTargetMs(audio.currentTime * 1000, (songMeta.videoGap ?? 0) * 1000)
      const desyncMs = targetMs - video.currentTime * 1000
      const seekTo = videoSeekTargetSec(targetMs, video.duration)
      if (Math.abs(desyncMs) > RESIZE_SEEK_THRESHOLD_MS && !video.seeking && seekTo !== null) {
        video.currentTime = seekTo
        if (video.playbackRate !== 1) video.playbackRate = 1
        seekTrackerRef.current.lastSeekAtMs = performance.now()
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [audioRef, videoRef])

  useEffect(() => {
    const tick = () => {
      const audio = audioRef.current
      const songMeta = metaRef.current
      if (!audio || !songMeta) return
      const chartLines = linesRef.current

      const audioMs = audio.currentTime * 1000
      const beat = msToBeat(audioMs, songMeta.bpm, songMeta.gap)
      beatPosition.set(beat)

      const video = videoRef.current
      if (video) syncVideo(audio, video, (songMeta.videoGap ?? 0) * 1000, seekTrackerRef.current, performance.now())

      const lineIndex = findLineIndexForBeat(chartLines, beat)
      if (lineIndex !== lastLineIndexRef.current) {
        lastLineIndexRef.current = lineIndex
        useStageStore.getState().setCurrentLineIndex(lineIndex)
      }

      const currentLine = chartLines[lineIndex]
      const syllableIndex = currentLine ? findActiveSyllableIndex(currentLine.notes, beat) : -1
      if (syllableIndex !== lastSyllableIndexRef.current) {
        lastSyllableIndexRef.current = syllableIndex
        useStageStore.getState().setActiveSyllableIndex(syllableIndex)
      }

      const activeNote = syllableIndex >= 0 ? currentLine?.notes[syllableIndex] : undefined
      progress.set(activeNote ? syllableProgressAt(activeNote, beat) : 0)
    }

    frame.read(tick, true)
    return () => cancelFrame(tick)
  }, [audioRef, videoRef, beatPosition, progress])

  // A stable handle: the motion values are created once per mount, so callers
  // (Stage memoizes `overlay(clock)` on it) can treat the clock as a constant
  // instead of rebuilding the gameplay subtree whenever Stage re-renders.
  return useMemo(
    () => ({
      beatPosition,
      progress,
      getBeat: () => {
        const audio = audioRef.current
        const songMeta = metaRef.current
        if (!audio || !songMeta) return beatPosition.get()
        return msToBeat(audio.currentTime * 1000, songMeta.bpm, songMeta.gap)
      },
    }),
    [beatPosition, progress, audioRef],
  )
}
