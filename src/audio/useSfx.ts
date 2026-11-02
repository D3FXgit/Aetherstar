import { create } from 'zustand'
import type { SfxPlayer } from './sfxContract'
import { createSfxPlayer, DEFAULT_SFX_VOLUME, type RealSfxPlayer } from './sfxPlayer'
import { SFX_URLS } from './sfxAssets'
import { getSharedAudioContext } from './webAudioApi'
import { getMixerGain } from './mixer'

let player: RealSfxPlayer | null = null

function getPlayer(): SfxPlayer {
  if (!player) {
    // The Effects slider (and master) are read per sound, so a change applies to the very next one.
    player = createSfxPlayer(getSharedAudioContext, SFX_URLS, () => DEFAULT_SFX_VOLUME * getMixerGain('effects'))
    // Decode the whole set the first time anything asks for a sound -- which in
    // practice is the first hover or click in the menus, minutes before a song
    // starts. Gameplay's hit feedback then costs nothing but a buffer source,
    // rather than the first Excellent of every session paying for a fetch and a
    // decode while the judging loop is running.
    void player.preload()
  }
  return player
}

/** Mirrors useWebAudioManager.ts exactly -- a per-domain Zustand store that lazily constructs the real player on first use. */
export const useSfx = create<SfxPlayer>(() => ({
  play: (name) => getPlayer().play(name),
}))
