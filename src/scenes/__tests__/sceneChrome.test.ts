import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SceneName } from '../sceneStore'
import {
  sceneHidesBackControl,
  sceneRendersOwnBack,
  sceneShowsBack,
  sceneShowsHeader,
} from '../sceneChrome'

/**
 * Every scene in the app, listed once so the rules below can be checked
 * against all of them rather than a hand-picked handful.
 *
 * The `satisfies` plus the exhaustiveness guard underneath are the point: add a
 * scene to `SceneName` and forget it here, and `tsc` fails. That is what keeps
 * "no Back-bearing scene has lost its Back" a standing guarantee instead of a
 * fact about the day it was written.
 */
const ALL_SCENES = [
  'boot',
  'home',
  'players',
  'settings',
  'mic',
  'lab',
  'lab-library',
  'lab-mic',
  'lab-stage',
  'lab-audience',
  'lab-gameplay',
  'lab-fx',
  'calibration',
  'hardware-setup',
  'lab-calibration',
  'lab-multiplayer',
  'session-select',
  'session-assign',
  'session-party-draw',
  'session-starting',
  'session-play',
  'session-results',
  'session-leaderboard',
  'lab-session',
  'jukebox',
] as const satisfies readonly SceneName[]

// Compile-time proof the list above is complete: if a new SceneName is not in
// it, `Missing` stops being `never` and this line stops type-checking.
type Missing = Exclude<SceneName, (typeof ALL_SCENES)[number]>
const _listIsExhaustive: Missing extends never ? true : never = true
void _listIsExhaustive

const ROOTS: readonly SceneName[] = ['home', 'boot']
const SELF_HEADED: readonly SceneName[] = [
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
]
/**
 * The screens a song plays on: Back is reachable by Escape/Backspace/gamepad B,
 * and nothing draws a control for it.
 */
const CHROMELESS: readonly SceneName[] = ['session-starting', 'session-play', 'jukebox']

describe('sceneChrome', () => {
  describe('which scenes offer Back at all', () => {
    it.each(ROOTS)("offers no Back on '%s', the bottom of the stack", (scene) => {
      expect(sceneShowsBack(scene)).toBe(false)
    })

    // The invariant the app is actually held to. Everything that is not a root
    // scene is somewhere the user can be stranded.
    it('offers Back on every scene that has a layer beneath it', () => {
      const withoutBack = ALL_SCENES.filter((scene) => !sceneShowsBack(scene))

      expect([...withoutBack].sort()).toEqual([...ROOTS].sort())
    })
  })

  /**
   * The regression this file exists for.
   *
   * Back used to be drawn one way -- a fixed bar over every scene. Moving four
   * screens to draw it themselves creates a way to lose it: opt a scene out of
   * the bar, forget to put the button in its header, and the screen ships with
   * no way back and nothing failing. So the two mechanisms are asserted to
   * partition the scenes exactly: every Back-bearing scene is covered by
   * precisely one of them, never both and never neither.
   *
   * (The other half of the proof is per-screen: each self-headed screen's own
   * test renders it and finds the button. This half guarantees the list of
   * screens that owe one is right.)
   */
  describe('how Back reaches each scene', () => {
    it('covers every Back-bearing scene by exactly one mechanism', () => {
      for (const scene of ALL_SCENES) {
        const mechanisms = [
          sceneShowsHeader(scene),
          sceneRendersOwnBack(scene),
          sceneHidesBackControl(scene),
        ].filter(Boolean)

        expect({ scene, mechanisms: mechanisms.length }).toEqual({
          scene,
          mechanisms: sceneShowsBack(scene) ? 1 : 0,
        })
      }
    })

    /**
     * The runtime sweep, kept as an explicit `missing: []` rather than an
     * `every()`: a failure has to name the scene that lost its way out, not
     * just say "false".
     *
     * This is the guarantee the third mechanism could most easily have broken.
     * Taking the control off gameplay is a change to how Back is *drawn*; if it
     * had been written as a change to whether Back *exists*, three screens
     * would have become inescapable and every other test in this file would
     * still pass.
     */
    it('leaves no scene without a way back', () => {
      const missing = ALL_SCENES.filter((scene) => !ROOTS.includes(scene) && !sceneShowsBack(scene))

      expect({ missing }).toEqual({ missing: [] })
    })

    it('names exactly the screens that draw Back in their own header', () => {
      const selfHeaded = ALL_SCENES.filter(sceneRendersOwnBack)

      expect([...selfHeaded].sort()).toEqual([...SELF_HEADED].sort())
    })

    /**
     * The other half of the promise, checked against the source itself.
     *
     * `SELF_HEADED_SCENES` is an opt-*out* of the fallback bar, so the failure
     * it makes possible is silent: list a scene, forget to put the control in
     * its header, and it ships with no way back and nothing failing. Most of
     * these screens also assert the button in their own render test, but
     * `calibration` cannot -- it constructs a real `AudioContext` on mount --
     * and a render test only ever covers the branches it happens to exercise,
     * while this covers the file.
     *
     * A source scan rather than a mount, following the precedent of
     * design/__tests__/blurBudget.test.ts, which polices an app-wide invariant
     * the same way for the same reason.
     */
    // Where a screen draws its header through a shared frame (every branch of
    // party draw and results renders into one), the frame is the file that owes
    // the control.
    const SELF_HEADED_SOURCE: Record<string, string> = {
      'session-select': 'session/SongSelector.tsx',
      'session-assign': 'session/SessionAssign.tsx',
      'session-party-draw': 'session/partyDraw/PartyDrawFrame.tsx',
      'session-leaderboard': 'session/SessionLeaderboard.tsx',
      settings: 'settings/Settings.tsx',
      players: 'players/Roster.tsx',
      mic: 'audio/MicCheck.tsx',
      calibration: 'calibration/CalibrationScene.tsx',
      'hardware-setup': 'multiplayer/HardwareSetup.tsx',
      'session-results': 'session/results/ResultsSurface.tsx',
    }
    it('names a source file for every routed screen that has opted out of the bar', () => {
      expect(Object.keys(SELF_HEADED_SOURCE).sort()).toEqual([...SELF_HEADED].sort())
    })

    it.each(Object.entries(SELF_HEADED_SOURCE))(
      "'%s' really renders the control it promised, in %s",
      (_scene, file) => {
        const source = readFileSync(join(process.cwd(), 'src', file), 'utf8')

        expect(/<(BackButton|SceneTitleBar)[\s/>]/.test(source)).toBe(true)
      },
    )

    // A root scene can never be dragged into drawing a control it does not have.
    it.each(ROOTS)("draws neither the bar nor an own header on '%s'", (scene) => {
      expect(sceneShowsHeader(scene)).toBe(false)
      expect(sceneRendersOwnBack(scene)).toBe(false)
    })

    // The screens that should *not* get a designed title row, and why -- this
    // is the half of the partition that has to stay put, or the next pass
    // quietly grows nine identical mediocre headers.
    //
    // lab scenes: developer surfaces with their own harness headers, not
    // read from a sofa and not part of the party. They are also now the *only*
    // thing on the bar, which is the point of the assertion below.
    it.each([
      'lab',
      'lab-library',
      'lab-mic',
      'lab-stage',
      'lab-audience',
      'lab-gameplay',
      'lab-fx',
      'lab-calibration',
      'lab-multiplayer',
      'lab-session',
    ] as const)("keeps the fallback bar on '%s'", (scene) => {
      expect(sceneShowsHeader(scene)).toBe(true)
      expect(sceneRendersOwnBack(scene)).toBe(false)
      expect(sceneHidesBackControl(scene)).toBe(false)
    })

    /**
     * The Clean HUD regression.
     *
     * A song is the one thing in this app that is the whole screen, and a glass
     * pill floating over its top-left corner is chrome laid over content (HIG
     * Going full screen: "prioritize content by temporarily hiding toolbars and
     * navigation controls"). So these three draw nothing -- no bar, no header
     * row -- while still answering `sceneShowsBack`, because Escape, Backspace
     * and gamepad B all still reach the same authority and mid-song that
     * authority asks before it throws the song away.
     *
     * Both halves are asserted together on purpose: "no control" that also
     * meant "no way out" would be the bug, not the fix.
     */
    it.each(CHROMELESS)("draws no Back control at all on '%s', while still offering Back", (scene) => {
      expect(sceneShowsHeader(scene)).toBe(false)
      expect(sceneRendersOwnBack(scene)).toBe(false)
      expect(sceneHidesBackControl(scene)).toBe(true)
      expect(sceneShowsBack(scene)).toBe(true)
    })

    it('names exactly the screens a song plays on as the chromeless ones', () => {
      const chromeless = ALL_SCENES.filter(sceneHidesBackControl)

      expect([...chromeless].sort()).toEqual([...CHROMELESS].sort())
    })

    // The regression this second pass exists for. Every screen a *player* meets
    // now draws Back inside its own header row; if one of them silently falls
    // back to the floating bar again, this fails.
    it.each(['players', 'mic', 'calibration', 'hardware-setup', 'session-results'] as const)(
      "draws Back inside the screen's own header on '%s', with no bar over it",
      (scene) => {
        expect(sceneRendersOwnBack(scene)).toBe(true)
        expect(sceneShowsHeader(scene)).toBe(false)
        expect(sceneShowsBack(scene)).toBe(true)
      },
    )

    // The bar is now a minority case, and saying so numerically is what stops
    // it quietly reabsorbing screens: after the Clean HUD pass, nothing a
    // *player* ever sees is on it -- only the Dev Lab.
    it('leaves the fallback bar to the Dev Lab, nothing else', () => {
      const onTheBar = ALL_SCENES.filter(sceneShowsHeader)

      expect([...onTheBar].sort()).toEqual(
        [
          'lab',
          'lab-audience',
          'lab-calibration',
          'lab-fx',
          'lab-gameplay',
          'lab-library',
          'lab-mic',
          'lab-multiplayer',
          'lab-session',
          'lab-stage',
        ].sort(),
      )
      expect(onTheBar.every((scene) => scene.startsWith('lab'))).toBe(true)
    })
  })
})
