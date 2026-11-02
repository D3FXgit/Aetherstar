import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { motionValue } from 'framer-motion'
import { Gameplay } from '../Gameplay'
import { LanePanel } from '../lane/LanePanel'
import { LanePagingProvider } from '../lane/LanePagingContext'
import { usePitchStore } from '../../audio/pitchStore'
import { usePlayersStore } from '../../players/store'
import { useHitStore } from '../state/useHitStore'
import { useScoreStore } from '../state/useScoreStore'
import { useCalibrationStore } from '../../calibration/calibrationStore'
import { DEFAULT_CALIBRATION_SETTINGS } from '../../calibration/types'
import type { SongLine, SongMeta } from '../../contracts/types'

const META: SongMeta = { artist: 'Test', title: 'Song', mp3Path: 'song.mp3', bpm: 120, gap: 0, videoGap: 0 }
const A4_HZ = 440 // pitch class 9

const LINES: SongLine[] = [
  { part: 'solo', notes: [{ kind: 'normal', startBeat: 0, length: 4, pitch: 9, syllable: 'la' }], lineBreakBeat: 6 },
  {
    part: 'solo',
    notes: [
      { kind: 'normal', startBeat: 8, length: 2, pitch: 9, syllable: 'li' },
      { kind: 'normal', startBeat: 10, length: 2, pitch: 14, syllable: 'lo' },
    ],
  },
]

function seedPitch(hz: number) {
  usePitchStore.setState({
    activeCaptures: {
      'dev-1': {
        latest: { t: Date.now(), hz, confidence: 1, deviceId: 'dev-1' },
        samples: [],
        latencyMs: 0,
      },
    },
  })
}

const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

beforeEach(() => {
  usePitchStore.setState({ devices: [], permissionStatus: 'granted', activeCaptures: {} })
  usePlayersStore.setState({ players: [{ id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' }] })
  useHitStore.getState().reset()
  useScoreStore.getState().reset({ players: [], combo: 0, rank: [] })
  useCalibrationStore.setState({ settings: DEFAULT_CALIBRATION_SETTINGS })
})

describe('the live note fill', () => {
  it('fills the note under the playhead as it is sung on pitch, before it is judged', async () => {
    seedPitch(A4_HZ)
    const beatPosition = motionValue(0)
    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />)
    const note = () => document.querySelector<HTMLElement>('[data-note-id="note-0"]')!

    await nextFrame()
    beatPosition.set(2)
    await nextFrame()

    await waitFor(() => expect(Number(note().style.getPropertyValue('--ae-note-live'))).toBeGreaterThanOrEqual(0.4))
    // Still un-judged: the live fill is visual only.
    expect(note()).not.toHaveAttribute('data-cleared')
  })

  it('does not fill while the singer is off the note', async () => {
    seedPitch(A4_HZ * 2 ** (4 / 12)) // four semitones sharp: outside Normal's tolerance
    const beatPosition = motionValue(0)
    render(<Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />)

    await nextFrame()
    beatPosition.set(2)
    await nextFrame()
    await nextFrame()

    const live = document.querySelector<HTMLElement>('[data-note-id="note-0"]')!.style.getPropertyValue('--ae-note-live')
    expect(live === '' || Number(live) === 0).toBe(true)
  })
})

describe('a paged lane', () => {
  function renderPaged(beatPosition = motionValue(0)) {
    render(
      <LanePagingProvider lines={LINES} bpm={META.bpm} beatPosition={beatPosition}>
        <LanePanel slotNumber={1}>
          <Gameplay meta={META} lines={LINES} beatPosition={beatPosition} />
        </LanePanel>
      </LanePagingProvider>,
    )
    return beatPosition
  }

  it('shows one line at a time, and flips to the next at its break', async () => {
    const beatPosition = renderPaged()
    expect(screen.getByTestId('note-lane')).toHaveAttribute('data-paged', 'true')
    expect(screen.getAllByTestId('note-block')).toHaveLength(1)

    act(() => beatPosition.set(6.5))
    await waitFor(() => expect(screen.getAllByTestId('note-block')).toHaveLength(2))
    expect(screen.getByTestId('note-page')).toHaveAttribute('data-page-index', '1')
  })

  it('moves the playhead, the pitch rule and the sustain spark across the line together', async () => {
    const beatPosition = renderPaged()
    const playheadLayer = () => screen.getByTestId('lane-playhead').parentElement!
    const ruleTrack = () => screen.getByTestId('pitch-line-track')

    act(() => beatPosition.set(2))
    await nextFrame()
    const atTwo = playheadLayer().style.transform
    expect(atTwo).toContain('translateX(50%)')
    expect(ruleTrack().style.transform).toBe(atTwo)
    expect(screen.getByTestId('lane-sustain-fx').parentElement!.style.transform).toBe(atTwo)
  })
})
