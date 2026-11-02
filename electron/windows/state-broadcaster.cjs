// Throttled game-state relay for the audience window.
// Trailing-edge throttle: report() is cheap and can be called at any rate;
// send() fires at most once per intervalMs, always with the freshest state.
function createScoreStateBroadcaster(send, intervalMs) {
  let latest = null
  let lastSent = null

  const intervalId = setInterval(() => {
    if (latest !== lastSent) {
      send(latest)
      lastSent = latest
    }
  }, intervalMs)

  return {
    report(state) {
      latest = state
    },
    getLatest() {
      return latest
    },
    stop() {
      clearInterval(intervalId)
    },
  }
}

module.exports = { createScoreStateBroadcaster }
