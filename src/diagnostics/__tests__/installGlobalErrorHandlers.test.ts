import { describe, expect, it, vi, afterEach } from 'vitest'
import { installGlobalErrorHandlers } from '../installGlobalErrorHandlers'
import { CRASH_PREFIX } from '../log'

describe('installGlobalErrorHandlers', () => {
  const disposers: Array<() => void> = []

  afterEach(() => {
    while (disposers.length > 0) disposers.pop()?.()
    vi.restoreAllMocks()
  })

  function install() {
    const dispose = installGlobalErrorHandlers()
    disposers.push(dispose)
    return dispose
  }

  it('logs an unhandled promise rejection through the crash channel (error boundaries never see these)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    install()

    // jsdom does not implement PromiseRejectionEvent, so build the shape the
    // listener reads. The listener is registered for 'unhandledrejection'.
    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    event.reason = new Error('rejected in the load path')
    window.dispatchEvent(event)

    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls[0][0]).toContain(CRASH_PREFIX)
    expect(spy.mock.calls[0][0]).toContain('unhandledrejection')
    expect(spy.mock.calls[0][0]).toContain('rejected in the load path')
  })

  it('logs an uncaught window error through the crash channel', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    install()

    const event = new Event('error') as Event & { error?: unknown; message?: string }
    event.error = new TypeError("Cannot read properties of undefined (reading 'meta')")
    window.dispatchEvent(event)

    expect(spy.mock.calls[0][0]).toContain(CRASH_PREFIX)
    expect(spy.mock.calls[0][0]).toContain("reading 'meta'")
  })

  it('is idempotent -- installing twice never double-logs', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    install()
    install()

    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    event.reason = 'once'
    window.dispatchEvent(event)

    expect(spy).toHaveBeenCalledOnce()
  })

  it('stops logging once disposed', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dispose = installGlobalErrorHandlers()
    dispose()

    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    event.reason = 'after dispose'
    window.dispatchEvent(event)

    expect(spy).not.toHaveBeenCalled()
  })
})
