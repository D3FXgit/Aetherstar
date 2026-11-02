/**
 * UltraStar beat <-> millisecond conversion: the lyric sweep, the note lane,
 * the countdown and note judging all read their position through these.
 *
 * THE `* 4` IS NOT OPTIONAL. An UltraStar `#BPM` tag counts *quarter* beats, so
 * one file beat lasts `60000 / (bpm * 4)` ms -- the same conversion
 * `electron/library/duration.cjs` uses, pinned together by
 * `__tests__/beatMs.test.ts`. Without it every song drifts further and further
 * behind the audio.
 */
export const QUARTER_BEATS_PER_BEAT = 4

/** Duration of one chart beat, in milliseconds. */
export function msPerBeat(bpm: number): number {
  return 60000 / (bpm * QUARTER_BEATS_PER_BEAT)
}

/** Beat 0 occurs at `gap` ms; each beat then advances `msPerBeat(bpm)` ms. */
export function beatToMs(beat: number, bpm: number, gap: number): number {
  return gap + beat * msPerBeat(bpm)
}

export function msToBeat(ms: number, bpm: number, gap: number): number {
  return (ms - gap) / msPerBeat(bpm)
}
