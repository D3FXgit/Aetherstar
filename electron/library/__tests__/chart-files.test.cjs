// @vitest-environment node
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { looksLikeChartText, looksLikeDuet, listChartFiles, pickChartFile } = require('../chart-files.cjs')
const { findSongFolders, discoverSongs } = require('../scan-worker.cjs')

const CHART = (title = 'T') => `#ARTIST:A\n#TITLE:${title}\n#MP3:song.mp3\n#BPM:200\n#GAP:0\n: 0 2 60 hi\nE\n`

describe('looksLikeChartText', () => {
  it('accepts an UltraStar header, with or without a byte-order mark or #BPM', () => {
    expect(looksLikeChartText(CHART())).toBe(true)
    expect(looksLikeChartText(`\u00ef\u00bb\u00bf${CHART()}`)).toBe(true)
    expect(looksLikeChartText('#ARTIST:NoBpm\n#TITLE:Song\n#MP3:song.mp3\n')).toBe(true)
  })

  it('rejects readmes, lyrics and a #TITLE with nothing else chart-like', () => {
    expect(looksLikeChartText('Thanks for downloading!\nVisit our site.\n')).toBe(false)
    expect(looksLikeChartText('Never gonna give you up\nnever gonna let you down\n')).toBe(false)
    expect(looksLikeChartText('#TITLE:only\n')).toBe(false)
    expect(looksLikeChartText(null)).toBe(false)
  })
})

describe('listChartFiles / pickChartFile', () => {
  let dir

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-charts-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('ignores .txt files that are not charts', () => {
    fs.writeFileSync(path.join(dir, 'aaa-readme.txt'), 'hello')
    fs.writeFileSync(path.join(dir, 'Song.txt'), CHART())
    expect(listChartFiles(dir)).toEqual([path.join(dir, 'Song.txt')])
  })

  it('picks the solo chart over a duet, then the shortest name, deterministically', () => {
    fs.writeFileSync(path.join(dir, 'A - T [DUET].txt'), `${CHART()}P1\n`)
    fs.writeFileSync(path.join(dir, 'A - T (Acoustic).txt'), CHART())
    fs.writeFileSync(path.join(dir, 'A - T.txt'), CHART())
    expect(listChartFiles(dir).map((p) => path.basename(p))).toEqual(['A - T.txt', 'A - T (Acoustic).txt', 'A - T [DUET].txt'])
    expect(pickChartFile(dir)).toBe(path.join(dir, 'A - T.txt'))
  })

  it('treats a chart with P1/P2 sections as a duet even without "duet" in its name', () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), `#ARTIST:A\n#TITLE:T\n#BPM:1\nP1\n: 0 1 1 x\nP2\n: 2 1 1 y\nE\n`)
    fs.writeFileSync(path.join(dir, 'bb.txt'), CHART())
    expect(pickChartFile(dir)).toBe(path.join(dir, 'bb.txt'))
  })

  it('also recognises the spaced "P 1" / "P 2" duet marker spelling', () => {
    expect(looksLikeDuet('a.txt', '#TITLE:T\nP 1\n: 0 1 1 x\nP 2\n: 2 1 1 y\nE\n')).toBe(true)
    expect(looksLikeDuet('a.txt', '#TITLE:T\r\np 2\r\n: 2 1 1 y\r\nE\r\n')).toBe(true)
    expect(looksLikeDuet('a.txt', '#TITLE:T\n: 0 1 1 P 1\nE\n')).toBe(false)
  })

  it('returns null for a folder with no chart, and for a missing folder', () => {
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'just notes')
    expect(pickChartFile(dir)).toBeNull()
    expect(pickChartFile(path.join(dir, 'missing'))).toBeNull()
  })
})

describe('findSongFolders', () => {
  let root

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-walk-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('keeps descending past a folder whose only .txt is a readme', () => {
    const artist = path.join(root, 'Lumen Quartet')
    const song = path.join(artist, 'Lumen Quartet - Harbour Lights')
    fs.mkdirSync(song, { recursive: true })
    fs.writeFileSync(path.join(artist, 'readme.txt'), 'All songs ripped by someone.')
    fs.writeFileSync(path.join(song, 'Lumen Quartet - Harbour Lights.txt'), CHART('Harbour Lights'))

    expect(findSongFolders(root)).toEqual([song])
  })

  it('reports the chosen chart alongside each folder', () => {
    const song = path.join(root, 'Song')
    fs.mkdirSync(song)
    fs.writeFileSync(path.join(song, 'license.txt'), 'CC-BY')
    fs.writeFileSync(path.join(song, 'Song.txt'), CHART())

    expect(discoverSongs(root)).toEqual([{ folder: song, chartPath: path.join(song, 'Song.txt') }])
  })
})
