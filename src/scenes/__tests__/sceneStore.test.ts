import { describe, expect, it, beforeEach } from 'vitest'
import { useSceneStore } from '../sceneStore'

describe('useSceneStore', () => {
  beforeEach(() => {
    useSceneStore.setState({ current: 'home', history: [] })
  })

  it('starts on the boot scene', () => {
    expect(useSceneStore.getInitialState().current).toBe('boot')
  })

  it("navigates to 'boot' exactly like any other scene", () => {
    useSceneStore.getState().navigate('boot')
    expect(useSceneStore.getState().current).toBe('boot')
  })

  it('navigates to another registered scene', () => {
    useSceneStore.getState().navigate('players')
    expect(useSceneStore.getState().current).toBe('players')
  })

  it("navigates to 'lab-library' exactly like any other scene", () => {
    useSceneStore.getState().navigate('lab-library')
    expect(useSceneStore.getState().current).toBe('lab-library')
  })

  it("navigates to 'mic' exactly like any other scene", () => {
    useSceneStore.getState().navigate('mic')
    expect(useSceneStore.getState().current).toBe('mic')
  })

  it("navigates to 'lab-mic' exactly like any other scene", () => {
    useSceneStore.getState().navigate('lab-mic')
    expect(useSceneStore.getState().current).toBe('lab-mic')
  })

  it("navigates to 'lab-audience' exactly like any other scene", () => {
    useSceneStore.getState().navigate('lab-audience')
    expect(useSceneStore.getState().current).toBe('lab-audience')
  })

  it.each([
    'session-select',
    'session-assign',
    'session-play',
    'session-results',
    'session-leaderboard',
    'lab-session',
  ] as const)("navigates to '%s' exactly like any other scene", (scene) => {
    useSceneStore.getState().navigate(scene)
    expect(useSceneStore.getState().current).toBe(scene)
  })

  // ---- Back stack ---------------------------------------------------

  describe('history stack', () => {
    it('starts with an empty history', () => {
      expect(useSceneStore.getInitialState().history).toEqual([])
    })

    it('pushes the scene it left onto the history stack', () => {
      useSceneStore.getState().navigate('settings')
      expect(useSceneStore.getState().history).toEqual(['home'])
      useSceneStore.getState().navigate('calibration')
      expect(useSceneStore.getState().history).toEqual(['home', 'settings'])
    })

    it('back() pops one layer at a time rather than jumping straight home', () => {
      useSceneStore.getState().navigate('settings')
      useSceneStore.getState().navigate('calibration')

      useSceneStore.getState().back()
      expect(useSceneStore.getState().current).toBe('settings')
      expect(useSceneStore.getState().history).toEqual(['home'])

      useSceneStore.getState().back()
      expect(useSceneStore.getState().current).toBe('home')
      expect(useSceneStore.getState().history).toEqual([])
    })

    it('back() on home with an empty history stays put', () => {
      useSceneStore.getState().back()
      expect(useSceneStore.getState().current).toBe('home')
    })

    // Scenes can be entered without a push (a direct setState, the Dev Lab
    // hotkey firing from boot). Back must still always have a way out.
    it('back() falls back to home when there is no history to pop', () => {
      useSceneStore.setState({ current: 'players', history: [] })
      useSceneStore.getState().back()
      expect(useSceneStore.getState().current).toBe('home')
    })

    it('navigate(scene, { replace: true }) swaps the current scene without pushing it', () => {
      useSceneStore.getState().navigate('settings')
      useSceneStore.getState().navigate('calibration', { replace: true })
      expect(useSceneStore.getState().current).toBe('calibration')
      expect(useSceneStore.getState().history).toEqual(['home'])
    })

    // Boot is a handoff, not a step the user took -- it must never be a back
    // target even if something navigates away from it without `replace`.
    it("never records 'boot' as a back target", () => {
      useSceneStore.setState({ current: 'boot', history: [] })
      useSceneStore.getState().navigate('home')
      expect(useSceneStore.getState().history).toEqual([])
      expect(useSceneStore.getState().current).toBe('home')
    })

    it('navigating to the scene already showing is a no-op, never a duplicate stack entry', () => {
      useSceneStore.getState().navigate('settings')
      useSceneStore.getState().navigate('settings')
      expect(useSceneStore.getState().history).toEqual(['home'])
    })

    // The stack self-heals instead of growing forever: jumping to a scene that
    // is already below you (endSession -> home, playAgain -> session-select)
    // unwinds to it rather than stacking a second copy on top.
    it('unwinds to an existing entry instead of pushing a second copy of it', () => {
      useSceneStore.getState().navigate('session-select')
      useSceneStore.getState().navigate('session-assign')
      useSceneStore.getState().navigate('session-starting')

      useSceneStore.getState().navigate('session-select')

      expect(useSceneStore.getState().current).toBe('session-select')
      expect(useSceneStore.getState().history).toEqual(['home'])
    })
  })
})
