import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadFixtureChart } from '../loadFixtureChart'

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/sample-song/notes.txt',
)

describe('loadFixtureChart', () => {
  it('parses the reference chart header into SongMeta', () => {
    const chart = loadFixtureChart(FIXTURE_PATH)

    expect(chart.meta.artist).toBe('AetherStar')
    expect(chart.meta.title).toBe('First Light')
    expect(chart.meta.mp3Path).toBe('instrumental.wav')
    expect(chart.meta.coverPath).toBe('cover.png')
    expect(chart.meta.videoPath).toBeUndefined()
    expect(chart.meta.edition).toBe('AetherStar Demo')
    expect(chart.meta.language).toBe('English')
    expect(chart.meta.bpm).toBe(120)
    expect(chart.meta.gap).toBe(6000)
    expect(chart.meta.videoGap).toBe(0)
  })

  it('parses note lines into a solo SongLine with normal notes', () => {
    const chart = loadFixtureChart(FIXTURE_PATH)

    expect(chart.lines.length).toBeGreaterThan(0)
    const firstLine = chart.lines[0]
    expect(firstLine.part).toBe('solo')
    expect(firstLine.notes.length).toBeGreaterThan(0)

    const firstNote = firstLine.notes[0]
    expect(firstNote).toEqual({
      kind: 'normal',
      startBeat: 0,
      length: 3,
      pitch: 64,
      syllable: 'Wake',
    })
  })

  it('records the trailing line-break beat and starts a new line after it', () => {
    const chart = loadFixtureChart(FIXTURE_PATH)

    const firstLine = chart.lines[0]
    expect(firstLine.lineBreakBeat).toBe(30)
    expect(chart.lines[1].notes[0]).toMatchObject({ startBeat: 32, syllable: 'A' })
  })
})
