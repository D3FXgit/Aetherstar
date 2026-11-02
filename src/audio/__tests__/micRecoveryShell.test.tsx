// The end-to-end path this whole phase exists for: a mic is unplugged *during
// a song*, and the shell -- not a screen -- is what notices.
//
// Deliberately its own file rather than an addition to src/__tests__/App.test.tsx,
// which is being edited concurrently.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import App from '../../App'
import { usePitchStore } from '../pitchStore'
import { useMicRecoveryStore } from '../micRecoveryStore'
import { useSceneStore } from '../../scenes/sceneStore'
import { useSessionStore } from '../../session/sessionStore'
import { useMicSlotStore } from '../../multiplayer/store'
import { toMicSlotArray, type MicSlot } from '../../multiplayer/types'
import { usePlayersStore } from '../../players/store'
import { useAppPreferencesStore } from '../../settings/appPreferencesStore'
import { createWebAudioManager } from '../webAudioManager'
import type { DeviceListChangedPayload } from '../types'
import type { PlayerProfile } from '../../contracts/types'

vi.mock('../webAudioManager')

const MIC_1 = { id: 'mic-1', name: 'USB Mic', channelCount: 1, sampleRate: 48000 }
const MIC_2 = { id: 'mic-2', name: 'Scarlett 2i2', channelCount: 2, sampleRate: 48000 }

const ADA: PlayerProfile = { id: 'ada', name: 'Ada', color: '#ffffff', avatarUrl: '' }
const GRACE: PlayerProfile = { id: 'grace', name: 'Grace', color: '#00ffff', avatarUrl: '' }

function setMicSlots(stored: MicSlot[]) {
  useMicSlotStore.setState({ slots: toMicSlotArray(stored), bindings: stored, runningCaptureKeys: [], captureHolders: [] })
}

describe('the shell watching for microphone disconnects', () => {
  let deviceListCallbacks: ((payload: DeviceListChangedPayload) => void)[]

  function emitDeviceListChanged(payload: DeviceListChangedPayload) {
    act(() => {
      deviceListCallbacks.forEach((callback) => callback(payload))
    })
  }

  beforeEach(() => {
    deviceListCallbacks = []
    window.api = {
      getWindowRole: () => 'main',
      audio: {
        listDevices: vi.fn().mockResolvedValue([MIC_1, MIC_2]),
        requestPermission: vi.fn().mockResolvedValue('granted'),
        getPermissionStatus: vi.fn().mockResolvedValue('granted'),
        startCapture: vi.fn().mockResolvedValue(undefined),
        stopCapture: vi.fn().mockResolvedValue(undefined),
        startRawScope: vi.fn().mockResolvedValue(undefined),
        stopRawScope: vi.fn().mockResolvedValue(undefined),
        onPitchBatch: vi.fn().mockReturnValue(() => {}),
        onDeviceListChanged: vi.fn((cb) => {
          deviceListCallbacks.push(cb)
          return () => {
            deviceListCallbacks = deviceListCallbacks.filter((entry) => entry !== cb)
          }
        }),
        onRawScopeChunk: vi.fn().mockReturnValue(() => {}),
      },
    } as unknown as Window['api']

    vi.mocked(createWebAudioManager).mockReturnValue({
      play: vi.fn(),
      duckTo: vi.fn(),
      restore: vi.fn(),
      crossfadeTo: vi.fn(),
      stop: vi.fn(),
    })

    usePitchStore.setState({
      devices: [MIC_1, MIC_2],
      permissionStatus: 'granted',
      activeCaptures: {
        [MIC_1.id]: { latest: null, samples: [], latencyMs: null, level: 0, levelAt: 0 },
        [MIC_2.id]: { latest: null, samples: [], latencyMs: null, level: 0, levelAt: 0 },
      },
    })
    useMicRecoveryStore.setState({ lostInputs: [], dismissed: false, knownDeviceNames: {} })
    usePlayersStore.setState({ players: [ADA, GRACE] })
    setMicSlots([
      { slotNumber: 1, deviceId: MIC_1.id, channelIndex: 0 },
      { slotNumber: 2, deviceId: MIC_2.id, channelIndex: 0 },
    ])
    useAppPreferencesStore.setState({ perfOverlayVisible: false })
    useSceneStore.setState({ current: 'session-play', history: ['home'] })
    useSessionStore.setState({
      phase: 'play',
      sessionId: 's1',
      selectedSong: null,
      assignedPlayerIds: ['ada', 'grace'],
      lastResult: null,
      songsPlayedThisSession: 0,
    })
  })

  it('subscribes mid-song, when no screen that watches audio events is mounted', () => {
    // The regression this pins: SessionPlay/Sing/Gameplay only *read*
    // usePitchStore. Before the shell subscribed, AUDIO_DEVICE_LIST_CHANGED
    // arrived during a song with nothing in the renderer listening for it,
    // so a mid-song disconnect was invisible -- the exact case that matters.
    render(<App />)
    expect(deviceListCallbacks.length).toBeGreaterThan(0)
  })

  it('surfaces the loss by mic number and sheds the dead capture, without disturbing the song', async () => {
    render(<App />)

    emitDeviceListChanged({ devices: [MIC_2], added: [], removed: [MIC_1] })

    await waitFor(() => expect(screen.getByTestId('mic-recovery')).toBeInTheDocument())
    expect(screen.getByTestId('mic-recovery')).toHaveTextContent('Mic 1')
    expect(screen.getByTestId('mic-recovery')).toHaveTextContent('Ada')

    // No stale capture for hardware on the floor, and the session machine and
    // the scene are exactly where the song left them.
    expect(usePitchStore.getState().activeCaptures[MIC_1.id]).toBeUndefined()
    expect(usePitchStore.getState().activeCaptures[MIC_2.id]).toBeDefined()
    expect(useSessionStore.getState().phase).toBe('play')
    expect(useSceneStore.getState().current).toBe('session-play')
  })

  it('claims no focus scope mid-song, so the stick still reaches the song behind it', async () => {
    render(<App />)

    emitDeviceListChanged({ devices: [MIC_2], added: [], removed: [MIC_1] })

    await waitFor(() => expect(screen.getByTestId('mic-recovery')).toBeInTheDocument())
    expect(document.querySelectorAll('[data-focus-scope]')).toHaveLength(0)
  })

  it('restores the microphone by itself when it goes back into the same port', async () => {
    render(<App />)

    emitDeviceListChanged({ devices: [MIC_2], added: [], removed: [MIC_1] })
    await waitFor(() => expect(screen.getByTestId('mic-recovery')).toBeInTheDocument())

    emitDeviceListChanged({ devices: [MIC_1, MIC_2], added: [MIC_1], removed: [] })

    await waitFor(() => expect(screen.queryByTestId('mic-recovery')).toBeNull())
    expect(window.api!.audio.startCapture).toHaveBeenCalledWith(MIC_1.id)
    // The mic slot was never cleared -- that is what let the reconnect find its
    // way back without anyone re-doing the eight-row matrix mid-party.
    expect(useMicSlotStore.getState().bindings).toHaveLength(2)
  })

  it('stops watching when the shell unmounts', () => {
    const { unmount } = render(<App />)
    expect(deviceListCallbacks.length).toBeGreaterThan(0)

    unmount()

    expect(deviceListCallbacks).toHaveLength(0)
  })
})
