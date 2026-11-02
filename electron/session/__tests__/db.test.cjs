// @vitest-environment node
const Database = require('better-sqlite3')
const { resolveNativeBinding } = require('../../native-binding.cjs')
const { openSessionDb, startSession, recordEntry, listLeaderboard, listSongHighscores, migrate } = require('../db.cjs')

describe('openSessionDb', () => {
  it('creates the sessions and session_entries tables', () => {
    const db = openSessionDb(':memory:')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
    expect(tables).toContain('sessions')
    expect(tables).toContain('session_entries')
  })
})

describe('startSession', () => {
  it('inserts a sessions row and returns its id/startedAt', () => {
    const db = openSessionDb(':memory:')
    const { id, startedAt } = startSession(db)
    expect(typeof id).toBe('string')
    expect(typeof startedAt).toBe('number')
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
    expect(row.started_at).toBe(startedAt)
  })
})

describe('recordEntry', () => {
  it('inserts a session_entries row with all fields round-tripping', () => {
    const db = openSessionDb(':memory:')
    const { id: sessionId } = startSession(db)

    const entry = recordEntry(db, {
      sessionId,
      songPath: '/library/nova/song',
      playerId: 'p1',
      score: 4200,
      epicCount: 5,
      goodCount: 2,
      awfulCount: 1,
    })

    expect(entry.session_id).toBe(sessionId)
    expect(entry.song_path).toBe('/library/nova/song')
    expect(entry.player_id).toBe('p1')
    expect(entry.score).toBe(4200)
    expect(entry.epic_count).toBe(5)
    expect(entry.good_count).toBe(2)
    expect(entry.awful_count).toBe(1)
    expect(typeof entry.played_at).toBe('number')
  })
})

describe('listLeaderboard', () => {
  it('joins against songs for title/artist when the song is still in the library, falls back to the path when not', () => {
    const db = openSessionDb(':memory:')
    // A minimal stand-in songs table matching electron/library/db.cjs's real
    // column names this join relies on -- not a full library schema, this
    // test only needs `path`/`title`/`artist` to exist.
    db.exec('CREATE TABLE songs (path TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL)')
    db.prepare('INSERT INTO songs (path, title, artist) VALUES (?, ?, ?)').run(
      '/library/nova/song',
      'Paper Satellites',
      'Nova Lane',
    )

    const { id: sessionId } = startSession(db)
    recordEntry(db, {
      sessionId,
      songPath: '/library/nova/song',
      playerId: 'p1',
      score: 4200,
      epicCount: 5,
      goodCount: 2,
      awfulCount: 1,
    })
    recordEntry(db, {
      sessionId,
      songPath: '/library/removed/song',
      playerId: 'p1',
      score: 1000,
      epicCount: 1,
      goodCount: 1,
      awfulCount: 1,
    })

    const leaderboard = listLeaderboard(db)
    expect(leaderboard).toHaveLength(2)

    const withSong = leaderboard.find((e) => e.songPath === '/library/nova/song')
    expect(withSong.songTitle).toBe('Paper Satellites')
    expect(withSong.songArtist).toBe('Nova Lane')

    const withoutSong = leaderboard.find((e) => e.songPath === '/library/removed/song')
    expect(withoutSong.songTitle).toBe('/library/removed/song')
    expect(withoutSong.songArtist).toBe('')
  })
})

describe('difficulty', () => {
  function entry(sessionId, overrides) {
    return {
      sessionId,
      songPath: '/library/song',
      playerId: 'p1',
      score: 1000,
      epicCount: 0,
      goodCount: 0,
      awfulCount: 0,
      ...overrides,
    }
  }

  it('stores the difficulty with each entry, defaulting to normal', () => {
    const db = openSessionDb(':memory:')
    const { id: sessionId } = startSession(db)
    expect(recordEntry(db, entry(sessionId, { difficulty: 'hard' })).difficulty).toBe('hard')
    expect(recordEntry(db, entry(sessionId, {})).difficulty).toBe('normal')
    expect(recordEntry(db, entry(sessionId, { difficulty: 'nonsense' })).difficulty).toBe('normal')
  })

  it('adds the difficulty column to a database created before it existed, keeping its rows', () => {
    const legacy = new Database(':memory:', { nativeBinding: resolveNativeBinding('better-sqlite3') })
    legacy.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL);
      CREATE TABLE session_entries (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), song_path TEXT NOT NULL,
        player_id TEXT NOT NULL, score INTEGER NOT NULL, epic_count INTEGER NOT NULL, good_count INTEGER NOT NULL,
        awful_count INTEGER NOT NULL, played_at INTEGER NOT NULL
      );
      INSERT INTO sessions VALUES ('s1', 1);
      INSERT INTO session_entries VALUES ('e1', 's1', '/library/song', 'p1', 900, 0, 0, 0, 1);
    `)

    migrate(legacy)

    const columns = legacy.prepare('PRAGMA table_info(session_entries)').all().map((c) => c.name)
    expect(columns).toContain('difficulty')
    // The old row is kept, and the all-time leaderboard still reads it as 'normal'.
    expect(legacy.prepare('SELECT COUNT(*) AS n FROM session_entries').get().n).toBe(1)
    legacy.exec('CREATE TABLE songs (path TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL)')
    expect(listLeaderboard(legacy)[0]).toMatchObject({ playerId: 'p1', score: 900, difficulty: 'normal' })
    // Idempotent: every open runs it, so a second pass must be a no-op.
    expect(() => migrate(legacy)).not.toThrow()
  })
})

describe('listSongHighscores', () => {
  function seed() {
    const db = openSessionDb(':memory:')
    const { id: sessionId } = startSession(db)
    const add = (playerId, score, difficulty, songPath = '/library/song') =>
      recordEntry(db, { sessionId, songPath, playerId, score, epicCount: 0, goodCount: 0, awfulCount: 0, difficulty })
    add('p1', 5000, 'normal')
    add('p2', 7000, 'normal')
    add('p3', 6000, 'normal')
    add('p1', 9000, 'easy')
    add('p2', 3000, 'hard')
    add('p9', 9999, 'normal', '/library/other')
    return db
  }

  it('returns one song and difficulty, best first, limited', () => {
    const db = seed()
    const scores = listSongHighscores(db, { songPath: '/library/song', difficulty: 'normal', limit: 2 })
    expect(scores.map((s) => [s.playerId, s.score])).toEqual([
      ['p2', 7000],
      ['p3', 6000],
    ])
  })

  it('returns every difficulty ladder when no difficulty is given', () => {
    const db = seed()
    const scores = listSongHighscores(db, { songPath: '/library/song', limit: 1 })
    expect(scores.map((s) => [s.difficulty, s.playerId, s.score])).toEqual([
      ['easy', 'p1', 9000],
      ['normal', 'p2', 7000],
      ['hard', 'p2', 3000],
    ])
  })

  it('leaves out scores recorded before difficulties existed, without deleting them', () => {
    const db = seed()
    // A pre-difficulty row on the old points scale: higher than any current score.
    db.prepare(
      `INSERT INTO session_entries (id, session_id, song_path, player_id, score, epic_count, good_count, awful_count, played_at, difficulty)
       VALUES ('legacy', (SELECT id FROM sessions LIMIT 1), '/library/song', 'p7', 250000, 0, 0, 0, 1, NULL)`,
    ).run()

    const all = listSongHighscores(db, { songPath: '/library/song', limit: 5 })
    expect(all.map((s) => s.playerId)).not.toContain('p7')
    expect(listSongHighscores(db, { songPath: '/library/song', difficulty: 'normal', limit: 1 })[0]).toMatchObject({
      playerId: 'p2',
      score: 7000,
    })
    expect(db.prepare("SELECT COUNT(*) AS n FROM session_entries WHERE id = 'legacy'").get().n).toBe(1)
  })

  it('returns nothing without a song path', () => {
    const db = seed()
    expect(listSongHighscores(db, {})).toEqual([])
  })
})
