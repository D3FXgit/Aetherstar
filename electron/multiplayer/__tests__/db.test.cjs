// @vitest-environment node
// describe/expect/it/beforeEach come from Vitest's globals (vite.config.ts test.globals: true)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const {
  MIC_SLOT_COUNT,
  openMultiplayerDb,
  listMicSlots,
  saveMicSlot,
  clearMicSlot,
} = require('../db.cjs')

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'multiplayer-db-')), 'library.db')
}

/**
 * Build the pre-Phase-4 schema by hand: `routing_bindings` is no longer created
 * by this module, so the only honest way to test the migration is to write the
 * table the way the shipped version actually left it on a user's disk.
 */
function seedLegacyDb(dbPath, { bindings = [], players = [] } = {}) {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE routing_bindings (
      player_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      channel_index INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );
  `)
  const insertBinding = db.prepare(
    'INSERT INTO routing_bindings (player_id, device_id, channel_index, updated_at) VALUES (?, ?, ?, ?)',
  )
  bindings.forEach((binding, index) =>
    insertBinding.run(binding.playerId, binding.deviceId, binding.channelIndex, binding.updatedAt ?? index),
  )
  const insertPlayer = db.prepare('INSERT INTO players (id, name, sort_order) VALUES (?, ?, ?)')
  players.forEach((player, index) => insertPlayer.run(player.id, player.id, player.sortOrder ?? index))
  db.close()
}

describe('openMultiplayerDb', () => {
  it('creates the mic_slots table with WAL mode enabled', () => {
    const db = openMultiplayerDb(tempDbPath())

    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mic_slots'").all()
    expect(rows).toHaveLength(1)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')

    db.close()
  })

  it('is idempotent -- opening twice against the same file does not throw or duplicate tables', () => {
    const dbPath = tempDbPath()
    openMultiplayerDb(dbPath).close()

    expect(() => openMultiplayerDb(dbPath).close()).not.toThrow()
  })

  it('opens cleanly against a database that never had the legacy routing tables', () => {
    const dbPath = tempDbPath()

    expect(() => openMultiplayerDb(dbPath).close()).not.toThrow()
  })
})

describe('mic slot CRUD', () => {
  let db

  beforeEach(() => {
    db = openMultiplayerDb(tempDbPath())
  })

  it('round-trips a slot through saveMicSlot/listMicSlots', () => {
    saveMicSlot(db, { slotNumber: 1, deviceId: 'mic-1', channelIndex: 0 })

    expect(listMicSlots(db)).toEqual([{ slotNumber: 1, deviceId: 'mic-1', channelIndex: 0 }])
  })

  it('saving an already-configured slot replaces it rather than duplicating it', () => {
    saveMicSlot(db, { slotNumber: 1, deviceId: 'mic-1', channelIndex: 0 })
    saveMicSlot(db, { slotNumber: 1, deviceId: 'mic-2', channelIndex: 1 })

    expect(listMicSlots(db)).toEqual([{ slotNumber: 1, deviceId: 'mic-2', channelIndex: 1 }])
  })

  it('lists slots in slot-number order however they were written', () => {
    saveMicSlot(db, { slotNumber: 5, deviceId: 'mic-5', channelIndex: 0 })
    saveMicSlot(db, { slotNumber: 2, deviceId: 'mic-2', channelIndex: 0 })

    expect(listMicSlots(db).map((slot) => slot.slotNumber)).toEqual([2, 5])
  })

  it('clearMicSlot removes just that slot', () => {
    saveMicSlot(db, { slotNumber: 1, deviceId: 'mic-1', channelIndex: 0 })
    saveMicSlot(db, { slotNumber: 2, deviceId: 'mic-2', channelIndex: 0 })

    clearMicSlot(db, 1)

    expect(listMicSlots(db)).toEqual([{ slotNumber: 2, deviceId: 'mic-2', channelIndex: 0 }])
  })

  it('round-trips all eight slots, including two channels of one interface', () => {
    const eight = Array.from({ length: MIC_SLOT_COUNT }, (_, index) => ({
      slotNumber: index + 1,
      deviceId: index < 2 ? 'interface-1' : `mic-${index}`,
      channelIndex: index < 2 ? index : 0,
    }))

    eight.forEach((slot) => saveMicSlot(db, slot))

    expect(listMicSlots(db)).toEqual(eight)
  })
})

/**
 * The model changed under people who already had a rig configured. These pin
 * the promise made in db.cjs's header: the *inputs* survive, the player half
 * does not, and nothing is re-imposed once the user has edited their mics.
 */
describe('migration from player-keyed routing_bindings', () => {
  it('moves each seat\'s input onto the mic slot of the same number, in roster order', () => {
    const dbPath = tempDbPath()
    seedLegacyDb(dbPath, {
      // Deliberately written newest-first so roster order, not write order, is
      // what the assertion can be explained by.
      bindings: [
        { playerId: 'grace', deviceId: 'mic-2', channelIndex: 1, updatedAt: 10 },
        { playerId: 'ada', deviceId: 'mic-1', channelIndex: 0, updatedAt: 20 },
      ],
      players: [
        { id: 'ada', sortOrder: 0 },
        { id: 'grace', sortOrder: 1 },
      ],
    })

    const db = openMultiplayerDb(dbPath)

    expect(listMicSlots(db)).toEqual([
      { slotNumber: 1, deviceId: 'mic-1', channelIndex: 0 },
      { slotNumber: 2, deviceId: 'mic-2', channelIndex: 1 },
    ])
    db.close()
  })

  it('keeps an input whose player has since been deleted, ordered after the seated ones', () => {
    const dbPath = tempDbPath()
    seedLegacyDb(dbPath, {
      bindings: [
        { playerId: 'ghost', deviceId: 'mic-9', channelIndex: 0, updatedAt: 1 },
        { playerId: 'ada', deviceId: 'mic-1', channelIndex: 0, updatedAt: 2 },
      ],
      players: [{ id: 'ada', sortOrder: 0 }],
    })

    const db = openMultiplayerDb(dbPath)

    expect(listMicSlots(db)).toEqual([
      { slotNumber: 1, deviceId: 'mic-1', channelIndex: 0 },
      { slotNumber: 2, deviceId: 'mic-9', channelIndex: 0 },
    ])
    db.close()
  })

  it('collapses two players who shared one physical input into a single slot', () => {
    const dbPath = tempDbPath()
    seedLegacyDb(dbPath, {
      bindings: [
        { playerId: 'ada', deviceId: 'mic-1', channelIndex: 0 },
        { playerId: 'grace', deviceId: 'mic-1', channelIndex: 0 },
      ],
      players: [
        { id: 'ada', sortOrder: 0 },
        { id: 'grace', sortOrder: 1 },
      ],
    })

    const db = openMultiplayerDb(dbPath)

    expect(listMicSlots(db)).toEqual([{ slotNumber: 1, deviceId: 'mic-1', channelIndex: 0 }])
    db.close()
  })

  it('never fills more than the eight available slots', () => {
    const dbPath = tempDbPath()
    seedLegacyDb(dbPath, {
      bindings: Array.from({ length: 12 }, (_, index) => ({
        playerId: `p${index}`,
        deviceId: `mic-${index}`,
        channelIndex: 0,
      })),
      players: Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, sortOrder: index })),
    })

    const db = openMultiplayerDb(dbPath)

    expect(listMicSlots(db)).toHaveLength(MIC_SLOT_COUNT)
    db.close()
  })

  // The regression that would hurt most: a user migrates, deliberately clears
  // Mic 1 because that interface is gone, reopens the app -- and the dead input
  // is back. It runs once, and "once" means "while mic_slots is still empty".
  it('does not re-run once the user has configured mic slots of their own', () => {
    const dbPath = tempDbPath()
    seedLegacyDb(dbPath, {
      bindings: [{ playerId: 'ada', deviceId: 'mic-1', channelIndex: 0 }],
      players: [{ id: 'ada', sortOrder: 0 }],
    })

    const first = openMultiplayerDb(dbPath)
    clearMicSlot(first, 1)
    saveMicSlot(first, { slotNumber: 4, deviceId: 'mic-4', channelIndex: 0 })
    first.close()

    const second = openMultiplayerDb(dbPath)

    expect(listMicSlots(second)).toEqual([{ slotNumber: 4, deviceId: 'mic-4', channelIndex: 0 }])
    second.close()
  })

  it('leaves the legacy table on disk rather than destroying the only copy of it', () => {
    const dbPath = tempDbPath()
    seedLegacyDb(dbPath, {
      bindings: [{ playerId: 'ada', deviceId: 'mic-1', channelIndex: 0 }],
      players: [{ id: 'ada', sortOrder: 0 }],
    })

    const db = openMultiplayerDb(dbPath)

    expect(db.prepare('SELECT COUNT(*) AS count FROM routing_bindings').get().count).toBe(1)
    db.close()
  })
})
