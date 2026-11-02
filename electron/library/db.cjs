// SQLite index for the song library. WAL mode with two independent
// connections (the scan worker writes, the main process reads): a Database
// instance is never shared across threads.
const path = require('node:path')
const Database = require('better-sqlite3')
const { resolveNativeBinding } = require('../native-binding.cjs')

// Prepared statements, cached per connection. db.prepare() compiles the SQL
// every call; the scanner runs a handful of statements per song, thousands of
// times per scan, so preparing each one once per connection is a large share
// of the scan's CPU. A WeakMap so a closed-and-dropped connection takes its
// statements with it.
const statementCache = new WeakMap()

function cachedStatement(db, sql) {
  let statements = statementCache.get(db)
  if (!statements) {
    statements = new Map()
    statementCache.set(db, statements)
  }
  let statement = statements.get(sql)
  if (!statement) {
    statement = db.prepare(sql)
    statements.set(sql, statement)
  }
  return statement
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS library_roots (
  path TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS songs (
  path TEXT PRIMARY KEY,
  root_path TEXT NOT NULL REFERENCES library_roots(path),
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  language TEXT,
  edition TEXT,
  mp3_path TEXT,
  video_path TEXT,
  cover_path TEXT,
  thumbnail_path TEXT,
  duration_ms INTEGER NOT NULL,
  is_duet INTEGER NOT NULL DEFAULT 0,
  is_playable INTEGER NOT NULL DEFAULT 0,
  mtime_ms INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_errors (
  path TEXT NOT NULL,
  reason TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(
  path UNINDEXED, artist, title, edition, content=songs, content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS songs_ai AFTER INSERT ON songs BEGIN
  INSERT INTO songs_fts(rowid, path, artist, title, edition) VALUES (new.rowid, new.path, new.artist, new.title, new.edition);
END;

CREATE TRIGGER IF NOT EXISTS songs_ad AFTER DELETE ON songs BEGIN
  INSERT INTO songs_fts(songs_fts, rowid, path, artist, title, edition) VALUES ('delete', old.rowid, old.path, old.artist, old.title, old.edition);
END;

CREATE TRIGGER IF NOT EXISTS songs_au AFTER UPDATE ON songs BEGIN
  INSERT INTO songs_fts(songs_fts, rowid, path, artist, title, edition) VALUES ('delete', old.rowid, old.path, old.artist, old.title, old.edition);
  INSERT INTO songs_fts(rowid, path, artist, title, edition) VALUES (new.rowid, new.path, new.artist, new.title, new.edition);
END;

-- Keyed by song folder path and deliberately not a foreign key into songs: a
-- favourite or a play survives the song briefly leaving the library (a root
-- removed and re-added, a folder renamed back).
CREATE TABLE IF NOT EXISTS favorites (
  song_path TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_path TEXT NOT NULL,
  played_at INTEGER NOT NULL,
  mode TEXT
);

CREATE INDEX IF NOT EXISTS idx_play_history_song ON play_history (song_path, played_at);
`

// SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` -- guard each
// addition with a PRAGMA table_info check so re-running against an
// already-migrated DB doesn't error.
function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function openDb(dbPath) {
  const db = new Database(dbPath, { nativeBinding: resolveNativeBinding('better-sqlite3') })
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL')
    // In WAL mode NORMAL is still crash-safe for the database file (a power
    // cut can lose the last commits, never corrupt it); FULL additionally
    // fsyncs the WAL on every commit, which is what made a large scan crawl.
    db.pragma('synchronous = NORMAL')
  }
  db.exec(SCHEMA_SQL)
  addColumnIfMissing(db, 'songs', 'bpm', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfMissing(db, 'songs', 'gap', 'INTEGER NOT NULL DEFAULT 0')
  // Separated vocal/instrumental tracks (#VOCALS/#INSTRUMENTAL). Nullable and
  // added by migration: every song indexed before stems existed keeps working.
  addColumnIfMissing(db, 'songs', 'vocals_path', 'TEXT')
  addColumnIfMissing(db, 'songs', 'instrumental_path', 'TEXT')
  // EBU R 128 measurement of the song's own audio (electron/library/loudness.cjs).
  // Nullable, and null is a meaningful value: "never analysed", which playback
  // reads as "play this song exactly as loud as it is". Every library indexed
  // before loudness existed therefore keeps working, unchanged, until its next
  // scan backfills these.
  addColumnIfMissing(db, 'songs', 'loudness_lufs', 'REAL')
  addColumnIfMissing(db, 'songs', 'true_peak_dbtp', 'REAL')
  // #PREVIEWSTART, in seconds; null when the chart has none (the preview then
  // picks its own start).
  addColumnIfMissing(db, 'songs', 'preview_start_sec', 'REAL')
  // Which generation of chart-derived columns this row was written with (see
  // SONG_META_VERSION). Rows indexed before it existed read 0, which is how an
  // unchanged song still gets newly-added columns filled on the next rescan.
  addColumnIfMissing(db, 'songs', 'meta_version', 'INTEGER NOT NULL DEFAULT 0')
  return db
}

/**
 * Generation of the chart-derived columns. Bump it whenever a new column is
 * filled from the chart text: the scan's unchanged-song shortcut
 * (scan-worker.cjs) then re-parses rows written with an older version and
 * fills just the new columns via updateChartMeta -- a cheap UPDATE, not a full
 * re-index (which would also discard and regenerate every thumbnail).
 *
 * 1: preview_start_sec (#PREVIEWSTART).
 */
const SONG_META_VERSION = 1

/** Finite and >= 0, else null: a garbage #PREVIEWSTART must not seek a preview to NaN or before the song. */
function normalizePreviewStartSec(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

// --- library_roots ---

function addRoot(db, rootPath, addedAt = Date.now()) {
  cachedStatement(db, 'INSERT OR IGNORE INTO library_roots (path, added_at) VALUES (?, ?)').run(rootPath, addedAt)
}

function listRoots(db) {
  return cachedStatement(db, 'SELECT path, added_at as addedAt FROM library_roots ORDER BY added_at ASC').all()
}

function removeRoot(db, rootPath) {
  deleteSongsUnderRoot(db, rootPath)
  clearScanErrorsForRoot(db, rootPath)
  cachedStatement(db, 'DELETE FROM library_roots WHERE path = ?').run(rootPath)
}

function deleteSongsUnderRoot(db, rootPath) {
  cachedStatement(db, 'DELETE FROM songs WHERE root_path = ?').run(rootPath)
}

// --- songs ---

function upsertSong(db, row) {
  cachedStatement(db, 
    `INSERT INTO songs (
       path, root_path, artist, title, language, edition, mp3_path, vocals_path, instrumental_path,
       video_path, cover_path,
       thumbnail_path, duration_ms, bpm, gap, is_duet, is_playable, mtime_ms, content_hash, added_at,
       loudness_lufs, true_peak_dbtp, preview_start_sec, meta_version
     ) VALUES (
       @path, @rootPath, @artist, @title, @language, @edition, @mp3Path, @vocalsPath, @instrumentalPath,
       @videoPath, @coverPath,
       @thumbnailPath, @durationMs, @bpm, @gap, @isDuet, @isPlayable, @mtimeMs, @contentHash, @addedAt,
       @loudnessLufs, @truePeakDbtp, @previewStartSec, @metaVersion
     )
     ON CONFLICT(path) DO UPDATE SET
       root_path = excluded.root_path, artist = excluded.artist, title = excluded.title,
       language = excluded.language, edition = excluded.edition, mp3_path = excluded.mp3_path,
       vocals_path = excluded.vocals_path, instrumental_path = excluded.instrumental_path,
       video_path = excluded.video_path, cover_path = excluded.cover_path,
       thumbnail_path = excluded.thumbnail_path, duration_ms = excluded.duration_ms,
       bpm = excluded.bpm, gap = excluded.gap,
       is_duet = excluded.is_duet, is_playable = excluded.is_playable,
       mtime_ms = excluded.mtime_ms, content_hash = excluded.content_hash,
       preview_start_sec = excluded.preview_start_sec, meta_version = excluded.meta_version,
       -- COALESCE, not a plain overwrite: an ordinary metadata rescan (which
       -- passes no loudness at all) must not throw away a measurement that cost
       -- a full decode to produce. Re-measuring is the loudness pass's job, and
       -- it writes through updateLoudness below.
       loudness_lufs = COALESCE(excluded.loudness_lufs, songs.loudness_lufs),
       true_peak_dbtp = COALESCE(excluded.true_peak_dbtp, songs.true_peak_dbtp)`,
  ).run({
    language: null,
    edition: null,
    mp3Path: null,
    vocalsPath: null,
    instrumentalPath: null,
    videoPath: null,
    coverPath: null,
    thumbnailPath: null,
    bpm: 0,
    gap: 0,
    loudnessLufs: null,
    truePeakDbtp: null,
    ...row,
    previewStartSec: normalizePreviewStartSec(row.previewStartSec),
    metaVersion: SONG_META_VERSION,
    isDuet: row.isDuet ? 1 : 0,
    isPlayable: row.isPlayable ? 1 : 0,
  })
}

/**
 * Fills the chart-derived columns added since `meta_version` was written, for a
 * song the scan otherwise skips as unchanged. Touches nothing else -- above all
 * not thumbnail_path or the loudness measurement.
 */
function updateChartMeta(db, songPath, { previewStartSec }) {
  cachedStatement(db, 'UPDATE songs SET preview_start_sec = ?, meta_version = ? WHERE path = ?').run(
    normalizePreviewStartSec(previewStartSec),
    SONG_META_VERSION,
    songPath,
  )
}

// Songs the scan worker indexed with a real cover file but no thumbnail --
// nativeImage (used to generate one) isn't reliably available inside a
// worker_threads context, so the worker always leaves these null; the main
// process backfills them after the scan completes (see startLibraryScan).
function listSongsMissingThumbnail(db, rootPath) {
  return db
    .prepare('SELECT path, cover_path FROM songs WHERE root_path = ? AND cover_path IS NOT NULL AND thumbnail_path IS NULL')
    .all(rootPath)
}

function updateThumbnailPath(db, songPath, thumbnailPath) {
  cachedStatement(db, 'UPDATE songs SET thumbnail_path = ? WHERE path = ?').run(thumbnailPath, songPath)
}

/** Many thumbnail paths in one transaction: `entries` is `{ path, thumbnailPath }[]`. */
function updateThumbnailPaths(db, entries) {
  if (!entries || entries.length === 0) return
  const statement = cachedStatement(db, 'UPDATE songs SET thumbnail_path = ? WHERE path = ?')
  db.transaction((rows) => {
    for (const row of rows) statement.run(row.thumbnailPath, row.path)
  })(entries)
}

// --- loudness (EBU R 128, measured by the scan worker's loudness pass) ---

/**
 * Every song under this root that has audio but no stored measurement, oldest
 * first.
 *
 * Keying the loudness pass on "no measurement yet" rather than on the scan's
 * own change detection is deliberate. The incremental-rescan check hashes the
 * chart bytes plus the folder listing, so a library that was indexed before
 * loudness existed hashes *identically* and every song is skipped -- a rescan
 * would never measure anything. This makes the pass a backfill: it picks up
 * exactly the songs that need it, whether they are new, or old and untouched.
 */
function listSongsMissingLoudness(db, rootPath) {
  return db
    .prepare(
      `SELECT path, mp3_path as mp3Path, instrumental_path as instrumentalPath
         FROM songs
        WHERE root_path = ?
          AND loudness_lufs IS NULL
          AND (mp3_path IS NOT NULL OR instrumental_path IS NOT NULL)
        ORDER BY added_at ASC`,
    )
    .all(rootPath)
}

function updateLoudness(db, songPath, { integratedLufs, truePeakDbtp }) {
  cachedStatement(db, 'UPDATE songs SET loudness_lufs = ?, true_peak_dbtp = ? WHERE path = ?').run(
    integratedLufs,
    truePeakDbtp,
    songPath,
  )
}

/**
 * A loudness measurement from outside this process (the renderer's
 * `library:set-loudness`), validated: both numbers finite and physically
 * plausible -- EBU R 128 gates at -70 LUFS, and nothing decodable peaks far
 * above 0 dBTP. Anything else is null, because a bogus value would not just be
 * wrong, it would be *applied* as a gain on every later play.
 *
 * @returns {{ integratedLufs: number, truePeakDbtp: number } | null}
 */
function sanitizeLoudnessMeasurement(value) {
  if (!value || typeof value !== 'object') return null
  const { integratedLufs, truePeakDbtp } = value
  if (typeof integratedLufs !== 'number' || !Number.isFinite(integratedLufs)) return null
  if (typeof truePeakDbtp !== 'number' || !Number.isFinite(truePeakDbtp)) return null
  if (integratedLufs < -70 || integratedLufs > 10) return null
  if (truePeakDbtp < -150 || truePeakDbtp > 30) return null
  return { integratedLufs, truePeakDbtp }
}

function getSong(db, songPath) {
  const row = cachedStatement(db, 'SELECT * FROM songs WHERE path = ?').get(songPath)
  return row ? toLibrarySong(row) : null
}

function findByPathAndHash(db, songPath) {
  return cachedStatement(
    db,
    'SELECT path, mtime_ms as mtimeMs, content_hash as contentHash, meta_version as metaVersion FROM songs WHERE path = ?',
  ).get(songPath)
}

/**
 * Free text from the search box -> an FTS5 MATCH expression.
 *
 * Each whitespace-separated word becomes its own quoted phrase (internal
 * quotes doubled, FTS5's only escape) with a prefix `*`, ANDed together, so
 * query syntax in user text (`TX/RX`, `"`, `-`, `NOT`, `title:`) is searched
 * as text instead of throwing. Words with no letter or digit are dropped.
 *
 * @returns {string | null} null when there is nothing to search for
 */
function toFtsPrefixQuery(rawQuery) {
  if (typeof rawQuery !== 'string') return null
  const phrases = rawQuery
    .trim()
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token))
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
  return phrases.length > 0 ? phrases.join(' ') : null
}

// Songs never played sort after every played one (the subquery is NULL / 0
// for them), then alphabetically, so the history sorts stay browsable.
const SORT_ORDER_SQL = {
  artist: 'artist ASC',
  title: 'title ASC',
  recent: 'added_at DESC',
  recentlySung:
    '(SELECT MAX(played_at) FROM play_history WHERE play_history.song_path = songs.path) DESC NULLS LAST, artist ASC',
  mostSung: '(SELECT COUNT(*) FROM play_history WHERE play_history.song_path = songs.path) DESC, artist ASC',
}

function buildSearchQuery(filters = {}) {
  const conditions = ['is_playable = 1']
  const params = {}

  let fromClause = 'FROM songs'
  const ftsQuery = toFtsPrefixQuery(filters.query)
  if (ftsQuery) {
    fromClause = 'FROM songs_fts JOIN songs ON songs.rowid = songs_fts.rowid'
    conditions.push('songs_fts MATCH @query')
    params.query = ftsQuery
  }
  if (filters.language) {
    conditions.push('language = @language')
    params.language = filters.language
  }
  if (filters.edition) {
    conditions.push('edition = @edition')
    params.edition = filters.edition
  }
  if (filters.duetOnly) {
    conditions.push('is_duet = 1')
  }
  if (filters.hasVideoOnly) {
    conditions.push("video_path IS NOT NULL AND video_path != ''")
  }
  if (filters.favoritesOnly) {
    conditions.push('songs.path IN (SELECT song_path FROM favorites)')
  }

  const orderBy = SORT_ORDER_SQL[filters.sort] ?? SORT_ORDER_SQL.artist

  const sql = `SELECT songs.* ${fromClause} WHERE ${conditions.join(' AND ')} ORDER BY ${orderBy}`
  return { sql, params }
}

function search(db, filters = {}) {
  const { sql, params } = buildSearchQuery(filters)
  return cachedStatement(db, sql).all(params).map(toLibrarySong)
}

function toLibrarySong(row) {
  return {
    path: row.path,
    artist: row.artist,
    title: row.title,
    language: row.language ?? undefined,
    edition: row.edition ?? undefined,
    durationMs: row.duration_ms,
    // Falls back to the full-size cover until the main process has backfilled
    // a thumbnail (the scan worker cannot make one: no nativeImage in a worker).
    thumbnailPath: row.thumbnail_path ?? row.cover_path,
    mp3Path: row.mp3_path,
    vocalsPath: row.vocals_path ?? null,
    instrumentalPath: row.instrumental_path ?? null,
    videoPath: row.video_path,
    bpm: row.bpm,
    gap: row.gap,
    hasVideo: Boolean(row.video_path),
    /** True only when BOTH stems resolved -- that is the pair playback can actually use to duck the guide vocal. */
    hasStems: Boolean(row.vocals_path && row.instrumental_path),
    hasCover: Boolean(row.cover_path),
    isDuet: Boolean(row.is_duet),
    isPlayable: Boolean(row.is_playable),
    addedAt: row.added_at,
    // Null all the way through to the renderer rather than being defaulted to
    // something plausible: "never analysed" and "analysed at 0 LUFS" have to
    // stay distinguishable, because the first means "leave this song's level
    // alone" and the second would mean "take 18 dB off it".
    loudnessLufs: row.loudness_lufs ?? null,
    truePeakDbtp: row.true_peak_dbtp ?? null,
    // #PREVIEWSTART in seconds, or null when the chart has none.
    previewStartSec: row.preview_start_sec ?? null,
  }
}

// --- scan_errors ---

function recordScanError(db, entry) {
  cachedStatement(db, 'INSERT INTO scan_errors (path, reason, timestamp) VALUES (?, ?, ?)').run(entry.path, entry.reason, entry.timestamp)
}

function listScanErrors(db) {
  return cachedStatement(db, 'SELECT path, reason, timestamp FROM scan_errors ORDER BY timestamp DESC').all()
}

/**
 * `path = ?` or anything beneath it, as SQL + params.
 *
 * Deliberately not `LIKE '<dir>/%'`: that only ever matched `/`-separated
 * paths, so on Windows (`D:\Songs\...`) removing a root left every one of its
 * scan errors behind; and `_`/`%` in a folder name are LIKE wildcards, while
 * LIKE is also case-insensitive -- either could delete a *sibling* folder's
 * rows. An exact prefix comparison on both separators has none of those
 * problems.
 *
 * The prefix length is measured by SQLite (`length(?)`), not passed in as JS
 * `prefix.length`: JS counts UTF-16 code units while SQLite's substr/length
 * count characters, so any astral character (emoji, some CJK) in the root made
 * the two disagree and the comparison never matched.
 */
function pathOrDescendantsClause(column, dirPath) {
  const endsWithSeparator = /[/\x5c]$/.test(dirPath)
  const prefixes = endsWithSeparator ? [dirPath] : [dirPath + path.posix.sep, dirPath + path.win32.sep]
  const clause = [`${column} = ?`, ...prefixes.map(() => `substr(${column}, 1, length(?)) = ?`)].join(' OR ')
  const params = [dirPath]
  for (const prefix of prefixes) params.push(prefix, prefix)
  return { clause, params }
}

// Called when a root is removed entirely (removeRoot, below) -- every error
// under it is now moot, since the songs themselves are gone too.
// scan_errors has no root_path column, so path-prefix matches every song
// folder findSongFolders() ever found under this root.
function clearScanErrorsForRoot(db, rootPath) {
  const { clause, params } = pathOrDescendantsClause('path', rootPath)
  cachedStatement(db, `DELETE FROM scan_errors WHERE ${clause}`).run(...params)
}

// Called by the scanner right before it (re-)evaluates one specific song
// folder, so a fixed problem doesn't keep showing a stale error alongside
// duplicate entries from every past scan. Deliberately per-path, not
// per-root: a song the incremental-rescan check skips (unchanged since last
// scan) must keep whatever error state it already had, since its underlying
// condition was never re-checked.
function clearScanErrorsForPath(db, songPath) {
  cachedStatement(db, 'DELETE FROM scan_errors WHERE path = ?').run(songPath)
}


// Deletes songs and their scan errors that no longer exist under rootPath.
function pruneMissingSongs(db, rootPath, activeSongPaths) {
  const activeSet = new Set(activeSongPaths)
  const existing = cachedStatement(db, 'SELECT path FROM songs WHERE root_path = ?').all(rootPath)
  const toDelete = existing.filter((row) => !activeSet.has(row.path))
  if (toDelete.length > 0) {
    const deleteStmt = cachedStatement(db, 'DELETE FROM songs WHERE path = ?')
    const transaction = db.transaction((rows) => {
      for (const row of rows) {
        deleteStmt.run(row.path)
        const { clause, params } = pathOrDescendantsClause('path', row.path)
        cachedStatement(db, `DELETE FROM scan_errors WHERE ${clause}`).run(...params)
      }
    })
    transaction(toDelete)
  }
  return toDelete.length
}

// --- favourites ---

function setFavorite(db, songPath, favorite, addedAt = Date.now()) {
  if (typeof songPath !== 'string' || songPath.length === 0) return false
  if (favorite) {
    cachedStatement(db, 'INSERT OR IGNORE INTO favorites (song_path, added_at) VALUES (?, ?)').run(songPath, addedAt)
  } else {
    cachedStatement(db, 'DELETE FROM favorites WHERE song_path = ?').run(songPath)
  }
  return Boolean(favorite)
}

function listFavorites(db) {
  return cachedStatement(db, 'SELECT song_path FROM favorites ORDER BY added_at ASC')
    .all()
    .map((row) => row.song_path)
}

// --- play history ---

/** One row per play, whatever the mode (a sung song, a jukebox song). */
function recordPlay(db, { songPath, mode, playedAt = Date.now() } = {}) {
  if (typeof songPath !== 'string' || songPath.length === 0) return false
  cachedStatement(db, 'INSERT INTO play_history (song_path, played_at, mode) VALUES (?, ?, ?)').run(
    songPath,
    playedAt,
    typeof mode === 'string' ? mode : null,
  )
  return true
}

module.exports = {
  setFavorite,
  listFavorites,
  recordPlay,
  pruneMissingSongs,
  openDb,
  addRoot,
  listRoots,
  removeRoot,
  deleteSongsUnderRoot,
  upsertSong,
  getSong,
  findByPathAndHash,
  search,
  buildSearchQuery,
  recordScanError,
  listScanErrors,
  clearScanErrorsForRoot,
  clearScanErrorsForPath,
  listSongsMissingThumbnail,
  updateThumbnailPath,
  updateThumbnailPaths,
  toFtsPrefixQuery,
  pathOrDescendantsClause,
  listSongsMissingLoudness,
  updateLoudness,
  updateChartMeta,
  SONG_META_VERSION,
  sanitizeLoudnessMeasurement,
}
