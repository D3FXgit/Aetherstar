import { describe, expect, it } from 'vitest'
import { FX_SPRITE_ASSETS, SFX_ASSETS } from '../manifest'

describe('SFX_ASSETS', () => {
  it('marks the three core hit sounds as required', () => {
    for (const path of ['sfx/hit_perfect.wav', 'sfx/hit_good.wav', 'sfx/hit_miss.wav']) {
      expect(SFX_ASSETS).toContainEqual({ path, required: true })
    }
  })

  it('marks the optional-but-wired cues as not required', () => {
    for (const path of [
      'sfx/combo_up.wav',
      'sfx/line_clear.wav',
      'sfx/ui_select.wav',
      'sfx/ui_back.wav',
      'sfx/countdown.wav',
      'sfx/fanfare_win.wav',
    ]) {
      expect(SFX_ASSETS).toContainEqual({ path, required: false })
    }
  })
})

describe('FX_SPRITE_ASSETS', () => {
  it('marks all five fx sprite sheets as required', () => {
    for (const path of [
      'fx/shards_epic.png',
      'fx/star_gold.png',
      'fx/trail_neon.png',
      'fx/smoke_soft.png',
      'fx/glitch_tile.png',
    ]) {
      expect(FX_SPRITE_ASSETS).toContainEqual({ path, required: true })
    }
  })
})
