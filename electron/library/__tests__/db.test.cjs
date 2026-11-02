// @vitest-environment node
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  openDb,
  addRoot,
  listRoots,
  removeRoot,
  upsertSong,
  getSong,
  search,
  recordScanError,
  listScanErrors,
  listSongsMissingThumbnail,
  updateThumbnailPath,
  updateThumbnailPaths,
  listSongsMissingLoudness,
  updateLoudness,
  pruneMissingSongs,
  updateChartMeta,
  findByPathAndHash,
  SONG_META_VERSION,
  sanitizeLoudnessMeasurement,
} = require('../db.cjs')

function makeSongRow(overrides = {}) {
  return {
    path: '/library/Nova Lane/Paper Satellites',
    rootPath: '/library',
    artist: 'Nova Lane',
    title: 'Paper Satellites',
    language: 'English',
    durationMs: 180000,
    isDuet: false,
    isPlayable: true,
    mtimeMs: 1000,
    contentHash: 'abc123',
    addedAt: 1000,
    ...overrides,
  }
}

describe('openDb — schema + migration', () => {
  it('creates library_roots, songs, scan_errors, and the songs_fts virtual table', () => {
    const db = openDb(':memory:')
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
      .all()
      .map((r) => r.name)

    expect(tables).toContain('library_roots')
    expect(tables).toContain('songs')
    expect(tables).toContain('scan_errors')
    expect(tables).toContain('songs_fts')
    db.close()
  })

  it('uses WAL journal mode on a real file', () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-db-')), 'library.db')
    const db = openDb(dbPath)
    const mode = db.pragma('journal_mode', { simple: true })
    expect(mode).toBe('wal')
    db.close()
  })

  it('is idempotent — opening the same file twice does not throw or duplicate tables', () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-db-')), 'library.db')
    const db1 = openDb(dbPath)
    db1.close()
    expect(() => {
      const db2 = openDb(dbPath)
      const count = db2.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='songs'").get()
      expect(count.c).toBe(1)
      db2.close()
    }).not.toThrow()
  })
})

describe('library_roots + songs queries', () => {
  let db

  beforeEach(() => {
    db = openDb(':memory:')
    addRoot(db, '/library')
  })

  it('round-trips a song through upsertSong/getSong', () => {
    upsertSong(db, makeSongRow())
    const song = getSong(db, '/library/Nova Lane/Paper Satellites')
    expect(song.artist).toBe('Nova Lane')
    expect(song.durationMs).toBe(180000)
    expect(song.isPlayable).toBe(true)
  })

  it('round-trips bpm, gap, and mp3Path through upsertSong/getSong', () => {
    upsertSong(db, makeSongRow({ bpm: 250, gap: 24065, mp3Path: '/library/song.mp3' }))
    const song = getSong(db, makeSongRow().path)
    expect(song.bpm).toBe(250)
    expect(song.gap).toBe(24065)
    expect(song.mp3Path).toBe('/library/song.mp3')
  })

  it('defaults bpm/gap to 0 for a song upserted without them (pre-migration row)', () => {
    upsertSong(db, makeSongRow())
    const song = getSong(db, makeSongRow().path)
    expect(song.bpm).toBe(0)
    expect(song.gap).toBe(0)
  })

  it('upserting the same path twice updates in place, no duplicate row', () => {
    upsertSong(db, makeSongRow())
    upsertSong(db, makeSongRow({ title: 'Updated Title' }))
    const count = db.prepare('SELECT count(*) as c FROM songs').get()
    expect(count.c).toBe(1)
    expect(getSong(db, makeSongRow().path).title).toBe('Updated Title')
  })

  it('round-trips library roots and removeRoot cascades to songs', () => {
    upsertSong(db, makeSongRow())
    expect(listRoots(db).map((r) => r.path)).toEqual(['/library'])

    removeRoot(db, '/library')
    expect(listRoots(db)).toEqual([])
    expect(search(db, {})).toEqual([])
  })

  it('round-trips scan errors', () => {
    recordScanError(db, { path: '/library/broken', reason: 'missing #MP3', timestamp: 5000 })
    const errors = listScanErrors(db)
    expect(errors).toHaveLength(1)
    expect(errors[0].reason).toBe('missing #MP3')
  })

  it('listSongsMissingThumbnail finds a song with a cover but no thumbnail yet, ignores one with neither or one already done', () => {
    upsertSong(db, makeSongRow({ path: '/library/needs-thumb', coverPath: '/library/needs-thumb/cover.jpg' }))
    upsertSong(db, makeSongRow({ path: '/library/no-cover' }))
    upsertSong(
      db,
      makeSongRow({ path: '/library/already-done', coverPath: '/library/already-done/cover.jpg', thumbnailPath: '/thumbs/x.jpg' }),
    )

    const pending = listSongsMissingThumbnail(db, '/library')

    expect(pending).toHaveLength(1)
    expect(pending[0].path).toBe('/library/needs-thumb')
    expect(pending[0].cover_path).toBe('/library/needs-thumb/cover.jpg')
  })

  it('updateThumbnailPath sets thumbnail_path for exactly the given song', () => {
    upsertSong(db, makeSongRow({ path: '/library/needs-thumb', coverPath: '/library/needs-thumb/cover.jpg' }))

    updateThumbnailPath(db, '/library/needs-thumb', '/thumbs/abc.jpg')

    expect(getSong(db, '/library/needs-thumb').thumbnailPath).toBe('/thumbs/abc.jpg')
    expect(listSongsMissingThumbnail(db, '/library')).toHaveLength(0)
  })

  it("toLibrarySong falls back to the full cover image when no resized thumbnail has been generated yet (backfillMissingThumbnails hasn't run, or nativeImage generation failed)", () => {
    upsertSong(db, makeSongRow({ path: '/library/needs-thumb', coverPath: '/library/needs-thumb/cover.jpg' }))
    expect(getSong(db, '/library/needs-thumb').thumbnailPath).toBe('/library/needs-thumb/cover.jpg')

    updateThumbnailPath(db, '/library/needs-thumb', '/thumbs/abc.jpg')
    expect(getSong(db, '/library/needs-thumb').thumbnailPath).toBe('/thumbs/abc.jpg')
  })

  it('search() FTS5-matches by artist prefix', () => {
    upsertSong(db, makeSongRow())
    const results = search(db, { query: 'nova' })
    expect(results).toHaveLength(1)
    expect(results[0].artist).toBe('Nova Lane')
  })

  it('search() treats FTS5 syntax characters in the query as text, not as query syntax', () => {
    upsertSong(db, makeSongRow({ path: '/library/txrx', artist: 'TX/RX', title: 'Static Road' }))
    upsertSong(db, makeSongRow())

    for (const query of ['TX/RX', 'tx/rx static', '"TX', 'TX - RX', '(static', 'NOT', 'title:road']) {
      expect(() => search(db, { query })).not.toThrow()
    }
    expect(search(db, { query: 'TX/RX' }).map((s) => s.artist)).toEqual(['TX/RX'])
    expect(search(db, { query: 'nova la' }).map((s) => s.artist)).toEqual(['Nova Lane'])
    // Nothing searchable at all -> no text filter, rather than an error.
    expect(search(db, { query: ' - ' })).toHaveLength(2)
  })

  it('updateThumbnailPaths writes many thumbnails in one go', () => {
    upsertSong(db, makeSongRow({ path: '/library/a', coverPath: '/library/a/cover.jpg' }))
    upsertSong(db, makeSongRow({ path: '/library/b', coverPath: '/library/b/cover.jpg' }))
    updateThumbnailPaths(db, [
      { path: '/library/a', thumbnailPath: '/thumbs/a.jpg' },
      { path: '/library/b', thumbnailPath: '/thumbs/b.jpg' },
    ])
    expect(getSong(db, '/library/a').thumbnailPath).toBe('/thumbs/a.jpg')
    expect(getSong(db, '/library/b').thumbnailPath).toBe('/thumbs/b.jpg')
  })

  it('removeRoot clears scan errors under a Windows-style root, and leaves a look-alike sibling root alone', () => {
    addRoot(db, 'D:\\Songs_1')
    recordScanError(db, { path: 'D:\\Songs_1\\A - B', reason: 'bad note', timestamp: 1 })
    recordScanError(db, { path: 'D:\\SongsX1\\C - D', reason: 'bad note', timestamp: 2 })
    removeRoot(db, 'D:\\Songs_1')
    expect(listScanErrors(db).map((e) => e.path)).toEqual(['D:\\SongsX1\\C - D'])
  })

  it('removeRoot clears scan errors under a root whose name contains an astral (non-BMP) character', () => {
    // JS .length counts the emoji as 2 UTF-16 units, SQLite's substr as 1
    // character; the prefix length has to be measured on the SQLite side.
    const root = '/music/\u{1F3A4} Karaoke'
    addRoot(db, root)
    recordScanError(db, { path: `${root}/A - B`, reason: 'bad note', timestamp: 1 })
    recordScanError(db, { path: `${root}\\C - D`, reason: 'bad note', timestamp: 2 })
    recordScanError(db, { path: '/music/other/E - F', reason: 'bad note', timestamp: 3 })
    removeRoot(db, root)
    expect(listScanErrors(db).map((e) => e.path)).toEqual(['/music/other/E - F'])
  })

  it('round-trips previewStartSec, and stores a missing or garbage value as null', () => {
    upsertSong(db, makeSongRow({ path: '/library/a', previewStartSec: 42.5 }))
    upsertSong(db, makeSongRow({ path: '/library/b' }))
    upsertSong(db, makeSongRow({ path: '/library/c', previewStartSec: -3 }))
    upsertSong(db, makeSongRow({ path: '/library/d', previewStartSec: Number.NaN }))
    expect(getSong(db, '/library/a').previewStartSec).toBe(42.5)
    expect(getSong(db, '/library/b').previewStartSec).toBeNull()
    expect(getSong(db, '/library/c').previewStartSec).toBeNull()
    expect(getSong(db, '/library/d').previewStartSec).toBeNull()
  })

  it('updateChartMeta fills preview_start_sec and the meta version without touching the thumbnail or loudness', () => {
    upsertSong(db, makeSongRow({ path: '/library/a', coverPath: '/library/a/cover.jpg' }))
    updateThumbnailPath(db, '/library/a', '/thumbs/a.jpg')
    updateLoudness(db, '/library/a', { integratedLufs: -14, truePeakDbtp: -1 })
    db.prepare('UPDATE songs SET meta_version = 0').run()

    updateChartMeta(db, '/library/a', { previewStartSec: 61 })

    const song = getSong(db, '/library/a')
    expect(song.previewStartSec).toBe(61)
    expect(song.thumbnailPath).toBe('/thumbs/a.jpg')
    expect(song.loudnessLufs).toBe(-14)
    expect(findByPathAndHash(db, '/library/a').metaVersion).toBe(SONG_META_VERSION)
  })

  it('search() filters by plain columns (language + duetOnly)', () => {
    upsertSong(db, makeSongRow())
    upsertSong(db, makeSongRow({ path: '/library/duet', title: 'Duet Song', isDuet: true, language: 'German' }))

    expect(search(db, { language: 'English', duetOnly: true })).toEqual([])
    expect(search(db, { duetOnly: true })).toHaveLength(1)
    expect(search(db, { language: 'English' })).toHaveLength(1)
  })

  it('search() excludes non-playable songs by default', () => {
    upsertSong(db, makeSongRow({ path: '/library/unplayable', isPlayable: false }))
    upsertSong(db, makeSongRow())
    expect(search(db, {})).toHaveLength(1)
  })
})

// Per-song loudness (electron/library/loudness.cjs -> src/audio/loudness.ts).
describe('loudness', () => {
  let db

  beforeEach(() => {
    db = openDb(':memory:')
    addRoot(db, '/library')
  })

  it('leaves a song unmeasured until the loudness pass measures it', () => {
    upsertSong(db, makeSongRow())

    const song = getSong(db, '/library/Nova Lane/Paper Satellites')
    // Null, not 0 and not -18: "never analysed" has to stay distinguishable
    // from "analysed at some level", because the first means "leave this
    // song's volume alone" and the second means "change it".
    expect(song.loudnessLufs).toBeNull()
    expect(song.truePeakDbtp).toBeNull()
  })

  it('stores and returns a measurement', () => {
    upsertSong(db, makeSongRow())
    updateLoudness(db, '/library/Nova Lane/Paper Satellites', { integratedLufs: -17, truePeakDbtp: -5.3 })

    const song = getSong(db, '/library/Nova Lane/Paper Satellites')
    expect(song.loudnessLufs).toBeCloseTo(-17, 6)
    expect(song.truePeakDbtp).toBeCloseTo(-5.3, 6)
  })

  it('does not throw away a measurement when an ordinary metadata rescan re-upserts the song', () => {
    // The measurement cost a full decode; re-parsing the chart must not undo
    // it. Only the loudness pass writes these columns.
    upsertSong(db, makeSongRow())
    updateLoudness(db, '/library/Nova Lane/Paper Satellites', { integratedLufs: -17, truePeakDbtp: -5.3 })

    upsertSong(db, makeSongRow({ title: 'Paper Satellites (Live)' }))

    const song = getSong(db, '/library/Nova Lane/Paper Satellites')
    expect(song.title).toBe('Paper Satellites (Live)')
    expect(song.loudnessLufs).toBeCloseTo(-17, 6)
  })

  it('sanitizeLoudnessMeasurement accepts a plausible measurement and rejects anything else', () => {
    expect(sanitizeLoudnessMeasurement({ integratedLufs: -14.2, truePeakDbtp: -0.8, extra: 1 })).toEqual({
      integratedLufs: -14.2,
      truePeakDbtp: -0.8,
    })
    for (const bad of [
      null,
      undefined,
      'x',
      {},
      { integratedLufs: '-14', truePeakDbtp: -1 },
      { integratedLufs: Number.NaN, truePeakDbtp: -1 },
      { integratedLufs: -Infinity, truePeakDbtp: -1 },
      { integratedLufs: -14, truePeakDbtp: Infinity },
      { integratedLufs: -90, truePeakDbtp: -1 },
      { integratedLufs: 25, truePeakDbtp: -1 },
      { integratedLufs: -14, truePeakDbtp: 99 },
    ]) {
      expect(sanitizeLoudnessMeasurement(bad)).toBeNull()
    }
  })

  describe('listSongsMissingLoudness', () => {
    it('lists exactly the songs that have audio and no measurement yet', () => {
      upsertSong(db, makeSongRow({ path: '/library/a', mp3Path: '/library/a/audio.mp3' }))
      upsertSong(db, makeSongRow({ path: '/library/b', mp3Path: '/library/b/audio.mp3' }))
      updateLoudness(db, '/library/b', { integratedLufs: -12, truePeakDbtp: -1 })

      expect(listSongsMissingLoudness(db, '/library').map((s) => s.path)).toEqual(['/library/a'])
    })

    it('picks up a stems-only song through its instrumental track', () => {
      upsertSong(db, makeSongRow({ path: '/library/stems', mp3Path: null, instrumentalPath: '/library/stems/inst.mp3' }))

      const pending = listSongsMissingLoudness(db, '/library')
      expect(pending).toHaveLength(1)
      expect(pending[0].instrumentalPath).toBe('/library/stems/inst.mp3')
    })

    it('skips a song with no audio at all, since there is nothing to measure', () => {
      upsertSong(db, makeSongRow({ path: '/library/no-audio', mp3Path: null, isPlayable: false }))
      expect(listSongsMissingLoudness(db, '/library')).toHaveLength(0)
    })

    it('is scoped to one root', () => {
      addRoot(db, '/other')
      upsertSong(db, makeSongRow({ path: '/library/a', mp3Path: '/library/a/audio.mp3' }))
      upsertSong(db, makeSongRow({ path: '/other/b', rootPath: '/other', mp3Path: '/other/b/audio.mp3' }))

      expect(listSongsMissingLoudness(db, '/library').map((s) => s.path)).toEqual(['/library/a'])
    })
  })

  it('migrates an existing database that predates the loudness columns', () => {
    // The real upgrade path: a library indexed before this feature existed must
    // open, keep every song it had, and simply report them as unmeasured.
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-db-')), 'library.db')
    const before = openDb(dbPath)
    before.exec('ALTER TABLE songs DROP COLUMN loudness_lufs')
    before.exec('ALTER TABLE songs DROP COLUMN true_peak_dbtp')
    addRoot(before, '/library')
    // Raw SQL, not upsertSong: the point of this test is a schema that predates
    // the columns the current writer knows about.
    before
      .prepare(
        `INSERT INTO songs (path, root_path, artist, title, duration_ms, is_duet, is_playable, mtime_ms, content_hash, added_at)
         VALUES ('/library/old', '/library', 'Nova Lane', 'Paper Satellites', 180000, 0, 1, 1000, 'abc123', 1000)`,
      )
      .run()
    before.close()

    const after = openDb(dbPath)
    const columns = after.prepare('PRAGMA table_info(songs)').all().map((c) => c.name)

    expect(columns).toContain('loudness_lufs')
    expect(columns).toContain('true_peak_dbtp')
    expect(getSong(after, '/library/old').title).toBe('Paper Satellites')
    expect(getSong(after, '/library/old').loudnessLufs).toBeNull()
    after.close()
  })

  describe('pruneMissingSongs', () => {
    it('removes songs and errors no longer in activeSongPaths', () => {
      addRoot(db, '/library')
      upsertSong(db, makeSongRow({ path: '/library/a', rootPath: '/library' }))
      upsertSong(db, makeSongRow({ path: '/library/b', rootPath: '/library' }))
      recordScanError(db, { path: '/library/b', reason: 'bad note', timestamp: 100 })

      const pruned = pruneMissingSongs(db, '/library', ['/library/a'])
      expect(pruned).toBe(1)
      expect(getSong(db, '/library/a')).not.toBeNull()
      expect(getSong(db, '/library/b')).toBeNull()
      expect(listScanErrors(db)).toHaveLength(0)
    })
  })

})

describe('favourites and play history', () => {
  const { setFavorite, listFavorites, recordPlay } = require('../db.cjs')
  let db

  beforeEach(() => {
    db = openDb(':memory:')
    addRoot(db, '/library')
    upsertSong(db, makeSongRow({ path: '/library/a', artist: 'Alpha', title: 'A' }))
    upsertSong(db, makeSongRow({ path: '/library/b', artist: 'Bravo', title: 'B' }))
    upsertSong(db, makeSongRow({ path: '/library/c', artist: 'Charlie', title: 'C' }))
  })

  afterEach(() => db.close())

  it('creates both tables additively on an existing database', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
    expect(tables).toEqual(expect.arrayContaining(['favorites', 'play_history']))
  })

  it('stars and unstars a song by path, idempotently', () => {
    setFavorite(db, '/library/b', true)
    setFavorite(db, '/library/b', true)
    setFavorite(db, '/library/a', true)
    expect(listFavorites(db).sort()).toEqual(['/library/a', '/library/b'])

    setFavorite(db, '/library/a', false)
    expect(listFavorites(db)).toEqual(['/library/b'])
    expect(setFavorite(db, '', true)).toBe(false)
  })

  it('filters the search down to favourites', () => {
    setFavorite(db, '/library/c', true)
    expect(search(db, { favoritesOnly: true }).map((s) => s.path)).toEqual(['/library/c'])
  })

  it('sorts by most and most recently sung, unplayed songs last', () => {
    recordPlay(db, { songPath: '/library/c', mode: 'classic', playedAt: 100 })
    recordPlay(db, { songPath: '/library/c', mode: 'jukebox', playedAt: 200 })
    recordPlay(db, { songPath: '/library/b', mode: 'jukebox', playedAt: 300 })

    expect(search(db, { sort: 'recentlySung' }).map((s) => s.path)).toEqual(['/library/b', '/library/c', '/library/a'])
    expect(search(db, { sort: 'mostSung' }).map((s) => s.path)).toEqual(['/library/c', '/library/b', '/library/a'])
    expect(db.prepare('SELECT COUNT(*) AS n FROM play_history').get().n).toBe(3)
  })

  it('ignores a play without a song path', () => {
    expect(recordPlay(db, {})).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS n FROM play_history').get().n).toBe(0)
  })
})
