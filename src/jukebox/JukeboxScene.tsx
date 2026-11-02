// Jukebox playback: the chosen song on the regular Stage (video + lyrics) with
// no gameplay layer, so no scoring and no microphones, under a music player's
// controls -- the transport bar, the Up next panel and an in-place song browser.
// Back closes those first, then opens JukeboxMenu (see sessionStore's 'jukebox'
// phase). The play order itself lives in sessionStore (see ./queueLogic.ts).
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { useReducedMotion } from 'framer-motion'
import { useT } from '../i18n'
import { Stage, type StageControl } from '../stage/Stage'
import { useChartLoader } from '../stage/chart/useChartLoader'
import { resolveCoverUrl } from '../stage/media/resolveMediaPath'
import { usePauseStore } from '../stage/pause/pauseStore'
import { GlassErrorState } from '../design/primitives/GlassErrorState'
import { SongLoadingScreen } from '../session/SongLoadingScreen'
import { useCalibrationStore } from '../calibration/calibrationStore'
import { clampCalibrationOffsetMs } from '../calibration/offsets'
import { setGameplayActive } from '../library/api'
import type { LibrarySong } from '../library/types'
import { useSfx } from '../audio/useSfx'
import { interceptSessionBack, useSessionStore } from '../session/sessionStore'
import { JukeboxMenu } from './JukeboxMenu'
import { TRANSPORT_HIDE_DELAY_MS, useJukeboxUiStore } from './jukeboxUiStore'
import { createTransport } from './transport'
import { useJukeboxInput } from './useJukeboxInput'
import { TransportBar } from './TransportBar'
import { QueuePanel } from './QueuePanel'
import { AddSongsOverlay } from './AddSongsOverlay'
import { QueueFinishedCard } from './QueueFinishedCard'
import { NowPlayingToast } from './NowPlayingToast'
import { lyricLiftStyle, useLyricLift } from './useLyricLift'

function JukeboxStage({
  song,
  onEnded,
  controlRef,
  chromeStyle,
}: {
  song: LibrarySong
  onEnded: () => void
  controlRef: RefObject<StageControl | null>
  chromeStyle: CSSProperties
}) {
  const t = useT()
  const { status, chart: loadedChart, sourceDir, error } = useChartLoader(song.path)
  // Clamped again where applied: a corrupt or legacy value must never move
  // #GAP by more than the calibration bound (offsets.ts).
  const outputOffsetMs = useCalibrationStore((state) => clampCalibrationOffsetMs(state.settings.outputOffsetMs))

  // The speakers' output latency, folded into the gap once (as the sung stage does).
  const chart = useMemo(() => {
    if (!loadedChart || outputOffsetMs === 0) return loadedChart
    return { ...loadedChart, meta: { ...loadedChart.meta, gap: loadedChart.meta.gap + outputOffsetMs } }
  }, [loadedChart, outputOffsetMs])

  if (status === 'ready' && chart && sourceDir) {
    // The jukebox draws its own now-playing card and transport bar instead of the singer's song card.
    return (
      <Stage
        chart={chart}
        sourceDir={sourceDir}
        onEnded={onEnded}
        skipLeadIn
        controlRef={controlRef}
        showSongCard={false}
        chromeStyle={chromeStyle}
      />
    )
  }

  if (status === 'error') {
    return (
      <GlassErrorState
        title={t('jukebox.error.title')}
        message={t('jukebox.error.message', { error: error ?? '' })}
        actionLabel={t('jukebox.menu.skip')}
        onAction={() => useSessionStore.getState().nextJukeboxSong()}
      />
    )
  }

  return (
    <SongLoadingScreen
      title={chart?.meta.title ?? song.title}
      artist={chart?.meta.artist ?? song.artist}
      coverUrl={chart && sourceDir ? resolveCoverUrl(sourceDir, chart.meta) ?? undefined : undefined}
    />
  )
}

export function JukeboxScene() {
  const t = useT()
  const song = useSessionStore((state) => state.selectedSong)
  const playId = useSessionStore((state) => state.jukeboxPlayId)
  const menuOpen = useSessionStore((state) => state.jukeboxMenuOpen)
  const finished = useSessionStore((state) => state.jukeboxFinished)
  const queueOpen = useJukeboxUiStore((state) => state.queueOpen)
  const addSongsOpen = useJukeboxUiStore((state) => state.addSongsOpen)
  const transportVisible = useJukeboxUiStore((state) => state.transportVisible)
  const activity = useJukeboxUiStore((state) => state.activity)
  const paused = usePauseStore((state) => state.phase !== 'running')
  const [hoveringBar, setHoveringBar] = useState(false)
  const controlRef = useRef<StageControl | null>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const transport = useMemo(() => createTransport(controlRef), [])
  const reduceMotion = useReducedMotion() ?? false
  const chromeStyle = useMemo(() => lyricLiftStyle(reduceMotion), [reduceMotion])

  useJukeboxInput(transport)

  // Background library work holds still while a song plays, as it does for a sung one.
  useEffect(() => {
    setGameplayActive(true)
    return () => setGameplayActive(false)
  }, [])

  // Fresh overlays per visit, and nothing left paused or open on the way out.
  useEffect(() => {
    useJukeboxUiStore.getState().reset()
    return () => {
      useJukeboxUiStore.getState().reset()
      usePauseStore.getState().reset()
    }
  }, [])

  // A new song always plays, even if the last one was paused when it was left.
  // Subscribed rather than an effect so it lands before the next stage mounts:
  // its start gate would otherwise see "paused" and wait for a resume. A reset
  // (not a resume) never restarts the outgoing song's media on its way out.
  useEffect(
    () =>
      useSessionStore.subscribe((state, previous) => {
        const justFinished = state.jukeboxFinished && !previous.jukeboxFinished
        if (state.jukeboxPlayId !== previous.jukeboxPlayId || justFinished) usePauseStore.getState().reset()
        // The finished card replaces the song and its panel.
        if (justFinished) useJukeboxUiStore.getState().setQueueOpen(false)
      }),
    [],
  )

  // Back closes the song browser, then the queue panel; on the "Queue
  // finished" card it goes back to the list. Otherwise the machine opens its menu.
  useEffect(
    () =>
      interceptSessionBack(() => {
        if (useJukeboxUiStore.getState().closeTopOverlay()) {
          useSfx.getState().play('back')
          return true
        }
        const session = useSessionStore.getState()
        if (session.phase === 'jukebox' && session.jukeboxFinished && !session.jukeboxMenuOpen) {
          useSfx.getState().play('back')
          session.jukeboxBackToList()
          return true
        }
        return false
      }),
    [],
  )

  // The transport bar hides after a few seconds without input -- never while
  // paused, while something is open over the song, or under the pointer.
  const holdTransport = paused || queueOpen || addSongsOpen || menuOpen || hoveringBar
  useEffect(() => {
    if (holdTransport) {
      if (!useJukeboxUiStore.getState().transportVisible) useJukeboxUiStore.setState({ transportVisible: true })
      return
    }
    const timer = setTimeout(() => useJukeboxUiStore.getState().hideTransport(), TRANSPORT_HIDE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [activity, holdTransport])

  const handleEnded = useCallback(() => useSessionStore.getState().jukeboxSongEnded(), [])

  const playing = song !== null && !finished
  // While the bar is up, the lyrics rise clear of it.
  useLyricLift(sceneRef, playing && transportVisible)
  // An idle screen with nothing up hides the pointer too, so it does not sit on the video.
  const hidePointer = playing && !transportVisible && !queueOpen && !addSongsOpen && !menuOpen

  let content
  if (finished) {
    content = <QueueFinishedCard />
  } else if (song) {
    // Keyed per play, so the same song queued twice starts from the top.
    content = (
      <JukeboxStage
        key={`${song.path}#${playId}`}
        song={song}
        onEnded={handleEnded}
        controlRef={controlRef}
        chromeStyle={chromeStyle}
      />
    )
  } else {
    content = (
      <GlassErrorState
        title={t('jukebox.empty.title')}
        message={t('jukebox.empty.message')}
        actionLabel={t('jukebox.menu.backToList')}
        onAction={() => useSessionStore.getState().jukeboxBackToList()}
      />
    )
  }

  return (
    <div
      ref={sceneRef}
      className="relative h-screen w-full overflow-hidden"
      style={hidePointer ? { cursor: 'none' } : undefined}
      data-testid="jukebox-scene"
      data-paused={playing && paused ? 'true' : undefined}
    >
      {content}
      {playing && song && (
        <>
          <NowPlayingToast key={`now-playing#${playId}`} song={song} />
          <TransportBar song={song} controlRef={controlRef} transport={transport} onHoverChange={setHoveringBar} />
        </>
      )}
      {queueOpen && !finished && <QueuePanel />}
      {addSongsOpen && <AddSongsOverlay />}
      {menuOpen && <JukeboxMenu />}
    </div>
  )
}
