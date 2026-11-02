import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseChartText } from '../parseChartText'

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures/sample-song/notes.txt',
)

const raw = readFileSync(FIXTURE_PATH, 'utf-8')

describe('parseChartText', () => {
  it('parses the reference chart header into SongMeta', () => {
    const chart = parseChartText(raw)

    expect(chart.meta.artist).toBe('AetherStar')
    expect(chart.meta.title).toBe('First Light')
    expect(chart.meta.mp3Path).toBe('instrumental.wav')
    expect(chart.meta.vocalsPath).toBe('vocals.wav')
    expect(chart.meta.instrumentalPath).toBe('instrumental.wav')
    expect(chart.meta.coverPath).toBe('cover.png')
    expect(chart.meta.videoPath).toBeUndefined()
    expect(chart.meta.bpm).toBe(120)
    expect(chart.meta.gap).toBe(6000)
    expect(chart.meta.videoGap).toBe(0)
  })

  it('parses note lines into a solo SongLine with normal notes', () => {
    const chart = parseChartText(raw)

    const firstLine = chart.lines[0]
    expect(firstLine.part).toBe('solo')
    expect(firstLine.notes[0]).toEqual({
      kind: 'normal',
      startBeat: 0,
      length: 3,
      pitch: 64,
      syllable: 'Wake',
    })
  })

  it('records the trailing line-break beat and starts a new line after it', () => {
    const chart = parseChartText(raw)

    const firstLine = chart.lines[0]
    expect(firstLine.lineBreakBeat).toBe(30)
    expect(chart.lines[1].notes[0]).toMatchObject({ startBeat: 32, syllable: 'A' })
  })

  it('parses every note kind the demo chart uses: golden, rap, golden rap and freestyle', () => {
    const chart = parseChartText(raw)
    const notes = chart.lines.flatMap((line) => line.notes)

    expect(chart.lines).toHaveLength(9)
    expect(notes.filter((n) => n.kind === 'golden').map((n) => n.syllable)).toEqual(['ring', 'page'])
    expect(notes.filter((n) => n.kind === 'rap')).toHaveLength(10)
    expect(notes.filter((n) => n.kind === 'goldenRap').map((n) => n.syllable)).toEqual(['tight'])
    expect(notes.filter((n) => n.kind === 'freestyle').map((n) => n.syllable)).toEqual(['Ooh'])
  })

  it('parses P1/P2 duet markers into their respective SongLine parts', () => {
    const duetSnippet = [
      '#ARTIST:Test Duet',
      '#TITLE:Two Parts',
      '#MP3:song.mp3',
      '#BPM:100',
      '#GAP:0',
      'P1',
      ': 0 2 60 One ',
      ': 2 2 60 part ',
      '- 4',
      'P2',
      ': 4 2 62 Other ',
      ': 6 2 62 part ',
      'E',
    ].join('\n')

    const chart = parseChartText(duetSnippet)

    expect(chart.lines).toHaveLength(2)
    expect(chart.lines[0].part).toBe('p1')
    expect(chart.lines[0].notes.map((n) => n.syllable)).toEqual(['One', 'part'])
    expect(chart.lines[1].part).toBe('p2')
    expect(chart.lines[1].notes.map((n) => n.syllable)).toEqual(['Other', 'part'])
  })

  it('a line break after a duet marker keeps the same part, not solo (real fixture is unaffected)', () => {
    const chart = parseChartText(raw)
    // The real fixture has no P1/P2 markers at all -- every line stays 'solo'.
    expect(chart.lines.every((line) => line.part === 'solo')).toBe(true)
  })

  // European-locale UltraStar editors write decimal BPM/GAP with a comma.
  // electron/library/parser.cjs already fixed exactly this (its
  // `parseDecimalTag`, with a comment about NaN "silently poisoning every
  // downstream timing calculation") -- but that's the *scan-time* parser.
  // This one, the playback parser, still used bare `Number()`, so a chart
  // that indexed fine could still produce meta.bpm = NaN once actually sung.
  it('parses comma-decimal BPM/GAP/VIDEOGAP the same way the scan-time parser does', () => {
    const chart = parseChartText(['#TITLE:Komma', '#BPM:326,9', '#GAP:12345,5', '#VIDEOGAP:1,5', ': 0 3 65 Hi', 'E'].join('\n'))

    expect(chart.meta.bpm).toBeCloseTo(326.9)
    expect(chart.meta.gap).toBeCloseTo(12345.5)
    expect(chart.meta.videoGap).toBeCloseTo(1.5)
  })

  it('never yields a non-finite gap/videoGap, whatever garbage the tag holds', () => {
    const chart = parseChartText(['#BPM:120', '#GAP:', '#VIDEOGAP:???', ': 0 3 65 Hi'].join('\n'))

    expect(Number.isFinite(chart.meta.gap)).toBe(true)
    expect(Number.isFinite(chart.meta.videoGap)).toBe(true)
  })

  // Every beat<->ms conversion divides by the BPM, so a chart without a
  // usable one cannot be played: msPerBeat would be Infinity and the song
  // would never advance. It is rejected with a clear message instead.
  it.each([
    ['missing', ['#TITLE:No tempo', ': 0 3 65 Hi'], /#BPM \(missing\)/],
    ['zero', ['#BPM:0', ': 0 3 65 Hi'], /#BPM \("0"\)/],
    ['negative', ['#BPM:-120', ': 0 3 65 Hi'], /#BPM/],
    ['garbage', ['#BPM:not-a-number', ': 0 3 65 Hi'], /not-a-number/],
    ['empty input', [''], /#BPM \(missing\)/],
  ])('rejects a chart whose #BPM is %s', (_label, lines, message) => {
    expect(() => parseChartText(lines.join('\n'))).toThrow(message)
  })

  it('accepts a comma-decimal BPM such as "300,5"', () => {
    expect(parseChartText(['#BPM:300,5', ': 0 3 65 Hi'].join('\n')).meta.bpm).toBe(300.5)
  })

  it('reads #START, #END, #PREVIEWSTART, the medley beats and #CALCMEDLEY', () => {
    const chart = parseChartText(
      [
        '#BPM:120',
        '#START:12,5',
        '#END:180000',
        '#PREVIEWSTART:42.5',
        '#MEDLEYSTARTBEAT:64',
        '#MEDLEYENDBEAT:128',
        '#CALCMEDLEY:off',
        ': 0 3 65 Hi',
      ].join('\n'),
    )

    expect(chart.meta).toMatchObject({
      startMs: 12500,
      endMs: 180000,
      previewStartSec: 42.5,
      medleyStartBeat: 64,
      medleyEndBeat: 128,
      calcMedley: false,
    })
  })

  it('leaves the playback-window and medley fields undefined when the tags are absent', () => {
    const { meta } = parseChartText(['#BPM:120', ': 0 3 65 Hi'].join('\n'))
    expect([meta.startMs, meta.endMs, meta.previewStartSec, meta.medleyStartBeat, meta.medleyEndBeat, meta.calcMedley]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('maps R and G to the rap and golden-rap kinds, not to freestyle', () => {
    const chart = parseChartText(['#BPM:120', 'R 0 2 60 rap', 'G 2 2 60 gold', 'F 4 2 60 free', ': 6 2 60 sung'].join('\n'))
    expect(chart.lines[0].notes.map((n) => n.kind)).toEqual(['rap', 'goldenRap', 'freestyle', 'normal'])
  })

  it('maps a P3 ("both singers") section to a shared line every singer sings', () => {
    const chart = parseChartText(['#BPM:120', 'P1', ': 0 2 60 a', '- 2', 'P2', ': 4 2 60 b', '- 6', 'P3', ': 8 2 60 both', 'E'].join('\n'))
    expect(chart.lines.map((l) => l.part)).toEqual(['p1', 'p2', 'solo'])
  })

  it('does not throw on binary-looking input that still declares a tempo', () => {
    expect(() => parseChartText('#BPM:100\n\u0000\u0001\uFFFD binary junk \u0000')).not.toThrow()
  })
})

describe('parseChartText: #BACKGROUND', () => {
  it('exposes #BACKGROUND as backgroundPath, and leaves it undefined when absent', () => {
    const tagged = parseChartText(['#TITLE:T', '#BPM:120', '#BACKGROUND:Artist - Title [BG].jpg', ': 0 3 65 Hi', 'E'].join('\n'))
    expect(tagged.meta.backgroundPath).toBe('Artist - Title [BG].jpg')
    const untagged = parseChartText(['#TITLE:T', '#BPM:120', ': 0 3 65 Hi', 'E'].join('\n'))
    expect(untagged.meta.backgroundPath).toBeUndefined()
  })
})
