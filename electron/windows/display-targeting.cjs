// Pure display-picking logic, separate from BrowserWindow
// creation -- prefer a persisted display, else the first non-primary display,
// else fall back to the primary (single-monitor windowed-preview mode).
function pickTargetDisplay(displays, primaryDisplayId, persistedDisplayId) {
  if (persistedDisplayId !== null) {
    const persisted = displays.find((d) => d.id === persistedDisplayId)
    if (persisted) return { display: persisted, isSingleDisplayFallback: false }
  }

  const nonPrimary = displays.find((d) => d.id !== primaryDisplayId)
  if (nonPrimary) return { display: nonPrimary, isSingleDisplayFallback: false }

  const primary = displays.find((d) => d.id === primaryDisplayId) ?? displays[0]
  return { display: primary, isSingleDisplayFallback: true }
}

module.exports = { pickTargetDisplay }
