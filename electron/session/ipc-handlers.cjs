// Wires the SESSION_* IPC channels to db.cjs.
//
// `sessionDb` is null when main.cjs could not open the database at startup.
// Every handler degrades instead of throwing then: a party night must still
// start (just unrecorded), and the screens that read scores get empty lists.
const { ipcMain } = require('electron')
const { IPC_CHANNELS } = require('../ipc-registry.cjs')
const db = require('./db.cjs')

function registerSessionIpcHandlers(sessionDb) {
  ipcMain.handle(IPC_CHANNELS.SESSION_START.channel, () => (sessionDb ? db.startSession(sessionDb) : null))

  ipcMain.handle(IPC_CHANNELS.SESSION_RECORD_ENTRY.channel, (_event, entry) =>
    sessionDb ? db.recordEntry(sessionDb, entry) : null,
  )

  // One channel, two reads: no argument is the all-time leaderboard; a
  // `{ songPath, difficulty?, limit? }` query is one song's highscore table
  // (window.api.session.listSongHighscores).
  ipcMain.handle(IPC_CHANNELS.SESSION_LIST_LEADERBOARD.channel, (_event, query) => {
    if (!sessionDb) return []
    if (query && typeof query.songPath === 'string') return db.listSongHighscores(sessionDb, query)
    return db.listLeaderboard(sessionDb)
  })
}

module.exports = { registerSessionIpcHandlers }
