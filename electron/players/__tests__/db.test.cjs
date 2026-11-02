// @vitest-environment node
// describe/expect/it/beforeEach come from Vitest's globals (vite.config.ts test.globals: true)
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { openPlayersDb, createPlayer, listPlayers, updatePlayer, deletePlayer, reorderPlayers } = require('../db.cjs')

function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'players-db-')), 'library.db')
}

describe('openPlayersDb', () => {
  it('creates the players table with WAL mode enabled', () => {
    const dbPath = tempDbPath()
    const db = openPlayersDb(dbPath)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='players'").all()
    expect(tables).toHaveLength(1)

    const journalMode = db.pragma('journal_mode', { simple: true })
    expect(journalMode).toBe('wal')

    db.close()
  })

  it('is idempotent -- opening twice against the same file does not throw or duplicate the table', () => {
    const dbPath = tempDbPath()
    const db1 = openPlayersDb(dbPath)
    db1.close()

    expect(() => {
      const db2 = openPlayersDb(dbPath)
      db2.close()
    }).not.toThrow()
  })
})

describe('players CRUD + reorder', () => {
  let db

  beforeEach(() => {
    db = openPlayersDb(tempDbPath())
  })

  it('creates a player with a UUID id and the next sort_order', () => {
    const p1 = createPlayer(db, { name: 'Alex', color: 'coral' })
    expect(p1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(p1.sort_order).toBe(0)
    expect(p1.songs_sung).toBe(0)
    expect(p1.best_score).toBe(0)

    const p2 = createPlayer(db, { name: 'Sam', color: 'cyan' })
    expect(p2.sort_order).toBe(1)
  })

  it('lists players ordered by sort_order', () => {
    createPlayer(db, { name: 'Alex', color: 'coral' })
    createPlayer(db, { name: 'Sam', color: 'cyan' })

    const players = listPlayers(db)
    expect(players.map((p) => p.name)).toEqual(['Alex', 'Sam'])
  })

  it('updates only the given fields', () => {
    const player = createPlayer(db, { name: 'Alex', color: 'coral' })
    updatePlayer(db, player.id, { name: 'Alexandra' })

    const [updated] = listPlayers(db)
    expect(updated.name).toBe('Alexandra')
    expect(updated.color).toBe('coral')
  })

  it('deletes a player', () => {
    const player = createPlayer(db, { name: 'Alex', color: 'coral' })
    deletePlayer(db, player.id)

    expect(listPlayers(db)).toHaveLength(0)
  })

  it('reorders players to match the given id order', () => {
    const p1 = createPlayer(db, { name: 'Alex', color: 'coral' })
    const p2 = createPlayer(db, { name: 'Sam', color: 'cyan' })
    const p3 = createPlayer(db, { name: 'Jordan', color: 'gold' })

    reorderPlayers(db, [p3.id, p1.id, p2.id])

    expect(listPlayers(db).map((p) => p.name)).toEqual(['Jordan', 'Alex', 'Sam'])
  })
})
