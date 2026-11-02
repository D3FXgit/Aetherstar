// Vite static asset imports, exactly like menuTrack.ts's `menu_loop.wav`
// import -- `assets/sfx/` is bundled/fingerprinted by `vite build`
// the same way, with no Electron main-process involvement. Every file here is
// original, synthesized by `scripts/generate-sound-assets.mjs` (re-run with
// `npm run generate:sounds` after changing it). Swapping a file in place under
// assets/sfx/ (same filename) needs no code change here; see
// assets/sfx/README.md.
import hoverUrl from '../../assets/sfx/ui_hover.wav'
import clickUrl from '../../assets/sfx/ui_click.wav'
import confirmUrl from '../../assets/sfx/ui_confirm.wav'
import backUrl from '../../assets/sfx/ui_back.wav'
import errorUrl from '../../assets/sfx/ui_error.wav'
import countdownBeepUrl from '../../assets/sfx/countdown_beep.wav'
import countdownGoUrl from '../../assets/sfx/countdown_go.wav'
import songSelectedUrl from '../../assets/sfx/song_selected.wav'
import hitExcellentUrl from '../../assets/sfx/placeholder_hit_excellent.wav'
import hitGoodUrl from '../../assets/sfx/placeholder_hit_good.wav'
import hitBadUrl from '../../assets/sfx/placeholder_hit_bad.wav'
import hitGoldenUrl from '../../assets/sfx/placeholder_hit_golden.wav'
import cheerUrl from '../../assets/sfx/placeholder_cheer.wav'
import crownLandUrl from '../../assets/sfx/placeholder_crown_land.wav'
import scoreTickUrl from '../../assets/sfx/placeholder_score_tick.wav'
import uiBingUrl from '../../assets/sfx/ui_bing.wav'
import uiBongUrl from '../../assets/sfx/ui_bong.wav'
import type { SfxName } from './sfxContract'

export const SFX_URLS: Record<SfxName, string> = {
  hover: hoverUrl,
  click: clickUrl,
  confirm: confirmUrl,
  back: backUrl,
  error: errorUrl,
  countdownBeep: countdownBeepUrl,
  countdownGo: countdownGoUrl,
  songSelected: songSelectedUrl,
  hitExcellent: hitExcellentUrl,
  hitGood: hitGoodUrl,
  hitBad: hitBadUrl,
  hitGolden: hitGoldenUrl,
  cheer: cheerUrl,
  crownLand: crownLandUrl,
  scoreTick: scoreTickUrl,
  uiBing: uiBingUrl,
  uiBong: uiBongUrl,
}

/**
 * `assets/sfx/song_selected.wav`'s real duration. The song-start transition
 * runs for exactly this long so the zoom + 3-2-1 countdown land on the end
 * of the sound rather than being cut off by it or trailing after it.
 *
 * The generator renders the sting to exactly this length in F major, with its
 * section changes on the countdown ticks (F -> Eb -> F, a build over a C pedal
 * at "2", a C7 chord and sub drop at "1", near silence before the end) so the
 * dominant it ends on points at `countdown_go.wav`'s bright C. A regenerated or replaced file of a
 * different length needs this updated (src/audio/__tests__/soundAssets.test.ts
 * checks the two agree).
 */
export const SONG_SELECTED_DURATION_MS = 4750

/**
 * Measured attack of `assets/sfx/song_selected.wav`: how long it takes from its
 * first sample to reach full level.
 *
 * Evidence (25 ms RMS windows over the file, as printed by
 * `node scripts/generate-sound-assets.mjs song_selected` and pinned by
 * src/audio/__tests__/soundAssets.test.ts, measured on the mono mix of the
 * stereo file): digital silence until 45 ms, then a gated stutter fill whose
 * hits peak ~2 dB under the loudest window (the 50 ms one), then the loudest
 * window of the whole file at 300 ms, where the main hit lands. Everything
 * after that is held at least ~1 dB below it (typically ~3 dB).
 *
 * Anything that must be inaudible "before the transition sound peaks" therefore
 * has to reach zero inside this window, not merely start fading within it.
 */
export const SONG_SELECTED_PEAK_OFFSET_MS = 300
