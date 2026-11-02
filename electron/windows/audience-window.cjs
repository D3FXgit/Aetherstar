// Audience (second-screen) window creation + display hot-plug handling.
const { BrowserWindow, screen } = require('electron')
const { hideWindowMenuBar, NO_MENU_BAR_WINDOW_OPTIONS } = require('./app-menu.cjs')

const WINDOW_URL_QUERY = 'window=audience'

function createAudienceWindow({ display, isSingleDisplayFallback, preloadPath, loadFn }) {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: isSingleDisplayFallback,
    fullscreen: !isSingleDisplayFallback,
    resizable: isSingleDisplayFallback,
    // The scoreboard is read-only (no interactive controls -- AudienceScoreboard.tsx
    // renders no inputs/buttons), and a newly-created BrowserWindow steals OS
    // focus from the main window by default. Without this, opening the
    // audience window can steal the user's next keyboard/mouse gesture away
    // from the main window, which is exactly the gesture Chromium's autoplay
    // policy requires to resume the main window's suspended AudioContext --
    // leaving the main window silently unable to play any audio.
    focusable: false,
    // The windowed single-display fallback has a frame -- but never a desktop
    // menu bar (see app-menu.cjs).
    ...NO_MENU_BAR_WINDOW_OPTIONS,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // This window usually sits on a TV the operator never focuses, and
      // Chromium throttles timers and requestAnimationFrame in windows it
      // considers hidden or occluded -- the scoreboard and lyrics would stall.
      backgroundThrottling: false,
    },
  })

  hideWindowMenuBar(win)
  loadFn(win, WINDOW_URL_QUERY)
  return win
}

function registerDisplayHotplugHandling(onDisplaysChanged) {
  const handleChange = () => onDisplaysChanged(screen.getAllDisplays())
  screen.on('display-added', handleChange)
  screen.on('display-removed', handleChange)
}

/**
 * Whether an audience window currently exists, with a change callback that
 * fires only on a real transition (open -> closed or back). main.cjs flips it
 * when it creates the window and when that same window closes -- replacing the
 * window (a display change) closes the old one *after* the new one exists, so
 * no spurious "closed" is reported in between.
 *
 * @param {(open: boolean) => void} onChange
 */
function createWindowPresence(onChange) {
  let open = false
  return {
    isOpen: () => open,
    set(next) {
      const value = next === true
      if (value === open) return
      open = value
      onChange(value)
    },
  }
}

module.exports = { createAudienceWindow, registerDisplayHotplugHandling, createWindowPresence, WINDOW_URL_QUERY }
