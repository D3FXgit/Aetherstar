import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsMicMonitorPanel } from '../SettingsMicMonitorPanel'
import { useMicMonitorStore } from '../../audio/micMonitorStore'

function stubApi(initial = { enabled: false, level: 0.5 }) {
  const stored = { ...initial }
  const api = {
    getMicMonitor: vi.fn(async () => ({ ...stored })),
    setMicMonitor: vi.fn(async (next: { enabled: boolean; level: number }) => {
      Object.assign(stored, { enabled: next.enabled === true, level: Math.min(1, Math.max(0, next.level)) })
      return { ...stored }
    }),
  }
  ;(window as unknown as { api: unknown }).api = { audio: api }
  return api
}

describe('SettingsMicMonitorPanel', () => {
  beforeEach(() => {
    useMicMonitorStore.setState({ enabled: false, level: 0.5, loaded: false })
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('loads the persisted setting on mount', async () => {
    stubApi({ enabled: true, level: 0.3 })
    render(<SettingsMicMonitorPanel />)

    await waitFor(() => expect(screen.getByRole('checkbox', { name: /hear the microphones/i })).toBeChecked())
    expect(screen.getByRole('slider', { name: /microphone level/i })).toHaveValue('0.3')
  })

  /**
   * The first-run guarantee, at the surface a user actually sees. Monitoring is
   * an amplifier aimed at the room; the pane must not open showing it on.
   */
  it('shows the switch off when nothing has been persisted', async () => {
    stubApi()
    render(<SettingsMicMonitorPanel />)

    await waitFor(() => expect(screen.getByRole('checkbox', { name: /hear the microphones/i })).toBeEnabled())
    expect(screen.getByRole('checkbox', { name: /hear the microphones/i })).not.toBeChecked()
  })

  it('turning it on writes through to the main process', async () => {
    const api = stubApi()
    render(<SettingsMicMonitorPanel />)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /hear the microphones/i })).toBeEnabled())

    fireEvent.click(screen.getByRole('checkbox', { name: /hear the microphones/i }))

    await waitFor(() => expect(api.setMicMonitor).toHaveBeenCalledWith({ enabled: true, level: 0.5 }))
  })

  it('moving the level writes through to the main process', async () => {
    const api = stubApi({ enabled: true, level: 0.5 })
    render(<SettingsMicMonitorPanel />)
    await waitFor(() => expect(screen.getByRole('slider', { name: /microphone level/i })).toBeEnabled())

    fireEvent.change(screen.getByRole('slider', { name: /microphone level/i }), { target: { value: '0.2' } })

    await waitFor(() => expect(api.setMicMonitor).toHaveBeenCalledWith({ enabled: true, level: 0.2 }))
  })

  /**
   * A level control that changes nothing audible is a control that lies. While
   * monitoring is off the slider is disabled rather than removed, so the pane
   * does not reflow when the switch is flipped.
   */
  it('disables the level while monitoring is off, and enables it once on', async () => {
    stubApi()
    render(<SettingsMicMonitorPanel />)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /hear the microphones/i })).toBeEnabled())

    expect(screen.getByRole('slider', { name: /microphone level/i })).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox', { name: /hear the microphones/i }))
    await waitFor(() => expect(screen.getByRole('slider', { name: /microphone level/i })).toBeEnabled())
  })

  /** Until load() answers, both controls would be showing a guess. */
  it('disables both controls until the persisted setting has arrived', () => {
    stubApi()
    render(<SettingsMicMonitorPanel />)

    expect(screen.getByRole('checkbox', { name: /hear the microphones/i })).toBeDisabled()
    expect(screen.getByRole('slider', { name: /microphone level/i })).toBeDisabled()
  })

  it('shows the level as a percentage', async () => {
    stubApi({ enabled: true, level: 0.35 })
    render(<SettingsMicMonitorPanel />)

    await waitFor(() => expect(screen.getByText('35%')).toBeInTheDocument())
  })

  /**
   * The pane has to say the honest thing about feedback. The native layer caps
   * the gain and mutes a runaway input, but none of that is feedback
   * cancellation, and the user is the one who can move the microphone.
   */
  it('tells the user what to do about whistling', async () => {
    stubApi({ enabled: true, level: 0.5 })
    render(<SettingsMicMonitorPanel />)

    await waitFor(() => expect(screen.getByText(/whistling/i)).toBeInTheDocument())
  })

  it('renders without a window.api rather than throwing inside Settings', async () => {
    delete (window as unknown as { api?: unknown }).api
    expect(() => render(<SettingsMicMonitorPanel />)).not.toThrow()
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /hear the microphones/i })).toBeEnabled())
  })
})
