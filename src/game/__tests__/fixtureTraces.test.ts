import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseChartText } from '../../stage/chart/parseChartText'
import { replayPitchTrace, theoreticalMaxScore } from '../replayTrace'
import { isRapKind } from '../scoring/scoringPlan'
import type { PitchSample } from '../../contracts/types'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const chartRaw = readFileSync(path.join(ROOT, 'fixtures/sample-song/notes.txt'), 'utf-8')
const chart = parseChartText(chartRaw)

const perfectSamples: PitchSample[] = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/gameplay-traces/perfect.json'), 'utf-8'))
const silenceSamples: PitchSample[] = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/gameplay-traces/silence.json'), 'utf-8'))

describe('gameplay trace fixtures (golden-file determinism)', () => {
  it('scores the "perfect" trace above 95% of the theoretical maximum', () => {
    const { score, notes } = replayPitchTrace(chart, perfectSamples)
    expect(score / theoreticalMaxScore(notes)).toBeGreaterThan(0.95)
  })

  it('scores the "silence" trace at ~0', () => {
    const { score, notes } = replayPitchTrace(chart, silenceSamples)
    expect(score / theoreticalMaxScore(notes)).toBeLessThan(0.05)
  })

  it('produces an identical score run to run (deterministic replay)', () => {
    const first = replayPitchTrace(chart, perfectSamples)
    const second = replayPitchTrace(chart, perfectSamples)
    expect(second.score).toBe(first.score)
  })

  it('scores on the 10,000 scale: a perfect trace lands near the fixed ceiling', () => {
    const { score, maxScore } = replayPitchTrace(chart, perfectSamples)
    expect(maxScore).toBe(10_000)
    expect(score).toBeGreaterThan(9_500)
    expect(score).toBeLessThanOrEqual(10_000)
  })

  it('takes a semitone tolerance: a trace a semitone sharp scores nothing at Hard and recovers at Normal', () => {
    // Every sample 100 cents sharp -- rounds to the neighbouring semitone.
    const sharpFactor = Math.pow(2, 100 / 1200)
    const detunedSamples = perfectSamples.map((s) => ({ ...s, hz: s.hz * sharpFactor }))
    // Rap notes are pitch-free, so tolerance only means anything on the pitched lines.
    const pitchedChart = { ...chart, lines: chart.lines.filter((line) => !line.notes.some((note) => isRapKind(note.kind))) }

    const atHard = replayPitchTrace(pitchedChart, detunedSamples, 0)
    const atNormal = replayPitchTrace(pitchedChart, detunedSamples, 1)

    expect(atHard.score / theoreticalMaxScore(atHard.notes)).toBeLessThan(0.05)
    expect(atNormal.score / theoreticalMaxScore(atNormal.notes)).toBeGreaterThan(0.95)
  })

  it('credits rap notes at any pitch: the same sharp trace still earns the rap line at Hard', () => {
    expect(chart.lines.some((line) => line.notes.some((note) => isRapKind(note.kind)))).toBe(true)
    const sharpFactor = Math.pow(2, 100 / 1200)
    const detunedSamples = perfectSamples.map((s) => ({ ...s, hz: s.hz * sharpFactor }))

    const atHard = replayPitchTrace(chart, detunedSamples, 0)

    expect(atHard.score).toBeGreaterThan(0)
    expect(atHard.score / theoreticalMaxScore(atHard.notes)).toBeLessThan(0.25)
  })
})
