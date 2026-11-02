// @vitest-environment node
const { openSessionDb } = require('../db.cjs')

const electronModulePath = require.resolve('electron')
const ipcRegistryModulePath = require.resolve('../../ipc-registry.cjs')
const ipcHandlersModulePath = require.resolve('../ipc-handlers.cjs')

function setupWithMockedElectron({ withDb = true } = {}) {
  const handlers = {}
  require.cache[electronModulePath] = {
    id: electronModulePath,
    filename: electronModulePath,
    loaded: true,
    exports: {
      ipcMain: {
        handle: (channel, listener) => {
          handlers[channel] = listener
        },
      },
    },
  }

  delete require.cache[ipcRegistryModulePath]
  delete require.cache[ipcHandlersModulePath]
  const { IPC_CHANNELS } = require('../../ipc-registry.cjs')
  const { registerSessionIpcHandlers } = require('../ipc-handlers.cjs')

  if (!withDb) {
    registerSessionIpcHandlers(null)
    return { handlers, IPC_CHANNELS, db: null }
  }

  const db = openSessionDb(':memory:')
  // listLeaderboard's LEFT JOIN needs a songs table to exist (it does in
  // production -- same shared library.db file library.db.cjs's migration
  // already created) even when this isolated test seeds no rows into it.
  db.exec('CREATE TABLE IF NOT EXISTS songs (path TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL)')
  registerSessionIpcHandlers(db)

  return { handlers, IPC_CHANNELS, db }
}

describe('registerSessionIpcHandlers', () => {
  afterEach(() => {
    delete require.cache[electronModulePath]
    delete require.cache[ipcRegistryModulePath]
    delete require.cache[ipcHandlersModulePath]
  })

  it('SESSION_START creates a real sessions row', () => {
    const { handlers, IPC_CHANNELS, db } = setupWithMockedElectron()
    const result = handlers[IPC_CHANNELS.SESSION_START.channel]()
    expect(typeof result.id).toBe('string')
    expect(db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.id)).toBeTruthy()
  })

  it('SESSION_RECORD_ENTRY inserts a real session_entries row', () => {
    const { handlers, IPC_CHANNELS } = setupWithMockedElectron()
    const { id: sessionId } = handlers[IPC_CHANNELS.SESSION_START.channel]()

    const entry = handlers[IPC_CHANNELS.SESSION_RECORD_ENTRY.channel]({}, {
      sessionId,
      songPath: '/library/song',
      playerId: 'p1',
      score: 100,
      epicCount: 1,
      goodCount: 0,
      awfulCount: 0,
    })

    expect(entry.session_id).toBe(sessionId)
    expect(entry.score).toBe(100)
  })

  it('SESSION_LIST_LEADERBOARD returns recorded entries', () => {
    const { handlers, IPC_CHANNELS } = setupWithMockedElectron()
    const { id: sessionId } = handlers[IPC_CHANNELS.SESSION_START.channel]()
    handlers[IPC_CHANNELS.SESSION_RECORD_ENTRY.channel]({}, {
      sessionId,
      songPath: '/library/song',
      playerId: 'p1',
      score: 100,
      epicCount: 1,
      goodCount: 0,
      awfulCount: 0,
    })

    const leaderboard = handlers[IPC_CHANNELS.SESSION_LIST_LEADERBOARD.channel]()
    expect(leaderboard).toHaveLength(1)
    expect(leaderboard[0].score).toBe(100)
  })

  it('SESSION_LIST_LEADERBOARD with a song query returns the highscores for that song, best first', () => {
    const { handlers, IPC_CHANNELS } = setupWithMockedElectron()
    const { id: sessionId } = handlers[IPC_CHANNELS.SESSION_START.channel]()
    const record = (playerId, score, songPath = '/library/song') =>
      handlers[IPC_CHANNELS.SESSION_RECORD_ENTRY.channel]({}, {
        sessionId, songPath, playerId, score, epicCount: 0, goodCount: 0, awfulCount: 0, difficulty: 'hard',
      })
    record('p1', 100)
    record('p2', 300)
    record('p3', 999, '/library/other')

    const scores = handlers[IPC_CHANNELS.SESSION_LIST_LEADERBOARD.channel]({}, { songPath: '/library/song', difficulty: 'hard' })
    expect(scores.map((s) => s.playerId)).toEqual(['p2', 'p1'])
  })

  it('degrades instead of throwing when the session database never opened', () => {
    const { handlers, IPC_CHANNELS } = setupWithMockedElectron({ withDb: false })
    expect(handlers[IPC_CHANNELS.SESSION_START.channel]()).toBeNull()
    expect(handlers[IPC_CHANNELS.SESSION_RECORD_ENTRY.channel]({}, { sessionId: 'x' })).toBeNull()
    expect(handlers[IPC_CHANNELS.SESSION_LIST_LEADERBOARD.channel]()).toEqual([])
    expect(handlers[IPC_CHANNELS.SESSION_LIST_LEADERBOARD.channel]({}, { songPath: '/x' })).toEqual([])
  })
})
