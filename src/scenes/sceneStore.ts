import { create } from 'zustand'

export type SceneName =
  | 'boot'
  | 'home'
  | 'players'
  | 'settings'
  | 'mic'
  | 'lab'
  | 'lab-library'
  | 'lab-mic'
  | 'lab-stage'
  | 'lab-audience'
  | 'lab-gameplay'
  | 'lab-fx'
  | 'calibration'
  | 'hardware-setup'
  | 'lab-calibration'
  | 'lab-multiplayer'
  | 'session-select'
  | 'session-assign'
  | 'session-party-draw'
  | 'session-starting'
  | 'session-play'
  | 'session-results'
  | 'session-leaderboard'
  | 'lab-session'
  | 'jukebox'

export interface NavigateOptions {
  /**
   * Swap the current scene instead of pushing it onto the back stack. For
   * handoffs the user never chose -- Boot -> Home once the audio bridge
   * answers -- so that Back from Home never lands on the splash again.
   */
  replace?: boolean
}

interface SceneStoreState {
  current: SceneName
  /**
   * The scenes underneath `current`, oldest first. Never contains `current`
   * itself and never contains 'boot'.
   */
  history: SceneName[]
  navigate: (scene: SceneName, options?: NavigateOptions) => void
  /** Step back exactly one layer. */
  back: () => void
}

// Every scene reachable by Back bottoms out here: Home is the app's root, and
// `back()` from a scene entered without a push (a direct setState, the Dev Lab
// hotkey) must still have somewhere to go rather than silently doing nothing.
const ROOT_SCENE: SceneName = 'home'

export const useSceneStore = create<SceneStoreState>((set) => ({
  current: 'boot',
  history: [],

  navigate: (scene, options) =>
    set((state) => {
      if (scene === state.current) return state

      // 'boot' is a splash the user is handed through, not a step they took.
      if (options?.replace || state.current === 'boot') return { current: scene }

      // Jumping to a scene that is already below us unwinds to it instead of
      // stacking a second copy. Without this the stack grows without bound
      // across a party night (Home -> select -> ... -> endSession -> Home ->
      // ...), and Back would walk back through screens the user already left.
      const existing = state.history.indexOf(scene)
      if (existing !== -1) return { current: scene, history: state.history.slice(0, existing) }

      return { current: scene, history: [...state.history, state.current] }
    }),

  back: () =>
    set((state) => {
      if (state.history.length === 0) {
        return state.current === ROOT_SCENE ? state : { current: ROOT_SCENE }
      }
      return {
        current: state.history[state.history.length - 1]!,
        history: state.history.slice(0, -1),
      }
    }),
}))
