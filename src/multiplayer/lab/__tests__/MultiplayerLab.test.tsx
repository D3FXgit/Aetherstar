import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { MultiplayerLab } from '../MultiplayerLab'
import { usePlayersStore } from '../../../players/store'
import { usePitchStore } from '../../../audio/pitchStore'
import { useMicSlotStore } from '../../store'
import { toMicSlotArray } from '../../types'

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures/sample-song/notes.txt',
)
const raw = readFileSync(FIXTURE_PATH, 'utf-8')
const ABSOLUTE_FIXTURE_PATH = '/abs/fixtures/sample-song/notes.txt'

describe('MultiplayerLab', () => {
  beforeEach(() => {
    usePlayersStore.setState({ players: [{ id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' }] })
    usePitchStore.setState({ devices: [], permissionStatus: 'granted', activeCaptures: {} })
    useMicSlotStore.setState({ slots: toMicSlotArray([]), bindings: [], runningCaptureKeys: [], captureHolders: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete window.api
  })

  it('renders the mic matrix and MultiplayerGameplay together against the fixture chart, and polls/displays CPU usage', async () => {
    const getCpuUsage = vi.fn().mockResolvedValue({ percent: 42 })
    window.api = {
      stage: { getFixtureChartPath: vi.fn().mockResolvedValue(ABSOLUTE_FIXTURE_PATH) },
      multiplayer: {
        getCpuUsage,
        listMicSlots: vi.fn().mockResolvedValue([]),
        saveMicSlot: vi.fn().mockResolvedValue(undefined),
        clearMicSlot: vi.fn().mockResolvedValue(undefined),
      },
      audio: {
        listDevices: vi.fn().mockResolvedValue([]),
        onPitchBatch: vi.fn().mockReturnValue(() => {}),
        onDeviceListChanged: vi.fn().mockReturnValue(() => {}),
      },
    } as unknown as Window['api']
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(raw) }))

    render(<MultiplayerLab />)

    expect(screen.getByTestId('mic-matrix')).toBeInTheDocument()

    await waitFor(() => expect(getCpuUsage).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('cpu-usage')).toHaveTextContent('42%'))
    await waitFor(() => expect(screen.getByTestId('gameplay')).toBeInTheDocument())
  })
})
