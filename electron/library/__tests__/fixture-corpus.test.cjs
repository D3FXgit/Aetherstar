// @vitest-environment node
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { generateCorpus } = require('../test-helpers/generateCorpus.cjs')
const { runScan } = require('../scan-worker.cjs')
const { openDb, addRoot, search } = require('../db.cjs')
const { parseChart } = require('../parser.cjs')

const FIXTURE_PATH = path.join(__dirname, '..', '..', '..', 'fixtures', 'sample-song', 'notes.txt')

describe('generateCorpus + scan/search perf', () => {
  it('writes a varied corpus with a malformed and a non-UTF-8 entry', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-corpus-'))
    const { count, titles } = generateCorpus(rootDir, { count: 40 })
    expect(count).toBe(40)
    expect(fs.readdirSync(rootDir)).toHaveLength(40)
    expect(titles).toHaveLength(40)
  })

  it('scans the full corpus and search stays under 200ms', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-corpus-scan-'))
    const { titles } = generateCorpus(rootDir, { count: 40 })

    const db = openDb(':memory:')
    addRoot(db, rootDir)
    const { songsFound, songsParsed } = await runScan({ rootPath: rootDir, db })

    expect(songsFound).toBe(40)
    expect(songsParsed).toBe(40) // the malformed entry still parses (with a warning), not skipped

    const knownTitleFragment = titles[10].split(' ')[0].toLowerCase()
    const start = performance.now()
    const results = search(db, { query: knownTitleFragment })
    const elapsedMs = performance.now() - start

    expect(results.length).toBeGreaterThan(0)
    expect(elapsedMs).toBeLessThan(200)
  })
})

describe('golden-file parser test', () => {
  it('parses the reference fixture file byte-exact into the SongChart contract', () => {
    const buffer = fs.readFileSync(FIXTURE_PATH)
    const { chart, warnings } = parseChart(buffer)

    expect(warnings).toEqual([])
    expect(chart.meta.artist).toBe('AetherStar')
    expect(chart.meta.title).toBe('First Light')
    expect(chart.meta.bpm).toBe(120)
    expect(chart.meta.gap).toBe(6000)
    expect(chart.lines[0].notes[0]).toEqual({ kind: 'normal', startBeat: 0, length: 3, pitch: 64, syllable: 'Wake' })
  })
})
