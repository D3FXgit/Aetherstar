// @vitest-environment node
// node: builtins (worker_threads) bypass require.cache, so unlike
// ipc-registry.test.cjs's `electron` mocking trick, scanner.cjs exposes an
// injectable `WorkerClass` option instead (see scanner.cjs's comment).
const { EventEmitter } = require('node:events')
const { startScan, setGameplayActive, terminateAllScans } = require('../scanner.cjs')

class FakeWorker extends EventEmitter {
  constructor(file, options) {
    super()
    this.options = options
    this.posted = []
    this.terminated = false
    FakeWorker.instances.push(this)
  }
  postMessage(message) {
    this.posted.push(message)
  }
  terminate() {
    this.terminated = true
    return Promise.resolve(1)
  }
}
FakeWorker.instances = []

describe('scanner.startScan', () => {
  beforeEach(() => {
    FakeWorker.instances = []
  })

  it('calls onProgress for each message and resolves when done', async () => {
    const progressEvents = []

    const promise = startScan('/library', { onProgress: (p) => progressEvents.push(p), WorkerClass: FakeWorker })
    const worker = FakeWorker.instances[0]

    worker.emit('message', { rootPath: '/library', songsFound: 2, songsParsed: 1, done: false })
    worker.emit('message', { rootPath: '/library', songsFound: 2, songsParsed: 2, done: true })

    await promise
    expect(progressEvents).toHaveLength(2)
    expect(progressEvents[1].done).toBe(true)
  })

  it('rejects a second concurrent scan for the same root', async () => {
    const firstPromise = startScan('/library-2', { WorkerClass: FakeWorker })
    await expect(startScan('/library-2', { WorkerClass: FakeWorker })).rejects.toThrow(/already/i)

    FakeWorker.instances[0].emit('message', { rootPath: '/library-2', done: true })
    await firstPromise
  })

  it('rejects -- and frees the root for a rescan -- when the worker exits without finishing', async () => {
    const promise = startScan('/library-3', { WorkerClass: FakeWorker })
    FakeWorker.instances[0].emit('exit', 1)
    await expect(promise).rejects.toThrow(/exited/)

    const retry = startScan('/library-3', { WorkerClass: FakeWorker })
    FakeWorker.instances[1].emit('message', { rootPath: '/library-3', done: true })
    await expect(retry).resolves.toMatchObject({ done: true })
  })

  it('rejects when the worker errors', async () => {
    const promise = startScan('/library-4', { WorkerClass: FakeWorker })
    FakeWorker.instances[0].emit('error', new Error('boom'))
    await expect(promise).rejects.toThrow('boom')
  })

  it('does not report child-process bookkeeping as progress', async () => {
    const progressEvents = []
    const promise = startScan('/library-5', { onProgress: (p) => progressEvents.push(p), WorkerClass: FakeWorker })
    const worker = FakeWorker.instances[0]
    worker.emit('message', { type: 'child-process', pid: 4242, running: true })
    worker.emit('message', { rootPath: '/library-5', done: true })
    await promise
    expect(progressEvents).toEqual([{ rootPath: '/library-5', done: true }])
  })

  describe('gameplay pausing and quit-time teardown', () => {
    afterEach(() => setGameplayActive(false))

    it('pauses and resumes running scans, and starts new scans paused during gameplay', async () => {
      const first = startScan('/library-6', { WorkerClass: FakeWorker })
      setGameplayActive(true)
      expect(FakeWorker.instances[0].posted).toEqual([{ type: 'pause' }])

      const second = startScan('/library-7', { WorkerClass: FakeWorker })
      expect(FakeWorker.instances[1].options.workerData.paused).toBe(true)

      setGameplayActive(false)
      expect(FakeWorker.instances[0].posted).toEqual([{ type: 'pause' }, { type: 'resume' }])
      expect(FakeWorker.instances[1].posted).toEqual([{ type: 'resume' }])

      FakeWorker.instances[0].emit('message', { done: true })
      FakeWorker.instances[1].emit('message', { done: true })
      await Promise.all([first, second])
    })

    it('terminateAllScans aborts the worker, kills its ffmpeg children and terminates the thread', async () => {
      const promise = startScan('/library-8', { WorkerClass: FakeWorker })
      const worker = FakeWorker.instances[0]
      worker.emit('message', { type: 'child-process', pid: 111, running: true })
      worker.emit('message', { type: 'child-process', pid: 222, running: true })
      worker.emit('message', { type: 'child-process', pid: 222, running: false })

      const killed = []
      await terminateAllScans({ killProcess: (pid) => killed.push(pid) })

      expect(worker.posted).toContainEqual({ type: 'abort' })
      expect(killed).toEqual([111])
      expect(worker.terminated).toBe(true)

      worker.emit('exit', 1)
      await expect(promise).rejects.toThrow(/exited/)
    })
  })
})
