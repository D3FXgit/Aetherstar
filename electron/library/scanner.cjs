// Main-process scan orchestrator. Owns the worker_threads
// Worker lifecycle; electron/main.cjs relays its progress callback over IPC.
const path = require('node:path')
const { Worker: RealWorker } = require('node:worker_threads')

/** rootPath -> { promise, worker, childPids } */
const activeScans = new Map()

/**
 * While a song is being sung, scans hold still: the worker finishes the batch
 * it is writing and then waits, and no new loudness decode is started. A scan
 * started during gameplay starts paused. See setGameplayActive.
 */
let gameplayActive = false

function postToWorker(worker, message) {
  if (!worker || typeof worker.postMessage !== 'function') return
  try {
    worker.postMessage(message)
  } catch {
    // The worker is already gone; its 'exit' handler settles the scan.
  }
}

// `WorkerClass` is injectable so tests can substitute a fake Worker --
// node: builtins bypass require.cache, so the require.cache-injection
// pattern electron/__tests__/ipc-registry.test.cjs uses for `electron`
// (a normally file-resolvable package outside Electron) doesn't apply here.
function startScan(rootPath, { onProgress, dbPath, thumbnailsDir, WorkerClass = RealWorker } = {}) {
  if (activeScans.has(rootPath)) {
    return Promise.reject(new Error(`a scan is already in progress for root: ${rootPath}`))
  }

  const entry = { promise: null, worker: null, childPids: new Set() }

  entry.promise = new Promise((resolve, reject) => {
    // A worker that dies (an uncaught exception, an out-of-memory kill, a
    // terminate() on quit) must still settle this promise, or the root's
    // activeScans entry would refuse every later rescan as "in progress".
    let settled = false
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }

    let worker
    try {
      worker = new WorkerClass(path.join(__dirname, 'scan-worker.cjs'), {
        workerData: { rootPath, dbPath, thumbnailsDir, paused: gameplayActive },
      })
    } catch (error) {
      settle(reject, error)
      return
    }
    entry.worker = worker

    worker.on('message', (message) => {
      // Bookkeeping from the worker, not progress: the ffmpeg processes its
      // loudness pass is running, so quitting can kill them (child processes
      // outlive a terminated worker thread).
      if (message && message.type === 'child-process') {
        if (message.running) entry.childPids.add(message.pid)
        else entry.childPids.delete(message.pid)
        return
      }
      if (message?.error) {
        settle(reject, new Error(message.error))
        return
      }
      onProgress?.(message)
      if (message?.done) settle(resolve, message)
    })

    worker.on('error', (error) => settle(reject, error))
    worker.on('exit', (code) => {
      entry.childPids.clear()
      settle(reject, new Error(`library scan worker for ${rootPath} exited (code ${code}) before finishing`))
    })
  }).finally(() => {
    if (activeScans.get(rootPath) === entry) activeScans.delete(rootPath)
  })

  activeScans.set(rootPath, entry)
  return entry.promise
}

/**
 * Pauses (true) or resumes (false) every running scan, and decides whether
 * scans started from now on begin paused.
 */
function setGameplayActive(active) {
  gameplayActive = Boolean(active)
  for (const entry of activeScans.values()) {
    postToWorker(entry.worker, { type: gameplayActive ? 'pause' : 'resume' })
  }
}

function isGameplayActive() {
  return gameplayActive
}

/**
 * Quit-time teardown: aborts every scan, kills the ffmpeg processes their
 * loudness passes started, and terminates the worker threads.
 *
 * @param {{ killProcess?: (pid: number) => void }} [options] seam for tests
 */
function terminateAllScans({ killProcess = (pid) => process.kill(pid) } = {}) {
  const terminations = []
  for (const entry of activeScans.values()) {
    postToWorker(entry.worker, { type: 'abort' })
    for (const pid of entry.childPids) {
      try {
        killProcess(pid)
      } catch {
        // Already exited.
      }
    }
    entry.childPids.clear()
    if (entry.worker && typeof entry.worker.terminate === 'function') {
      try {
        terminations.push(Promise.resolve(entry.worker.terminate()).catch(() => {}))
      } catch {
        // Already terminated.
      }
    }
  }
  return Promise.all(terminations)
}

module.exports = { startScan, setGameplayActive, isGameplayActive, terminateAllScans }
