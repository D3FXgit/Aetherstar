import { describe, expect, it, vi, afterEach } from 'vitest'
import { CRASH_PREFIX, SONGLOAD_PREFIX, logCrash, logSongLoad, logSongLoadError, toError } from '../log'

describe('diagnostics log', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes one greppable prefix family, so a single grep catches everything', () => {
    expect(CRASH_PREFIX).toBe('[AetherStar crash]')
    expect(SONGLOAD_PREFIX).toBe('[AetherStar songload]')
    expect(SONGLOAD_PREFIX.startsWith('[AetherStar')).toBe(true)
    expect(CRASH_PREFIX.startsWith('[AetherStar')).toBe(true)
  })

  it('logCrash writes the prefix, the location, the message and the stack to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('kaboom')

    logCrash('scene:sing', error, { chartPath: '/songs/a' })

    expect(spy).toHaveBeenCalledOnce()
    const [message, payload] = spy.mock.calls[0]
    expect(message).toContain(CRASH_PREFIX)
    expect(message).toContain('scene:sing')
    expect(message).toContain('kaboom')
    expect(payload).toMatchObject({ chartPath: '/songs/a', error })
    expect((payload as { stack?: string }).stack).toBe(error.stack)
  })

  it('logCrash survives a non-Error rejection value (the common unhandledrejection case)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    logCrash('unhandledrejection', 'just a string')

    expect(spy.mock.calls[0][0]).toContain('just a string')
  })

  it('logSongLoad writes a structured step line to console.info', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})

    logSongLoad('fetch:start', { url: 'app-media://media/songs/a/notes.txt' })

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toBe(`${SONGLOAD_PREFIX} fetch:start`)
    expect(spy.mock.calls[0][1]).toEqual({ url: 'app-media://media/songs/a/notes.txt' })
  })

  it('logSongLoadError routes a failed step into the crash channel', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    logSongLoadError('fetch', new Error('404'), { url: 'x' })

    expect(spy.mock.calls[0][0]).toContain(CRASH_PREFIX)
    expect(spy.mock.calls[0][0]).toContain('songload/fetch')
  })

  it('toError normalizes anything into a real Error', () => {
    const original = new Error('already')
    expect(toError(original)).toBe(original)
    expect(toError('text').message).toBe('text')
    expect(toError({ code: 7 }).message).toContain('code')
    expect(toError(undefined).message).toBe('undefined')
  })
})
