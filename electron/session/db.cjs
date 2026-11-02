// SQLite store for party sessions and their scores. Its own connection to the
// shared library.db file, with its own tables and migration; it imports nothing
// from the library or players modules.
const crypto = require('node:crypto')
const Database = require('better-sqlite3')
const { resolveNativeBinding } = require('../native-binding.cjs')

/** The three singer difficulties a score can be set on (src/calibration/types.ts `Difficulty`). */
const DIFFICULTIES = ['easy', 'normal', 'hard']
const DEFAULT_DIFFICULTY = 'normal'
const DEFAULT_HIGHSCORE_LIMIT = 5
const MAX_HIGHSCORE_LIMIT = 50

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  song_path TEXT NOT NULL,
  player_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  epic_count INTEGER NOT NULL,
  good_count INTEGER NOT NULL,
  awful_count INTEGER NOT NULL,
  played_at INTEGER NOT NULL,
  difficulty TEXT
);
`

/**
 * Additive, idempotent migrations for databases created before a column
 * existed (`CREATE TABLE IF NOT EXISTS` never alters an existing table). Rows
 * written before `difficulty` existed keep NULL: the leaderboard reads them as
 * 'normal', the per-song highscores leave them out.
 */
function migrate(db) {
  const columns = db
    .prepare('PRAGMA table_info(session_entries)')
    .all()
    .map((column) => column.name)
  if (!columns.includes('difficulty')) {
    db.exec('ALTER TABLE session_entries ADD COLUMN difficulty TEXT')
  }
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_session_entries_song_score ON session_entries (song_path, difficulty, score DESC)',
  )
}

function openSessionDb(dbPath) {
  const db = new Database(dbPath, { nativeBinding: resolveNativeBinding('better-sqlite3') })
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL')
  }
  db.exec(SCHEMA_SQL)
  migrate(db)
  return db
}

function normalizeDifficulty(difficulty) {
  return DIFFICULTIES.includes(difficulty) ? difficulty : DEFAULT_DIFFICULTY
}

function startSession(db) {
  const id = crypto.randomUUID()
  const startedAt = Date.now()
  db.prepare('INSERT INTO sessions (id, started_at) VALUES (?, ?)').run(id, startedAt)
  return { id, startedAt }
}

function recordEntry(db, { sessionId, songPath, playerId, score, epicCount, goodCount, awfulCount, difficulty }) {
  const id = crypto.randomUUID()
  const playedAt = Date.now()
  db.prepare(
    `INSERT INTO session_entries (id, session_id, song_path, player_id, score, epic_count, good_count, awful_count, played_at, difficulty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sessionId, songPath, playerId, score, epicCount, goodCount, awfulCount, playedAt, normalizeDifficulty(difficulty))
  return db.prepare('SELECT * FROM session_entries WHERE id = ?').get(id)
}

function listLeaderboard(db) {
  return db
    .prepare(
      `SELECT
         se.session_id AS sessionId,
         se.song_path AS songPath,
         COALESCE(s.title, se.song_path) AS songTitle,
         COALESCE(s.artist, '') AS songArtist,
         se.player_id AS playerId,
         se.score AS score,
         se.epic_count AS epicCount,
         se.good_count AS goodCount,
         se.awful_count AS awfulCount,
         se.played_at AS playedAt,
         COALESCE(se.difficulty, '${DEFAULT_DIFFICULTY}') AS difficulty
       FROM session_entries se
       LEFT JOIN songs s ON s.path = se.song_path
       ORDER BY se.played_at DESC`,
    )
    .all()
}

/**
 * The top scores ever recorded on one song, per difficulty.
 *
 * `difficulty` narrows it to one ladder; omitted, every difficulty's own top
 * `limit` comes back, so one busy difficulty cannot crowd out the others. Ties
 * go to whoever set the score first. Rows without a difficulty were scored on
 * the old points scale and would outrank every current score, so they are
 * left out here (but kept in the table and in the all-time leaderboard).
 */
function listSongHighscores(db, { songPath, difficulty, limit } = {}) {
  if (typeof songPath !== 'string' || songPath.length === 0) return []
  const cappedLimit = Math.min(Math.max(1, Math.floor(Number(limit) || DEFAULT_HIGHSCORE_LIMIT)), MAX_HIGHSCORE_LIMIT)
  const statement = db.prepare(
    `SELECT
       session_id AS sessionId,
       song_path AS songPath,
       player_id AS playerId,
       score,
       epic_count AS epicCount,
       good_count AS goodCount,
       awful_count AS awfulCount,
       played_at AS playedAt,
       difficulty
     FROM session_entries
     WHERE song_path = ? AND difficulty IS NOT NULL AND difficulty = ?
     ORDER BY score DESC, played_at ASC
     LIMIT ?`,
  )
  const ladders = difficulty === undefined || difficulty === null ? DIFFICULTIES : [normalizeDifficulty(difficulty)]
  return ladders.flatMap((ladder) => statement.all(songPath, ladder, cappedLimit))
}

module.exports = { openSessionDb, migrate, startSession, recordEntry, listLeaderboard, listSongHighscores, DIFFICULTIES }
