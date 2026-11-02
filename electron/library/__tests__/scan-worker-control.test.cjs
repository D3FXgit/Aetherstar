// @vitest-environment node
// The worker side of scanner.cjs's pause/resume/abort messages. DB-free: the
// control object only needs a MessagePort-shaped emitter.
const { EventEmitter } = require('node:events')
const { createWorkerControl } = require('../scan-worker.cjs')

function fakePort() {
  const port = new EventEmitter()
  port.posted = []
  port.postMessage = (message) => port.posted.push(message)
  port.unref = vi.fn()
  return port
}

function fakeChild(pid) {
  const child = new EventEmitter()
  child.pid = pid
  child.killedWith = null
  child.kill = (signal) => {
    child.killedWith = signal
  }
  return child
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

describe('createWorkerControl', () => {
  it('passes straight through when not paused', async () => {
    const control = createWorkerControl(fakePort())
    await expect(control.waitWhilePaused()).resolves.toBeUndefined()
  })

  it('holds while paused and continues on resume', async () => {
    const port = fakePort()
    const control = createWorkerControl(port, { initiallyPaused: true })
    let passed = false
    const waiting = control.waitWhilePaused().then(() => {
      passed = true
    })

    await tick()
    await tick()
    expect(passed).toBe(false)

    port.emit('message', { type: 'resume' })
    await waiting
    expect(passed).toBe(true)
  })

  it('a pause message stops the next gate', async () => {
    const port = fakePort()
    const control = createWorkerControl(port)
    port.emit('message', { type: 'pause' })
    expect(control.isPaused()).toBe(true)

    let passed = false
    const waiting = control.waitWhilePaused().then(() => {
      passed = true
    })
    await tick()
    await tick()
    expect(passed).toBe(false)
    port.emit('message', { type: 'resume' })
    await waiting
  })

  it('abort releases a paused gate with an error and kills the decoders it spawned', async () => {
    const port = fakePort()
    const child = fakeChild(1234)
    const control = createWorkerControl(port, { initiallyPaused: true, spawn: () => child })

    control.trackedSpawn('ffmpeg', ['-i', 'x.mp3'])
    expect(port.posted).toEqual([{ type: 'child-process', pid: 1234, running: true }])

    const waiting = control.waitWhilePaused()
    port.emit('message', { type: 'abort' })

    await expect(waiting).rejects.toThrow(/aborted/)
    expect(child.killedWith).toBe('SIGKILL')
  })

  it('reports a decoder that exits on its own exactly once', () => {
    const port = fakePort()
    const child = fakeChild(77)
    const control = createWorkerControl(port, { spawn: () => child })

    control.trackedSpawn('ffmpeg', [])
    child.emit('exit', 0)
    child.emit('error', new Error('late'))

    expect(port.posted).toEqual([
      { type: 'child-process', pid: 77, running: true },
      { type: 'child-process', pid: 77, running: false },
    ])
  })

  it('dispose detaches from the port so the worker thread can exit', () => {
    const port = fakePort()
    const control = createWorkerControl(port)
    expect(port.listenerCount('message')).toBe(1)
    control.dispose()
    expect(port.listenerCount('message')).toBe(0)
    expect(port.unref).toHaveBeenCalled()
  })
})
