// The application menu -- or, on Windows and Linux, the lack of one.
//
// Electron installs a default "File Edit View Window Help" menu when the app
// sets none. On Windows/Linux that menu is drawn *inside* the window, so the
// moment someone switches to Settings > Graphics > "Windowed mode" a desktop
// menu bar appears above a sofa-driven TV app. Nothing in it is part of the
// app's UI, so on those platforms there is no menu at all:
//
// - Copy/paste/cut/select-all/undo in text fields keep working -- Chromium
//   handles those keys itself on Windows/Linux; the default menu's Edit items
//   were only duplicates of them.
// - DevTools (and reload) are dev-only and wired up through
//   `devShortcutAction` below instead of the default View menu.
//
// macOS is different: its menu bar lives at the top of the screen, never in
// the window, and Cmd+Q/C/V/X/A/Z are menu accelerators there -- without a
// menu they stop working. So macOS keeps a minimal menu: the app menu (About,
// Hide, Quit), Edit, a View with full screen (plus reload/devtools in dev
// only), and Window.

/**
 * @param {{ platform: NodeJS.Platform, isDev: boolean }} options
 * @returns {Electron.MenuItemConstructorOptions[] | null} null = no menu at all
 */
function buildAppMenuTemplate({ platform, isDev }) {
  if (platform !== 'darwin') return null

  const devItems = isDev ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }] : []

  return [
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [...devItems, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]
}

/**
 * Installs the platform's menu. Call once, after `app.whenReady()`.
 *
 * @param {{ Menu: typeof Electron.Menu, platform: NodeJS.Platform, isDev: boolean }} options
 */
function installAppMenu({ Menu, platform, isDev }) {
  const template = buildAppMenuTemplate({ platform, isDev })
  Menu.setApplicationMenu(template ? Menu.buildFromTemplate(template) : null)
}

/**
 * Window options that keep a menu bar from ever being drawn in the window on
 * Windows/Linux, even if something later sets a menu (belt and braces with
 * `installAppMenu`). Spread into every BrowserWindow's options.
 */
const NO_MENU_BAR_WINDOW_OPTIONS = Object.freeze({ autoHideMenuBar: true })

/**
 * Hides the menu bar of an already-constructed window. `autoHideMenuBar` alone
 * still lets Alt reveal it; this removes it for good. No-op on macOS, where
 * there is no in-window menu bar.
 *
 * @param {{ setMenuBarVisibility?: (visible: boolean) => void }} win
 */
function hideWindowMenuBar(win) {
  if (typeof win?.setMenuBarVisibility === 'function') win.setMenuBarVisibility(false)
}

/**
 * Developer shortcuts that the default menu used to provide on Windows/Linux.
 * Only in dev builds -- a packaged app never opens DevTools from the keyboard.
 * (macOS gets them from its View menu, see buildAppMenuTemplate.)
 *
 * @param {{ type?: string, key?: string, control?: boolean, meta?: boolean, shift?: boolean, alt?: boolean }} input
 *   An Electron `before-input-event` input.
 * @param {{ platform: NodeJS.Platform, isDev: boolean }} options
 * @returns {'toggleDevTools' | 'reload' | null}
 */
function devShortcutAction(input, { platform, isDev }) {
  if (!isDev || platform === 'darwin') return null
  if (!input || input.type !== 'keyDown') return null
  const key = String(input.key ?? '').toLowerCase()
  if (key === 'f12') return 'toggleDevTools'
  if (input.control && input.shift && !input.alt && key === 'i') return 'toggleDevTools'
  if (input.control && !input.shift && !input.alt && key === 'r') return 'reload'
  return null
}

module.exports = {
  buildAppMenuTemplate,
  installAppMenu,
  hideWindowMenuBar,
  devShortcutAction,
  NO_MENU_BAR_WINDOW_OPTIONS,
}
