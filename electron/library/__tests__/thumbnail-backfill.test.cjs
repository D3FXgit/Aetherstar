// @vitest-environment node
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { runThumbnailBackfill, thumbnailPathFor } = require('../thumbnail-backfill.cjs')

const songs = (n) => Array.from({ length: n }, (_, i) => ({ path: `/lib/song-${i}`, cover_path: `/lib/song-${i}/cover.jpg` }))

describe('runThumbnailBackfill', () => {
  let thumbnailsDir

  beforeEach(() => {
    thumbnailsDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aetherstar-thumbs-')), 'thumbnails')
  })

  it('writes each thumbnail asynchronously and commits DB updates in batches', async () => {
    const commits = []
    const result = await runThumbnailBackfill({
      pending: songs(5),
      thumbnailsDir,
      encode: () => Buffer.from('jpeg'),
      commit: (entries) => commits.push(entries.map((e) => e.path)),
      batchSize: 2,
    })

    expect(result).toEqual({ generated: 5, failed: 0, cancelled: false })
    expect(commits).toEqual([['/lib/song-0', '/lib/song-1'], ['/lib/song-2', '/lib/song-3'], ['/lib/song-4']])
    expect(fs.readFileSync(thumbnailPathFor(thumbnailsDir, '/lib/song-3'), 'utf8')).toBe('jpeg')
  })

  it('yields to the event loop between songs', async () => {
    const yieldFn = vi.fn(() => Promise.resolve())
    await runThumbnailBackfill({ pending: songs(3), thumbnailsDir, encode: () => Buffer.from('x'), commit: () => {}, yieldFn })
    expect(yieldFn).toHaveBeenCalledTimes(3)
  })

  it('waits for gameplay to end before each song', async () => {
    let release
    let idle = false
    const encode = vi.fn(() => Buffer.from('x'))
    const run = runThumbnailBackfill({
      pending: songs(1),
      thumbnailsDir,
      encode,
      commit: () => {},
      whenIdle: () => (idle ? Promise.resolve() : new Promise((resolve) => (release = resolve))),
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(encode).not.toHaveBeenCalled()

    idle = true
    release()
    await run
    expect(encode).toHaveBeenCalledTimes(1)
  })

  it('counts covers that cannot be decoded or written, without stopping', async () => {
    const commits = []
    const result = await runThumbnailBackfill({
      pending: songs(3),
      thumbnailsDir,
      encode: (cover) => (cover.includes('song-0') ? null : Buffer.from('x')),
      writeFile: async (file) => {
        if (file === thumbnailPathFor(thumbnailsDir, '/lib/song-1')) throw new Error('disk full')
      },
      commit: (entries) => commits.push(...entries.map((e) => e.path)),
    })
    expect(result).toEqual({ generated: 1, failed: 2, cancelled: false })
    expect(commits).toEqual(['/lib/song-2'])
  })

  it('stops when cancelled, committing what it already wrote', async () => {
    let cancelled = false
    const commits = []
    const result = await runThumbnailBackfill({
      pending: songs(4),
      thumbnailsDir,
      encode: () => Buffer.from('x'),
      commit: (entries) => commits.push(...entries.map((e) => e.path)),
      writeFile: async (file) => {
        if (file === thumbnailPathFor(thumbnailsDir, '/lib/song-1')) cancelled = true
      },
      isCancelled: () => cancelled,
      batchSize: 10,
    })
    expect(result.cancelled).toBe(true)
    expect(commits).toEqual(['/lib/song-0', '/lib/song-1'])
  })
})
