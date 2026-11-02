// "Is a song being sung right now?" -- set by the renderer
// (window.api.library.setGameplayActive) and read by everything in the main
// process that should hold still meanwhile: library scans and their loudness
// decoding (scanner.cjs), the thumbnail backfill (main.cjs) and audio device
// polling (audio/device-watcher.cjs). Live pitch judging shares the main
// process's event loop with all of them.

function createGameplayActivity() {
  let active = false
  const listeners = new Set()
  let idleWaiters = []

  return {
    isActive: () => active,

    /** @returns {boolean} whether the state actually changed */
    set(next) {
      const value = next === true
      if (value === active) return false
      active = value
      if (!active) {
        const waiters = idleWaiters
        idleWaiters = []
        for (const resolve of waiters) resolve()
      }
      for (const listener of [...listeners]) {
        try {
          listener(active)
        } catch (error) {
          console.error('[gameplay] listener failed:', error)
        }
      }
      return true
    },

    /** @returns {() => void} unsubscribe */
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** Resolves immediately when idle, otherwise as soon as gameplay ends. */
    whenIdle() {
      if (!active) return Promise.resolve()
      return new Promise((resolve) => idleWaiters.push(resolve))
    },
  }
}

module.exports = { createGameplayActivity }
