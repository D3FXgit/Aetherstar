import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseChartText } from '../../stage/chart/parseChartText'
import { replayPitchTrace, theoreticalMaxScore } from '../../game/replayTrace'
import { applyCalibration } from '../applyCalibration'
import type { PitchSample } from '../../contracts/types'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const chartRaw = readFileSync(path.join(ROOT, 'fixtures/sample-song/notes.txt'), 'utf-8')
const chart = parseChartText(chartRaw)

const perfectSamples: PitchSample[] = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/gameplay-traces/perfect.json'), 'utf-8'))

const SIMULATED_LAG_MS = 150

describe('score normalization sanity check: calibration measurably improves the score', () => {
  it('a deliberately laggy (uncalibrated) trace scores well below 95% of the theoretical max', () => {
    const laggyTrace = perfectSamples.map((sample) => ({ ...sample, t: sample.t + SIMULATED_LAG_MS }))

    const { score, notes } = replayPitchTrace(chart, laggyTrace)
    expect(score / theoreticalMaxScore(notes)).toBeLessThan(0.95)
  })

  it('applying the matching inputOffsetMs calibration recovers score above 95% for the same recorded performance', () => {
    const laggyTrace = perfectSamples.map((sample) => ({ ...sample, t: sample.t + SIMULATED_LAG_MS }))
    const calibratedTrace = applyCalibration(laggyTrace, { inputOffsetMs: SIMULATED_LAG_MS, transpositionSemitones: 0 })

    const { score, notes } = replayPitchTrace(chart, calibratedTrace)
    expect(score / theoreticalMaxScore(notes)).toBeGreaterThan(0.95)
  })
})
