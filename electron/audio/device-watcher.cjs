// Hot-plug detection by polling (cpal has no portable hot-plug event).
// listDevices() is synchronous and can block the main thread for tens of ms
// on Windows, so polls are 5 s apart, chained with setTimeout, and skipped
// while a song is being sung (`isPaused()`).
const DEFAULT_POLL_INTERVAL_MS = 5000

function diffDeviceLists(previous, next) {
  const previousIds = new Set(previous.map((d) => d.id))
  const nextIds = new Set(next.map((d) => d.id))

  const added = next.filter((d) => !previousIds.has(d.id))
  const removed = previous.filter((d) => !nextIds.has(d.id))

  return { added, removed, changed: added.length > 0 || removed.length > 0 }
}

function isThenable(value) {
  return Boolean(value) && typeof value.then === 'function'
}

/**
 * `bridge` must expose listDevices(); `onChange` fires with { devices, added, removed }
 * only when the list actually differs from the last poll.
 *
 * @param {{ isPaused?: () => boolean }} [options]
 * @returns {(() => void) & { pollNow: () => void }} stop -- with `pollNow` to re-check immediately (e.g. when gameplay ends)
 */
function startDeviceWatcher(bridge, onChange, intervalMs = DEFAULT_POLL_INTERVAL_MS, { isPaused = () => false } = {}) {
  let lastDevices = []
  let stopped = false
  let inFlight = false
  let timer = null

  const accept = (devices) => {
    if (stopped || !Array.isArray(devices)) return
    const diff = diffDeviceLists(lastDevices, devices)
    lastDevices = devices
    if (diff.changed) onChange({ devices, added: diff.added, removed: diff.removed })
  }

  // The first enumeration only establishes the baseline -- nothing has
  // "changed" yet.
  try {
    const initial = bridge.listDevices()
    if (isThenable(initial)) {
      inFlight = true
      initial
        .then((devices) => {
          if (Array.isArray(devices)) lastDevices = devices
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false
        })
    } else if (Array.isArray(initial)) {
      lastDevices = initial
    }
  } catch {
    // An enumeration failure is not a device change; try again next poll.
  }

  function poll() {
    if (stopped || inFlight || isPaused()) return
    let result
    try {
      result = bridge.listDevices()
    } catch {
      return
    }
    if (!isThenable(result)) {
      accept(result)
      return
    }
    inFlight = true
    result
      .then(accept)
      .catch(() => {})
      .finally(() => {
        inFlight = false
      })
  }

  function schedule() {
    if (stopped) return
    timer = setTimeout(() => {
      poll()
      schedule()
    }, intervalMs)
  }

  schedule()

  const stop = () => {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
  }
  stop.pollNow = poll
  return stop
}

module.exports = { diffDeviceLists, startDeviceWatcher, DEFAULT_POLL_INTERVAL_MS }
