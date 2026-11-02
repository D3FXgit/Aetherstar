// @vitest-environment node
// describe/expect/it/vi come from Vitest's globals (vite.config.ts test.globals: true)
const {
  buildAppMenuTemplate,
  installAppMenu,
  hideWindowMenuBar,
  devShortcutAction,
  NO_MENU_BAR_WINDOW_OPTIONS,
} = require('../app-menu.cjs')

function fakeMenu() {
  return {
    setApplicationMenu: vi.fn(),
    buildFromTemplate: vi.fn((template) => ({ built: template })),
  }
}

describe('buildAppMenuTemplate', () => {
  it.each(['win32', 'linux'])('has no menu at all on %s (no "File Edit View Window Help" bar in windowed mode)', (platform) => {
    expect(buildAppMenuTemplate({ platform, isDev: false })).toBeNull()
    expect(buildAppMenuTemplate({ platform, isDev: true })).toBeNull()
  })

  it('keeps a minimal macOS menu so Cmd+Q/C/V/X/A/Z and full screen still work', () => {
    const template = buildAppMenuTemplate({ platform: 'darwin', isDev: false })
    const roles = template.map((item) => item.role ?? item.label)
    expect(roles).toEqual(['appMenu', 'editMenu', 'View', 'windowMenu'])
    const viewRoles = template[2].submenu.map((item) => item.role)
    expect(viewRoles).toEqual(['togglefullscreen'])
  })

  it('adds reload/devtools to the macOS View menu only in dev', () => {
    const template = buildAppMenuTemplate({ platform: 'darwin', isDev: true })
    const viewRoles = template[2].submenu.map((item) => item.role ?? item.type)
    expect(viewRoles).toEqual(['reload', 'forceReload', 'toggleDevTools', 'separator', 'togglefullscreen'])
  })
})

describe('installAppMenu', () => {
  it.each(['win32', 'linux'])('removes the application menu on %s', (platform) => {
    const Menu = fakeMenu()
    installAppMenu({ Menu, platform, isDev: false })
    expect(Menu.setApplicationMenu).toHaveBeenCalledWith(null)
    expect(Menu.buildFromTemplate).not.toHaveBeenCalled()
  })

  it('installs the minimal menu on macOS', () => {
    const Menu = fakeMenu()
    installAppMenu({ Menu, platform: 'darwin', isDev: false })
    expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1)
    expect(Menu.setApplicationMenu).toHaveBeenCalledWith({ built: buildAppMenuTemplate({ platform: 'darwin', isDev: false }) })
  })
})

describe('window menu bar', () => {
  it('auto-hides the menu bar via the window options', () => {
    expect(NO_MENU_BAR_WINDOW_OPTIONS).toEqual({ autoHideMenuBar: true })
  })

  it('hides an existing window menu bar and tolerates windows without the API', () => {
    const win = { setMenuBarVisibility: vi.fn() }
    hideWindowMenuBar(win)
    expect(win.setMenuBarVisibility).toHaveBeenCalledWith(false)
    expect(() => hideWindowMenuBar({})).not.toThrow()
  })
})

describe('devShortcutAction', () => {
  const dev = { platform: 'win32', isDev: true }

  it('maps F12 and Ctrl+Shift+I to DevTools and Ctrl+R to reload in dev', () => {
    expect(devShortcutAction({ type: 'keyDown', key: 'F12' }, dev)).toBe('toggleDevTools')
    expect(devShortcutAction({ type: 'keyDown', key: 'I', control: true, shift: true }, dev)).toBe('toggleDevTools')
    expect(devShortcutAction({ type: 'keyDown', key: 'r', control: true }, dev)).toBe('reload')
  })

  it('leaves clipboard/editing shortcuts and plain keys to the page', () => {
    for (const key of ['c', 'v', 'x', 'a', 'z']) {
      expect(devShortcutAction({ type: 'keyDown', key, control: true }, dev)).toBeNull()
    }
    expect(devShortcutAction({ type: 'keyDown', key: 'i' }, dev)).toBeNull()
    expect(devShortcutAction({ type: 'keyUp', key: 'F12' }, dev)).toBeNull()
    // Ctrl+Shift+D is the renderer's Dev Lab hotkey.
    expect(devShortcutAction({ type: 'keyDown', key: 'D', control: true, shift: true }, dev)).toBeNull()
  })

  it('does nothing in production or on macOS (where the View menu provides them)', () => {
    expect(devShortcutAction({ type: 'keyDown', key: 'F12' }, { platform: 'win32', isDev: false })).toBeNull()
    expect(devShortcutAction({ type: 'keyDown', key: 'F12' }, { platform: 'darwin', isDev: true })).toBeNull()
  })
})

describe('main.cjs wiring (static check)', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const mainSource = fs.readFileSync(path.join(__dirname, '..', '..', 'main.cjs'), 'utf-8')

  it('installs the app menu once the app is ready, before the first window', () => {
    const ready = mainSource.indexOf('app.whenReady()')
    const install = mainSource.indexOf('installAppMenu({ Menu, platform: process.platform, isDev })')
    const firstWindow = mainSource.indexOf('createWindow()\n', ready)
    expect(ready).toBeGreaterThan(-1)
    expect(install).toBeGreaterThan(ready)
    expect(install).toBeLessThan(firstWindow)
  })

  it('creates the main window without a menu bar', () => {
    expect(mainSource).toContain('...NO_MENU_BAR_WINDOW_OPTIONS')
    expect(mainSource).toContain('hideWindowMenuBar(mainWindow)')
  })
})
