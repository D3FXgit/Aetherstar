// Registers the jukebox scene with the router. Loaded by sessionStore.startJukebox
// before it navigates; harmless if the registry already lists the scene.
import { registerScene } from '../scenes/sceneRegistry'
import { JUKEBOX_SCENE } from '../session/sessionStore'
import { JukeboxScene } from './JukeboxScene'

registerScene(JUKEBOX_SCENE, JukeboxScene)
