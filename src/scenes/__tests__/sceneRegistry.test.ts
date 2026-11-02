import { describe, expect, it } from 'vitest'
import { SCENE_REGISTRY } from '../sceneRegistry'
import { Boot } from '../Boot'
import { Home } from '../Home'
import { HardwareSetup } from '../../multiplayer/HardwareSetup'
import { JukeboxScene } from '../../jukebox/JukeboxScene'

describe('SCENE_REGISTRY', () => {
  it('maps the boot scene to Boot', () => {
    expect(SCENE_REGISTRY.boot).toBe(Boot)
  })

  it('maps the home scene to Home', () => {
    expect(SCENE_REGISTRY.home).toBe(Home)
  })

  it('maps the hardware-setup scene to HardwareSetup', () => {
    expect(SCENE_REGISTRY['hardware-setup']).toBe(HardwareSetup)
  })

  it('maps the jukebox scene to JukeboxScene', () => {
    expect(SCENE_REGISTRY.jukebox).toBe(JukeboxScene)
  })

  // Unreachable routes are gone: songs are sung inside the session loop
  // (SessionPlay embeds <Sing>), and nothing navigates to the library browser.
  it('registers neither the standalone sing nor the library route', () => {
    // Not even names any more (SceneName dropped them); checked by key so a
    // reintroduced route would still be caught.
    expect(Object.keys(SCENE_REGISTRY)).not.toContain('sing')
    expect(Object.keys(SCENE_REGISTRY)).not.toContain('library')
  })

  // The Dev Lab is registered from main.tsx in DEV builds only; importing the
  // registry (as the production bundle does) must not drag any lab in.
  it('registers no lab scene on its own', () => {
    const labRoutes = Object.keys(SCENE_REGISTRY).filter((name) => name === 'lab' || name.startsWith('lab-'))
    expect(labRoutes).toEqual([])
  })
})
