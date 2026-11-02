// @vitest-environment node
const fs = require('node:fs')
const path = require('node:path')
const { parseTags, decodeSongText, parseChart } = require('../parser.cjs')

const FIXTURE_PATH = path.join(__dirname, '..', '..', '..', 'fixtures', 'sample-song', 'notes.txt')

describe('parseTags', () => {
  it('parses the real fixture chart tag block', () => {
    const buffer = fs.readFileSync(FIXTURE_PATH)
    const meta = parseTags(decodeSongText(buffer))
    expect(meta.artist).toBe('AetherStar')
    expect(meta.bpm).toBe(120)
    expect(meta.gap).toBe(6000)
    expect(meta.mp3Path).toBe('instrumental.wav')
    expect(meta.vocalsPath).toBe('vocals.wav')
    expect(meta.instrumentalPath).toBe('instrumental.wav')
    expect(meta.coverPath).toBe('cover.png')
    expect(meta.videoPath).toBeUndefined()
  })

  it('passes through unrecognized #TAG:value lines without failing', () => {
    const text = '#ARTIST:Test\n#TITLE:Song\n#MP3:test.mp3\n#BPM:100\n#GAP:0\n#RELATIVE:YES\n: 0 1 60 hi\nE\n'
    expect(() => parseTags(text)).not.toThrow()
    expect(parseTags(text).artist).toBe('Test')
  })

  it('parses comma-decimal BPM/GAP values (common in European-locale-authored .txt files) instead of poisoning them to NaN', () => {
    const text = '#ARTIST:Test\n#TITLE:Song\n#MP3:test.mp3\n#BPM:326,9\n#GAP:38850,98\n#VIDEOGAP:1,5\n'
    const meta = parseTags(text)
    expect(meta.bpm).toBe(326.9)
    expect(meta.gap).toBe(38850.98)
    expect(meta.videoGap).toBe(1.5)
  })

  it('defaults an unparseable BPM/GAP value to 0 instead of NaN', () => {
    const text = '#ARTIST:Test\n#TITLE:Song\n#MP3:test.mp3\n#BPM:not-a-number\n'
    expect(parseTags(text).bpm).toBe(0)
  })
})

describe('decodeSongText', () => {
  it('strips a UTF-8 BOM', () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('#ARTIST:BOM Test\n', 'utf-8')])
    const text = decodeSongText(withBom)
    expect(text.startsWith('#ARTIST')).toBe(true)
  })

  it('falls back to windows-1252 when the bytes are not valid UTF-8', () => {
    // 0xE9 alone is invalid UTF-8 but is 'é' in windows-1252.
    const cp1252 = Buffer.concat([Buffer.from('#ARTIST:Caf', 'utf-8'), Buffer.from([0xe9]), Buffer.from('\n', 'utf-8')])
    const text = decodeSongText(cp1252)
    const meta = parseTags(text)
    expect(meta.artist).toBe('Café')
  })
})

describe('parseChart', () => {
  it('parses normal/golden/freestyle/line-break/duet markers', () => {
    const text = [
      '#ARTIST:Test',
      '#TITLE:Duet Song',
      '#MP3:test.mp3',
      '#BPM:100',
      '#GAP:0',
      'P1',
      ': 0 2 60 first ',
      '* 2 2 62 golden ',
      'F 4 2 64 free ',
      '- 6',
      'P2',
      ': 6 2 60 second ',
      'E',
    ].join('\n')

    const { chart, warnings } = parseChart(Buffer.from(text, 'utf-8'))
    expect(warnings).toEqual([])
    expect(chart.lines).toHaveLength(2)
    expect(chart.lines[0].part).toBe('p1')
    expect(chart.lines[0].notes.map((n) => n.kind)).toEqual(['normal', 'golden', 'freestyle'])
    expect(chart.lines[0].lineBreakBeat).toBe(6)
    expect(chart.lines[1].part).toBe('p2')
  })

  it('maps R/G to rap/goldenRap and a P3 section to a shared ("solo") line', () => {
    const text = ['#BPM:100', 'P1', 'R 0 2 60 rap ', 'G 2 2 60 gold ', '- 4', 'P3', ': 6 2 60 both ', 'E'].join('\n')
    const { chart, warnings } = parseChart(Buffer.from(text, 'utf-8'))
    expect(warnings).toEqual([])
    expect(chart.lines[0].notes.map((n) => n.kind)).toEqual(['rap', 'goldenRap'])
    expect(chart.lines.map((l) => l.part)).toEqual(['p1', 'solo'])
  })

  it('rejects a chart with a missing or zero #BPM with a clear error', () => {
    expect(() => parseChart(Buffer.from('#TITLE:x\n: 0 2 60 a\n', 'utf-8'))).toThrow(/#BPM \(missing\)/)
    expect(() => parseChart(Buffer.from('#BPM:0\n: 0 2 60 a\n', 'utf-8'))).toThrow(/#BPM \("0"\)/)
  })

  it('records a warning and skips a malformed note line without failing the rest of the chart', () => {
    const wellFormed = fs.readFileSync(FIXTURE_PATH, 'utf-8')
    const lines = wellFormed.split(/\r?\n/)
    const firstNoteIndex = lines.findIndex((l) => /^[:*F]\s/.test(l))
    const withBadLine = [...lines]
    withBadLine.splice(firstNoteIndex + 1, 0, ': abc 2 65 broken ')

    const { chart, warnings } = parseChart(Buffer.from(withBadLine.join('\n'), 'utf-8'))
    const { chart: goodChart } = parseChart(fs.readFileSync(FIXTURE_PATH))

    expect(warnings.length).toBeGreaterThanOrEqual(1)
    expect(warnings[0]).toMatch(/malformed/)

    const goodNoteCount = goodChart.lines.reduce((sum, l) => sum + l.notes.length, 0)
    const badNoteCount = chart.lines.reduce((sum, l) => sum + l.notes.length, 0)
    expect(badNoteCount).toBe(goodNoteCount)
  })
})
