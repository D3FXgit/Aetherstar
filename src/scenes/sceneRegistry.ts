import type { ComponentType } from 'react'
import type { SceneName } from './sceneStore'
import { Boot } from './Boot'
import { Home } from './Home'
import { Players } from './Players'
import { Settings } from '../settings/Settings'
import { MicCheck } from '../audio/MicCheck'
import { SessionSelect } from '../session/SessionSelect'
import { SessionAssign } from '../session/SessionAssign'
import { SessionPartyDraw } from '../session/SessionPartyDraw'
import { SessionStarting } from '../session/SessionStarting'
import { SessionPlay } from '../session/SessionPlay'
import { SessionResults } from '../session/SessionResults'
import { SessionLeaderboard } from '../session/SessionLeaderboard'
import { CalibrationScene } from '../calibration/CalibrationScene'
import { HardwareSetup } from '../multiplayer/HardwareSetup'
import { JukeboxScene } from '../jukebox/JukeboxScene'

// lab scenes ('lab', 'lab-*') are registered by src/lab/registerDevLabs.ts
// in development builds only. An unregistered name falls back to Home.
export const SCENE_REGISTRY: Partial<Record<SceneName, ComponentType>> = {
  boot: Boot,
  home: Home,
  players: Players,
  settings: Settings,
  mic: MicCheck,
  'session-select': SessionSelect,
  'session-assign': SessionAssign,
  'session-party-draw': SessionPartyDraw,
  'session-starting': SessionStarting,
  'session-play': SessionPlay,
  'session-results': SessionResults,
  'session-leaderboard': SessionLeaderboard,
  calibration: CalibrationScene,
  'hardware-setup': HardwareSetup,
  jukebox: JukeboxScene,
}

export function registerScene(name: SceneName, component: ComponentType) {
  SCENE_REGISTRY[name] = component
}
