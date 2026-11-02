// @vitest-environment node
// describe/expect/it/beforeEach/vi come from Vitest's globals (vite.config.ts test.globals: true)

// Same require-cache-injection pattern as ipc-registry.test.cjs/protocols.test.cjs --
// requiring the real 'electron' package outside the Electron binary returns a path
// string, not the API surface.
const electronModulePath = require.resolve('electron')

const FULLSCREEN_DISPLAY = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }

describe('createAudienceWindow', () => {
  let constructorArgs
  let screenListeners

  beforeEach(() => {
    constructorArgs = null
    screenListeners = {}

    class FakeBrowserWindow {
      constructor(options) {
        constructorArgs = options
        this.menuBarVisible = true
      }

      setMenuBarVisibility(visible) {
        this.menuBarVisible = visible
      }
    }

    require.cache[electronModulePath] = {
      id: electronModulePath,
      filename: electronModulePath,
      loaded: true,
      exports: {
        BrowserWindow: FakeBrowserWindow,
        screen: {
          on: (event, handler) => {
            screenListeners[event] = handler
          },
          getAllDisplays: () => [FULLSCREEN_DISPLAY],
        },
      },
    }

    delete require.cache[require.resolve('../audience-window.cjs')]
  })

  it('creates a borderless fullscreen window positioned on the target display when a second monitor exists', () => {
    const { createAudienceWindow } = require('../audience-window.cjs')
    const loadFn = () => {}

    createAudienceWindow({ display: FULLSCREEN_DISPLAY, isSingleDisplayFallback: false, preloadPath: '/preload.cjs', loadFn })

    expect(constructorArgs.x).toBe(1920)
    expect(constructorArgs.y).toBe(0)
    expect(constructorArgs.width).toBe(1920)
    expect(constructorArgs.height).toBe(1080)
    expect(constructorArgs.frame).toBe(false)
    expect(constructorArgs.fullscreen).toBe(true)
    // A new BrowserWindow steals focus by default; the read-only scoreboard
    // must not take the gesture meant to resume the main window's audio.
    expect(constructorArgs.focusable).toBe(false)
    expect(constructorArgs.webPreferences).toEqual({
      preload: '/preload.cjs',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Occluded/unfocused windows must keep animating at full rate.
      backgroundThrottling: false,
    })
  })

  it('creates a normal framed, non-fullscreen window in single-display fallback mode', () => {
    const { createAudienceWindow } = require('../audience-window.cjs')

    createAudienceWindow({ display: FULLSCREEN_DISPLAY, isSingleDisplayFallback: true, preloadPath: '/preload.cjs', loadFn: () => {} })

    expect(constructorArgs.frame).toBe(true)
    expect(constructorArgs.fullscreen).toBe(false)
    expect(constructorArgs.resizable).toBe(true)
    expect(constructorArgs.focusable).toBe(false)
  })

  it('never shows a desktop menu bar, even in the framed single-display fallback', () => {
    const { createAudienceWindow } = require('../audience-window.cjs')

    const win = createAudienceWindow({ display: FULLSCREEN_DISPLAY, isSingleDisplayFallback: true, preloadPath: '/preload.cjs', loadFn: () => {} })

    expect(constructorArgs.autoHideMenuBar).toBe(true)
    expect(win.menuBarVisible).toBe(false)
  })

  it('calls loadFn with the created window and the audience-window URL query', () => {
    const { createAudienceWindow } = require('../audience-window.cjs')
    const loadFn = vi.fn()

    const win = createAudienceWindow({ display: FULLSCREEN_DISPLAY, isSingleDisplayFallback: false, preloadPath: '/preload.cjs', loadFn })

    expect(loadFn).toHaveBeenCalledWith(win, 'window=audience')
  })
})

describe('registerDisplayHotplugHandling', () => {
  let screenListeners
  let displays

  beforeEach(() => {
    screenListeners = {}
    displays = [FULLSCREEN_DISPLAY]

    require.cache[electronModulePath] = {
      id: electronModulePath,
      filename: electronModulePath,
      loaded: true,
      exports: {
        BrowserWindow: class {},
        screen: {
          on: (event, handler) => {
            screenListeners[event] = handler
          },
          getAllDisplays: () => displays,
        },
      },
    }

    delete require.cache[require.resolve('../audience-window.cjs')]
  })

  it('registers display-added and display-removed listeners', () => {
    const { registerDisplayHotplugHandling } = require('../audience-window.cjs')
    registerDisplayHotplugHandling(() => {})

    expect(typeof screenListeners['display-added']).toBe('function')
    expect(typeof screenListeners['display-removed']).toBe('function')
  })

  it('calls onDisplaysChanged with the updated display list, without throwing, when a display is removed', () => {
    const { registerDisplayHotplugHandling } = require('../audience-window.cjs')
    const onDisplaysChanged = vi.fn()
    registerDisplayHotplugHandling(onDisplaysChanged)

    displays = [] // the target display was just unplugged
    expect(() => screenListeners['display-removed']()).not.toThrow()
    expect(onDisplaysChanged).toHaveBeenCalledWith([])
  })
})

describe('createWindowPresence', () => {
  beforeEach(() => {
    require.cache[electronModulePath] = {
      id: electronModulePath,
      filename: electronModulePath,
      loaded: true,
      exports: { BrowserWindow: class {}, screen: { on: () => {}, getAllDisplays: () => [] } },
    }
    delete require.cache[require.resolve('../audience-window.cjs')]
  })

  it('starts closed and reports only real open/close transitions', () => {
    const { createWindowPresence } = require('../audience-window.cjs')
    const onChange = vi.fn()
    const presence = createWindowPresence(onChange)

    expect(presence.isOpen()).toBe(false)
    presence.set(true)
    // Re-targeting to another display creates a new window while one is open:
    // still open, nothing to report.
    presence.set(true)
    presence.set(false)
    presence.set(false)

    expect(onChange.mock.calls).toEqual([[true], [false]])
    expect(presence.isOpen()).toBe(false)
  })
})
