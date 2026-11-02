// SQLite store for the eight hardware mic slots (Mic 1..8: a device + channel).
// Keyed by slot, not player: who sings into which mic is chosen per song and
// never stored here. Own connection and migration on library.db.
const Database = require('better-sqlite3')
const { resolveNativeBinding } = require('../native-binding.cjs')

/** The rig tops out at eight physical inputs, so slot numbers are 1..8. */
const MIC_SLOT_COUNT = 8

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mic_slots (
  slot_number INTEGER PRIMARY KEY,
  device_id TEXT NOT NULL,
  channel_index INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`

function tableExists(db, name) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").all(name).length > 0
}

/**
 * Carry a pre-existing player-keyed routing matrix over to numbered mic slots.
 *
 * What survives is the part that cost the user real effort: *which physical
 * inputs work*. A binding's `(device_id, channel_index)` is exactly that, and
 * it moves across unchanged. The `player_id` half cannot move, because the new
 * model has nowhere to put it -- a mic slot belongs to nobody.
 *
 * The order is taken from the roster's own `sort_order`, because that is what
 * the old matrix listed its P1..P8 rows in: P1's input becomes Mic 1, P2's
 * becomes Mic 2, and so on. Bindings whose player has since been deleted still
 * come across (they are working inputs), ordered after the seated ones by when
 * they were last touched. Duplicates -- two players sharing one physical input,
 * which the old matrix allowed and warned about -- collapse to a single slot,
 * since a mic slot has no owner to duplicate for.
 *
 * Runs once: it is skipped the moment `mic_slots` has any row of its own, so a
 * user who has since edited their mics never has the old table reimposed on
 * them. The `routing_*` tables are deliberately left on disk untouched rather
 * than dropped -- this is a one-way read, and destroying the only copy of
 * someone's old setup to tidy up a schema is not a trade worth making.
 *
 * @returns {number} how many slots were filled from old bindings.
 */
function migrateRoutingBindingsToMicSlots(db) {
  if (!tableExists(db, 'routing_bindings')) return 0
  if (db.prepare('SELECT COUNT(*) AS count FROM mic_slots').get().count > 0) return 0

  // LEFT JOIN, not JOIN: a binding for a deleted player is still a verified
  // physical input, and dropping it would silently shrink the user's rig.
  const orderedBindings = tableExists(db, 'players')
    ? db
        .prepare(
          `SELECT b.device_id, b.channel_index
             FROM routing_bindings b
             LEFT JOIN players p ON p.id = b.player_id
            ORDER BY (p.sort_order IS NULL) ASC, p.sort_order ASC, b.updated_at ASC, b.device_id ASC`,
        )
        .all()
    : db.prepare('SELECT device_id, channel_index FROM routing_bindings ORDER BY updated_at ASC, device_id ASC').all()

  const seen = new Set()
  const distinct = []
  for (const row of orderedBindings) {
    const key = `${row.device_id}#${row.channel_index}`
    if (seen.has(key)) continue
    seen.add(key)
    distinct.push(row)
    if (distinct.length === MIC_SLOT_COUNT) break
  }
  if (distinct.length === 0) return 0

  const now = Date.now()
  const insert = db.prepare(
    'INSERT INTO mic_slots (slot_number, device_id, channel_index, updated_at) VALUES (?, ?, ?, ?)',
  )
  db.transaction(() => {
    distinct.forEach((row, index) => insert.run(index + 1, row.device_id, row.channel_index, now))
  })()

  return distinct.length
}

function openMultiplayerDb(dbPath) {
  const db = new Database(dbPath, { nativeBinding: resolveNativeBinding('better-sqlite3') })
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL')
  }
  db.exec(SCHEMA_SQL)
  migrateRoutingBindingsToMicSlots(db)
  return db
}

function toMicSlot(row) {
  return { slotNumber: row.slot_number, deviceId: row.device_id, channelIndex: row.channel_index }
}

/** Every *configured* slot, lowest number first. Unconfigured slots have no row. */
function listMicSlots(db) {
  return db.prepare('SELECT * FROM mic_slots ORDER BY slot_number ASC').all().map(toMicSlot)
}

function saveMicSlot(db, { slotNumber, deviceId, channelIndex }) {
  db.prepare(
    `INSERT INTO mic_slots (slot_number, device_id, channel_index, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(slot_number) DO UPDATE SET device_id = excluded.device_id, channel_index = excluded.channel_index, updated_at = excluded.updated_at`,
  ).run(slotNumber, deviceId, channelIndex, Date.now())
}

/**
 * Un-configure one mic.
 *
 * A deleted row, not a row with a null device: "Mic 5 has no input" and "Mic 5
 * is a device that is currently unplugged" are different states, and only the
 * first one belongs in this table.
 */
function clearMicSlot(db, slotNumber) {
  db.prepare('DELETE FROM mic_slots WHERE slot_number = ?').run(slotNumber)
}

module.exports = {
  MIC_SLOT_COUNT,
  openMultiplayerDb,
  listMicSlots,
  saveMicSlot,
  clearMicSlot,
  migrateRoutingBindingsToMicSlots,
}
