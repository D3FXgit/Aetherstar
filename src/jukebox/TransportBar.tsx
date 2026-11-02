// The jukebox's transport bar: what is playing, a seek bar, Previous / Play-Pause
// / Next, Shuffle, Repeat, the Up next panel and the music volume. Glass, because
// it floats over the video. It hides after a few seconds without input (see
// JukeboxScene) and stays up while the song is paused.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useT } from '../i18n'
import { Panel } from '../design/primitives/GlassPanel'
import { GlassSlider } from '../design/primitives/GlassSlider'
import { springTransition, tokens } from '../design/tokens'
import { useAppPreferencesStore } from '../settings/appPreferencesStore'
import type { LibrarySong } from '../library/types'
import type { StageControl } from '../stage/Stage'
import { usePauseStore } from '../stage/pause/pauseStore'
import { useSessionStore } from '../session/sessionStore'
import { useJukeboxUiStore } from './jukeboxUiStore'
import { formatPlaybackTime, songByline } from './queueLogic'
import { SEEK_STEP_SEC, VOLUME_STEP, type JukeboxTransport } from './transport'
import { SEEK_ATTRIBUTE, TRANSPORT_ATTRIBUTE } from './useJukeboxInput'
import { SongThumb } from './SongThumb'
import { TransportButton } from './TransportButton'
import {
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  QueueIcon,
  RepeatIcon,
  ShuffleIcon,
  VolumeIcon,
} from './icons'

/** How often the time readout re-reads the clock. The per-frame clock stays out of React. */
const CLOCK_TICK_MS = 250
/** The transport bar's height, as a CSS custom property on the scene root. */
export const TRANSPORT_HEIGHT_VAR = '--jukebox-transport-h'

/** Where Unmute returns to when the level was already 0 before muting. */
const UNMUTE_FALLBACK = 0.8

interface SongClock {
  /** Seconds into the song proper (after `#START`). */
  elapsed: number
  /** The song's length (`#START` to `#END` or the end of the audio), or null while unknown. */
  total: number | null
  start: number
}

function readClock(control: StageControl | null): SongClock {
  if (!control) return { elapsed: 0, total: null, start: 0 }
  const start = control.getStartTime()
  const end = control.getEndTime()
  // A length the clock cannot vouch for (NaN before metadata, Infinity for a
  // stream) is no length: the bar shows the elapsed time alone until it is known.
  const total = end !== null && Number.isFinite(end) ? Math.max(0, end - start) : null
  return {
    start,
    elapsed: Math.max(0, control.getTime() - start),
    total: total !== null && total > 0 ? total : null,
  }
}

function sameClock(a: SongClock, b: SongClock): boolean {
  return a.start === b.start && a.total === b.total && Math.abs(a.elapsed - b.elapsed) < 0.05
}

interface TransportBarProps {
  song: LibrarySong
  controlRef: RefObject<StageControl | null>
  transport: JukeboxTransport
  onHoverChange?: (hovering: boolean) => void
}

export function TransportBar({ song, controlRef, transport, onHoverChange }: TransportBarProps) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const visible = useJukeboxUiStore((state) => state.transportVisible)
  const focusRequest = useJukeboxUiStore((state) => state.focusRequest)
  const queueOpen = useJukeboxUiStore((state) => state.queueOpen)
  const paused = usePauseStore((state) => state.phase !== 'running')
  const shuffle = useSessionStore((state) => state.jukeboxShuffle)
  const repeat = useSessionStore((state) => state.jukeboxRepeat)
  const upNext = useSessionStore((state) => state.jukeboxQueue[0] ?? null)
  const playId = useSessionStore((state) => state.jukeboxPlayId)
  const rootRef = useRef<HTMLDivElement>(null)
  const playRef = useRef<HTMLButtonElement>(null)
  const [clock, setClock] = useState<SongClock>(() => readClock(controlRef.current))

  // The readout only needs to move while someone can see it.
  useEffect(() => {
    if (!visible) return
    const read = () => {
      const next = readClock(controlRef.current)
      setClock((previous) => (sameClock(previous, next) ? previous : next))
    }
    read()
    const interval = setInterval(read, CLOCK_TICK_MS)
    return () => clearInterval(interval)
  }, [visible, controlRef, playId])

  // The bar's height, published on the scene as `--jukebox-transport-h`, so the
  // Up next panel can end above it instead of covering its right-hand controls.
  useLayoutEffect(() => {
    const root = rootRef.current
    const scene = root?.parentElement
    if (!root || !scene) return
    const publish = () => scene.style.setProperty(TRANSPORT_HEIGHT_VAR, `${root.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(root)
    return () => {
      observer.disconnect()
      scene.style.removeProperty(TRANSPORT_HEIGHT_VAR)
    }
  }, [])

  // An arrow press or the D-pad asked for the bar: land on Play/Pause.
  useEffect(() => {
    if (focusRequest > 0) playRef.current?.focus()
  }, [focusRequest])

  // Hidden, the bar lets go of focus, so ←/→ seek again instead of walking it.
  useEffect(() => {
    if (visible) return
    const active = document.activeElement
    if (active instanceof HTMLElement && rootRef.current?.contains(active)) active.blur()
  }, [visible])

  const seekTo = (elapsed: number) => transport.seekTo(clock.start + elapsed)

  const repeatLabel = t(`jukebox.transport.repeat.${repeat}`)

  return (
    <motion.div
      ref={rootRef}
      {...{ [TRANSPORT_ATTRIBUTE]: '' }}
      role="region"
      aria-label={t('jukebox.transport.label')}
      data-testid="jukebox-transport"
      data-visible={visible ? 'true' : 'false'}
      // Hidden, nothing in it can be focused or clicked.
      inert={!visible}
      initial={false}
      animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 24 }}
      transition={springTransition('panelEnter', reduceMotion ?? false)}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-[clamp(1rem,2.5vw,3rem)] pb-[clamp(1rem,2.5vw,2.5rem)]"
      onPointerEnter={() => onHoverChange?.(true)}
      onPointerLeave={() => onHoverChange?.(false)}
    >
      <Panel variant="glass" className="pointer-events-auto flex flex-col gap-3 rounded-3xl px-6 pb-4 pt-5 shadow-2xl">
        <SeekBar clock={clock} onSeek={seekTo} onStep={(delta) => transport.seekBy(delta)} />

        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6">
          {/* Now playing */}
          <div className="flex min-w-0 items-center gap-4" data-testid="jukebox-transport-now-playing">
            <SongThumb song={song} className="size-16" />
            <div className="min-w-0">
              <div className="truncate text-xl font-bold text-ink-primary">{song.title}</div>
              <div className="truncate text-base font-medium text-ink-secondary">{songByline(song)}</div>
              {upNext && (
                <div className="truncate text-sm text-ink-tertiary" data-testid="jukebox-up-next">
                  {t('jukebox.transport.upNext', { title: upNext.title, artist: upNext.artist })}
                </div>
              )}
            </div>
          </div>

          {/* Playback */}
          <div className="flex items-center gap-3">
            <TransportButton
              label={t('jukebox.transport.shuffle')}
              aria-pressed={shuffle}
              active={shuffle}
              data-testid="jukebox-transport-shuffle"
              onClick={() => useSessionStore.getState().setJukeboxShuffle(!shuffle)}
            >
              <ShuffleIcon />
            </TransportButton>
            <TransportButton label={t('jukebox.transport.previous')} data-testid="jukebox-transport-previous" onClick={transport.previous}>
              <PreviousIcon />
            </TransportButton>
            <TransportButton
              ref={playRef}
              size="lg"
              primary
              label={paused ? t('jukebox.transport.play') : t('jukebox.transport.pause')}
              data-testid="jukebox-transport-play"
              onClick={transport.togglePlay}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </TransportButton>
            <TransportButton label={t('jukebox.transport.next')} data-testid="jukebox-transport-next" onClick={transport.next}>
              <NextIcon />
            </TransportButton>
            <TransportButton
              label={repeatLabel}
              aria-pressed={repeat !== 'off'}
              active={repeat !== 'off'}
              data-testid="jukebox-transport-repeat"
              data-repeat={repeat}
              onClick={() => useSessionStore.getState().cycleJukeboxRepeat()}
            >
              <RepeatIcon one={repeat === 'one'} />
            </TransportButton>
          </div>

          {/* Queue and volume */}
          <div className="flex min-w-0 items-center justify-end gap-3">
            <TransportButton
              label={t('jukebox.transport.queue')}
              aria-pressed={queueOpen}
              active={queueOpen}
              data-testid="jukebox-transport-queue"
              onClick={() => useJukeboxUiStore.getState().toggleQueue()}
            >
              <QueueIcon />
            </TransportButton>
            <VolumeControl />
          </div>
        </div>
      </Panel>
    </motion.div>
  )
}

/**
 * The seek bar: a slider over the song from `#START` to its end. Click or drag
 * to seek (the jump happens on release, not per pixel); ←/→ step 10 seconds.
 */
function SeekBar({
  clock,
  onSeek,
  onStep,
}: {
  clock: SongClock
  onSeek: (elapsed: number) => void
  onStep: (deltaSec: number) => void
}) {
  const t = useT()
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragFraction, setDragFraction] = useState<number | null>(null)
  const total = clock.total
  const known = total !== null && total > 0
  const fraction = dragFraction ?? (known ? Math.min(1, clock.elapsed / total) : 0)
  const shownElapsed = dragFraction !== null && known ? dragFraction * total : clock.elapsed
  const remaining = known ? Math.max(0, total - shownElapsed) : null

  const fractionAt = (clientX: number): number | null => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return null
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!known) return
    const at = fractionAt(event.clientX)
    if (at === null) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragFraction(at)
  }
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragFraction === null) return
    const at = fractionAt(event.clientX)
    if (at !== null) setDragFraction(at)
  }
  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragFraction === null || !known) return
    const at = fractionAt(event.clientX) ?? dragFraction
    setDragFraction(null)
    onSeek(at * total)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // ←/→ are taken by the scene's own handler (they seek wherever focus is
    // not on a button); Home/End are the slider's own.
    if (event.key === 'Home') {
      event.preventDefault()
      onSeek(0)
    } else if (event.key === 'End' && known) {
      event.preventDefault()
      onSeek(total)
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      onStep(event.key === 'PageUp' ? SEEK_STEP_SEC * 3 : -SEEK_STEP_SEC * 3)
    }
  }

  const elapsedText = formatPlaybackTime(shownElapsed)
  const totalText = known ? formatPlaybackTime(total) : null

  return (
    <div className="flex items-center gap-4">
      <span className="w-16 shrink-0 text-right text-base font-semibold tabular-nums text-ink-secondary" data-testid="jukebox-elapsed">
        {elapsedText}
      </span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        {...{ [SEEK_ATTRIBUTE]: '' }}
        data-jukebox-adjust="seek"
        data-testid="jukebox-seek"
        aria-label={t('jukebox.transport.seek')}
        aria-valuemin={0}
        aria-valuemax={known ? Math.round(total) : 0}
        aria-valuenow={Math.round(shownElapsed)}
        aria-valuetext={totalText ? t('jukebox.transport.position', { elapsed: elapsedText, total: totalText }) : elapsedText}
        className="group relative flex h-8 flex-1 cursor-pointer touch-none items-center rounded-full"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDragFraction(null)}
        onKeyDown={handleKeyDown}
      >
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/20 transition-[height] duration-150 group-hover:h-3 group-focus-visible:h-3">
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${fraction * 100}%`, background: tokens.accent.cyan }}
          />
        </div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f2f2f4] shadow-[0_1px_4px_rgba(0,0,0,.5)]"
          style={{ left: `${fraction * 100}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-base font-semibold tabular-nums text-ink-secondary" data-testid="jukebox-remaining">
        {remaining === null ? '' : t('jukebox.transport.remaining', { time: formatPlaybackTime(remaining) })}
      </span>
    </div>
  )
}

/** The mixer's music channel -- the song's own level, the same slider as in Settings. */
function VolumeControl() {
  const t = useT()
  const music = useAppPreferencesStore((state) => state.mixer.music)
  const beforeMuteRef = useRef(UNMUTE_FALLBACK)
  const muted = music <= 0
  const setMusic = (value: number) => useAppPreferencesStore.getState().setMixerVolume('music', value)

  return (
    <div className="flex min-w-0 items-center gap-2">
      <TransportButton
        size="sm"
        label={muted ? t('jukebox.transport.unmute') : t('jukebox.transport.mute')}
        data-testid="jukebox-transport-mute"
        onClick={() => {
          if (muted) {
            setMusic(beforeMuteRef.current > 0 ? beforeMuteRef.current : UNMUTE_FALLBACK)
          } else {
            beforeMuteRef.current = music
            setMusic(0)
          }
        }}
      >
        <VolumeIcon muted={muted} />
      </TransportButton>
      <GlassSlider
        value={music}
        onChange={setMusic}
        label={t('jukebox.transport.volume')}
        step={VOLUME_STEP}
        className="w-40"
        data-testid="jukebox-volume"
        data-jukebox-adjust="volume"
      />
    </div>
  )
}
