import { describe, expect, it, vi } from 'vitest'
import { ensureAudioContextRunning, type AudioContextLike } from '../webAudioApi'

function makeContext(state: AudioContextLike['state'], resume: () => Promise<void>) {
  return {
    currentTime: 0,
    state,
    destination: {},
    createGain: vi.fn(),
    createBufferSource: vi.fn(),
    decodeAudioData: vi.fn(),
    resume: vi.fn(resume),
  } as unknown as AudioContextLike & { state: AudioContextLike['state'] }
}

describe('ensureAudioContextRunning', () => {
  /**
   * The bug this exists for, reported as "now I don't have any audio anymore".
   *
   * Chromium does not reject `resume()` on a context the autoplay policy is
   * blocking -- the promise stays *pending* until the context is allowed to
   * run. The previous implementation attached its gesture listener inside that
   * promise's `.then`, so on a context built before any qualifying gesture the
   * listener was never attached at all, and the only thing that could have
   * unblocked the context was gated behind the context being unblocked.
   */
  it('arms the gesture listener even when resume() never settles', async () => {
    // Pending forever, exactly as a blocked context behaves.
    const context = makeContext('suspended', () => new Promise<void>(() => {}))

    ensureAudioContextRunning(context)
    await Promise.resolve()

    window.dispatchEvent(new Event('pointerdown'))
    // Once on construction, once for the gesture -- the gesture reached it.
    expect(context.resume).toHaveBeenCalledTimes(2)
  })

  it('takes a key press as the gesture too, for a room driven from a keyboard', async () => {
    const context = makeContext('suspended', () => new Promise<void>(() => {}))

    ensureAudioContextRunning(context)
    window.dispatchEvent(new Event('keydown'))

    expect(context.resume).toHaveBeenCalledTimes(2)
  })

  it('is a one-shot: a second click during the same attempt does not ask again', async () => {
    const context = makeContext('suspended', () => new Promise<void>(() => {}))

    ensureAudioContextRunning(context)
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('keydown'))

    expect(context.resume).toHaveBeenCalledTimes(2)
  })

  it('settles without a gesture when the context simply comes back', async () => {
    const context = makeContext('suspended', () => Promise.resolve())
    const onSettled = vi.fn()

    ensureAudioContextRunning(context, onSettled)
    // The resume resolved and the context reports itself running.
    ;(context as { state: AudioContextLike['state'] }).state = 'running'
    await Promise.resolve()
    await Promise.resolve()

    expect(onSettled).toHaveBeenCalledOnce()
    // And the listener came back off with it.
    window.dispatchEvent(new Event('pointerdown'))
    expect(context.resume).toHaveBeenCalledTimes(1)
  })

  it('lets the caller re-arm when a gesture was not enough', async () => {
    const context = makeContext('suspended', () => Promise.resolve())
    const onSettled = vi.fn()

    ensureAudioContextRunning(context, onSettled)
    window.dispatchEvent(new Event('pointerdown'))
    await Promise.resolve()
    await Promise.resolve()

    // Settled, so the caller's `resumeArmed` flag clears and the next action
    // installs a fresh listener rather than assuming one is still live.
    expect(onSettled).toHaveBeenCalled()
  })

  it('does nothing to a running context, and settles immediately', () => {
    const context = makeContext('running', () => Promise.resolve())
    const onSettled = vi.fn()

    ensureAudioContextRunning(context, onSettled)

    expect(context.resume).not.toHaveBeenCalled()
    expect(onSettled).toHaveBeenCalledOnce()
  })

  it('never touches a closed context, which resume() rejects on and nothing can revive', () => {
    const context = makeContext('closed', () => Promise.reject(new Error('closed')))

    ensureAudioContextRunning(context)

    expect(context.resume).not.toHaveBeenCalled()
  })
})
