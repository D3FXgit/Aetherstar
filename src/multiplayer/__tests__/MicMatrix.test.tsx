import { describe, expect, it, beforeEach, vi } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MicMatrix } from '../MicMatrix'
import { useMicSlotStore } from '../store'
import { usePitchStore } from '../../audio/pitchStore'
import { useCalibrationStore } from '../../calibration/calibrationStore'
import { useSceneStore } from '../../scenes/sceneStore'
import { toMicSlotArray } from '../types'
import * as api from '../api'
import * as slots from '../slots'

vi.mock('../api')
// Spied so a render of the matrix is countable: MicMatrix calls
// conflictsByMicNumber exactly once per render of its own body.
vi.mock('../slots', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../slots')>()
  return { ...actual, conflictsByMicNumber: vi.fn(actual.conflictsByMicNumber) }
})

const MONO_MIC = { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }
const STEREO = { id: 'mic-2', name: 'Podcast Pair', channelCount: 2, sampleRate: 48000 }
const INTERFACE = { id: 'iface', name: 'Scarlett 18i8', channelCount: 4, sampleRate: 48000 }

describe('MicMatrix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listMicSlots).mockResolvedValue([])
    vi.mocked(api.saveMicSlot).mockResolvedValue(undefined)
    vi.mocked(api.clearMicSlot).mockResolvedValue(undefined)
    usePitchStore.setState({
      devices: [MONO_MIC, STEREO, INTERFACE],
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
    useCalibrationStore.setState({ target: null })
    useSceneStore.setState({ current: 'settings', history: [] })
  })

  /**
   * These rows are the *rig*, not the roster, so a party can be wired up
   * before the guests arrive.
   */
  it('always shows eight numbered mics, with no roster involved', () => {
    render(<MicMatrix />)

    for (let micNumber = 1; micNumber <= 8; micNumber++) {
      expect(screen.getByTestId(`mic-slot-row-${micNumber}`)).toBeInTheDocument()
    }
    expect(screen.getByText('Mic 1')).toBeInTheDocument()
    expect(screen.getByText('Mic 8')).toBeInTheDocument()
  })

  it('gives every mic its own device select, channel select and live meter', () => {
    render(<MicMatrix />)

    expect(screen.getAllByRole('combobox', { name: /device$/ })).toHaveLength(8)
    expect(screen.getAllByRole('combobox', { name: /channel$/ })).toHaveLength(8)
    expect(screen.getAllByRole('meter')).toHaveLength(8)
  })

  it('lists every enumerated device as an option, plus an explicit "No input"', () => {
    render(<MicMatrix />)

    const select = screen.getByRole('combobox', { name: 'Mic 1 device' })
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'No input',
      'USB Mic',
      'Podcast Pair',
      'Scarlett 18i8',
    ])
  })

  it('persists a chosen device against the mic number', async () => {
    render(<MicMatrix />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Mic 3 device' }), { target: { value: 'mic-1' } })

    await waitFor(() =>
      expect(api.saveMicSlot).toHaveBeenCalledWith({ slotNumber: 3, deviceId: 'mic-1', channelIndex: 0 }),
    )
  })

  it('clears the mic when the device is set back to "No input"', async () => {
    vi.mocked(api.listMicSlots).mockResolvedValue([{ slotNumber: 2, deviceId: 'mic-1', channelIndex: 0 }])
    render(<MicMatrix />)
    await waitFor(() => expect(useMicSlotStore.getState().bindings).toHaveLength(1))

    fireEvent.change(screen.getByRole('combobox', { name: 'Mic 2 device' }), { target: { value: '' } })

    await waitFor(() => expect(api.clearMicSlot).toHaveBeenCalledWith(2))
  })

  describe('the channel control names what the hardware calls it', () => {
    it('offers Left and Right for a two-channel device', async () => {
      vi.mocked(api.listMicSlots).mockResolvedValue([{ slotNumber: 1, deviceId: STEREO.id, channelIndex: 0 }])
      render(<MicMatrix />)

      const select = await screen.findByRole('combobox', { name: 'Mic 1 channel' })
      await waitFor(() =>
        expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Left', 'Right']),
      )
    })

    it('offers In 1..In N for a multi-channel interface', async () => {
      vi.mocked(api.listMicSlots).mockResolvedValue([{ slotNumber: 1, deviceId: INTERFACE.id, channelIndex: 0 }])
      render(<MicMatrix />)

      const select = await screen.findByRole('combobox', { name: 'Mic 1 channel' })
      await waitFor(() =>
        expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
          'In 1',
          'In 2',
          'In 3',
          'In 4',
        ]),
      )
    })

    // Rendered on every row even when there is nothing to choose, so the column
    // never collapses and the eight rows stay aligned.
    it('is present but disabled on a mono device and on an unconfigured mic', async () => {
      vi.mocked(api.listMicSlots).mockResolvedValue([{ slotNumber: 1, deviceId: MONO_MIC.id, channelIndex: 0 }])
      render(<MicMatrix />)

      await waitFor(() => expect(screen.getByRole('combobox', { name: 'Mic 1 channel' })).toBeDisabled())
      expect(screen.getByRole('combobox', { name: 'Mic 8 channel' })).toBeDisabled()
    })

    it('persists a channel change against the mic number', async () => {
      vi.mocked(api.listMicSlots).mockResolvedValue([{ slotNumber: 1, deviceId: INTERFACE.id, channelIndex: 0 }])
      render(<MicMatrix />)
      const select = await screen.findByRole('combobox', { name: 'Mic 1 channel' })
      await waitFor(() => expect(select).not.toBeDisabled())

      fireEvent.change(select, { target: { value: '2' } })

      await waitFor(() =>
        expect(api.saveMicSlot).toHaveBeenCalledWith({ slotNumber: 1, deviceId: INTERFACE.id, channelIndex: 2 }),
      )
    })
  })

  // Two mics on one physical input hear each other. A tinted row would leave a
  // colour-blind user with no way to know, so it is said in words and it names
  // the other mic.
  it('says in words which other mic shares an input', async () => {
    vi.mocked(api.listMicSlots).mockResolvedValue([
      { slotNumber: 1, deviceId: MONO_MIC.id, channelIndex: 0 },
      { slotNumber: 4, deviceId: MONO_MIC.id, channelIndex: 0 },
    ])
    render(<MicMatrix />)

    expect(await screen.findByTestId('mic-conflict-1')).toHaveTextContent('Shares this input with Mic 4')
    expect(screen.getByTestId('mic-conflict-4')).toHaveTextContent('Shares this input with Mic 1')
  })

  it('does not call two channels of one interface a conflict', async () => {
    vi.mocked(api.listMicSlots).mockResolvedValue([
      { slotNumber: 1, deviceId: INTERFACE.id, channelIndex: 0 },
      { slotNumber: 2, deviceId: INTERFACE.id, channelIndex: 1 },
    ])
    render(<MicMatrix />)
    await waitFor(() => expect(useMicSlotStore.getState().bindings).toHaveLength(2))

    expect(screen.queryByTestId('mic-conflict-1')).toBeNull()
  })

  describe('calibration', () => {
    it('is offered per mic and targets that mic\'s physical input', async () => {
      vi.mocked(api.listMicSlots).mockResolvedValue([{ slotNumber: 2, deviceId: INTERFACE.id, channelIndex: 1 }])
      render(<MicMatrix />)
      const button = await screen.findByRole('button', { name: 'Calibrate Mic 2' })
      await waitFor(() => expect(button).not.toBeDisabled())

      fireEvent.click(button)

      expect(useCalibrationStore.getState().target?.deviceId).toBe('iface#1')
      expect(useSceneStore.getState().current).toBe('calibration')
    })

    it('is unavailable for a mic with no input to calibrate', () => {
      render(<MicMatrix />)
      expect(screen.getByRole('button', { name: 'Calibrate Mic 5' })).toBeDisabled()
    })
  })

  it('says so plainly when no audio hardware is present at all', () => {
    usePitchStore.setState({ devices: [] })
    render(<MicMatrix />)

    expect(screen.getByTestId('mic-matrix-no-devices')).toBeInTheDocument()
  })

  it('refreshes the device list on mount so newly plugged inputs appear', async () => {
    const refreshDevices = vi.fn().mockResolvedValue(undefined)
    usePitchStore.setState({ refreshDevices })

    render(<MicMatrix />)

    await waitFor(() => expect(refreshDevices).toHaveBeenCalled())
  })

  /**
   * Meters need running captures, and captures cost a native thread each. The
   * claim is scoped to the matrix being on screen so leaving Settings does not
   * leave eight streams open for the rest of the session.
   */
  describe('capture lifetime', () => {
    it('claims captures while mounted and drops the claim on unmount', async () => {
      const { unmount } = render(<MicMatrix />)

      await waitFor(() => expect(useMicSlotStore.getState().captureHolders).toContain('mic-matrix'))

      unmount()
      await waitFor(() => expect(useMicSlotStore.getState().captureHolders).not.toContain('mic-matrix'))
    })
  })

  /**
   * Eight live meters must not re-render the whole matrix. `useCaptureLevel`
   * lives in SlotLevelMeter, one component below this one -- hoisting it into
   * the matrix is the regression this guards.
   */
  it('does not re-render the matrix when an input level changes', async () => {
    vi.mocked(api.listMicSlots).mockResolvedValue([{ slotNumber: 1, deviceId: MONO_MIC.id, channelIndex: 0 }])
    render(<MicMatrix />)
    await waitFor(() => expect(useMicSlotStore.getState().bindings).toHaveLength(1))

    const rendersBefore = vi.mocked(slots.conflictsByMicNumber).mock.calls.length

    act(() => {
      usePitchStore.setState({
        activeCaptures: {
          [MONO_MIC.id]: { latest: null, samples: [], latencyMs: 5, level: 0.4, levelAt: Date.now() },
        },
      })
    })

    expect(vi.mocked(slots.conflictsByMicNumber).mock.calls.length).toBe(rendersBefore)
  })
})
