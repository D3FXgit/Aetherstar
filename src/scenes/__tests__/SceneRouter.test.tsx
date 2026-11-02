import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SceneRouter } from '../SceneRouter'
import { useSceneStore } from '../sceneStore'
import { SCENE_REGISTRY, registerScene } from '../sceneRegistry'
import { CRASH_PREFIX } from '../../diagnostics/log'

describe('SceneRouter', () => {
  beforeEach(() => {
    useSceneStore.setState({ current: 'home' })
  })

  afterEach(() => {
    delete window.api
    vi.restoreAllMocks()
  })

  it('shows Home by default', () => {
    render(<SceneRouter />)
    expect(screen.getByText('Start a night')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('shows the target scene after navigate(), and hides Home', async () => {
    // Home mounts first (default scene) and, once window.api exists at all, calls
    // getAppInfo(); Players then renders the real Roster, which calls
    // window.api.players.list(). Mock both so navigating away from Home doesn't
    // reject against a missing preload API either scene actually calls.
    // @ts-expect-error -- only the fields Home/Roster touch matter for this test
    window.api = {
      getAppInfo: vi.fn().mockResolvedValue({}),
      onPong: vi.fn().mockReturnValue(() => {}),
      players: { list: vi.fn().mockResolvedValue([]) },
    } as Window['api']

    render(<SceneRouter />)
    useSceneStore.getState().navigate('players')

    // AnimatePresence's exit animation is async, even in jsdom.
    // Players renders the real Roster -- "Add player" is its stable entry point.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add player' })).toBeInTheDocument())
    expect(screen.queryByText('Start a night')).not.toBeInTheDocument()
  })

  // Before this boundary existed, any render-phase throw inside a scene took
  // the whole React tree down to a blank window with nothing captured.
  it('contains a scene that throws while rendering, showing a fallback and logging the crash', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const previous = SCENE_REGISTRY['session-results']
    registerScene('session-results', function ExplodingScene(): never {
      throw new Error('scene exploded on render')
    })

    try {
      useSceneStore.setState({ current: 'session-results' })
      render(<SceneRouter />)

      await waitFor(() => expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument())
      expect(screen.getByTestId('error-boundary-fallback')).toHaveAttribute('data-error-boundary', 'scene:session-results')
      expect(screen.getByText(/scene exploded on render/)).toBeInTheDocument()

      const crashCall = errorSpy.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes(CRASH_PREFIX),
      )
      expect(crashCall).toBeDefined()
      expect(crashCall![0]).toContain('scene:session-results')
    } finally {
      if (previous) registerScene('session-results', previous)
    }
  })

  // ---- the navigation bar's safe area -----------------------------------

  describe('header safe area', () => {
    // 'lab' rather than a player-facing screen: every screen a player meets now
    // draws Back in its own header (sceneChrome.ts), so the band only exists
    // over the Dev Lab and the full-bleed gameplay scenes. The Lab route is not
    // registered in this file, so the router falls back to Home for the *body*
    // -- which is exactly right here, because the band is a property of the
    // frame, not of whatever scene is inside it.
    it('reserves space for the fallback bar on a sub-view that uses it, and none on the root', async () => {
      // @ts-expect-error -- only the fields Home touches matter here
      window.api = {
        getAppInfo: vi.fn().mockResolvedValue({}),
        onPong: vi.fn().mockReturnValue(() => {}),
        players: { list: vi.fn().mockResolvedValue([]) },
      } as Window['api']
      useSceneStore.setState({ current: 'home' })
      const { rerender } = render(<SceneRouter />)
      expect(screen.getByTestId('scene-frame').className).not.toContain('pt-20')

      useSceneStore.getState().navigate('lab')
      rerender(<SceneRouter />)

      await waitFor(() => expect(screen.getByTestId('scene-frame')).toHaveAttribute('data-scene', 'lab'))
      expect(screen.getByTestId('scene-frame').className).toContain('pt-20')
    })

    // The half of the partition this second pass moved. The roster, the mic
    // check, calibration, the mic rig, the library and the results celebration
    // all head themselves now, so none of them may reserve a band for a bar
    // that is not there -- that band *is* the flat dead strip across the top of
    // the window the user reported. (Results is the one taken end to end here
    // because it is the only one of the six that mounts with no preload API;
    // the membership itself is proved in sceneChrome.test.ts, and each screen's
    // own suite finds the button.)
    it('reserves nothing above the results celebration, which now owns the window', async () => {
      useSceneStore.setState({ current: 'session-results', history: [] })
      render(<SceneRouter />)

      await waitFor(() => expect(screen.getByTestId('scene-frame')).toHaveAttribute('data-scene', 'session-results'))
      expect(screen.getByTestId('scene-frame').className).not.toContain('pt-20')
      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
    })

    // The band is the other half of the compositional bug. A screen that draws
    // Back in its own header has nothing floating over it, so reserving 5rem
    // for a bar that is not there would leave a flat dead strip across the top
    // of the window with the screen's real header pushed 80px below it -- which
    // is what a screenshot of the old Settings and Song Selector showed, and
    // what the user reported twice. (HIG Layout: "Make sure backgrounds and
    // full-screen artwork extend to the edges of the display.")
    it('reserves nothing above a scene that draws Back in its own header', async () => {
      useSceneStore.setState({ current: 'settings' })
      render(<SceneRouter />)

      await waitFor(() => expect(screen.getByTestId('scene-frame')).toHaveAttribute('data-scene', 'settings'))
      expect(screen.getByTestId('scene-frame').className).not.toContain('pt-20')
    })

    // The "broken layout transition". The inset used to live on the app shell,
    // derived from the *current* scene, so it was removed the instant Back was
    // pressed -- while the screen it belonged to was still on screen, mid-exit.
    // The outgoing scene snapped 5rem up its own fade. Now the inset is inside
    // the keyed subtree AnimatePresence holds, so the screen leaving keeps the
    // one it was rendered with all the way out.
    it('keeps the outgoing scene’s inset for the whole of its exit, so nothing jumps mid-transition', async () => {
      // @ts-expect-error -- only the fields Home/Roster touch matter here
      window.api = {
        getAppInfo: vi.fn().mockResolvedValue({}),
        onPong: vi.fn().mockReturnValue(() => {}),
        players: { list: vi.fn().mockResolvedValue([]) },
      } as Window['api']
      useSceneStore.setState({ current: 'lab' })
      const { rerender } = render(<SceneRouter />)
      expect(screen.getByTestId('scene-frame').className).toContain('pt-20')

      useSceneStore.getState().navigate('home')
      rerender(<SceneRouter />)

      // Still the outgoing frame, still inset, still leaving.
      const leaving = screen.getByTestId('scene-frame')
      expect(leaving).toHaveAttribute('data-scene', 'lab')
      expect(leaving.className).toContain('pt-20')

      // And the screen that replaces it brings its own (absent) inset.
      await waitFor(() => expect(screen.getByTestId('scene-frame')).toHaveAttribute('data-scene', 'home'))
      expect(screen.getByTestId('scene-frame').className).not.toContain('pt-20')
    })
  })

  it('recovers once the scene changes -- the fallback does not stick around', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const previous = SCENE_REGISTRY['session-results']
    registerScene('session-results', function ExplodingScene(): never {
      throw new Error('scene exploded on render')
    })

    try {
      useSceneStore.setState({ current: 'session-results' })
      render(<SceneRouter />)
      await waitFor(() => expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument())

      useSceneStore.getState().navigate('home')

      await waitFor(() => expect(screen.getByText('Start a night')).toBeInTheDocument())
      expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument()
    } finally {
      if (previous) registerScene('session-results', previous)
    }
  })
})
