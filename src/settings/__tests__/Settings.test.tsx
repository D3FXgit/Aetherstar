import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Settings } from '../Settings'
import { BackAuthorityProvider } from '../../scenes/SceneHeader'
import { useAppPreferencesStore } from '../appPreferencesStore'
import { useMicSlotStore } from '../../multiplayer/store'
import { usePitchStore } from '../../audio/pitchStore'
import { toMicSlotArray } from '../../multiplayer/types'
import * as micApi from '../../multiplayer/api'

vi.mock('../../multiplayer/api')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(micApi.listMicSlots).mockResolvedValue([])
  usePitchStore.setState({
    devices: [],
    activeCaptures: {},
    subscribeToEvents: () => () => {},
    refreshDevices: vi.fn().mockResolvedValue(undefined),
  })
  useMicSlotStore.setState({
    slots: toMicSlotArray([]),
    bindings: [],
    runningCaptureKeys: [],
    captureHolders: [],
  })
  useAppPreferencesStore.setState({ settingsTabId: null })
  localStorage.clear()
})

afterEach(() => {
  delete window.api
})

describe('Settings', () => {
  // Three named panes. Anything else on this rail is a regression.
  it('offers exactly three tabs: Audio & Mics, Song Folders, Graphics', () => {
    render(<Settings />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Audio & Mics', 'Song Folders', 'Graphics'])
  })

  it('opens on Audio & Mics with the eight-mic matrix already on screen', () => {
    render(<Settings />)

    expect(screen.getByRole('tab', { name: 'Audio & Mics' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('settings-mics-panel')).toBeInTheDocument()
    expect(screen.getByTestId('mic-matrix')).toBeInTheDocument()
  })

  /** Ordinary tab state: one pane mounted, and the marker set by the click. */
  describe('switching panes', () => {
    it('mounts only the selected pane', () => {
      render(<Settings />)

      fireEvent.click(screen.getByRole('tab', { name: 'Song Folders' }))

      expect(screen.getByTestId('settings-library-panel')).toBeInTheDocument()
      expect(screen.queryByTestId('settings-mics-panel')).toBeNull()
      expect(screen.queryByTestId('settings-display-panel')).toBeNull()
    })

    it('moves the selected marker to the clicked tab and nowhere else', () => {
      render(<Settings />)

      fireEvent.click(screen.getByRole('tab', { name: 'Graphics' }))

      expect(screen.getByRole('tab', { name: 'Graphics' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tab', { name: 'Audio & Mics' })).toHaveAttribute('aria-selected', 'false')
    })

    it('shows the graphics settings under Graphics', () => {
      render(<Settings />)

      fireEvent.click(screen.getByRole('tab', { name: 'Graphics' }))

      expect(screen.getByTestId('settings-display-panel')).toBeInTheDocument()
      expect(screen.getByTestId('settings-fx-panel')).toBeInTheDocument()
      expect(screen.queryByTestId('settings-perf-overlay-toggle')).not.toBeInTheDocument()
    })

    it('names each pane by the tab that selects it', () => {
      render(<Settings />)

      expect(screen.getByRole('tabpanel', { name: 'Audio & Mics' })).toBeInTheDocument()
    })
  })

  // Leaving eight native audio streams open after the user walks away from
  // Settings is exactly what the capture-claim contract exists to prevent.
  it('drops its live-mic claim when the pane is left', async () => {
    render(<Settings />)
    await waitFor(() => expect(useMicSlotStore.getState().captureHolders).toContain('mic-matrix'))

    fireEvent.click(screen.getByRole('tab', { name: 'Song Folders' }))

    await waitFor(() => expect(useMicSlotStore.getState().captureHolders).not.toContain('mic-matrix'))
  })

  describe('restoring the last pane', () => {
    it('reopens on the pane last used', () => {
      useAppPreferencesStore.setState({ settingsTabId: 'settings-tab-graphics' })

      render(<Settings />)

      expect(screen.getByRole('tab', { name: 'Graphics' })).toHaveAttribute('aria-selected', 'true')
    })

    it('remembers the pane the user switches to', () => {
      render(<Settings />)

      fireEvent.click(screen.getByRole('tab', { name: 'Song Folders' }))

      expect(useAppPreferencesStore.getState().settingsTabId).toBe('settings-tab-songs')
    })

    // A stored id from an older build must not leave the scene blank.
    it('falls back to the first pane for a tab id that no longer exists', () => {
      useAppPreferencesStore.setState({ settingsTabId: 'settings-group-about' })

      render(<Settings />)

      expect(screen.getByRole('tab', { name: 'Audio & Mics' })).toHaveAttribute('aria-selected', 'true')
    })
  })

  /** These rows are the only routes from Settings to those scenes; losing one strands it. */
  it('keeps a way through to Mic Check, Calibration and the Players roster', () => {
    render(<Settings />)

    expect(screen.getByRole('button', { name: 'Open mic check' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Calibration' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manage players' })).toBeInTheDocument()
  })

  /**
   * Back lives in this screen's own rail. sceneChrome.ts lists 'settings' as
   * self-headed, so the shell draws nothing over it and these assertions are
   * what keep Settings from having no way out.
   */
  describe('the way back out', () => {
    it('draws the shell Back control as the leading item of its own rail', () => {
      const onBack = vi.fn()
      render(
        <BackAuthorityProvider onBack={onBack}>
          <Settings />
        </BackAuthorityProvider>,
      )

      const back = screen.getByRole('button', { name: 'Back' })
      const rail = back.closest('aside')

      // In the rail, above the title and the tabs: one column, read top to bottom.
      expect(rail).not.toBeNull()
      expect(rail).toHaveTextContent('Settings')
      expect(rail).toContainElement(screen.getByTestId('settings-nav'))
      expect(back.compareDocumentPosition(screen.getByRole('heading', { name: 'Settings' })))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING)

      fireEvent.click(back)

      expect(onBack).toHaveBeenCalledTimes(1)
    })

    // The shell reserves no band above Settings, so subtracting one here would
    // leave 5rem of the window unused.
    it('takes the whole window height rather than the viewport minus a bar', () => {
      render(<Settings />)

      const scene = screen.getByTestId('settings-scene')
      expect(scene.className).toContain('h-screen')
      expect(scene.className).not.toContain('5rem')
    })
  })

  // A version string is not a setting, and the perf overlay is a developer tool.
  it('does not offer a version readout or perf-overlay toggle on the initial pane', () => {
    render(<Settings />)

    expect(screen.queryByLabelText(/perf overlay/i)).toBeNull()
    expect(screen.queryByText(/^AetherStar/)).toBeNull()
  })
})
