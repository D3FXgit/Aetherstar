import '@testing-library/jest-dom'

// jsdom has no ResizeObserver, which several layout hooks observe on mount.
// Tests that need
// specific callback behavior stub `window.ResizeObserver` themselves; this
// default keeps every other test from crashing on mount.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}

// jsdom's <video>/<audio> elements exist as DOM nodes but throw "Not
// implemented" on play()/load(), which the stage's media elements call on
// mount. Guarded because this
// setup file also runs for @vitest-environment node test files (no DOM globals
// at all), e.g. every electron/**/__tests__ suite.
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = () => Promise.resolve()
  HTMLMediaElement.prototype.pause = () => {}
  HTMLMediaElement.prototype.load = () => {}
}
