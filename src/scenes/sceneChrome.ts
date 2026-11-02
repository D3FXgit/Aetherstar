import type { SceneName } from './sceneStore'

/**
 * Where Back appears, and how. Every scene is in exactly one state:
 *  - root (Home, Boot): no Back at all;
 *  - self-headed: Back is the leading item of the screen's own title row;
 *  - chromeless (a song is playing): Back exists only as Escape, Backspace or
 *    gamepad B, which raise the abandon confirmation; no control covers the song;
 *  - everything else (lab scenes): a fallback bar pinned to the top.
 * sceneChrome.test.ts proves the partition is total.
 */

/** Home is the root of the stack and Boot a splash, so neither offers Back. */
const ROOT_SCENE_LIST = ['home', 'boot'] as const satisfies readonly SceneName[]
const ROOT_SCENES: ReadonlySet<SceneName> = new Set<SceneName>(ROOT_SCENE_LIST)

/**
 * Scenes that draw Back in their own header row. Listing a scene here is a
 * promise that it renders `<BackButton />` (SceneHeader.tsx); each screen's
 * own test checks the button is really there.
 */
const SELF_HEADED_SCENE_LIST = [
  'session-select',
  'session-assign',
  'session-party-draw',
  'session-leaderboard',
  'settings',
  'players',
  'mic',
  'calibration',
  'hardware-setup',
  'session-results',
] as const satisfies readonly SceneName[]
const SELF_HEADED_SCENES: ReadonlySet<SceneName> = new Set<SceneName>(SELF_HEADED_SCENE_LIST)

/**
 * The song (or the jukebox's video), and nothing else: Back is reachable
 * (Escape, Backspace, gamepad B) but nothing draws it over the content.
 */
const CHROMELESS_BACK_SCENE_LIST = [
  'session-starting',
  'session-play',
  'jukebox',
] as const satisfies readonly SceneName[]
const CHROMELESS_BACK_SCENES: ReadonlySet<SceneName> = new Set<SceneName>(CHROMELESS_BACK_SCENE_LIST)

/** Compile-time proof that no scene sits in two of the lists (an overlap would silently pick one branch). */
type _Overlap =
  | Extract<(typeof ROOT_SCENE_LIST)[number], (typeof SELF_HEADED_SCENE_LIST)[number]>
  | Extract<(typeof ROOT_SCENE_LIST)[number], (typeof CHROMELESS_BACK_SCENE_LIST)[number]>
  | Extract<(typeof SELF_HEADED_SCENE_LIST)[number], (typeof CHROMELESS_BACK_SCENE_LIST)[number]>
const _setsAreDisjoint: _Overlap extends never ? true : never = true
void _setsAreDisjoint

/** Can the user get back from here? Everything except the two root scenes. */
export function sceneShowsBack(scene: SceneName): boolean {
  return !ROOT_SCENES.has(scene)
}

/** True when the screen composes Back into its own header row. */
export function sceneRendersOwnBack(scene: SceneName): boolean {
  return sceneShowsBack(scene) && SELF_HEADED_SCENES.has(scene)
}

/**
 * True when Back exists but no on-screen control carries it -- keyboard and
 * gamepad only. Exactly the scenes a song is playing over.
 */
export function sceneHidesBackControl(scene: SceneName): boolean {
  return sceneShowsBack(scene) && CHROMELESS_BACK_SCENES.has(scene)
}

/**
 * True when the shell draws the fallback bar. SceneRouter reserves the band on
 * the same predicate, so the bar and its space can never drift apart.
 */
export function sceneShowsHeader(scene: SceneName): boolean {
  return sceneShowsBack(scene) && !SELF_HEADED_SCENES.has(scene) && !CHROMELESS_BACK_SCENES.has(scene)
}

/** The fallback bar's height and the matching band a scene under it keeps clear. */
export const SCENE_HEADER_HEIGHT_CLASS = 'h-20'
export const SCENE_HEADER_INSET_CLASS = 'pt-20'
