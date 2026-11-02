// @vitest-environment node
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { runScan, runLoudnessPass } = require('../scan-worker.cjs')
const { openDb, addRoot, search, getSong, listScanErrors, updateLoudness } = require('../db.cjs')

const CHART_TEXT = (artist, title) =>
  `#ARTIST:${artist}\n#TITLE:${title}\n#MP3:song.mp3\n#BPM:200\n#GAP:1000\n: 0 2 60 hi\nE\n`

function writeSongFolder(dir, { artist, title, withMp3 = true }) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'notes.txt'), CHART_TEXT(artist, title), 'utf-8')
  if (withMp3) fs.writeFileSync(path.join(dir, 'song.mp3'), 'fake-mp3-bytes')
}

describe('runScan', () => {
  let root
  let db

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-scan-'))
    db = openDb(':memory:')
    addRoot(db, root)
  })

  it('finds song folders at unbounded depth, including artist-grouped layouts', async () => {
    writeSongFolder(path.join(root, 'FlatSong'), { artist: 'Flat', title: 'Song' })
    writeSongFolder(path.join(root, 'ArtistName', 'NestedSong'), { artist: 'Nested', title: 'Song' })

    await runScan({ rootPath: root, db })

    const results = search(db, {})
    expect(results.map((s) => s.artist).sort()).toEqual(['Flat', 'Nested'])
  })

  it('does not mistake a readme for a chart, nor stop descending at a folder holding only a readme', async () => {
    fs.writeFileSync(path.join(root, 'readme.txt'), 'My karaoke collection')
    const songDir = path.join(root, 'Artist', 'Song')
    writeSongFolder(songDir, { artist: 'Deep', title: 'Song' })
    fs.writeFileSync(path.join(songDir, 'aaa-lyrics.txt'), 'la la la')

    await runScan({ rootPath: root, db })

    expect(search(db, {}).map((s) => s.artist)).toEqual(['Deep'])
    expect(listScanErrors(db)).toEqual([])
  })

  it('records an unreadable chart as that song\'s scan error and keeps scanning the rest', async () => {
    writeSongFolder(path.join(root, 'A'), { artist: 'Kept', title: 'Song' })
    writeSongFolder(path.join(root, 'B'), { artist: 'Vanished', title: 'Song' })
    let calls = 0

    await runScan({
      rootPath: root,
      db,
      batchSize: 1,
      // Runs after discovery, before the first batch: the chart disappears
      // between being found and being read -- an rmdir mid-scan, a USB drive
      // pulled, a sync client renaming it.
      waitWhilePaused: async () => {
        if (calls++ === 0) fs.rmSync(path.join(root, 'B', 'notes.txt'))
      },
    })

    expect(search(db, {}).map((s) => s.artist)).toEqual(['Kept'])
    const errors = listScanErrors(db)
    expect(errors).toHaveLength(1)
    expect(errors[0].path).toBe(path.join(root, 'B'))
    expect(errors[0].reason).toMatch(/could not read chart/)
  })

  it('awaits the pause gate between batches', async () => {
    for (let i = 0; i < 5; i++) writeSongFolder(path.join(root, `S${i}`), { artist: `A${i}`, title: 'Song' })
    const gate = vi.fn(async () => {})

    await runScan({ rootPath: root, db, batchSize: 2, waitWhilePaused: gate })

    expect(gate).toHaveBeenCalledTimes(3)
    expect(search(db, {})).toHaveLength(5)
  })

  it('persists the real bpm/gap parsed from the chart', async () => {
    writeSongFolder(path.join(root, 'WithBpmGap'), { artist: 'BpmArtist', title: 'Song' })

    await runScan({ rootPath: root, db })

    const song = getSong(db, path.join(root, 'WithBpmGap'))
    expect(song.bpm).toBe(200)
    expect(song.gap).toBe(1000)
  })

  // A chart with no usable #BPM cannot be timed at all (every beat<->ms
  // conversion divides by it), so the parser rejects it: it is reported in the
  // scan errors with a clear reason and not indexed as a playable song.
  it('reports a song with no #BPM tag as a scan error instead of indexing an untimeable chart', async () => {
    const dir = path.join(root, 'NoBpm')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'notes.txt'),
      '#ARTIST:NoBpm\n#TITLE:Song\n#MP3:song.mp3\n#GAP:1000\n: 0 2 60 hi\nE\n',
      'utf-8',
    )
    fs.writeFileSync(path.join(dir, 'song.mp3'), 'fake-mp3-bytes')

    await runScan({ rootPath: root, db })

    const errors = listScanErrors(db).filter((e) => e.path === dir)
    expect(errors).toHaveLength(1)
    expect(errors[0].reason).toMatch(/#BPM \(missing\)/)
    expect(getSong(db, dir)).toBeFalsy()
  })

  it('falls back to whatever audio file is actually in the folder when the #MP3-tagged filename does not exist', async () => {
    const dir = path.join(root, 'RenamedAudio')
    fs.mkdirSync(dir, { recursive: true })
    // Chart tags a file that isn't there; the folder has a differently-named one.
    fs.writeFileSync(path.join(dir, 'notes.txt'), CHART_TEXT('Fallback', 'Song'), 'utf-8')
    fs.writeFileSync(path.join(dir, 'actual-audio-file.mp3'), 'fake-mp3-bytes')

    await runScan({ rootPath: root, db })

    const song = getSong(db, dir)
    expect(song.isPlayable).toBe(true)
    expect(search(db, {}).map((s) => s.path)).toContain(dir)
    expect(listScanErrors(db)).toEqual([])
  })

  it('falls back to any audio file in the folder when the chart has no #MP3 tag at all', async () => {
    const dir = path.join(root, 'NoTagButHasAudio')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(dir + '/notes.txt', '#ARTIST:NoTag\n#TITLE:Song\n#BPM:200\n#GAP:1000\n: 0 2 60 hi\nE\n', 'utf-8')
    fs.writeFileSync(path.join(dir, 'whatever.ogg'), 'fake-audio-bytes')

    await runScan({ rootPath: root, db })

    const song = getSong(db, dir)
    expect(song.isPlayable).toBe(true)
  })

  it('marks a song missing #MP3 as not playable, excluded from playable search', async () => {
    writeSongFolder(path.join(root, 'NoAudio'), { artist: 'NoAudio', title: 'Song', withMp3: false })

    await runScan({ rootPath: root, db })

    expect(search(db, {})).toEqual([])
    const song = getSong(db, path.join(root, 'NoAudio'))
    expect(song.isPlayable).toBe(false)
  })

  it('records a scan error for a song missing #MP3, so the unplayable report has something to show', async () => {
    writeSongFolder(path.join(root, 'NoAudio'), { artist: 'NoAudio', title: 'Song', withMp3: false })

    await runScan({ rootPath: root, db })

    const errors = listScanErrors(db)
    expect(errors).toHaveLength(1)
    expect(errors[0].path).toBe(path.join(root, 'NoAudio'))
    expect(errors[0].reason).toMatch(/missing audio file/)
  })

  it('a rescan clears a since-fixed song\'s stale error, but leaves an unchanged song\'s still-valid error alone', async () => {
    const fixedDir = path.join(root, 'WillBeFixed')
    writeSongFolder(fixedDir, { artist: 'Fixed', title: 'Song', withMp3: false })
    const untouchedDir = path.join(root, 'StillBroken')
    writeSongFolder(untouchedDir, { artist: 'Untouched', title: 'Song', withMp3: false })

    await runScan({ rootPath: root, db })
    expect(listScanErrors(db)).toHaveLength(2)

    // "Fix" one song by adding its audio file -- and nothing else. This used
    // to need an artificial `fs.utimesSync` on notes.txt to be re-evaluated,
    // which both hid a real bug (adding media to a folder never triggered a
    // rescan, so the fixed song kept its stale "missing audio" error forever)
    // and made the test flaky: the touch often landed in the same millisecond
    // as the original write, so the mtime never actually changed. The song
    // folder's own contents are part of the change signature now, so this is
    // deterministic.
    fs.writeFileSync(path.join(fixedDir, 'song.mp3'), 'fake-mp3-bytes')

    await runScan({ rootPath: root, db })

    const errors = listScanErrors(db)
    expect(errors).toHaveLength(1)
    expect(errors[0].path).toBe(untouchedDir)
    expect(getSong(db, fixedDir).isPlayable).toBe(true)
  })

  it('re-evaluates a song when a file appears in its folder, even though the .txt is byte-identical', async () => {
    // The incremental-rescan check used to key on the .txt alone, so dropping
    // a video (or a stem, or the missing audio file) next to an already-indexed
    // song was invisible until the chart itself happened to change.
    const dir = path.join(root, 'GainsAVideo')
    writeSongFolder(dir, { artist: 'Gains', title: 'A Video' })
    await runScan({ rootPath: root, db })
    expect(getSong(db, dir).hasVideo).toBe(false)

    fs.writeFileSync(path.join(dir, 'clip.mp4'), 'fake-mp4-bytes')
    await runScan({ rootPath: root, db })

    expect(getSong(db, dir).hasVideo).toBe(true)
  })

  it('records a scan error for a chart that parses but has no singable notes', async () => {
    // Parsing "succeeds" (a header-only file is not malformed), so this used
    // to be indexed as a perfectly playable song that then sat in the stage's
    // countdown forever. Nothing anywhere reported it.
    const dir = path.join(root, 'HeaderOnly')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'notes.txt'), '#ARTIST:A\n#TITLE:T\n#MP3:song.mp3\n#BPM:200\n#GAP:0\nE\n', 'utf-8')
    fs.writeFileSync(path.join(dir, 'song.mp3'), 'fake-mp3-bytes')

    await runScan({ rootPath: root, db })

    expect(listScanErrors(db).some((e) => e.path === dir && /no singable notes/i.test(e.reason))).toBe(true)
    expect(getSong(db, dir).isPlayable).toBe(false)
  })

  it('records each parser warning as its own scan error rather than swallowing skipped lines', async () => {
    const dir = path.join(root, 'PartlyBroken')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'notes.txt'),
      '#ARTIST:A\n#TITLE:T\n#MP3:song.mp3\n#BPM:200\n#GAP:0\n: 0 2 60 ok\nnonsense line\n: 4 2 60 ok\nE\n',
      'utf-8',
    )
    fs.writeFileSync(path.join(dir, 'song.mp3'), 'fake-mp3-bytes')

    await runScan({ rootPath: root, db })

    const errors = listScanErrors(db).filter((e) => e.path === dir)
    expect(errors).toHaveLength(1)
    expect(errors[0].reason).toMatch(/line 7: unrecognized line/)
    // A mostly-valid chart still loads: the bad line is skipped, not the song.
    expect(getSong(db, dir).isPlayable).toBe(true)
  })

  it('skips re-parsing unchanged songs on a second scan (mtime/hash unchanged)', async () => {
    writeSongFolder(path.join(root, 'Song'), { artist: 'Same', title: 'Song' })
    await runScan({ rootPath: root, db })

    let upsertCount = 0
    const dbModule = require('../db.cjs')
    const originalUpsert = dbModule.upsertSong
    dbModule.upsertSong = (...args) => {
      upsertCount++
      return originalUpsert(...args)
    }

    await runScan({ rootPath: root, db })
    dbModule.upsertSong = originalUpsert

    expect(upsertCount).toBe(0)
  })

  it('persists #PREVIEWSTART as previewStartSec', async () => {
    const dir = path.join(root, 'Preview')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'notes.txt'),
      '#ARTIST:P\n#TITLE:S\n#MP3:song.mp3\n#BPM:200\n#GAP:0\n#PREVIEWSTART:45.5\n: 0 2 60 hi\nE\n',
      'utf-8',
    )
    fs.writeFileSync(path.join(dir, 'song.mp3'), 'fake-mp3-bytes')
    writeSongFolder(path.join(root, 'NoPreview'), { artist: 'N', title: 'S' })

    await runScan({ rootPath: root, db })

    expect(getSong(db, dir).previewStartSec).toBe(45.5)
    expect(getSong(db, path.join(root, 'NoPreview')).previewStartSec).toBeNull()
  })

  it('backfills previewStartSec for an unchanged song indexed before the column existed, without a full re-index', async () => {
    const dir = path.join(root, 'Old')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'notes.txt'),
      '#ARTIST:O\n#TITLE:S\n#MP3:song.mp3\n#BPM:200\n#GAP:0\n#PREVIEWSTART:30\n: 0 2 60 hi\nE\n',
      'utf-8',
    )
    fs.writeFileSync(path.join(dir, 'song.mp3'), 'fake-mp3-bytes')
    await runScan({ rootPath: root, db })
    // Simulate a row written by the previous app version.
    db.prepare('UPDATE songs SET preview_start_sec = NULL, meta_version = 0, thumbnail_path = ?').run('/thumbs/old.jpg')

    const dbModule = require('../db.cjs')
    const originalUpsert = dbModule.upsertSong
    let upsertCount = 0
    dbModule.upsertSong = (...args) => {
      upsertCount++
      return originalUpsert(...args)
    }
    try {
      await runScan({ rootPath: root, db })
    } finally {
      dbModule.upsertSong = originalUpsert
    }

    expect(upsertCount).toBe(0)
    const song = getSong(db, dir)
    expect(song.previewStartSec).toBe(30)
    expect(song.thumbnailPath).toBe('/thumbs/old.jpg')
  })
})

describe('runScan — stems', () => {
  let root
  let db

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-scan-stems-'))
    db = openDb(':memory:')
    addRoot(db, root)
  })

  function writeStemSong(dir, { header, files }) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'notes.txt'), `${header}: 0 2 60 hi\nE\n`, 'utf-8')
    for (const name of files) fs.writeFileSync(path.join(dir, name), 'fake-audio-bytes')
  }

  it('indexes #VOCALS/#INSTRUMENTAL alongside the full mix', async () => {
    const dir = path.join(root, 'WithStems')
    writeStemSong(dir, {
      header: '#ARTIST:A\n#TITLE:T\n#AUDIO:mix.mp3\n#VOCALS:voc.mp3\n#INSTRUMENTAL:inst.mp3\n#BPM:200\n#GAP:0\n',
      files: ['mix.mp3', 'voc.mp3', 'inst.mp3'],
    })

    await runScan({ rootPath: root, db })

    const song = getSong(db, dir)
    expect(song.mp3Path).toBe(path.join(dir, 'mix.mp3'))
    expect(song.vocalsPath).toBe(path.join(dir, 'voc.mp3'))
    expect(song.instrumentalPath).toBe(path.join(dir, 'inst.mp3'))
    expect(song.hasStems).toBe(true)
    expect(listScanErrors(db)).toEqual([])
  })

  it('never substitutes another audio file for a missing stem — a mis-resolved stem would play the full mix twice', async () => {
    const dir = path.join(root, 'BrokenStem')
    writeStemSong(dir, {
      header: '#ARTIST:A\n#TITLE:T\n#MP3:mix.mp3\n#VOCALS:missing-voc.mp3\n#INSTRUMENTAL:inst.mp3\n#BPM:200\n#GAP:0\n',
      files: ['mix.mp3', 'inst.mp3'],
    })

    await runScan({ rootPath: root, db })

    const song = getSong(db, dir)
    expect(song.vocalsPath).toBeNull()
    expect(song.instrumentalPath).toBe(path.join(dir, 'inst.mp3'))
    // Still perfectly playable -- it just falls back to the full mix.
    expect(song.isPlayable).toBe(true)
    expect(listScanErrors(db).some((e) => e.path === dir && /missing-voc\.mp3/.test(e.reason))).toBe(true)
  })

  it('does not mistake a stem file for the full mix when the chart tags no #AUDIO/#MP3', async () => {
    // The "any audio file in this folder" fallback would otherwise hand back
    // the a-cappella track as the song's main audio.
    const dir = path.join(root, 'StemsOnly')
    writeStemSong(dir, {
      header: '#ARTIST:A\n#TITLE:T\n#VOCALS:voc.mp3\n#INSTRUMENTAL:inst.mp3\n#BPM:200\n#GAP:0\n',
      files: ['voc.mp3', 'inst.mp3'],
    })

    await runScan({ rootPath: root, db })

    const song = getSong(db, dir)
    expect(song.mp3Path).toBeNull()
    // The instrumental carries the whole song's timing, so a stems-only chart
    // is playable: playback promotes it to the clock source.
    expect(song.isPlayable).toBe(true)
    expect(song.hasStems).toBe(true)
  })

  it('leaves stem columns null and hasStems false for an ordinary song', async () => {
    const dir = path.join(root, 'NoStems')
    writeStemSong(dir, { header: '#ARTIST:A\n#TITLE:T\n#MP3:mix.mp3\n#BPM:200\n#GAP:0\n', files: ['mix.mp3'] })

    await runScan({ rootPath: root, db })

    const song = getSong(db, dir)
    expect(song.vocalsPath).toBeNull()
    expect(song.instrumentalPath).toBeNull()
    expect(song.hasStems).toBe(false)
  })
})

describe('runScan — thumbnails', () => {
  const electronModulePath = require.resolve('electron')
  const scanWorkerModulePath = require.resolve('../scan-worker.cjs')
  let root
  let db
  let thumbnailsDir

  function requireScanWorkerWithMockedElectron(nativeImageMock) {
    require.cache[electronModulePath] = {
      id: electronModulePath,
      filename: electronModulePath,
      loaded: true,
      exports: { nativeImage: nativeImageMock },
    }
    delete require.cache[scanWorkerModulePath]
    return require('../scan-worker.cjs')
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-scan-thumb-'))
    thumbnailsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-thumbs-'))
    db = openDb(':memory:')
    addRoot(db, root)
  })

  afterEach(() => {
    delete require.cache[electronModulePath]
    delete require.cache[scanWorkerModulePath]
  })

  it('writes a JPEG thumbnail for a song with a real cover and stores its path', async () => {
    const songDir = path.join(root, 'WithCover')
    fs.mkdirSync(songDir, { recursive: true })
    fs.writeFileSync(path.join(songDir, 'notes.txt'), '#ARTIST:A\n#TITLE:T\n#MP3:s.mp3\n#COVER:cover.jpg\n#BPM:200\n#GAP:0\n: 0 1 60 hi\nE\n')
    fs.writeFileSync(path.join(songDir, 's.mp3'), 'fake')
    fs.writeFileSync(path.join(songDir, 'cover.jpg'), 'fake-jpg-bytes')

    const mockResized = { toJPEG: () => Buffer.from('resized-jpeg') }
    const mockImage = { isEmpty: () => false, resize: () => mockResized }
    const { runScan: runScanWithMock } = requireScanWorkerWithMockedElectron({ createFromPath: () => mockImage })

    await runScanWithMock({ rootPath: root, db, thumbnailsDir })

    const song = getSong(db, songDir)
    expect(song.thumbnailPath).toBeTruthy()
    expect(fs.existsSync(song.thumbnailPath)).toBe(true)
    expect(fs.readFileSync(song.thumbnailPath, 'utf-8')).toBe('resized-jpeg')
  })

  it('leaves thumbnailPath null when there is no cover', async () => {
    const songDir = path.join(root, 'NoCover')
    fs.mkdirSync(songDir, { recursive: true })
    fs.writeFileSync(path.join(songDir, 'notes.txt'), '#ARTIST:A\n#TITLE:T\n#MP3:s.mp3\n#BPM:200\n#GAP:0\n: 0 1 60 hi\nE\n')
    fs.writeFileSync(path.join(songDir, 's.mp3'), 'fake')

    const { runScan: runScanWithMock } = requireScanWorkerWithMockedElectron({ createFromPath: () => ({ isEmpty: () => true }) })
    await runScanWithMock({ rootPath: root, db, thumbnailsDir })

    const song = getSong(db, songDir)
    expect(song.thumbnailPath).toBeNull()
  })
})

// Phase 2 of a scan: the EBU R 128 backfill that gives playback a per-song
// normalisation gain. See electron/library/loudness.cjs for why it measures at
// scan time and src/audio/loudness.ts for what the numbers are used for.
describe('runLoudnessPass', () => {
  let root
  let db

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-loudness-'))
    db = openDb(':memory:')
    addRoot(db, root)
  })

  const available = () => Promise.resolve(true)

  it('measures every song that has no measurement, and stores it', async () => {
    writeSongFolder(path.join(root, 'A'), { artist: 'A', title: 'Song' })
    writeSongFolder(path.join(root, 'B'), { artist: 'B', title: 'Song' })
    await runScan({ rootPath: root, db })

    const measure = vi.fn(async (audioPath) => ({
      integratedLufs: audioPath.includes(`${path.sep}A${path.sep}`) ? -5.9 : -17,
      truePeakDbtp: -1,
    }))
    const result = await runLoudnessPass({ rootPath: root, db, measure, ffmpegAvailable: available })

    expect(result).toEqual({ measured: 2, skipped: 0 })
    expect(getSong(db, path.join(root, 'A')).loudnessLufs).toBeCloseTo(-5.9, 6)
    expect(getSong(db, path.join(root, 'B')).loudnessLufs).toBeCloseTo(-17, 6)
  })

  it('measures the file that will actually be heard', async () => {
    writeSongFolder(path.join(root, 'A'), { artist: 'A', title: 'Song' })
    await runScan({ rootPath: root, db })

    const measure = vi.fn().mockResolvedValue({ integratedLufs: -12, truePeakDbtp: -1 })
    await runLoudnessPass({ rootPath: root, db, measure, ffmpegAvailable: available })

    expect(measure).toHaveBeenCalledWith(path.join(root, 'A', 'song.mp3'))
  })

  // The whole reason the pass keys on "no measurement yet" rather than on the
  // scan's own change detection: a library indexed before loudness existed
  // hashes identically, so every song is skipped by the metadata pass and a
  // rescan would otherwise never measure anything.
  it('backfills a library whose songs are all unchanged since the last scan', async () => {
    writeSongFolder(path.join(root, 'A'), { artist: 'A', title: 'Song' })
    await runScan({ rootPath: root, db })
    // A second scan skips the song entirely -- nothing about it has changed.
    const second = await runScan({ rootPath: root, db })
    expect(second.songsParsed).toBe(0)

    const measure = vi.fn().mockResolvedValue({ integratedLufs: -9, truePeakDbtp: -1 })
    await runLoudnessPass({ rootPath: root, db, measure, ffmpegAvailable: available })

    expect(getSong(db, path.join(root, 'A')).loudnessLufs).toBeCloseTo(-9, 6)
  })

  it('never re-measures a song it has already measured', async () => {
    writeSongFolder(path.join(root, 'A'), { artist: 'A', title: 'Song' })
    await runScan({ rootPath: root, db })
    updateLoudness(db, path.join(root, 'A'), { integratedLufs: -9, truePeakDbtp: -1 })

    const measure = vi.fn().mockResolvedValue({ integratedLufs: -99, truePeakDbtp: -1 })
    const result = await runLoudnessPass({ rootPath: root, db, measure, ffmpegAvailable: available })

    expect(measure).not.toHaveBeenCalled()
    expect(result).toEqual({ measured: 0, skipped: 0 })
    expect(getSong(db, path.join(root, 'A')).loudnessLufs).toBeCloseTo(-9, 6)
  })

  it('skips the whole pass when there is no decoder on this machine, without spawning per song', async () => {
    writeSongFolder(path.join(root, 'A'), { artist: 'A', title: 'Song' })
    writeSongFolder(path.join(root, 'B'), { artist: 'B', title: 'Song' })
    await runScan({ rootPath: root, db })

    const measure = vi.fn()
    const result = await runLoudnessPass({
      rootPath: root,
      db,
      measure,
      ffmpegAvailable: () => Promise.resolve(false),
    })

    expect(measure).not.toHaveBeenCalled()
    expect(result).toEqual({ measured: 0, skipped: 2 })
    // And the songs are still perfectly playable -- just unnormalised.
    expect(getSong(db, path.join(root, 'A')).isPlayable).toBe(true)
    expect(getSong(db, path.join(root, 'A')).loudnessLufs).toBeNull()
  })

  it('leaves a song that could not be measured unmeasured, and keeps going', async () => {
    writeSongFolder(path.join(root, 'Broken'), { artist: 'Broken', title: 'Song' })
    writeSongFolder(path.join(root, 'Fine'), { artist: 'Fine', title: 'Song' })
    await runScan({ rootPath: root, db })

    const measure = vi.fn(async (audioPath) =>
      audioPath.includes('Broken') ? null : { integratedLufs: -12, truePeakDbtp: -1 },
    )
    const result = await runLoudnessPass({ rootPath: root, db, measure, ffmpegAvailable: available })

    expect(result).toEqual({ measured: 1, skipped: 1 })
    expect(getSong(db, path.join(root, 'Broken')).loudnessLufs).toBeNull()
    expect(getSong(db, path.join(root, 'Fine')).loudnessLufs).toBeCloseTo(-12, 6)
  })

  it('does not probe for a decoder at all when there is nothing to measure', async () => {
    const ffmpegAvailable = vi.fn()
    const result = await runLoudnessPass({ rootPath: root, db, measure: vi.fn(), ffmpegAvailable })

    expect(ffmpegAvailable).not.toHaveBeenCalled()
    expect(result).toEqual({ measured: 0, skipped: 0 })
  })

  it('measures several files at once rather than one at a time', async () => {
    for (const name of ['A', 'B', 'C', 'D']) writeSongFolder(path.join(root, name), { artist: name, title: 'Song' })
    await runScan({ rootPath: root, db })

    let inFlight = 0
    let peak = 0
    const measure = async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight--
      return { integratedLufs: -12, truePeakDbtp: -1 }
    }

    await runLoudnessPass({ rootPath: root, db, measure, ffmpegAvailable: available, concurrency: 3 })

    expect(peak).toBe(3)
  })

  it('reports progress under its own phase, so the metadata scan s counters are not reused', async () => {
    writeSongFolder(path.join(root, 'A'), { artist: 'A', title: 'Song' })
    await runScan({ rootPath: root, db })

    const progress = []
    await runLoudnessPass({
      rootPath: root,
      db,
      measure: async () => ({ integratedLufs: -12, truePeakDbtp: -1 }),
      ffmpegAvailable: available,
      onProgress: (p) => progress.push(p),
    })

    expect(progress).toHaveLength(1)
    expect(progress[0]).toMatchObject({ phase: 'loudness', songsFound: 1, songsParsed: 1, done: false })
  })
})

describe('runScan — loudness phase', () => {
  let root
  let db

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-scan-loudness-'))
    db = openDb(':memory:')
    addRoot(db, root)
  })

  it('leaves the loudness phase off unless the caller asks for it', async () => {
    writeSongFolder(path.join(root, 'A'), { artist: 'A', title: 'Song' })
    const measure = vi.fn()

    await runScan({ rootPath: root, db, loudnessOptions: { measure, ffmpegAvailable: () => Promise.resolve(true) } })

    expect(measure).not.toHaveBeenCalled()
  })

  it('runs it behind the metadata pass, so the library is browsable before any decoding starts', async () => {
    writeSongFolder(path.join(root, 'A'), { artist: 'A', title: 'Song' })

    let songsIndexedWhenMeasuringStarted = null
    const measure = vi.fn(async () => {
      songsIndexedWhenMeasuringStarted = search(db, {}).length
      return { integratedLufs: -12, truePeakDbtp: -1 }
    })

    const result = await runScan({
      rootPath: root,
      db,
      analyseLoudness: true,
      loudnessOptions: { measure, ffmpegAvailable: () => Promise.resolve(true) },
    })

    expect(songsIndexedWhenMeasuringStarted).toBe(1)
    expect(result.loudness).toEqual({ measured: 1, skipped: 0 })
  })

  it('reports done only once the loudness phase has finished too', async () => {
    writeSongFolder(path.join(root, 'A'), { artist: 'A', title: 'Song' })
    const seen = []

    await runScan({
      rootPath: root,
      db,
      analyseLoudness: true,
      onProgress: (p) => seen.push(p),
      loudnessOptions: {
        measure: async () => ({ integratedLufs: -12, truePeakDbtp: -1 }),
        ffmpegAvailable: () => Promise.resolve(true),
      },
    })

    const doneIndex = seen.findIndex((p) => p.done)
    expect(doneIndex).toBe(seen.length - 1)
    expect(seen.some((p) => p.phase === 'loudness')).toBe(true)
  })
})

describe('computeFolderSignature format', () => {
  // The stored content_hash of every indexed song was computed with this exact
  // formula (sha1 of the chart bytes, a NUL, then the sorted file names joined
  // by NUL). Changing any part of it -- even just the separator -- makes every
  // song look changed on the next rescan: a full re-index and every thumbnail
  // rebuilt. Pinned against an independent computation so that cannot happen
  // silently.
  it('is sha1(chart + NUL + sorted names joined by NUL)', () => {
    const crypto = require('node:crypto')
    const { computeFolderSignature } = require('../scan-worker.cjs')
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-signature-'))
    try {
      fs.writeFileSync(path.join(folder, 'song.txt'), 'chart')
      fs.writeFileSync(path.join(folder, 'b.mp3'), '')
      fs.writeFileSync(path.join(folder, 'a cover.jpg'), '')
      fs.mkdirSync(path.join(folder, 'subfolder'))
      const chart = Buffer.from('#TITLE:x\n')
      const expected = crypto
        .createHash('sha1')
        .update(Buffer.concat([chart, Buffer.from([0]), Buffer.from(['a cover.jpg', 'b.mp3', 'song.txt'].join('\u0000'), 'utf-8')]))
        .digest('hex')
      expect(computeFolderSignature(folder, chart)).toBe(expected)
    } finally {
      fs.rmSync(folder, { recursive: true, force: true })
    }
  })
})
