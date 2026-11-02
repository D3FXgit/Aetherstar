// SQLite store for player profiles: its own connection to library.db and its
// own migration for just the `players` table, independent of electron/library/**.
const crypto = require('node:crypto')
const Database = require('better-sqlite3')
const { resolveNativeBinding } = require('../native-binding.cjs')

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  avatar_path TEXT,
  songs_sung INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`

function openPlayersDb(dbPath) {
  const db = new Database(dbPath, { nativeBinding: resolveNativeBinding('better-sqlite3') })
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL')
  }
  db.exec(SCHEMA_SQL)
  return db
}

function createPlayer(db, { name, color }) {
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  const { maxSortOrder } = db.prepare('SELECT MAX(sort_order) AS maxSortOrder FROM players').get()
  const sortOrder = maxSortOrder === null ? 0 : maxSortOrder + 1

  db.prepare(
    `INSERT INTO players (id, name, color, avatar_path, songs_sung, best_score, sort_order, created_at)
     VALUES (?, ?, ?, NULL, 0, 0, ?, ?)`,
  ).run(id, name, color, sortOrder, createdAt)

  return db.prepare('SELECT * FROM players WHERE id = ?').get(id)
}

function listPlayers(db) {
  return db.prepare('SELECT * FROM players ORDER BY sort_order ASC').all()
}

const UPDATABLE_FIELDS = ['name', 'color', 'avatar_path', 'songs_sung', 'best_score']

function updatePlayer(db, id, patch) {
  const fields = Object.keys(patch).filter((key) => UPDATABLE_FIELDS.includes(key))
  if (fields.length === 0) return

  const setClause = fields.map((field) => `${field} = ?`).join(', ')
  const values = fields.map((field) => patch[field])
  db.prepare(`UPDATE players SET ${setClause} WHERE id = ?`).run(...values, id)
}

function deletePlayer(db, id) {
  db.prepare('DELETE FROM players WHERE id = ?').run(id)
}

function reorderPlayers(db, orderedIds) {
  const stmt = db.prepare('UPDATE players SET sort_order = ? WHERE id = ?')
  const reorder = db.transaction((ids) => {
    ids.forEach((id, index) => stmt.run(index, id))
  })
  reorder(orderedIds)
}

module.exports = { openPlayersDb, createPlayer, listPlayers, updatePlayer, deletePlayer, reorderPlayers }
