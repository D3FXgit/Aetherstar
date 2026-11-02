// Recursive scan core. Dual-mode: `runScan` is a
// plain exported function, callable directly (fast unit tests, or the main
// process's own fallback) and also driven by the worker_threads glue at the
// bottom of this file when spawned as a real Worker (electron/library/scanner.cjs).
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn: nodeSpawn } = require('node:child_process')
const { isMainThread, parentPort, workerData } = require('node:worker_threads')

const parser = require('./parser.cjs')
const dbApi = require('./db.cjs')
const { computeDurationMs } = require('./duration.cjs')
const { measureLoudness, isFfmpegAvailable } = require('./loudness.cjs')
const { pickChartFile } = require('./chart-files.cjs')

let nativeImage = null
try {
  // Only available inside Electron's main/worker context, never in a plain
  // Node test run -- thumbnail generation degrades gracefully without it.
  ;({ nativeImage } = require('electron'))
} catch {
  nativeImage = null
}

/**
 * Every song folder under `rootPath`, each with the one chart it is indexed by.
 *
 * A folder is a song folder only when it holds a .txt that actually looks like
 * an UltraStar chart (electron/library/chart-files.cjs) -- a readme.txt or
 * lyrics.txt does not make it one, and does not stop the walk from descending
 * into the folders beneath it. When several charts qualify, the choice is
 * deterministic (solo before duet, then by name) and is the same one the
 * app-media:// handler makes when playback asks for the folder.
 *
 * One chart per folder because the library keys a song by its folder
 * (db.cjs's `songs.path` primary key, which the renderer, the session history
 * and the thumbnail cache all use as the song's identity).
 *
 * @returns {{ folder: string, chartPath: string }[]}
 */
function discoverSongs(rootPath) {
  const found = []
  const stack = [rootPath]

  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    const chartPath = pickChartFile(dir, entries)
    if (chartPath) {
      found.push({ folder: dir, chartPath })
      continue // a song folder's own subfolders (if any) aren't walked further
    }

    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(dir, entry.name))
    }
  }

  return found
}

function findSongFolders(rootPath) {
  return discoverSongs(rootPath).map((song) => song.folder)
}

function findTxtFile(dir) {
  return pickChartFile(dir)
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.flac', '.aac'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.avi', '.mpg', '.mpeg', '.webm', '.mov', '.mkv', '.m4v'])
const COVER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp'])

/** First file in `dir` whose extension is in `extensions` (case-insensitive) and which isn't excluded, or null. */
function findFirstFileByExtension(dir, extensions, excludeAbsPaths = []) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const excluded = new Set(excludeAbsPaths.filter(Boolean))
  const match = entries.find(
    (e) => e.isFile() && extensions.has(path.extname(e.name).toLowerCase()) && !excluded.has(path.join(dir, e.name)),
  )
  return match ? path.join(dir, match.name) : null
}

/**
 * Change signature for one song folder: the chart's bytes plus the sorted
 * names of everything sitting beside it.
 *
 * The folder listing is in here because the incremental-rescan check used to
 * key on the .txt alone, so adding the audio file a song was missing, dropping
 * in a transcoded video, or adding stems changed nothing the scanner could
 * see -- the song kept its stale "missing audio" scan error until the chart
 * itself happened to change. Hashing the listing (rather than comparing folder
 * mtimes) also keeps this free of any dependence on the clock, which is what
 * made the rescan test flaky.
 */
function computeFolderSignature(folder, chartBuffer) {
  let names = []
  try {
    names = fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort()
  } catch {
    names = []
  }
  return crypto.createHash('sha1').update(chartBuffer).update('\0').update(names.join('\0')).digest('hex')
}

/**
 * Resolves a chart's tagged media reference (`#MP3`/`#VIDEO`/`#COVER`) to a
 * real file. If the tagged filename doesn't exist -- or the chart didn't tag
 * one at all -- falls back to whatever file of the right kind is actually
 * sitting in the song's own folder, rather than treating the song as
 * unplayable/missing that media just because the chart's own reference is
 * stale or wrong (a renamed file, a case mismatch, a different extension --
 * all common in real-world UltraStar libraries).
 *
 * `excludeAbsPaths` keeps that fallback away from files that are known to be
 * something else: a song's separated stems are audio files sitting right next
 * to it, so without this the "any audio file in the folder" rule cheerfully
 * nominates the a-cappella track as the song's main audio.
 */
function resolveMediaFile(folder, taggedRelativePath, fallbackExtensions, excludeAbsPaths = []) {
  if (taggedRelativePath) {
    const taggedAbsPath = path.join(folder, taggedRelativePath)
    if (fs.existsSync(taggedAbsPath)) return taggedAbsPath
  }
  return findFirstFileByExtension(folder, fallbackExtensions, excludeAbsPaths)
}

/**
 * Resolves a stem tag (`#VOCALS`/`#INSTRUMENTAL`) -- strictly, with no
 * extension fallback. Every other media kind can safely guess, because the
 * worst case is the right sort of file with the wrong name. A stem cannot:
 * substituting "some audio file in this folder" for a missing vocal track
 * almost always picks the full mix, and playing the full mix on top of the
 * instrumental is far worse than having no guide vocal at all.
 *
 * @returns {{ absPath: string|null, missingTag: string|null }}
 */
function resolveStemFile(folder, taggedRelativePath) {
  if (!taggedRelativePath) return { absPath: null, missingTag: null }
  const absPath = path.join(folder, taggedRelativePath)
  if (fs.existsSync(absPath)) return { absPath, missingTag: null }
  return { absPath: null, missingTag: taggedRelativePath }
}

function generateThumbnail(coverAbsPath, thumbnailsDir, songPath) {
  if (!nativeImage || !coverAbsPath || !thumbnailsDir) return null
  try {
    const image = nativeImage.createFromPath(coverAbsPath)
    if (image.isEmpty()) return null
    const resized = image.resize({ width: 240 })
    const jpeg = resized.toJPEG(80)
    fs.mkdirSync(thumbnailsDir, { recursive: true })
    const filename = `${crypto.createHash('sha1').update(songPath).digest('hex')}.jpg`
    const thumbnailPath = path.join(thumbnailsDir, filename)
    fs.writeFileSync(thumbnailPath, jpeg)
    return thumbnailPath
  } catch {
    return null
  }
}

/**
 * How many files are decoded at once during the loudness pass.
 *
 * One `ffmpeg -af ebur128` uses ~1.15 cores and runs at ~236x realtime, so the
 * pass is CPU-bound rather than IO-bound. Three at a time is roughly 3x the
 * throughput while deliberately leaving cores free: this runs inside a
 * `worker_threads` Worker in the *running app*, and a scan that saturates the
 * machine is a scan that makes the UI stutter -- on a box the user has already
 * reported lag on.
 */
const LOUDNESS_CONCURRENCY = 3

/**
 * Songs written per SQLite transaction in the metadata pass, and the most time
 * one batch may hold the write lock. Autocommitting every song cost a WAL
 * sync each; batching makes a large first scan several times faster. The time
 * budget keeps each write transaction short, because the main process writes
 * to the same file (thumbnails, players, session results) and waits on this
 * lock -- and because pause requests are only seen between batches.
 */
const SCAN_BATCH_SIZE = 200
const SCAN_BATCH_TIME_BUDGET_MS = 250

/** Default for callers that never pause (unit tests, a direct runScan). */
async function noPause() {}

/**
 * Phase 2 of a scan: fill in the EBU R 128 measurement for every song under
 * this root that hasn't got one.
 *
 * Deliberately a *second pass* rather than a step inside the metadata loop.
 * Measuring costs ~1 s per song against a few milliseconds for parsing a chart,
 * so folding it into the main loop would multiply the time before the library
 * is browsable by ~100x. Run afterwards, the library is complete and usable the
 * moment phase 1 ends and the levels settle in behind it; and because the pass
 * keys on "no measurement yet" (see db.listSongsMissingLoudness) rather than on
 * the change detection, an existing library gets backfilled by the next rescan
 * without its content hashes having to change.
 *
 * Every failure is silent by design: no ffmpeg installed, an undecodable file,
 * a timeout. The song simply keeps a null measurement, and playback keeps
 * playing it at exactly the level it plays at today.
 */
async function runLoudnessPass({
  rootPath,
  db,
  onProgress,
  measure = measureLoudness,
  ffmpegAvailable = isFfmpegAvailable,
  concurrency = LOUDNESS_CONCURRENCY,
  waitWhilePaused = noPause,
}) {
  const pending = dbApi.listSongsMissingLoudness(db, rootPath)
  if (pending.length === 0) return { measured: 0, skipped: 0 }
  // One probe for the whole pass rather than a failed spawn per song.
  if (!(await ffmpegAvailable())) return { measured: 0, skipped: pending.length }

  let measured = 0
  let skipped = 0
  let next = 0

  const report = (currentPath, done) =>
    onProgress?.({
      rootPath,
      phase: 'loudness',
      songsFound: pending.length,
      songsParsed: measured + skipped,
      currentPath,
      done,
      errorCount: 0,
    })

  async function worker() {
    for (;;) {
      // Never start a decode while someone is singing: three ffmpeg processes
      // at ~1 core each is exactly the load that makes pitch judging stutter.
      // A decode already running finishes (they take about a second).
      await waitWhilePaused()
      const index = next++
      if (index >= pending.length) return
      const song = pending[index]
      // The full mix when there is one, else the instrumental -- the same
      // choice previewAudioPath makes, so the level measured is the level the
      // song is actually heard at.
      const audioPath = song.mp3Path ?? song.instrumentalPath
      const result = audioPath ? await measure(audioPath) : null
      if (result) {
        dbApi.updateLoudness(db, song.path, result)
        measured++
      } else {
        skipped++
      }
      report(song.path, false)
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, pending.length)) }, worker))
  return { measured, skipped }
}

/**
 * `analyseLoudness` defaults to *false*, and the worker entry point at the
 * bottom of this file is what turns it on. Phase 2 spawns a decoder per song,
 * which is exactly what a unit test calling `runScan` directly must not do; the
 * one caller that runs against a real library opts in explicitly.
 *
 * `waitWhilePaused` is awaited between batches of the metadata pass and before
 * every loudness decode; the worker entry point makes it block while gameplay
 * is active (electron/library/scanner.cjs's setGameplayActive).
 *
 * @param {{ rootPath: string, db: import('better-sqlite3').Database, onProgress?: (p: object) => void, thumbnailsDir?: string, analyseLoudness?: boolean, loudnessOptions?: object, waitWhilePaused?: () => Promise<void>, batchSize?: number, batchTimeBudgetMs?: number }} opts
 */
async function runScan({
  rootPath,
  db,
  onProgress,
  thumbnailsDir,
  analyseLoudness = false,
  loudnessOptions = {},
  waitWhilePaused = noPause,
  batchSize = SCAN_BATCH_SIZE,
  batchTimeBudgetMs = SCAN_BATCH_TIME_BUDGET_MS,
}) {
  const songs = discoverSongs(rootPath)
  if (typeof dbApi.pruneMissingSongs === 'function') {
    dbApi.pruneMissingSongs(
      db,
      rootPath,
      songs.map((song) => song.folder),
    )
  }
  let songsParsed = 0
  let errorCount = 0

  const report = (currentPath, done) => {
    onProgress?.({
      rootPath,
      songsFound: songs.length,
      songsParsed,
      currentPath,
      done,
      errorCount,
    })
  }

  const recordError = (folder, reason) => {
    dbApi.recordScanError(db, { path: folder, reason, timestamp: Date.now() })
    errorCount++
  }

  function scanSong({ folder, chartPath }) {
    // Everything that touches the file system is inside the per-song guard: a
    // chart deleted mid-scan, an unreadable file or a permissions error used
    // to throw straight out of runScan and abort the whole library's scan.
    let mtimeMs
    let buffer
    let contentHash
    try {
      const stat = fs.statSync(chartPath)
      mtimeMs = Math.round(stat.mtimeMs)
      buffer = fs.readFileSync(chartPath)
      contentHash = computeFolderSignature(folder, buffer)
    } catch (error) {
      dbApi.clearScanErrorsForPath(db, folder)
      recordError(folder, `could not read chart ${path.basename(chartPath)}: ${String(error?.message ?? error)}`)
      songsParsed++
      report(folder, false)
      return
    }

    const existing = dbApi.findByPathAndHash(db, folder)
    if (existing && existing.mtimeMs === mtimeMs && existing.contentHash === contentHash) {
      // Unchanged since the last scan -- but indexed before some chart-derived
      // column existed (e.g. #PREVIEWSTART). The chart bytes are already in
      // hand, so re-parsing just to fill the new column(s) costs a few ms once
      // per song; a full re-index would also throw away the thumbnail.
      if ((existing.metaVersion ?? 0) < dbApi.SONG_META_VERSION) {
        try {
          const { chart } = parser.parseChart(buffer)
          dbApi.updateChartMeta(db, folder, { previewStartSec: chart.meta.previewStartSec })
        } catch {
          // Indexed before, unparseable now (e.g. a parser that got stricter):
          // leave the row as it was; the next real change re-evaluates it.
        }
      }
      report(folder, false)
      return
    }

    // This song is actually being (re-)evaluated -- clear whatever error(s)
    // it carried from a previous scan first, so a fixed problem (renamed
    // file restored, a code fix) doesn't keep showing a stale error
    // alongside duplicate entries from every past scan. Songs skipped by the
    // unchanged check above intentionally keep their prior error state,
    // since their underlying condition was never re-checked.
    dbApi.clearScanErrorsForPath(db, folder)

    try {
      const { chart, warnings } = parser.parseChart(buffer)
      for (const warning of warnings) recordError(folder, warning)

      // Stems first: they are audio files in the same folder, so the full
      // mix's "any audio file here" fallback has to be told to ignore them.
      const vocals = resolveStemFile(folder, chart.meta.vocalsPath)
      const instrumental = resolveStemFile(folder, chart.meta.instrumentalPath)
      for (const [tag, stem] of [['#VOCALS', vocals], ['#INSTRUMENTAL', instrumental]]) {
        if (!stem.missingTag) continue
        recordError(folder, `missing stem file: ${tag}:${stem.missingTag} (playback falls back to the full mix)`)
      }

      const mp3AbsPath = resolveMediaFile(folder, chart.meta.mp3Path, AUDIO_EXTENSIONS, [
        vocals.absPath,
        instrumental.absPath,
      ])
      const videoAbsPath = resolveMediaFile(folder, chart.meta.videoPath, VIDEO_EXTENSIONS)
      const coverAbsPath = resolveMediaFile(folder, chart.meta.coverPath, COVER_EXTENSIONS)
      // A chart with only stems is still singable: playback promotes the
      // instrumental to the clock source when there is no full mix.
      const hasAudio = Boolean(mp3AbsPath || instrumental.absPath || vocals.absPath)
      // A header-only chart parses without complaint, but would mount a stage
      // that sits in its countdown forever: not playable, and reported.
      const hasNotes = chart.lines.some((line) => line.notes.length > 0)
      if (!hasNotes) recordError(folder, 'chart parsed but contains no singable notes')
      const isPlayable = hasAudio && hasNotes

      // No resolvable audio at all, not even a fallback file in the folder:
      // still indexed (isPlayable: false, hidden from the grid) and reported,
      // so the selector's "couldn't be loaded" list can explain it.
      if (!hasAudio) {
        const reason = chart.meta.mp3Path
          ? `missing audio file: ${chart.meta.mp3Path} (no audio file found in the song folder either)`
          : 'no #AUDIO/#MP3 tag and no audio file found in the song folder'
        recordError(folder, reason)
      }
      const isDuet = chart.lines.some((l) => l.part === 'p1' || l.part === 'p2')
      const thumbnailPath = coverAbsPath ? generateThumbnail(coverAbsPath, thumbnailsDir, folder) : null

      dbApi.upsertSong(db, {
        path: folder,
        rootPath,
        artist: chart.meta.artist,
        title: chart.meta.title,
        language: chart.meta.language,
        edition: chart.meta.edition,
        mp3Path: mp3AbsPath,
        vocalsPath: vocals.absPath,
        instrumentalPath: instrumental.absPath,
        videoPath: videoAbsPath,
        coverPath: coverAbsPath,
        thumbnailPath,
        durationMs: Math.round(computeDurationMs(chart)),
        bpm: chart.meta.bpm,
        gap: chart.meta.gap,
        previewStartSec: chart.meta.previewStartSec,
        isDuet,
        isPlayable,
        mtimeMs,
        contentHash,
        // Unused by the ON CONFLICT UPDATE branch (added_at is never in its SET list),
        // so this only matters for a first-time insert.
        addedAt: Date.now(),
      })
    } catch (error) {
      recordError(folder, String(error?.message ?? error))
    }

    songsParsed++
    report(folder, false)
  }

  // Batched: one transaction per SCAN_BATCH_SIZE songs (or per time budget,
  // whichever ends first) instead of one autocommit -- and one WAL sync -- per
  // statement. Between batches the write lock is released and the scan yields,
  // which is where a pause request takes effect.
  const inTransaction = typeof db.transaction === 'function' ? (fn) => db.transaction(fn)() : (fn) => fn()
  let index = 0
  while (index < songs.length) {
    await waitWhilePaused()
    const batchEnd = Math.min(songs.length, index + Math.max(1, batchSize))
    const batchStartedAt = Date.now()
    inTransaction(() => {
      while (index < batchEnd) {
        scanSong(songs[index])
        index++
        if (Date.now() - batchStartedAt >= batchTimeBudgetMs) break
      }
    })
  }

  // Phase 2, behind the finished metadata scan. `done` is deliberately still
  // false here: the library is browsable, but the scan is not over.
  let loudness = { measured: 0, skipped: 0 }
  if (analyseLoudness) {
    loudness = await runLoudnessPass({ rootPath, db, onProgress, waitWhilePaused, ...loudnessOptions })
  }

  report(null, true)
  return { songsFound: songs.length, songsParsed, errorCount, loudness }
}

/**
 * The worker side of electron/library/scanner.cjs's control messages:
 * `pause`/`resume` (gameplay started/ended) and `abort` (app quitting).
 *
 * Returns the `waitWhilePaused` gate runScan awaits, plus a `spawn` that
 * registers every ffmpeg it starts with the parent -- a child process outlives
 * a terminated worker thread, so only the main process can reliably kill the
 * decoders on quit.
 */
function createWorkerControl(port, { initiallyPaused = false, spawn = nodeSpawn } = {}) {
  let paused = Boolean(initiallyPaused)
  let aborted = false
  let waiters = []
  const children = new Set()

  const wake = () => {
    const pending = waiters
    waiters = []
    for (const resolve of pending) resolve()
  }

  const onMessage = (message) => {
    if (!message || typeof message !== 'object') return
    if (message.type === 'pause') {
      paused = true
    } else if (message.type === 'resume') {
      paused = false
      wake()
    } else if (message.type === 'abort') {
      aborted = true
      for (const child of children) {
        try {
          child.kill('SIGKILL')
        } catch {
          // already gone
        }
      }
      wake()
    }
  }
  port.on('message', onMessage)

  async function waitWhilePaused() {
    // Yield first, so a pause/abort the parent has already posted is
    // delivered before the next batch starts rather than after it.
    await new Promise((resolve) => setImmediate(resolve))
    while (paused && !aborted) {
      await new Promise((resolve) => waiters.push(resolve))
    }
    if (aborted) throw new Error('library scan aborted')
  }

  function trackedSpawn(...args) {
    const child = spawn(...args)
    if (child && child.pid) {
      children.add(child)
      const pid = child.pid
      port.postMessage({ type: 'child-process', pid, running: true })
      let forgotten = false
      const forget = () => {
        if (forgotten) return
        forgotten = true
        children.delete(child)
        port.postMessage({ type: 'child-process', pid, running: false })
      }
      child.once?.('exit', forget)
      child.once?.('error', forget)
    }
    return child
  }

  function dispose() {
    port.off?.('message', onMessage)
    port.unref?.()
  }

  return { waitWhilePaused, trackedSpawn, dispose, isPaused: () => paused, isAborted: () => aborted }
}

// worker_threads entry point -- only runs when this file is spawned as a
// real Worker (electron/library/scanner.cjs). A plain `require()` from a
// test or the main thread never executes this branch.
if (!isMainThread && parentPort && workerData) {
  const dbApi2 = require('./db.cjs')
  const db = dbApi2.openDb(workerData.dbPath)
  const control = createWorkerControl(parentPort, { initiallyPaused: workerData.paused })
  runScan({
    rootPath: workerData.rootPath,
    db,
    thumbnailsDir: workerData.thumbnailsDir,
    // The one place phase 2 is on: a real scan of a real library, on its own
    // thread, where a second of decoding per new song costs the UI nothing.
    analyseLoudness: true,
    loudnessOptions: { measure: (audioPath) => measureLoudness(audioPath, { spawn: control.trackedSpawn }) },
    waitWhilePaused: control.waitWhilePaused,
    onProgress: (progress) => parentPort.postMessage(progress),
  })
    .catch((error) => parentPort.postMessage({ error: String(error.message ?? error) }))
    .finally(() => {
      db.close()
      // The control listener would otherwise keep this thread alive forever.
      control.dispose()
    })
}

module.exports = {
  runScan,
  runLoudnessPass,
  LOUDNESS_CONCURRENCY,
  SCAN_BATCH_SIZE,
  discoverSongs,
  findSongFolders,
  findTxtFile,
  resolveMediaFile,
  resolveStemFile,
  computeFolderSignature,
  generateThumbnail,
  createWorkerControl,
}
