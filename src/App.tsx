import { Suspense, lazy, useCallback, useEffect, useMemo, useRef } from 'react'
import { Backdrop } from './design/primitives/Backdrop'
import { ErrorBoundary } from './design/primitives/ErrorBoundary'
import { SceneRouter } from './scenes/SceneRouter'
import { BackAuthorityProvider, SceneHeader } from './scenes/SceneHeader'
import { useScene } from './scenes/useScene'
import { JUKEBOX_SCENE, isSessionScene, useSessionStore } from './session/sessionStore'
import { useCouchNavigation } from './input/useCouchNavigation'
import { useWebAudioManager } from './audio/useWebAudioManager'
import { useMicRecovery } from './audio/useMicRecovery'
import { usePitchCapture } from './audio/usePitchCapture'
import { MicRecoveryOverlay } from './audio/MicRecoveryOverlay'
import { handMenuMusicToPreview, startMenuMusic, stopMenuMusic, takeOverPreviewAsMenuMusic } from './audio/menuMusic'
import {
  useSongPreviewStore,
  MENU_MUSIC_STOP_MS,
  PREVIEW_BROWSE_FADE_MS,
  PREVIEW_CROSSFADE_MS,
  PREVIEW_LAUNCH_FADE_MS,
} from './audio/songPreviewStore'
import { RESULTS_BED_FADE_IN_MS, RESULTS_BED_FADE_OUT_MS, resultsBedPlayOptions } from './audio/resultsBed'
import { resultsBedRequestFor } from './session/results/resultsBedRequest'
import { useSceneStore, type SceneName } from './scenes/sceneStore'
import { useLabHotkey } from './lab/useLabHotkey'
import { useWindowRole } from './audience/useWindowRole'
import { AudienceScoreboard } from './audience/AudienceScoreboard'
import { useAppPreferencesStore } from './settings/appPreferencesStore'
import type { MenuMusicMode } from './settings/types'
import { PauseLayer } from './stage/pause/PauseLayer'
import { usePauseStore } from './stage/pause/pauseStore'

// The lab scenes are registered from main.tsx, in development builds only
// (src/lab/registerDevLabs.ts) -- nothing lab-related is imported here.

/**
 * The perf overlay is a developer tool. In a production build
 * `import.meta.env.DEV` is the literal `false`, so this is `null`, the lazy
 * import is dropped, and the overlay never ships -- whatever a stale
 * `perfOverlayVisible` preference in a player's localStorage says.
 */
const PerfOverlay = import.meta.env.DEV
  ? lazy(() => import('./perf/PerfOverlay').then((module) => ({ default: module.PerfOverlay })))
  : null

// Real gameplay scenes -- every other scene keeps menu music at full volume,
// so a song never has menu music under it. Songs are sung only inside the
// session loop now; there is no standalone sing scene.
const GAMEPLAY_SCENES = new Set<SceneName>(['session-play', JUKEBOX_SCENE])

/**
 * The scenes across which a song preview stays audible.
 *
 * This is the whole point of the pair: picking a song leaves `session-select`
 * for `session-assign`, and the preview the user chose the song by has to
 * carry across that boundary rather than dying with the screen that started
 * it. Because both scenes are in this set, a navigation between them changes
 * nothing the effect below acts on, so nothing is stopped and nothing is
 * started -- the same source keeps playing at the same position.
 */
const PREVIEW_SCENES = new Set<SceneName>(['session-select', 'session-assign', 'session-party-draw'])

/**
 * Scenes that leave the music channel exactly as they found it.
 *
 * The song-start transition is neither a menu nor gameplay: it is 4.75 s of
 * `song_selected.wav` plus a 3-2-1 countdown, arrived at from a screen whose
 * preview has just stopped the menu music. Treating it as "a menu again" would
 * start the menu track under the countdown; ducking it would be a no-op with a
 * misleading name. So it holds whatever state the music is already in.
 */
const MUSIC_HOLD_SCENES = new Set<SceneName>(['session-starting'])

/**
 * The scene the results bed plays behind: the song just sung, muffled "from
 * the next room" (src/audio/resultsBed.ts). Leaving it -- for the leaderboard,
 * the song list, Home -- fades the bed out and hands the room back to the menu
 * music.
 */
const RESULTS_BED_SCENE: SceneName = 'session-results'

const SCENE_TRANSITION_RAMP_MS = 600

export default function App() {
  const windowRole = useWindowRole()
  const { current } = useScene()
  const perfOverlayVisible = useAppPreferencesStore((state) => state.perfOverlayVisible)
  useLabHotkey()

  // Stable for the app's lifetime: the gamepad loop holds it and must never be
  // re-bound per render.
  const handleBack = useCallback(() => {
    const scene = useSceneStore.getState().current
    // Mid-song, Back pauses (and, from the pause menu, resumes) -- it never
    // throws a song away by itself. Leaving is the menu's Quit. The jukebox is
    // not paused here: its Back falls through to the session machine below,
    // which opens the jukebox menu.
    if (scene === 'session-play') {
      usePauseStore.getState().toggle()
      return
    }

    // Inside the party loop the session machine is the navigation authority
    // (it owns SCENE_BY_PHASE), so Back steps *its* phase back and lets the
    // scene follow. Popping the scene stack here instead would leave `phase`
    // describing a screen that is no longer on screen.
    //
    // The `phase !== 'idle'` guard is what keeps that delegation from turning
    // Back into a dead end. `sessionStore.back()` is a switch over the phase,
    // and its 'idle' arm deliberately returns without doing anything ("Home is
    // not a session screen -- the scene stack owns Back there"). That is the
    // right answer for the machine and the wrong answer for the user whenever
    // the two have drifted apart: a session-* scene reached with the machine
    // already reset -- the Dev Lab's session route, a scene restored after the
    // error boundary sent the app home, any direct setState -- would delegate
    // to a no-op and the button would simply stop working, with no way out but
    // quitting. Falling through to the scene stack means every scene in the
    // app has a Back that moves, and the stack's own `home` fallback is the
    // floor under all of them.
    if (isSessionScene(scene) && useSessionStore.getState().phase !== 'idle') {
      useSessionStore.getState().back()
      return
    }

    useSceneStore.getState().back()
  }, [])

  // Gamepad + keyboard directional navigation for the whole shell, both routed
  // to the same Back the on-screen control uses. Off in the audience window,
  // which is a scoreboard nobody drives.
  useCouchNavigation(handleBack, windowRole !== 'audience')

  // Whatever way the song screen is left, nothing stays paused behind it.
  useEffect(() => {
    if (current !== 'session-play') usePauseStore.getState().reset()
  }, [current])

  // Mic disconnects are watched here, not by a screen, because the case that
  // matters is mid-song -- when no screen that subscribes to audio events is
  // mounted. See useMicRecovery.
  useMicRecovery(windowRole !== 'audience')

  // Live pitch has to reach the store during a *song*, and every screen that
  // subscribed to it is unmounted by then. See usePitchCapture.
  usePitchCapture(windowRole !== 'audience')

  // One top-level Audio Manager policy, so no scene can start or stop music
  // behind another's back. It is driven by two inputs: the current scene, and
  // which song the *session* wants previewed (see src/audio/songPreviewStore.ts).
  //
  // Keeping both here is what makes the Song Selector -> Player Selection
  // handoff possible at all. Preview playback used to be owned by the
  // selector's mount lifecycle, so it necessarily died when that screen
  // unmounted; the selector now only ever *requests* a track, and the single
  // owner of play/stop is this effect. Navigating between two scenes that both
  // allow the preview, with the same track requested, is therefore a no-op:
  // no restart, and no second source layered over the first.
  const previewTrack = useSongPreviewStore((state) => state.track)
  // Where that preview should open (the chart's #PREVIEWSTART), or null to let
  // the engine pick. Only read when a preview is (re)started below; a change on
  // its own never restarts audio that is already playing the right track.
  const previewStartSec = useSongPreviewStore((state) => state.previewStartSec)
  // Whether it loops (Party Draw) or plays once to the end and is reported as
  // ended (Song Select, which then moves on to the next song). Read on start.
  const previewLoop = useSongPreviewStore((state) => state.loop)
  // What plays behind the menus (Settings > Audio & Mics > Menu music). A
  // change applies at once on a menu screen; see the menu music bus below.
  const menuMusicMode = useAppPreferencesStore((state) => state.menuMusicMode)
  const musicStateRef = useRef<'unstarted' | 'playing' | 'ducked' | 'stopped'>('unstarted')
  // The mode the menu music now playing (or ducked) was started in.
  const musicModeRef = useRef<MenuMusicMode | null>(null)
  const playingPreviewRef = useRef<string | null>(null)
  // The song just sung, which the results bed plays. The session keeps it
  // through results and the leaderboard and clears it on "New song" / leaving,
  // so reading it here -- rather than waiting for the results screen to ask
  // after it mounts -- means the menu music is never started for one render on
  // the way in only to be stopped again.
  const sungSong = useSessionStore((state) => state.selectedSong)
  const resultsBed = useMemo(() => resultsBedRequestFor(sungSong), [sungSong])
  const resultsBedTrack = resultsBed?.track ?? null
  const resultsBedStartSec = resultsBed?.previewStartSec ?? null
  const playingResultsBedRef = useRef<string | null>(null)
  const isAudienceWindow = windowRole === 'audience'
  useEffect(() => {
    // The audience display is a screen, not a second speaker. It renders this
    // same bundle, and a hook cannot be called conditionally -- so without this
    // guard the whole policy below ran in the audience renderer too, and the
    // menu track and every song preview came out of the TV as well as the host
    // machine, the two slightly out of phase. Nothing in the audience UI wants
    // audio; the policy just had no idea which window it was running in.
    if (isAudienceWindow) return

    const audio = useWebAudioManager.getState()
    const isGameplay = GAMEPLAY_SCENES.has(current)
    // A preview is only ever audible on the scenes that allow one; anywhere
    // else the answer is silence regardless of what was last requested.
    const wantedPreview = PREVIEW_SCENES.has(current) ? previewTrack : null
    const playingPreview = playingPreviewRef.current
    // The sung song, muffled, behind the results screen (the results bus below).
    const wantedResultsBed = current === RESULTS_BED_SCENE ? resultsBedTrack : null

    // --- handing one song between the menu music and the preview ----------
    // Home <-> Song Select with the same song on both sides is a handover,
    // not a stop and a restart: the engine moves the playing source from one
    // bus to the other (src/audio/menuMusic.ts), and the blocks below then
    // find nothing left to do.
    if (wantedPreview !== playingPreview) {
      if (
        // In: the selector preselected the library song the menu is playing,
        // and wants it played through (not looped) -- the menu song never loops.
        playingPreview === null &&
        wantedPreview !== null &&
        !previewLoop &&
        musicStateRef.current === 'playing' &&
        handMenuMusicToPreview(audio, wantedPreview, () => useSongPreviewStore.getState().notifyEnded(wantedPreview))
      ) {
        playingPreviewRef.current = wantedPreview
        musicStateRef.current = 'stopped'
      } else if (
        // Out: back to the menus (not into gameplay, the countdown or the
        // results bed), with library menu music wanted and none playing.
        playingPreview !== null &&
        wantedPreview === null &&
        !PREVIEW_SCENES.has(current) &&
        !isGameplay &&
        !MUSIC_HOLD_SCENES.has(current) &&
        wantedResultsBed === null &&
        menuMusicMode === 'library' &&
        (musicStateRef.current === 'stopped' || musicStateRef.current === 'unstarted') &&
        takeOverPreviewAsMenuMusic(audio, playingPreview)
      ) {
        playingPreviewRef.current = null
        musicStateRef.current = 'playing'
        musicModeRef.current = 'library'
      }
    }

    // --- the preview bus ------------------------------------------------
    if (wantedPreview !== playingPreviewRef.current) {
      const previewOptions = {
        previewStartSec,
        loop: previewLoop,
        onEnded: () => {
          if (wantedPreview !== null) useSongPreviewStore.getState().notifyEnded(wantedPreview)
        },
      }
      if (playingPreview !== null && wantedPreview !== null) {
        // Browsing from one song to the next (or the selector moving on by
        // itself once a preview has played out): an equal-power crossfade, so
        // the two songs blend rather than dip -- and the outgoing one keeps
        // playing until the incoming one has actually started (it streams, so
        // that is within ~150 ms), so there is no gap.
        audio.crossfadeTo(wantedPreview, PREVIEW_CROSSFADE_MS, 'preview', { ...previewOptions, fadeCurve: 'equal-power' })
      } else {
        if (playingPreview !== null) {
          // Ending a preview because the session is launching the song is the
          // one case with a hard deadline: the start transition opens with
          // song_selected.wav, which reaches full level 300 ms in, and the
          // preview has to be *at* zero before then rather than still fading.
          const launching = wantedPreview === null && MUSIC_HOLD_SCENES.has(current)
          audio.stop(launching ? PREVIEW_LAUNCH_FADE_MS : PREVIEW_BROWSE_FADE_MS, 'preview')
        }
        if (wantedPreview !== null) audio.play(wantedPreview, 'preview', previewOptions)
      }
      playingPreviewRef.current = wantedPreview
    }

    // --- the results bus ------------------------------------------------
    // A track that fails to load is simply silence: the engine reports it to
    // nobody, and the menu music stays stopped for the rest of this screen
    // like it would under a playing bed.
    const playingResultsBed = playingResultsBedRef.current
    if (wantedResultsBed !== playingResultsBed) {
      if (playingResultsBed !== null) {
        // A Versus rematch goes straight to the start transition, whose
        // song_selected.wav needs the room as quickly as a preview does.
        const launching = MUSIC_HOLD_SCENES.has(current)
        audio.stop(launching ? PREVIEW_LAUNCH_FADE_MS : RESULTS_BED_FADE_OUT_MS, 'results')
      }
      if (wantedResultsBed !== null) {
        audio.crossfadeTo(wantedResultsBed, RESULTS_BED_FADE_IN_MS, 'results', resultsBedPlayOptions(resultsBedStartSec))
      }
      playingResultsBedRef.current = wantedResultsBed
    }

    // --- the menu music bus ---------------------------------------------
    // What plays is src/audio/menuMusic.ts's business (a library song
    // rotation, or the bundled loop); *when* is decided here.
    if (isGameplay) {
      // The bundled loop is ducked, not stopped: it has to be resumable as a
      // fade-in when the song ends. A library song is stopped instead -- it
      // would otherwise run on (and crossfade into the next one, loading a
      // second song) under the song being sung, and coming back starts a fresh
      // random song anyway. A preview, by contrast, is a looping source that
      // must not survive into gameplay at all -- the block above normally has
      // it stopped already, and this is the backstop for any path that reaches
      // gameplay without that happening.
      if (musicStateRef.current === 'playing') {
        if (musicModeRef.current === 'builtin') {
          audio.duckTo(0, SCENE_TRANSITION_RAMP_MS, 'music')
          musicStateRef.current = 'ducked'
        } else {
          stopMenuMusic(audio, SCENE_TRANSITION_RAMP_MS)
          musicStateRef.current = 'stopped'
        }
      }
      audio.stop(SCENE_TRANSITION_RAMP_MS, 'preview')
    } else if (wantedPreview !== null || wantedResultsBed !== null) {
      // A song preview takes the room. The menu music is *stopped*, not ducked
      // to a floor: two tracks at once is the artefact this screen is supposed
      // to avoid, and a ducked source is still a running one -- audible under
      // a quiet passage and, worse, still holding the bus. The cost is that
      // coming back has to start it again rather than restore(), handled below.
      // The results bed takes the room the same way.
      if (musicStateRef.current !== 'stopped') {
        stopMenuMusic(audio, MENU_MUSIC_STOP_MS)
        musicStateRef.current = 'stopped'
      }
    } else if (!MUSIC_HOLD_SCENES.has(current)) {
      const live = musicStateRef.current === 'playing' || musicStateRef.current === 'ducked'
      // The setting changed since this music started: swap it for the new choice.
      if (live && musicModeRef.current !== menuMusicMode) {
        stopMenuMusic(audio, SCENE_TRANSITION_RAMP_MS)
        musicStateRef.current = 'stopped'
      }
      if (musicStateRef.current === 'ducked') {
        audio.restore(SCENE_TRANSITION_RAMP_MS, 'music')
        musicStateRef.current = 'playing'
      } else if (musicStateRef.current !== 'playing' && menuMusicMode !== 'off') {
        startMenuMusic(audio, menuMusicMode)
        musicStateRef.current = 'playing'
        musicModeRef.current = menuMusicMode
      }
    }

    // Leaving the preview scenes retires the request as well as the sound, so
    // reopening the selector later cannot resurrect a stale track before the
    // screen has said what it wants. Guarded on the current value, so this
    // settles in one extra pass instead of looping.
    if (!PREVIEW_SCENES.has(current) && previewTrack !== null) {
      useSongPreviewStore.getState().clearPreview()
    }
  }, [current, previewTrack, previewStartSec, previewLoop, isAudienceWindow, menuMusicMode, resultsBedTrack, resultsBedStartSec])

  if (windowRole === 'audience') {
    return (
      <ErrorBoundary label="audience-window">
        <AudienceScoreboard />
      </ErrorBoundary>
    )
  }

  return (
    // Outer of the app's two boundaries -- the last resort. SceneRouter's own
    // inner boundary contains anything a scene throws (keeping the back button
    // alive); this one only ever fires for the shell itself (Backdrop,
    // PerfOverlay, the router) and exists so that even then the window shows a
    // readable error with a way out instead of going white and silent.
    <ErrorBoundary label="app-shell" resetKey={current}>
      <Backdrop />
      {/*
        `handleBack` is published to the whole shell rather than handed to one
        bar, because Back is now drawn in two places: inside a screen's own
        header (Song Selector, Player Selection, Settings, Leaderboard) and, for
        screens with no header to put it in, by the fallback bar below. Both
        routes read this one value, so the on-screen control, Escape, Backspace
        and gamepad B remain the same phase-aware authority -- including the
        pause menu mid-song. See src/scenes/sceneChrome.ts for why the control
        moved into the screens.
      */}
      <BackAuthorityProvider onBack={handleBack}>
        {/*
          The shell states no per-scene layout of its own. The fallback bar's
          band is part of the scene subtree instead (SceneRouter), so it travels
          with the screen it belongs to. All that is left here is "fill the
          window".
        */}
        <div className="flex min-h-screen w-full">
          <SceneRouter />
        </div>
        {PerfOverlay && perfOverlayVisible && (
          <Suspense fallback={null}>
            <PerfOverlay />
          </Suspense>
        )}
        {/* The fallback navigation bar, for the Back-bearing scenes that have
            no header of their own -- Players, Results, the Stage, every /lab/*
            route. Scenes listed as self-headed in sceneChrome.ts render the
            same <BackButton /> in their own title row instead, so this is empty
            chrome on exactly those screens and absent from the DOM. */}
        <SceneHeader scene={current} />
      {/* Above the shell, below the pause menu: both mark themselves
          `data-focus-scope` and `focusScope()` takes the last one in document
          order, so the menu the player just opened always wins the stick.
          Mid-song this renders as a non-modal banner and claims no scope. */}
      <MicRecoveryOverlay />
      {/* Mounted for the whole song screen -- loading, singing, or crashed --
          so Back always has a way out. */}
      <PauseLayer enabled={current === 'session-play'} />
      </BackAuthorityProvider>
    </ErrorBoundary>
  )
}
