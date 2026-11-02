import { describe, expect, it } from 'vitest'
import { SCENE_REGISTRY } from '../../scenes/sceneRegistry'
import { JUKEBOX_SCENE } from '../../session/sessionStore'
import { JukeboxScene } from '../JukeboxScene'

describe('registerJukeboxScene', () => {
  it('puts the jukebox scene in the router registry', async () => {
    await import('../registerJukeboxScene')
    expect(SCENE_REGISTRY[JUKEBOX_SCENE]).toBe(JukeboxScene)
  })
})
