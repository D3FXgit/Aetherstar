import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsWindowPanel } from '../SettingsWindowPanel'
import type { WindowDisplayMode } from '../types'

let displayModeCallback: ((mode: WindowDisplayMode) => void) | undefined
let setWindowed: ReturnType<typeof vi.fn>

function installApi(mode: WindowDisplayMode) {
  displayModeCallback = undefined
  setWindowed = vi.fn(async (windowed: boolean) => ({ windowed, platform: mode.platform }))
  // @ts-expect-error -- only the window namespace matters for this panel
  window.api = {
    window: {
      getDisplayMode: vi.fn().mockResolvedValue(mode),
      setWindowed,
      onDisplayModeChanged: vi.fn((cb: (next: WindowDisplayMode) => void) => {
        displayModeCallback = cb
        return () => {}
      }),
    },
  } as Window['api']
}

beforeEach(() => installApi({ windowed: false, platform: 'win32' }))
afterEach(() => {
  delete window.api
})

describe('SettingsWindowPanel', () => {
  it('shows the switch off while the app is full screen -- the startup default', async () => {
    render(<SettingsWindowPanel />)
    const toggle = await screen.findByTestId('settings-windowed-toggle')
    await waitFor(() => expect(toggle).not.toBeDisabled())
    expect(toggle).not.toBeChecked()
  })

  it('asks main to leave full screen when "Windowed mode" is turned on', async () => {
    render(<SettingsWindowPanel />)
    const toggle = await screen.findByTestId('settings-windowed-toggle')
    await waitFor(() => expect(toggle).not.toBeDisabled())

    await userEvent.click(toggle)

    expect(setWindowed).toHaveBeenCalledWith(true)
    await waitFor(() => expect(toggle).toBeChecked())
  })

  it('follows the window when the OS changes it -- the macOS green button, not this switch', async () => {
    installApi({ windowed: false, platform: 'darwin' })
    render(<SettingsWindowPanel />)
    const toggle = await screen.findByTestId('settings-windowed-toggle')
    await waitFor(() => expect(toggle).not.toBeDisabled())
    expect(toggle).not.toBeChecked()

    act(() => displayModeCallback?.({ windowed: true, platform: 'darwin' }))

    expect(toggle).toBeChecked()
    expect(setWindowed).not.toHaveBeenCalled()
  })

  it('names the macOS escape hatch on macOS and only the toggle elsewhere', async () => {
    installApi({ windowed: false, platform: 'darwin' })
    const { unmount } = render(<SettingsWindowPanel />)
    expect(await screen.findByText(/green button/i)).toBeInTheDocument()
    unmount()

    installApi({ windowed: false, platform: 'win32' })
    render(<SettingsWindowPanel />)
    await waitFor(() => expect(screen.getByTestId('settings-windowed-toggle')).not.toBeDisabled())
    expect(screen.queryByText(/green button/i)).not.toBeInTheDocument()
    expect(screen.getByText(/instead of full screen/i)).toBeInTheDocument()
  })
})
