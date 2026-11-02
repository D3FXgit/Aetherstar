import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { motion, type MotionValue } from 'framer-motion'
import type { SongChart } from '../contracts/types'
import { useInstrumentalFade } from '../game/useInstrumentalFade'
import { useLaneColorsStore } from '../multiplayer/laneColors'
import { logSongLoad, logSongLoadError } from '../diagnostics/log'
import { Countdown } from './countdown/Countdown'
import { countdownSecondsAt, firstNoteMs } from './countdown/secondsUntilGap'
import { STAGE_GRID_CLASS, STAGE_LYRIC_CELL, STAGE_SONG_CARD_CELL } from './layout'
import { ClockLyrics } from './lyrics/ClockLyrics'
import { isDuetChart } from './lyrics/duetParts'
import { LyricBox } from './lyrics/LyricBox'
import { StageMedia } from './media/StageMedia'
import { mediaDurationSec } from './media/mediaDuration'
import { resolveCoverUrl } from './media/resolveMediaPath'
import { SongInfoCard } from './SongInfoCard'
import { useStageStore } from './stageStore'
import { isSongPaused, usePauseStore } from './pause/pauseStore'
import { playFromClock, useStagePauseControl } from './pause/useStagePauseControl'
import { StageClockContext, type StageClockContextValue } from './timing/StageClockContext'
import { useStageClock } from './timing/useStageClock'
import { videoSeekTargetSec, videoTargetMs } from './timing/driftCorrection'

/**
 * Transport control over a mounted stage, for a player (the jukebox) rather
 * than a singer. Times are seconds on the audio clock. Pause and resume are not
 * here: they go through the pause store, which the stage already obeys.
 */
export interface StageControl {
  /** Where the song is now. */
  getTime(): number
  /** Where the song starts (`#START`, else 0). */
  getStartTime(): number
  /**
   * Where the song ends (`#END`, else the clock audio's length), or null until
   * the audio knows its length. Never NaN or Infinity.
   */
  getEndTime(): number | null
  /** Jump to `seconds`, clamped to the song; the stem and video follow in the same task. */
  seek(seconds: number): void
}

/** While paused, CSS-driven FX (hit bursts, sparks, their pseudo-element layers) hold their frame. */
const PAUSED_FX_CLASS =
  '[&_*]:[animation-play-state:paused]! [&_*::before]:[animation-play-state:paused]! [&_*::after]:[animation-play-state:paused]!'

/**
 * How long the clock will wait for a vocal stem to become decodable before
 * starting without it. Generous enough for a cold read off a spinning disk,
 * short enough that a stalled stem is a two-second delay and not a dead stage.
 */
const STEM_READY_TIMEOUT_MS = 2000

/**
 * Poll interval for the lead-in countdown. The layer only re-renders when the
 * shown second changes, never per poll or per frame.
 */
const COUNTDOWN_TICK_MS = 100

interface StageClockHandle {
  beatPosition: MotionValue<number>
  progress: MotionValue<number>
  getBeat(): number
}


/**
 * The lead-in countdown, in its own layer: the last three seconds before the
 * first note (not `#GAP`, which is often seconds before anyone sings). The flip
 * to `playing` lives on this poll so the per-frame clock loop gains no store read.
 */
const StageCountdownLayer = memo(function StageCountdownLayer({
  audioRef,
  targetMs,
}: {
  audioRef: RefObject<HTMLAudioElement | null>
  targetMs: number
}) {
  const status = useStageStore((state) => state.status)
  const [seconds, setSeconds] = useState<number | null>(() =>
    countdownSecondsAt((audioRef.current?.currentTime ?? 0) * 1000, targetMs),
  )

  useEffect(() => {
    if (status !== 'countdown') return
    const read = () => {
      const ms = (audioRef.current?.currentTime ?? 0) * 1000
      // Same-value updates bail out of rendering, so this renders once a second
      // inside the lead-in and never outside it.
      setSeconds(countdownSecondsAt(ms, targetMs))
      if (ms >= targetMs) useStageStore.getState().setStatus('playing')
    }
    read()
    const interval = setInterval(read, COUNTDOWN_TICK_MS)
    return () => clearInterval(interval)
  }, [status, targetMs, audioRef])

  if (status !== 'countdown' || seconds === null) return null

  return (
    <div data-testid="stage-countdown-layer" className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
      <Countdown status={status} seconds={seconds} />
    </div>
  )
})

/**
 * The lyric box, isolated from the rest of the stage: the line/syllable indices
 * change several times a second, and only the two lines of text should
 * re-render for it, not the media layer or the gameplay overlay.
 */
const StageLyricLayer = memo(function StageLyricLayer({
  lines,
  progress,
}: {
  lines: SongChart['lines']
  progress: MotionValue<number>
}) {
  const currentLineIndex = useStageStore((state) => state.currentLineIndex)
  const activeSyllableIndex = useStageStore((state) => state.activeSyllableIndex)
  // One singer: their colour. Several on the same words: the neutral default.
  const soloColor = useLaneColorsStore((state) => (state.colors.length === 1 ? state.colors[0] : undefined))

  return (
    <LyricBox
      lines={lines}
      currentLineIndex={currentLineIndex}
      activeSyllableIndex={activeSyllableIndex}
      progress={progress}
      accentColor={soloColor}
    />
  )
})

interface StageProps {
  chart: SongChart
  sourceDir: string
  /** Extra layers (the gameplay overlay) drawn on this exact clock rather than a second, drifting one. */
  overlay?: (clock: StageClockHandle) => ReactNode
  /** Fires once when the song ends: the audio's own `ended`, or `#END` being reached. */
  onEnded?: () => void
  /** No 3-2-1 before the first note (the jukebox, where nobody is waiting to sing). */
  skipLeadIn?: boolean
  /** Receives seek / position control over this stage (the jukebox's transport bar). */
  controlRef?: RefObject<StageControl | null>
  /** The top-left song card. Off where the caller shows its own now-playing info. */
  showSongCard?: boolean
  /** Extra style on the song card + lyrics layer (the jukebox lifts it clear of its transport bar). */
  chromeStyle?: CSSProperties
}

/** Assembles the media layer, lyric box, and countdown into the full singer-view Stage. */
export function Stage({ chart, sourceDir, overlay, onEnded, skipLeadIn = false, controlRef, showSongCard = true, chromeStyle }: StageProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const vocalStemRef = useRef<HTMLAudioElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [usingStems, setUsingStems] = useState(false)
  const [playbackStarted, setPlaybackStarted] = useState(false)
  const [clockUrl, setClockUrl] = useState<string | null>(null)
  /** Whether the start gate below has let the song begin; a resume before that leaves the start to the gate. */
  const startedRef = useRef(false)
  /**
   * What the song was last started *with*: the clock element and every input
   * that decides where it starts. Anything else re-running the start effect --
   * the stem plan settling after the song is already playing -- must not start
   * it again (see below).
   */
  const startedWithRef = useRef<readonly unknown[] | null>(null)
  const paused = usePauseStore((state) => state.phase !== 'running')
  const handleStemPlan = useCallback((next: boolean) => setUsingStems(next), [])
  const { startMs, endMs, videoGap } = chart.meta

  useEffect(() => {
    setPlaybackStarted(false)
  }, [chart, sourceDir, clockUrl])

  useEffect(() => {
    logSongLoad('stage:mount', {
      sourceDir,
      title: chart.meta.title,
      artist: chart.meta.artist,
      bpm: chart.meta.bpm,
      gap: chart.meta.gap,
      videoGap: chart.meta.videoGap,
      lineCount: chart.lines.length,
    })
    useStageStore.getState().reset()
    useStageStore.getState().setStatus(skipLeadIn ? 'playing' : 'countdown')
  }, [chart, sourceDir, skipLeadIn])

  // The only thing that starts playback: the <audio> carries no autoPlay, and
  // the whole clock derives from audio.currentTime.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    // `usingStems` is a dependency so a stem plan that settles *before* the
    // start makes the gate wait for the stem element. After the start it can
    // still flip (a guide vocal that errors mid-song), and running the gate
    // again then re-ran `playFromClock`, which re-seeks the playing video.
    // The stem loop (useStemAudio) brings a late stem into line by itself, so
    // the same song on the same clock element is never started twice.
    const startInputs = [audio, chart, sourceDir, clockUrl, startMs, videoGap] as const
    const previous = startedWithRef.current
    if (startedRef.current && previous && startInputs.every((value, index) => Object.is(value, previous[index]))) return
    let cancelled = false
    let started = false
    startedRef.current = false
    startedWithRef.current = null

    const start = () => {
      if (cancelled || started) return
      started = true
      startedRef.current = true
      startedWithRef.current = startInputs
      setPlaybackStarted(true)
      // `#START`: skip the intro. Applied before the first play() so the song
      // never sounds from 0 first.
      if (startMs !== undefined && startMs > 0 && audio.currentTime * 1000 < startMs) {
        try {
          audio.currentTime = startMs / 1000
        } catch {
          // A seek refused before metadata is survivable: the song plays from 0.
        }
      }
      // Paused before the media was ready: Resume starts it instead.
      if (isSongPaused()) return
      // Stem and video start in the same task, from the clock's own position --
      // a stem dragged into place a frame later is audible on the first downbeat.
      playFromClock(audio, vocalStemRef.current, videoRef.current, (videoGap ?? 0) * 1000)
    }

    // Both elements have to be decodable before either is allowed to start,
    // or the stem joins late and the first line flams.
    const stemElement = vocalStemRef.current
    let audioReady = audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    // A stem that has already failed is "ready" in the only sense that
    // matters here: it is never going to hold the clock up again.
    let stemReady = !stemElement || stemElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    const startWhenBothReady = () => {
      if (audioReady && stemReady) start()
    }
    const onAudioReady = () => {
      audioReady = true
      startWhenBothReady()
    }
    const onStemSettled = () => {
      stemReady = true
      startWhenBothReady()
    }

    // Backstop: a stem that neither loads nor errors (a stalled read, a
    // half-written file) must never be able to hold the song hostage. The
    // clock is the one thing gameplay cannot do without, so after this it
    // starts regardless and the stem catches up -- or doesn't.
    const stemWaitTimeout = setTimeout(() => {
      if (!started) {
        logSongLoadError('media:stem-timeout', new Error('The vocal stem never became ready; starting without it.'), {
          src: vocalStemRef.current?.currentSrc ?? null,
        })
        start()
      }
    }, STEM_READY_TIMEOUT_MS)

    audio.addEventListener('canplay', onAudioReady)
    stemElement?.addEventListener('canplay', onStemSettled)
    stemElement?.addEventListener('error', onStemSettled)
    startWhenBothReady()

    return () => {
      cancelled = true
      clearTimeout(stemWaitTimeout)
      audio.removeEventListener('canplay', onAudioReady)
      stemElement?.removeEventListener('canplay', onStemSettled)
      stemElement?.removeEventListener('error', onStemSettled)
    }
  }, [chart, sourceDir, usingStems, clockUrl, startMs, videoGap])

  const clock = useStageClock({ audioRef, videoRef, meta: chart.meta, lines: chart.lines })

  useStagePauseControl({ audioRef, vocalStemRef, videoRef, videoGapMs: (videoGap ?? 0) * 1000, startedRef })

  /**
   * The clock element's last known length, kept current from its own
   * `loadedmetadata` / `durationchange` (and `progress`, for a stream-like
   * source whose length is only known once it has fully loaded). Re-attached
   * whenever the clock element is swapped (`clockUrl`).
   */
  const clockDurationRef = useRef<number | null>(null)
  useEffect(() => {
    clockDurationRef.current = null
    const audio = audioRef.current
    if (!audio) return
    const update = () => {
      const duration = mediaDurationSec(audio)
      if (duration !== null) clockDurationRef.current = duration
    }
    update()
    const events = ['loadedmetadata', 'durationchange', 'progress'] as const
    for (const name of events) audio.addEventListener(name, update)
    return () => {
      for (const name of events) audio.removeEventListener(name, update)
    }
  }, [clockUrl])

  useImperativeHandle(
    controlRef,
    (): StageControl => {
      const startTime = () => (startMs !== undefined && startMs > 0 ? startMs / 1000 : 0)
      const endTime = () => {
        if (endMs !== undefined && endMs > 0) return endMs / 1000
        // The clock element -- the one that is playing, the instrumental when
        // the song runs on stems -- read live, then as last reported. Only when
        // it cannot say: the guide-vocal stem, which runs the same length.
        return mediaDurationSec(audioRef.current) ?? clockDurationRef.current ?? mediaDurationSec(vocalStemRef.current)
      }
      return {
        getTime: () => audioRef.current?.currentTime ?? 0,
        getStartTime: startTime,
        getEndTime: endTime,
        seek: (seconds) => {
          const audio = audioRef.current
          if (!audio || !Number.isFinite(seconds)) return
          const end = endTime()
          const target = Math.max(startTime(), end === null ? seconds : Math.min(seconds, end))
          try {
            audio.currentTime = target
          } catch {
            // Not seekable yet (no metadata): nothing to move.
            return
          }
          // The stem and the video are put on the new position here rather than
          // left to the drift loops, which would let them run a beat off first
          // -- and which do nothing at all while paused.
          const stem = vocalStemRef.current
          if (stem) {
            try {
              stem.currentTime = target
            } catch {
              // The stem loop brings it into line once it can seek.
            }
          }
          const video = videoRef.current
          if (video) {
            const videoMs = videoTargetMs(target * 1000, (videoGap ?? 0) * 1000)
            const videoSec = videoMs < 0 ? 0 : videoSeekTargetSec(videoMs, video.duration)
            if (videoSec !== null) {
              try {
                video.currentTime = videoSec
              } catch {
                // The clock loop seeks it once it is seekable.
              }
            }
          }
        },
      }
    },
    [startMs, endMs, videoGap],
  )

  // The end of the song: the element's own `ended`, or `#END` when the chart
  // says the song stops before the file does. Fired once either way.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !onEnded) return
    let fired = false
    const finish = () => {
      if (fired) return
      fired = true
      onEnded()
    }
    const onTimeUpdate = () => {
      if (endMs === undefined || !(endMs > 0)) return
      if (audio.currentTime * 1000 >= endMs) {
        audio.pause()
        finish()
      }
    }
    audio.addEventListener('ended', finish)
    audio.addEventListener('timeupdate', onTimeUpdate)
    return () => {
      audio.removeEventListener('ended', finish)
      audio.removeEventListener('timeupdate', onTimeUpdate)
    }
  }, [onEnded, endMs, clockUrl])

  // Memoised on stable inputs, so the gameplay subtree is built once per song
  // rather than on every Stage render.
  const overlayNode = useMemo(() => overlay?.(clock), [overlay, clock])

  /**
   * The instrumental fade. The lyric box goes with the lanes: it is the largest
   * thing covering the video and there is nothing to read during a break.
   * Computed once and shared through StageClockContext, so both are one value.
   */
  const lyricOpacity = useInstrumentalFade(chart.lines, chart.meta.bpm, clock.beatPosition)

  const stageClockValue = useMemo<StageClockContextValue>(
    () => ({ beatPosition: clock.beatPosition, instrumentalOpacity: lyricOpacity, getBeat: clock.getBeat }),
    [clock, lyricOpacity],
  )

  const duet = useMemo(() => isDuetChart(chart.lines), [chart.lines])
  const laneColors = useLaneColorsStore((state) => state.colors)
  const countdownTargetMs = useMemo(() => firstNoteMs(chart), [chart])

  return (
    <StageClockContext.Provider value={stageClockValue}>
      <div
        data-testid="stage"
        data-paused={paused ? 'true' : undefined}
        className={`relative w-full h-full min-h-screen overflow-hidden ${paused ? PAUSED_FX_CLASS : ''}`}
      >
        <StageMedia
          chart={chart}
          sourceDir={sourceDir}
          audioRef={audioRef}
          vocalStemRef={vocalStemRef}
          videoRef={videoRef}
          onStemPlan={handleStemPlan}
          playbackStarted={playbackStarted}
          onClockUrlChange={setClockUrl}
          onFatalError={onEnded}
        />

        {/* Stage's half of the singer-view grid (the overlay draws the other
            half into the same grid, see ./layout.ts). Never takes pointer events. */}
        <div className={`${STAGE_GRID_CLASS} pointer-events-none`} style={chromeStyle}>
          {showSongCard && (
            <div className={STAGE_SONG_CARD_CELL}>
              <SongInfoCard meta={chart.meta} coverUrl={resolveCoverUrl(sourceDir, chart.meta)} audioRef={audioRef} />
            </div>
          )}

          <motion.div className={STAGE_LYRIC_CELL} style={{ opacity: lyricOpacity }}>
            {duet ? (
              // A duet: two compact boxes (P2 over P1), each on its own part's
              // cursor, read straight off the clock.
              <ClockLyrics lines={chart.lines} beatPosition={clock.beatPosition} partColors={laneColors} />
            ) : (
              <StageLyricLayer lines={chart.lines} progress={clock.progress} />
            )}
          </motion.div>
        </div>

        {overlayNode}

        {/* After the overlay so the 3-2-1 sits in front of the note lanes. */}
        {!skipLeadIn && <StageCountdownLayer audioRef={audioRef} targetMs={countdownTargetMs} />}
      </div>
    </StageClockContext.Provider>
  )
}
