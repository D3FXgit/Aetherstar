export interface AssetSpec {
  /** Path relative to the app's assets/ directory, e.g. 'sfx/hit_perfect.wav'. */
  path: string
  required: boolean
}

export const SFX_ASSETS: AssetSpec[] = [
  { path: 'sfx/hit_perfect.wav', required: true },
  { path: 'sfx/hit_good.wav', required: true },
  { path: 'sfx/hit_miss.wav', required: true },
  { path: 'sfx/combo_up.wav', required: false },
  { path: 'sfx/line_clear.wav', required: false },
  { path: 'sfx/ui_select.wav', required: false },
  { path: 'sfx/ui_back.wav', required: false },
  { path: 'sfx/countdown.wav', required: false },
  { path: 'sfx/fanfare_win.wav', required: false },
]

export const FX_SPRITE_ASSETS: AssetSpec[] = [
  { path: 'fx/shards_epic.png', required: true },
  { path: 'fx/star_gold.png', required: true },
  { path: 'fx/trail_neon.png', required: true },
  { path: 'fx/smoke_soft.png', required: true },
  { path: 'fx/glitch_tile.png', required: true },
]
