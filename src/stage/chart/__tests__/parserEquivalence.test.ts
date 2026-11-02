import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { decodeChartBytes } from '../decodeChartBytes'
import { parseChartWithWarnings } from '../parseChartText'

/**
 * The anti-drift harness.
 *
 * This app has two UltraStar parsers and cannot have one: electron/library/
 * parser.cjs is CommonJS in the main process, src/stage/chart/parseChartText.ts
 * is ESM/TypeScript in the renderer, and neither module system can load the
 * other's file. So instead of a shared implementation there is a shared proof
 * -- for every fixture in fixtures/ultrastar-tolerance/, both parsers are run
 * over the same bytes and their full { chart, warnings } results must be
 * deep-equal, warning strings included.
 *
 * A tolerance rule added to one parser and not the other fails here.
 * electron/library/__tests__/tolerance-corpus.test.cjs is the other half of
 * the pair: it states what the rules actually are.
 */
const require_ = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const CORPUS_DIR = path.resolve(HERE, '../../../../fixtures/ultrastar-tolerance')
const SAMPLE_SONG = path.resolve(HERE, '../../../../fixtures/sample-song/notes.txt')
// A windows-1252 chart with no #ENCODING tag -- the shape of most European-made charts.
const CP1252_SONG = path.resolve(HERE, '../../../../fixtures/cp1252-song/notes.txt')

const scanParser = require_(path.resolve(HERE, '../../../../electron/library/parser.cjs')) as {
  decodeSongText: (buffer: Uint8Array) => string
  parseChart: (buffer: Uint8Array) => { chart: unknown; warnings: string[] }
}

const corpusFiles = readdirSync(CORPUS_DIR)
  .filter((name) => name.endsWith('.txt'))
  .sort()

describe('scan-time and playback-time parsers agree', () => {
  it('has a corpus to check', () => {
    expect(corpusFiles.length).toBeGreaterThan(10)
  })

  it.each([...corpusFiles.map((f) => path.join(CORPUS_DIR, f)), SAMPLE_SONG, CP1252_SONG])(
    'produces identical decoded text and identical { chart, warnings } for %s',
    (file) => {
      const bytes = readFileSync(file)

      // Step 1: the byte -> text step must agree, or nothing downstream can.
      const rendererText = decodeChartBytes(bytes)
      expect(rendererText).toBe(scanParser.decodeSongText(bytes))

      // Step 2: the text -> chart step must agree, warnings included.
      const renderer = parseChartWithWarnings(rendererText)
      const scan = scanParser.parseChart(bytes)
      expect(renderer.warnings).toEqual(scan.warnings)
      expect(renderer.chart).toEqual(scan.chart)
    },
  )
})

describe('decodeChartBytes', () => {
  it("decodes an untagged windows-1252 chart's umlauts instead of U+FFFD", () => {
    const text = decodeChartBytes(readFileSync(CP1252_SONG))

    expect(text).toContain('Grüße')
    expect(text).toContain('Dächern')
    expect(text).toContain('glüht’s')
    expect(text).not.toContain('�')
  })

  it('strips a UTF-8 BOM so the very first #TAG is still readable', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('#ARTIST:X\n')])
    expect(decodeChartBytes(bytes).startsWith('#ARTIST:X')).toBe(true)
  })
})

describe('both parsers read #BACKGROUND', () => {
  it('exposes the same backgroundPath', () => {
    const text = ['#ARTIST:A', '#TITLE:T', '#BPM:120', '#COVER:A - T [CO].jpg', '#BACKGROUND:A - T [BG].jpg', ': 0 3 65 Hi', 'E'].join('\n')
    const scan = scanParser.parseChart(new TextEncoder().encode(text)) as { chart: { meta: { backgroundPath?: string } } }
    const renderer = parseChartWithWarnings(text)
    expect(scan.chart.meta.backgroundPath).toBe('A - T [BG].jpg')
    expect(renderer.chart.meta.backgroundPath).toBe('A - T [BG].jpg')
    expect(renderer.chart).toEqual(scan.chart)
  })
})
