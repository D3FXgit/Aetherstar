import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { beatToMs, msPerBeat, msToBeat, QUARTER_BEATS_PER_BEAT } from '../beatMs'
import { parseChartText } from '../../chart/parseChartText'
import { decodeChartBytes } from '../../chart/decodeChartBytes'

// Real fixture values: fixtures/sample-song/notes.txt (#BPM:120, #GAP:6000)
const BPM = 120
const GAP = 6000

const require_ = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../../..')
const { computeDurationMs } = require_(path.join(ROOT, 'electron/library/duration.cjs')) as {
  computeDurationMs: (chart: { meta: { bpm: number; gap: number }; lines: { notes: { startBeat: number; length: number }[] }[] }) => number
}

describe('beatToMs', () => {
  it('maps beat 0 to the GAP offset', () => {
    expect(beatToMs(0, BPM, GAP)).toBe(6000)
  })

  /**
   * The regression this file exists for.
   *
   * An UltraStar `#BPM` counts *quarter* beats: one file beat lasts
   * `60000 / (bpm * 4)` ms, not `60000 / bpm`. The playback clock shipped with
   * the second formula, so every beat was four times too long -- `msToBeat`
   * returned a quarter of the true beat and the lyric sweep, the note lane and
   * the note judging all fell progressively further behind the audio, which is
   * exactly the reported "lyrics drift out of sync with the music".
   *
   * The scan-time duration estimator (electron/library/duration.cjs) always
   * had the `* 4`, and it is meant to be the one shared conversion, so the two
   * halves of the app disagreed by a factor of four about how long a song is.
   */
  it('advances by 60000/(bpm*4) ms per beat -- UltraStar beats are quarter beats', () => {
    expect(msPerBeat(BPM)).toBe(125)
    expect(beatToMs(4, BPM, GAP)).toBe(6000 + 500)
    expect(QUARTER_BEATS_PER_BEAT).toBe(4)
  })
})

describe('msToBeat', () => {
  it('is the exact inverse of beatToMs', () => {
    expect(msToBeat(beatToMs(4, BPM, GAP), BPM, GAP)).toBe(4)
    expect(msToBeat(6500, BPM, GAP)).toBe(4)
  })
})

describe('agreement with the scan-time duration estimator', () => {
  /**
   * Both halves of the app must convert beats to milliseconds identically:
   * the library browser's displayed duration comes from
   * electron/library/duration.cjs, and playback's clock comes from here. When
   * they disagreed the song list said 4:33 and the stage behaved as if the
   * song were 16:16.
   */
  function lastBeatOf(chart: { lines: { notes: { startBeat: number; length: number }[] }[] }): number {
    let last = 0
    for (const line of chart.lines) {
      for (const note of line.notes) {
        last = Math.max(last, note.startBeat + note.length)
      }
    }
    return last
  }

  const charts = [
    // The demo song: last note ends on beat 316 -> 6000 + 316 * 125 = 45.5 s.
    ['fixtures/sample-song/notes.txt', 45_500],
    // A windows-1252 chart with comma decimals: #BPM:212,5 / #GAP:1250,5, last
    // note ending on beat 52 -> 1250.5 + 52 * 60000 / 850 = 4921.09 ms. The old
    // formula (no `* 4`) claimed 15.9 s for the same file.
    ['fixtures/cp1252-song/notes.txt', 4_921],
  ] as const

  it.each(charts)('%s: beatToMs(lastBeat) matches computeDurationMs()', (relPath, expectedMs) => {
    const chart = parseChartText(decodeChartBytes(new Uint8Array(readFileSync(path.join(ROOT, relPath)))))
    const durationMs = beatToMs(lastBeatOf(chart), chart.meta.bpm, chart.meta.gap)

    expect(durationMs).toBeCloseTo(computeDurationMs(chart), 6)
    expect(Math.round(durationMs)).toBe(expectedMs)
  })
})
