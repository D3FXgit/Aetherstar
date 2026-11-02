import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SettingsDisplayPanel } from '../SettingsDisplayPanel'
import { useAppPreferencesStore } from '../appPreferencesStore'

const DISPLAYS = [
  { id: 1, label: 'Built-in Display', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, isPrimary: true },
  { id: 2, label: 'External Monitor', bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, isPrimary: false },
]

afterEach(() => {
  delete window.api
})

describe('SettingsDisplayPanel', () => {
  beforeEach(() => {
    useAppPreferencesStore.setState({ perfOverlayVisible: false })
    // @ts-expect-error -- only audience.listDisplays/setDisplay/setEnabled matter for this test
    window.api = {
      audience: {
        listDisplays: vi.fn().mockResolvedValue({ displays: DISPLAYS, selectedDisplayId: 2, enabled: false }),
        setDisplay: vi.fn().mockResolvedValue(undefined),
        setEnabled: vi.fn().mockResolvedValue(undefined),
      },
    } as Window['api']
  })

  it('lists the displays returned by window.api.audience.listDisplays on mount', async () => {
    render(<SettingsDisplayPanel />)
    await waitFor(() => expect(screen.getByText('Built-in Display')).toBeInTheDocument())
    expect(screen.getByText('External Monitor')).toBeInTheDocument()
  })

  it('indicates the currently-selected display', async () => {
    render(<SettingsDisplayPanel />)
    await waitFor(() => expect(screen.getByTestId('settings-display-selected-2')).toBeInTheDocument())
  })

  it('selecting a different display calls window.api.audience.setDisplay', async () => {
    render(<SettingsDisplayPanel />)
    await waitFor(() => expect(screen.getByTestId('settings-display-select-1')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('settings-display-select-1'))
    expect(window.api!.audience.setDisplay).toHaveBeenCalledWith(1)
  })

  it('reflects the enabled flag returned by listDisplays as an unchecked toggle by default', async () => {
    render(<SettingsDisplayPanel />)
    await waitFor(() => expect(screen.getByTestId('settings-display-enabled-toggle')).toBeInTheDocument())
    expect(screen.getByTestId('settings-display-enabled-toggle')).not.toBeChecked()
  })

  it('reflects an already-enabled second screen as a checked toggle', async () => {
    // @ts-expect-error -- same partial mock shape as above
    window.api.audience.listDisplays = vi.fn().mockResolvedValue({ displays: DISPLAYS, selectedDisplayId: 2, enabled: true })
    render(<SettingsDisplayPanel />)
    await waitFor(() => expect(screen.getByTestId('settings-display-enabled-toggle')).toBeChecked())
  })

  it('toggling the checkbox on calls window.api.audience.setEnabled(true)', async () => {
    render(<SettingsDisplayPanel />)
    await waitFor(() => expect(screen.getByTestId('settings-display-enabled-toggle')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('settings-display-enabled-toggle'))
    expect(window.api!.audience.setEnabled).toHaveBeenCalledWith(true)
  })

  it('toggling the checkbox off calls window.api.audience.setEnabled(false)', async () => {
    // @ts-expect-error -- same partial mock shape as above
    window.api.audience.listDisplays = vi.fn().mockResolvedValue({ displays: DISPLAYS, selectedDisplayId: 2, enabled: true })
    render(<SettingsDisplayPanel />)
    await waitFor(() => expect(screen.getByTestId('settings-display-enabled-toggle')).toBeChecked())

    fireEvent.click(screen.getByTestId('settings-display-enabled-toggle'))
    expect(window.api!.audience.setEnabled).toHaveBeenCalledWith(false)
  })

  // The overlay is a developer diagnostic (DEV-only in App.tsx); players
  // do not get a switch for it.
  it('does not offer a performance overlay switch', async () => {
    render(<SettingsDisplayPanel />)
    await waitFor(() => expect(screen.getByTestId('settings-display-enabled-toggle')).toBeInTheDocument())
    expect(screen.queryByTestId('settings-perf-overlay-toggle')).not.toBeInTheDocument()
    expect(screen.queryByText(/performance overlay/i)).not.toBeInTheDocument()
  })})
