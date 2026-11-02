import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { HardwareSetup } from '../HardwareSetup'
import { usePitchStore } from '../../audio/pitchStore'
import { useMicSlotStore } from '../store'
import { useSceneStore } from '../../scenes/sceneStore'
import { toMicSlotArray } from '../types'
import * as api from '../api'
import { t } from '../../i18n'

vi.mock('../api')

describe('HardwareSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePitchStore.setState({
      devices: [{ id: 'dev-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }],
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
    useSceneStore.setState({ current: 'hardware-setup', history: [] })
    vi.mocked(api.listMicSlots).mockResolvedValue([])
  })

  // The screen is the rig, not the party: microphones can be set up before
  // anyone is in the roster.
  it('shows all eight mics whether or not anyone is in the roster', () => {
    render(<HardwareSetup />)

    expect(screen.getByTestId('mic-matrix')).toBeInTheDocument()
    expect(screen.getByTestId('mic-slot-row-1')).toBeInTheDocument()
    expect(screen.getByTestId('mic-slot-row-8')).toBeInTheDocument()
  })

  it('gives every mic its own live level meter', () => {
    render(<HardwareSetup />)

    expect(screen.getAllByRole('meter')).toHaveLength(8)
  })

  // Saying so here is what stops someone reading the rows as a seating plan.
  it('says plainly that the numbers are inputs, claimed later by singers', () => {
    render(<HardwareSetup />)

    expect(screen.getByText(/inputs, not players/i)).toBeInTheDocument()
  })

  // Back is the leading item of this screen's own title row; the shell draws
  // no bar above it (src/scenes/sceneChrome.ts).
  it('leads its own header row with Back, before the title', () => {
    render(<HardwareSetup />)

    const row = screen.getByTestId('scene-title-bar')
    const back = screen.getByRole('button', { name: 'Back' })
    const heading = screen.getByRole('heading', { level: 1, name: t('mic.setup.title') })

    expect(row).toContainElement(back)
    expect(row).toContainElement(heading)
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('refreshes the device list on mount so newly plugged inputs appear', async () => {
    const refreshDevices = vi.fn().mockResolvedValue(undefined)
    usePitchStore.setState({ refreshDevices })

    render(<HardwareSetup />)

    await waitFor(() => expect(refreshDevices).toHaveBeenCalled())
  })
})
