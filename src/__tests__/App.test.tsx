import { useEffect } from 'react'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { useSceneStore } from '../scenes/sceneStore'
import { SCENE_REGISTRY, registerScene } from '../scenes/sceneRegistry'
import { useAppPreferencesStore } from '../settings/appPreferencesStore'
import { createWebAudioManager } from '../audio/webAudioManager'
import { useSessionStore } from '../session/sessionStore'
import { useMicSlotStore } from '../multiplayer/store'
import { useMicHealthStore } from '../game/state/useMicHealthStore'
import { usePauseStore } from '../stage/pause/pauseStore'
import { useScoreStore } from '../game/state/useScoreStore'
// The real owner name a song's capture claim is held under, imported rather
// than retyped so the teardown test cannot quietly stop matching it.
import { GAMEPLAY_CAPTURE_OWNER } from '../multiplayer/MultiplayerGameplay'

import type { LibrarySong } from '../library/types'

// Enough of a song to drive the session machine's forward transitions, so the
// scene stack under a session screen is built by the real actions rather than
// written by hand.
const SONG: LibrarySong = {
  path: '/library/song',
  artist: 'Artist',
  title: 'Song',
  durationMs: 120000,
  thumbnailPath: null,
  mp3Path: '/library/song/song.mp3',
  videoPath: null,
  bpm: 120,
  gap: 0,
  hasVideo: false,
  hasCover: false,
  isDuet: false,
  isPlayable: true,
  addedAt: 1,
}

// App.tsx's scene-driven Audio Manager policy plays music on every mount --
// jsdom has no real AudioContext, so every test that renders <App/> needs this
// mocked, not just the policy tests in App.audioPolicy.test.tsx.
vi.mock('../audio/webAudioManager')

describe('App', () => {
  beforeEach(() => {
    useSceneStore.setState({ current: 'home', history: [] })
    useSessionStore.setState({
      phase: 'idle',
      sessionId: null,
      selectedSong: null,
      assignedPlayerIds: [],
      lastResult: null,
      songsPlayedThisSession: 0,
    })
    useAppPreferencesStore.setState({ perfOverlayVisible: false })
    // The two stores a song holds state in, so one test's abandon cannot make
    // the next one's teardown look clean for free.
    useMicSlotStore.setState({ captureHolders: [], runningCaptureKeys: [] })
    useMicHealthStore.setState({ byPlayerId: {} })
    usePauseStore.getState().reset()
    delete window.api
    vi.mocked(createWebAudioManager).mockReturnValue({
      play: vi.fn(),
      duckTo: vi.fn(),
      restore: vi.fn(),
      crossfadeTo: vi.fn(),
      stop: vi.fn(),
    })
  })

  // Asserted on the scene's own identity rather than on a control inside it.
  // This is a *shell* test -- what it has to prove is that Home's CTA reaches
  // the real Settings scene and not a placeholder -- and pinning it to whichever
  // panel Settings happens to open on made it fail whenever Settings
  // rearranged its sections. What each panel contains is Settings' own
  // suite's business (src/settings/__tests__/).
  it('navigates to the real Settings scene when its CTA is clicked', async () => {
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))

    await waitFor(() => expect(screen.getByTestId('settings-scene')).toBeInTheDocument())
  })

  // Back is drawn two ways now (src/scenes/sceneChrome.ts): screens with a
  // header of their own compose the control into it, and the rest get the
  // fallback bar. Settings is one of the former, so this is the end-to-end
  // proof that a *composed* Back runs the shell's own authority -- the button
  // lives inside the scene, and pressing it still steps one layer to Home.
  it('shows a Back control on any non-Home scene, and stepping back from one layer deep returns to the same Home', async () => {
    render(<App />)

    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await waitFor(() => expect(screen.getByTestId('settings-scene')).toBeInTheDocument())

    // No floating bar over this screen, and no reserved band under it: the
    // control is part of the screen's own layout.
    expect(screen.queryByTestId('scene-header')).not.toBeInTheDocument()
    const back = screen.getByRole('button', { name: 'Back' })
    expect(screen.getByTestId('settings-scene')).toContainElement(back)

    await userEvent.click(back)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Start a night' })).toBeInTheDocument())
    // The screen that was left is really gone, not stacked underneath the one
    // that replaced it -- and its Back went with it.
    expect(screen.queryByTestId('settings-scene')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument())
  })

  // The other half: a screen with no header of its own still gets the fallback
  // bar, so opting the player-facing screens out of it cannot have stranded the
  // rest.
  //
  // A lab scene rather than a menu screen or the Stage: after the Clean HUD
  // pass the bar only ever appears over /lab/* (src/scenes/sceneChrome.ts) --
  // every screen a player browses heads itself, and the three screens a song
  // occupies draw no control at all.
  it('falls back to the global bar on a scene with no header of its own', async () => {
    const previous = SCENE_REGISTRY['lab-stage']
    registerScene('lab-stage', function StubLabStage() {
      return <div data-testid="stub-lab-stage" />
    })

    try {
      useSceneStore.setState({ current: 'lab-stage', history: ['home'] })
      render(<App />)

      await waitFor(() => expect(screen.getByTestId('scene-header')).toBeInTheDocument())
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))

      expect(useSceneStore.getState().current).toBe('home')
    } finally {
      if (previous) registerScene('lab-stage', previous)
      else delete SCENE_REGISTRY['lab-stage']
    }
  })

  // And the screens that moved. Each of these was on the floating bar and now
  // draws Back inside its own header row; the shell must not also draw one, or
  // the screen has two Back buttons and a 5rem dead band above its real title.
  it('draws no bar over the screens that now head themselves', async () => {
    useSceneStore.setState({ current: 'session-results', history: ['home'] })
    render(<App />)

    await waitFor(() => expect(screen.getByTestId('session-results')).toBeInTheDocument())
    expect(screen.queryByTestId('scene-header')).not.toBeInTheDocument()
    // Still exactly one Back, and it is the screen's own.
    const back = screen.getByRole('button', { name: 'Back' })
    expect(screen.getByTestId('session-results')).toContainElement(back)

    await userEvent.click(back)
    expect(useSceneStore.getState().current).toBe('home')
  })

  it('steps back one layer at a time rather than jumping straight home', async () => {
    useSceneStore.setState({ current: 'session-results', history: ['home', 'settings'] })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(useSceneStore.getState().current).toBe('settings')

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(useSceneStore.getState().current).toBe('home')
  })

  it('moves the session machine back a phase instead of popping the scene stack behind it', async () => {
    useSessionStore.setState({ phase: 'assign', selectedSong: null, assignedPlayerIds: ['p1'] })
    useSceneStore.setState({ current: 'session-assign', history: ['home', 'session-select'] })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    // Phase and scene moved together -- neither is left describing the other's screen.
    expect(useSessionStore.getState().phase).toBe('select')
    expect(useSceneStore.getState().current).toBe('session-select')
  })

  // Walks the whole party loop backwards through the *one* Back handler and
  // checks the two machines agree at every single step. The scene stack and
  // the session machine are separate authorities that both move on Back, and
  // the failure mode is silent: `phase` describing a screen that is no longer
  // on screen, which then sends the next forward transition somewhere absurd.
  // The newer scenes ('session-starting', 'session-results',
  // 'session-leaderboard') were added after that delegation was written, so
  // this pins them specifically.
  //
  // `via` is not decoration: after the Clean HUD pass the countdown has no
  // control to click, so it is driven by the key a player actually uses. The
  // point of the walk is that both routes are the *same* authority, and it
  // would stop proving that if the keyboard rows were quietly dropped.
  it.each([
    {
      from: 'session-leaderboard',
      via: 'button',
      phase: 'leaderboard',
      history: ['home', 'session-select', 'session-assign', 'session-starting', 'session-play', 'session-results'],
      toScene: 'session-results',
      toPhase: 'results',
    },
    {
      from: 'session-starting',
      via: 'escape',
      phase: 'starting',
      history: ['home', 'session-select', 'session-assign'],
      toScene: 'session-assign',
      toPhase: 'assign',
    },
    {
      from: 'session-assign',
      via: 'button',
      phase: 'assign',
      history: ['home', 'session-select'],
      toScene: 'session-select',
      toPhase: 'select',
    },
    // The same step, taken with the key instead of the control: one authority,
    // two triggers, and the User Selection screen is where a player is most
    // likely to reach for either.
    {
      from: 'session-assign',
      via: 'escape',
      phase: 'assign',
      history: ['home', 'session-select'],
      toScene: 'session-select',
      toPhase: 'select',
    },
    // 'select' and 'results' have no earlier phase inside the loop, so Back
    // leaves it entirely -- and leaving means a clean reset, not a machine
    // parked mid-loop with no screen behind it.
    { from: 'session-select', via: 'button', phase: 'select', history: ['home'], toScene: 'home', toPhase: 'idle' },
    {
      from: 'session-results',
      via: 'button',
      phase: 'results',
      history: ['home', 'session-select', 'session-assign', 'session-starting', 'session-play'],
      toScene: 'home',
      toPhase: 'idle',
    },
  ] as const)(
    'keeps the scene and the session phase in lockstep stepping back from $from via $via',
    async ({ from, via, phase, history, toScene, toPhase }) => {
      useSessionStore.setState({
        phase,
        sessionId: 's1',
        lastResult: [],
        assignedPlayerIds: ['p1'],
        songsPlayedThisSession: 1,
      })
      useSceneStore.setState({ current: from, history: [...history] })
      render(<App />)

      if (via === 'button') await userEvent.click(await screen.findByRole('button', { name: 'Back' }))
      else await userEvent.keyboard('{Escape}')

      await waitFor(() => expect(useSceneStore.getState().current).toBe(toScene))
      expect(useSessionStore.getState().phase).toBe(toPhase)
      // The stack never keeps a copy of the screen just left, so a party night
      // of songs can't grow it without bound.
      expect(useSceneStore.getState().history).not.toContain(from)
    },
  )

  /**
   * Back out of User Selection, from every way in.
   *
   * The report behind these was "the User Selection Back button doesn't
   * accurately pop the history state". The single-step case was already
   * covered; what was not was the *entry path*, and there are now three of
   * them -- a normal pick from the Song Selector, the new double-click quick
   * start, and arriving backwards from the countdown. Each pushes a different
   * shape of scene stack underneath the screen, and `navigate`'s "unwind, don't
   * push" rule is what has to hold for all of them: stepping back to a scene
   * already in the stack must *shrink* it, never stack a second copy.
   *
   * A stack that grows on Back is the failure this is really about, and it is
   * silent -- Back still moves, so nothing looks wrong until a party night's
   * worth of songs has left twenty dead layers underneath Home and Back starts
   * walking back through screens the user left an hour ago. So the assertion is
   * on the whole stack, not just on `current`.
   */
  describe('leaving User Selection', () => {
    // Every entry path builds the stack for real, through the store actions the
    // screens themselves call -- no hand-written history, which would be the
    // test asserting its own assumption.
    const enterVia = {
      'a normal pick': () => {
        useSceneStore.setState({ current: 'home', history: [] })
        useSessionStore.setState({ phase: 'select', sessionId: 's1' })
        useSceneStore.getState().navigate('session-select')
        useSessionStore.getState().pickSong(SONG)
      },
      'the double-click quick start': () => {
        // Identical to a normal pick by construction: quick start commits
        // through `onSongPicked`, which *is* `pickSong`. Asserted anyway,
        // because "the shortcut takes a different route into the same screen"
        // is exactly the assumption that would make it a different bug.
        useSceneStore.setState({ current: 'home', history: [] })
        useSessionStore.setState({ phase: 'select', sessionId: 's1' })
        useSceneStore.getState().navigate('session-select')
        useSessionStore.getState().pickSong(SONG)
      },
      'stepping back out of the countdown': () => {
        useSceneStore.setState({ current: 'home', history: [] })
        useSessionStore.setState({ phase: 'select', sessionId: 's1' })
        useSceneStore.getState().navigate('session-select')
        useSessionStore.getState().pickSong(SONG)
        useSessionStore.getState().assignPlayers(['p1'])
        useSessionStore.getState().back()
      },
    } as const

    it.each(Object.keys(enterVia) as (keyof typeof enterVia)[])(
      'pops to the Song Selector and then Home, having arrived via %s',
      async (path) => {
        enterVia[path]()
        expect(useSceneStore.getState().current).toBe('session-assign')
        const depthOnArrival = useSceneStore.getState().history.length
        render(<App />)

        await userEvent.click(await screen.findByRole('button', { name: 'Back' }))

        await waitFor(() => expect(useSceneStore.getState().current).toBe('session-select'))
        expect(useSessionStore.getState().phase).toBe('select')
        // Unwound, not pushed: one layer shallower than the screen it left, and
        // with no copy of that screen buried in it.
        expect(useSceneStore.getState().history).toEqual(['home'])
        expect(useSceneStore.getState().history.length).toBeLessThan(depthOnArrival)

        await userEvent.click(await screen.findByRole('button', { name: 'Back' }))

        await waitFor(() => expect(useSceneStore.getState().current).toBe('home'))
        expect(useSessionStore.getState().phase).toBe('idle')
        expect(useSceneStore.getState().history).toEqual([])
      },
    )

    /**
     * The empty-roster detour, which is the one place a screen inside the party
     * loop navigates the *scene stack* directly rather than moving the session
     * machine: "No players yet" offers "Add a player", which pushes the roster
     * on top of `session-assign` while `phase` stays 'assign'.
     *
     * That leaves the two authorities deliberately out of step for the duration
     * of the visit, and Back has to read the *scene* to decide which one to
     * move -- the roster is not a session scene, so Back pops the stack; the
     * screen underneath it is, so the next Back moves the machine. Get that
     * wrong in either direction and the user is either stuck on the roster or
     * thrown out of the session from it.
     */
    it('comes back from the roster it sent you to, and only then leaves the screen', async () => {
      useSceneStore.setState({ current: 'home', history: [] })
      useSessionStore.setState({ phase: 'select', sessionId: 's1' })
      useSceneStore.getState().navigate('session-select')
      useSessionStore.getState().pickSong(SONG)
      // What the empty state's "Add a player" does.
      useSceneStore.getState().navigate('players')
      expect(useSceneStore.getState().history).toEqual(['home', 'session-select', 'session-assign'])
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: 'Back' }))

      // Back to the screen that sent you, with the session untouched.
      await waitFor(() => expect(useSceneStore.getState().current).toBe('session-assign'))
      expect(useSessionStore.getState().phase).toBe('assign')
      expect(useSceneStore.getState().history).toEqual(['home', 'session-select'])

      await userEvent.click(await screen.findByRole('button', { name: 'Back' }))

      // And now the machine moves, because this screen is one of its own.
      await waitFor(() => expect(useSceneStore.getState().current).toBe('session-select'))
      expect(useSessionStore.getState().phase).toBe('select')
      expect(useSceneStore.getState().history).toEqual(['home'])
    })
  })

  // Back must never be a dead end. `sessionStore.back()`'s 'idle' arm returns
  // without doing anything -- correct for the machine, and a button that does
  // nothing for the user -- so a session-* scene reached with the machine
  // already reset (a direct setState, a lab scene, recovery after the
  // error boundary sent the app home) has to fall through to the scene stack.
  it('still moves when a session scene is showing but the session machine has been reset', async () => {
    useSessionStore.setState({ phase: 'idle', selectedSong: null, assignedPlayerIds: [] })
    useSceneStore.setState({ current: 'session-leaderboard', history: ['home'] })
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    await waitFor(() => expect(useSceneStore.getState().current).toBe('home'))
  })

  /**
   * Back mid-song pauses; it never throws a song away by itself.
   *
   * There is no on-screen control over the song (see src/scenes/sceneChrome.ts),
   * so these drive it the way a player does: Escape opens the pause menu, and
   * leaving is the menu's Quit.
   */
  describe('pausing a song mid-play', () => {
    beforeEach(() => {
      useSessionStore.setState({ phase: 'play', mode: 'classic', assignedPlayerIds: ['p1'] })
      useSceneStore.setState({ current: 'session-play', history: ['home', 'session-select'] })
    })

    // The removal itself, asserted on the running shell rather than only on the
    // predicate: no bar, no header row, nothing labelled Back anywhere on the
    // window while a song is playing.
    it('draws no Back control anywhere over the song', async () => {
      render(<App />)

      await waitFor(() => expect(screen.getByTestId('scene-frame')).toHaveAttribute('data-scene', 'session-play'))
      expect(screen.queryByTestId('scene-header')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
      // And no band reserved for the bar that is gone: the Stage owns y=0.
      expect(screen.getByTestId('scene-frame').className).not.toContain('pt-20')
    })

    it('opens the pause menu on Escape, with Resume focused, and leaves nothing yet', async () => {
      render(<App />)

      await userEvent.keyboard('{Escape}')

      expect(screen.getByRole('dialog')).toHaveAccessibleName('Paused')
      expect(screen.getByRole('button', { name: 'Resume' })).toHaveFocus()
      expect(screen.getByRole('button', { name: 'Restart song' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Quit to song select' })).toBeInTheDocument()
      expect(usePauseStore.getState().phase).toBe('menu')
      expect(useSessionStore.getState().phase).toBe('play')
      expect(useSceneStore.getState().current).toBe('session-play')
    })

    it('counts back in after Resume, then carries on singing', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        render(<App />)
        await userEvent.keyboard('{Escape}')
        await userEvent.click(screen.getByRole('button', { name: 'Resume' }))

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(screen.getByTestId('pause-resume-countdown')).toHaveTextContent('3')
        expect(usePauseStore.getState().phase).toBe('resuming')

        await act(async () => {
          vi.advanceTimersByTime(3000)
        })
        expect(usePauseStore.getState().phase).toBe('running')
        expect(screen.queryByTestId('pause-resume-countdown')).not.toBeInTheDocument()
        expect(useSessionStore.getState().phase).toBe('play')
      } finally {
        vi.useRealTimers()
      }
    })

    // The same key that opened the menu closes it again -- and Back never
    // answers Quit.
    it('treats a second Escape as Resume, never as Quit', async () => {
      render(<App />)

      await userEvent.keyboard('{Escape}')
      await userEvent.keyboard('{Escape}')

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(usePauseStore.getState().phase).toBe('resuming')
      expect(useSessionStore.getState().phase).toBe('play')
    })

    it('restarts the song with the scores zeroed', async () => {
      useScoreStore.getState().reset({ players: [{ playerId: 'p1', name: 'Alex', score: 4200, combo: 0, rank: 1 }], combo: 0, rank: ['p1'] })
      const token = usePauseStore.getState().restartToken
      render(<App />)

      await userEvent.keyboard('{Escape}')
      await userEvent.click(screen.getByRole('button', { name: 'Restart song' }))

      expect(usePauseStore.getState().restartToken).toBe(token + 1)
      expect(usePauseStore.getState().phase).toBe('running')
      expect(useScoreStore.getState().players[0].score).toBe(0)
      expect(useSessionStore.getState().phase).toBe('play')
    })

    // Quit records nothing and goes back to the song list, with the machine
    // moved on rather than parked on 'play'.
    it('quits to the song select without recording a score', async () => {
      render(<App />)

      await userEvent.keyboard('{Escape}')
      await userEvent.click(screen.getByRole('button', { name: 'Quit to song select' }))

      await waitFor(() => expect(useSessionStore.getState().phase).toBe('select'))
      expect(useSessionStore.getState().lastResult).toBeNull()
      expect(useSessionStore.getState().songsPlayedThisSession).toBe(0)
      expect(useSessionStore.getState().selectedSong).toBeNull()
      expect(useSceneStore.getState().current).toBe('session-select')
      expect(usePauseStore.getState().phase).toBe('running')
    })

    // A party night quits the way an abandoned song always did: the session ends.
    it('ends the session when quitting a party song', async () => {
      useSessionStore.setState({ mode: 'party' })
      render(<App />)

      await userEvent.keyboard('{Escape}')
      await userEvent.click(screen.getByRole('button', { name: 'End the party' }))

      await waitFor(() => expect(useSessionStore.getState().phase).toBe('idle'))
      expect(useSessionStore.getState().assignedPlayerIds).toEqual([])
      expect(useSceneStore.getState().current).toBe('home')
    })

    /**
     * The load-bearing half of "exiting must unmount the song context cleanly".
     *
     * Navigating is the easy part; what actually matters is that the gameplay
     * subtree really leaves the tree, because everything the song holds is
     * released by unmount cleanups -- MultiplayerGameplay's
     * `releaseCaptures('gameplay')`, Gameplay's per-player
     * `useMicHealthStore.clear()`, Stage's media elements. A shell that changed
     * scenes while leaving the old subtree mounted would pass every other test
     * here and leave eight native capture streams open.
     *
     * The stub stands in for the real gameplay tree (which wants a chart, an
     * `<audio>` and a preload bridge) but holds the *real* claim on the *real*
     * store, under the same owner name MultiplayerGameplay uses -- so what is
     * being proved is the shell's teardown, not the stub's.
     */
    it('unmounts the gameplay subtree on quit, releasing the claims it holds', async () => {
      const previous = SCENE_REGISTRY['session-play']
      registerScene('session-play', function StubGameplay() {
        useEffect(() => {
          void useMicSlotStore.getState().acquireCaptures(GAMEPLAY_CAPTURE_OWNER)
          useMicHealthStore.getState().report('p1', 'ok', 'device-1')
          return () => {
            void useMicSlotStore.getState().releaseCaptures(GAMEPLAY_CAPTURE_OWNER)
          }
        }, [])
        return <div data-testid="stub-gameplay" />
      })

      try {
        render(<App />)
        await waitFor(() => expect(useMicSlotStore.getState().captureHolders).toContain(GAMEPLAY_CAPTURE_OWNER))
        expect(useMicHealthStore.getState().byPlayerId.p1).toBeDefined()

        await userEvent.keyboard('{Escape}')
        await userEvent.click(screen.getByRole('button', { name: 'Quit to song select' }))

        // The subtree is gone, so its cleanups have run...
        await waitFor(() => expect(screen.queryByTestId('stub-gameplay')).not.toBeInTheDocument())
        await waitFor(() =>
          expect(useMicSlotStore.getState().captureHolders).not.toContain(GAMEPLAY_CAPTURE_OWNER),
        )
        // ...and the mic-health board is empty rather than still describing a
        // singer who left: a lane that never mounted has no cleanup to run.
        expect(useMicHealthStore.getState().byPlayerId).toEqual({})
        // And the machine has moved on, not parked on 'play' with no song running.
        expect(useSessionStore.getState().phase).toBe('select')
      } finally {
        if (previous) registerScene('session-play', previous)
      }
    })
  })

  describe('couch navigation', () => {
    it('Escape steps back, so the shell is usable without a mouse', async () => {
      useSceneStore.setState({ current: 'settings', history: ['home'] })
      render(<App />)

      await userEvent.keyboard('{Escape}')

      await waitFor(() => expect(useSceneStore.getState().current).toBe('home'))
    })

    it('Escape mid-song opens the pause menu', async () => {
      useSessionStore.setState({ phase: 'play' })
      useSceneStore.setState({ current: 'session-play', history: ['home'] })
      render(<App />)

      await userEvent.keyboard('{Escape}')

      expect(await screen.findByRole('dialog')).toHaveAccessibleName('Paused')
      expect(useSessionStore.getState().phase).toBe('play')
    })

    /**
     * The other half of "unmounts cleanly": the listener that now carries the
     * only exit from a song is a *window* listener, so it outlives any screen
     * unless it is removed. One that survived a teardown would keep answering
     * keys for a shell that no longer exists -- and on a couch app the symptom
     * is the reported one, an Escape that navigates something invisible.
     */
    it('takes its key listener with it when the shell unmounts', async () => {
      useSceneStore.setState({ current: 'settings', history: ['home'] })
      const { unmount } = render(<App />)
      unmount()

      useSceneStore.setState({ current: 'settings', history: ['home'] })
      await userEvent.keyboard('{Escape}')

      expect(useSceneStore.getState().current).toBe('settings')
    })

    // The listener is bound once for the life of the shell, not re-bound per
    // render -- `handleBack` is a stable callback and `useKeyboardNavigation`
    // holds it in a ref. A per-render rebind is the kind of cost that shows up
    // as input lag on the screen that re-renders most.
    it('binds exactly one keydown listener for the whole shell', () => {
      const addSpy = vi.spyOn(window, 'addEventListener')

      const { rerender } = render(<App />)
      rerender(<App />)

      const keydownBinds = addSpy.mock.calls.filter(([type]) => type === 'keydown')
      expect(keydownBinds).toHaveLength(1)
      addSpy.mockRestore()
    })
  })

  // Was: "shows the 'run npm run dev' IPC placeholder". That placeholder was
  // the scaffold IpcDemo's, and it is gone -- but the claim underneath it
  // still matters, so it is asserted directly instead: the app renders its
  // real menu in browser preview, with no window.api, rather than blanking or
  // throwing on a missing bridge.
  it('renders the menu when window.api is absent (browser preview)', async () => {
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Start a night' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  // Was: "renders AppInfo and enables IPC demo". Those panels now live in
  // Settings > About (version) and nowhere (the ping demo). The menu's status
  // readout is player-facing copy now -- a mic count, never the backend name.
  it('renders the plain menu with a player-facing mic readout when window.api is present (Electron)', async () => {
    const getAppInfo = vi.fn().mockResolvedValue({
      name: 'AetherStar',
      version: '1.0.0',
      electron: '37.2.6',
      chrome: '128',
      node: '22',
      platform: 'darwin',
      arch: 'arm64',
    })
    window.api = {
      getAppInfo,
      getWindowRole: vi.fn().mockReturnValue('main'),
      openFile: vi.fn(),
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      ping: vi.fn(),
      onPong: vi.fn().mockReturnValue(() => {}),
      library: {
        addRoot: vi.fn(),
        removeRoot: vi.fn(),
        listRoots: vi.fn(),
        rescan: vi.fn(),
        search: vi.fn(),
        getSong: vi.fn(),
        listScanErrors: vi.fn(),
        onScanProgress: vi.fn().mockReturnValue(() => {}),
      },
      stage: {
        getFixtureChartPath: vi.fn(),
      },
      players: {
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        reorder: vi.fn(),
        readImportedPhoto: vi.fn(),
      },
      audio: {
        listDevices: vi.fn(),
        requestPermission: vi.fn(),
        getPermissionStatus: vi.fn(),
        startCapture: vi.fn(),
        stopCapture: vi.fn(),
        startRawScope: vi.fn(),
        stopRawScope: vi.fn(),
        onPitchBatch: vi.fn().mockReturnValue(() => {}),
        onDeviceListChanged: vi.fn().mockReturnValue(() => {}),
        onRawScopeChunk: vi.fn().mockReturnValue(() => {}),
      },
      audience: {
        reportScoreState: vi.fn(),
        listDisplays: vi.fn(),
        setDisplay: vi.fn(),
        setEnabled: vi.fn(),
        onScoreState: vi.fn().mockReturnValue(() => {}),
      },
      fx: {
        getAssetsDir: vi.fn(),
      },
      session: {
        start: vi.fn(),
        recordEntry: vi.fn(),
        listLeaderboard: vi.fn(),
      },
      multiplayer: {
        listMicSlots: vi.fn(),
        saveMicSlot: vi.fn(),
        clearMicSlot: vi.fn(),
        getCpuUsage: vi.fn(),
      },
      calibration: {
        get: vi.fn(),
        set: vi.fn(),
      },
    }

    render(<App />)

    await waitFor(() => expect(screen.getByTestId('home-status')).toHaveTextContent('No mic found'))
    expect(screen.getByTestId('home-status').textContent).not.toMatch(/CORE AUDIO|WASAPI/)
    // The scaffold panels are gone for good: no version dump, no ping button.
    expect(screen.queryByRole('button', { name: 'Send ping' })).not.toBeInTheDocument()
    expect(screen.queryByText(/AetherStar v1\.0\.0/)).not.toBeInTheDocument()
  })

  it('renders AudienceScoreboard instead of the Home menu when window.api.getWindowRole() reports "audience"', () => {
    // @ts-expect-error -- only the fields the audience render path touches matter for this test
    window.api = {
      getWindowRole: vi.fn().mockReturnValue('audience'),
      audience: {
        reportScoreState: vi.fn(),
        listDisplays: vi.fn(),
        setDisplay: vi.fn(),
        onScoreState: vi.fn().mockReturnValue(() => {}),
      },
      players: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        reorder: vi.fn(),
        readImportedPhoto: vi.fn(),
      },
    } as Window['api']

    render(<App />)

    expect(screen.queryByRole('button', { name: 'Start a night' })).not.toBeInTheDocument()
  })

  /**
   * The audience display is a *screen*, not a second speaker.
   *
   * It renders the same bundle as the main window, and React cannot call a
   * hook conditionally -- so the scene-driven audio policy below ran to
   * completion in the audience renderer before the `windowRole === 'audience'`
   * early return was ever reached. The result was the menu track and every
   * song preview playing out of the TV as well as the host machine, slightly
   * out of phase with each other. Nothing in the audience UI asks for audio;
   * the policy simply was not told which window it was in.
   */
  it('never plays audio in the audience window', () => {
    // @ts-expect-error -- only the fields the audience render path touches matter for this test
    window.api = {
      getWindowRole: vi.fn().mockReturnValue('audience'),
      audience: {
        reportScoreState: vi.fn(),
        listDisplays: vi.fn(),
        setDisplay: vi.fn(),
        onScoreState: vi.fn().mockReturnValue(() => {}),
      },
      players: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        reorder: vi.fn(),
        readImportedPhoto: vi.fn(),
      },
    } as Window['api']

    // The store caches its engine in a module variable, so the live instance is
    // whichever the factory returned *first* in this file -- and it carries the
    // calls every earlier test made through it. Clear those before rendering,
    // or this asserts on another test's history.
    const audio = vi.mocked(createWebAudioManager).mock.results[0]?.value
    vi.mocked(audio.play).mockClear()
    vi.mocked(audio.crossfadeTo).mockClear()

    render(<App />)

    expect(audio.play).not.toHaveBeenCalled()
    expect(audio.crossfadeTo).not.toHaveBeenCalled()
  })

  // A developer tool: in DEV (which is what tests run as) the preference shows
  // it, lazily loaded; production builds compile the overlay out entirely.
  it('renders the perf overlay only when useAppPreferencesStore.perfOverlayVisible is true', async () => {
    const { unmount } = render(<App />)
    expect(screen.queryByTestId('perf-overlay')).not.toBeInTheDocument()
    unmount()

    useAppPreferencesStore.setState({ perfOverlayVisible: true })
    render(<App />)
    expect(await screen.findByTestId('perf-overlay')).toBeInTheDocument()
  })

  // The whole point of putting a second boundary *inside* SceneRouter: a
  // crashing scene must never take the global chrome with it, or the user's
  // only way out is quitting the app.
  it('keeps the global Back control usable when the active scene crashes, and recovers on stepping back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const previous = SCENE_REGISTRY['lab-stage']
    registerScene('lab-stage', function ExplodingScene(): never {
      throw new Error('scene exploded on render')
    })

    try {
      useSceneStore.setState({ current: 'lab-stage' })
      render(<App />)

      await waitFor(() => expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument())
      // The scene-level boundary caught it -- not the app-shell one.
      expect(screen.getByTestId('error-boundary-fallback')).toHaveAttribute(
        'data-error-boundary',
        'scene:lab-stage',
      )

      // Entered by a direct setState, so there is no history to pop -- Back
      // still has to have a way out, and bottoms out at Home.
      const backButton = screen.getByRole('button', { name: 'Back' })
      await userEvent.click(backButton)

      await waitFor(() => expect(screen.getByRole('button', { name: 'Start a night' })).toBeInTheDocument())
      expect(screen.queryByTestId('error-boundary-fallback')).not.toBeInTheDocument()
    } finally {
      vi.restoreAllMocks()
      if (previous) registerScene('lab-stage', previous)
      else delete SCENE_REGISTRY['lab-stage']
    }
  })

  /**
   * A crashing *gameplay* scene is the one case the removed bar used to cover
   * and nothing else does: there is no header row to fall back to, and the
   * error boundary's own fallback is inside the scene subtree. So Escape has to
   * be the way out, and it has to still be listening after a scene threw.
   */
  it('still leaves a crashed gameplay scene by Escape, with no control to press', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const previous = SCENE_REGISTRY['session-play']
    registerScene('session-play', function ExplodingGameplay(): never {
      throw new Error('gameplay exploded on render')
    })

    try {
      useSessionStore.setState({ phase: 'play', assignedPlayerIds: ['p1'] })
      useSceneStore.setState({ current: 'session-play', history: ['home'] })
      render(<App />)

      await waitFor(() => expect(screen.getByTestId('error-boundary-fallback')).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()

      await userEvent.keyboard('{Escape}')
      await userEvent.click(await screen.findByRole('button', { name: 'Quit to song select' }))

      await waitFor(() => expect(useSceneStore.getState().current).toBe('session-select'))
      expect(useSessionStore.getState().phase).toBe('select')
    } finally {
      vi.restoreAllMocks()
      if (previous) registerScene('session-play', previous)
    }
  })
})
