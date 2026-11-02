import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { Stage } from '../Stage'
import { useStageStore } from '../stageStore'
import type { SongChart } from '../../contracts/types'
import { MultiplayerGameplay } from '../../multiplayer/MultiplayerGameplay'
import { usePlayersStore } from '../../players/store'
import { usePitchStore } from '../../audio/pitchStore'
import { useMicSlotStore } from '../../multiplayer/store'
import { toMicSlotArray, type MicSlot } from '../../multiplayer/types'
import * as micApi from '../../multiplayer/api'

vi.mock('../../multiplayer/api')

/**
 * The lyric cursor, end to end on a mounted Stage: audio.currentTime -> the
 * stage clock's frame loop -> the stage store (solo) or the beat MotionValue
 * (duets, ClockLyrics) -> LyricBox. Syllables must go active, then sung, while
 * the song plays -- not only once something else (a pause) re-renders.
 *
 * Fake timers stay on for the whole file: framer-motion's frame loop is a
 * module singleton, and a frame scheduled on a fake clock that is then swapped
 * for the real one never fires, which would stall every later test's clock.
 */

// 240 BPM: one chart beat is 60000 / (240 * 4) = 62.5 ms. #GAP 1 s.
const GAP_MS = 1000
const MS_PER_BEAT = 62.5
const secondsAtBeat = (beat: number) => (GAP_MS + beat * MS_PER_BEAT) / 1000

const firstLineNotes = [
  { kind: 'normal' as const, startBeat: 0, length: 8, pitch: 60, syllable: 'Gründ' },
  { kind: 'normal' as const, startBeat: 8, length: 8, pitch: 60, syllable: 'lich' },
  { kind: 'normal' as const, startBeat: 16, length: 8, pitch: 60, syllable: 'durch' },
  { kind: 'normal' as const, startBeat: 24, length: 8, pitch: 60, syllable: 'checkt' },
]

const soloChart: SongChart = {
  meta: { artist: 'A', title: 'T', mp3Path: 'song.mp3', bpm: 240, gap: GAP_MS, videoGap: 0 },
  lines: [
    { part: 'solo', lineBreakBeat: 34, notes: firstLineNotes },
    { part: 'solo', notes: [{ kind: 'normal', startBeat: 48, length: 8, pitch: 60, syllable: 'Steht' }] },
  ],
}

const duetChart: SongChart = {
  ...soloChart,
  lines: [
    { part: 'p1', notes: firstLineNotes },
    { part: 'p2', notes: [{ kind: 'normal', startBeat: 40, length: 8, pitch: 60, syllable: 'Two' }] },
  ],
}

type State = 'active' | 'sung' | 'unsung'

function syllableStates(scope: HTMLElement = document.body): State[] {
  const current = within(scope)
    .getAllByTestId('lyric-line')
    .find((line) => line.dataset.variant === 'current')!
  return [...current.querySelectorAll<HTMLElement>('[data-note-kind]')].map((span) =>
    span.hasAttribute('data-active') ? 'active' : span.style.color.startsWith('rgba(242') ? 'unsung' : 'sung',
  )
}

function setRig(withMic: boolean) {
  const bindings: MicSlot[] = withMic ? [{ slotNumber: 1, deviceId: 'dev-1', channelIndex: 0 }] : []
  vi.mocked(micApi.listMicSlots).mockResolvedValue(bindings)
  usePitchStore.setState({ devices: [], permissionStatus: 'granted', activeCaptures: {} })
  usePlayersStore.setState({ players: [{ id: 'p1', name: 'Alex', color: 'coral', avatarUrl: '' }] })
  useMicSlotStore.setState({ slots: toMicSlotArray(bindings), bindings, runningCaptureKeys: [], captureHolders: [] })
}

/** Mounts the stage the way Sing does (optionally with the gameplay overlay) and returns a playhead. */
function mountStage(chart: SongChart, withOverlay: boolean) {
  render(
    <Stage
      chart={chart}
      sourceDir="/abs/fixtures/sample-song"
      overlay={
        withOverlay
          ? (clock) => (
              <MultiplayerGameplay meta={chart.meta} lines={chart.lines} beatPosition={clock.beatPosition} assignedPlayerIds={['p1']} />
            )
          : undefined
      }
    />,
  )
  const audio = screen.getByTestId('stage-clock-audio') as HTMLAudioElement
  let position = 0
  Object.defineProperty(audio, 'currentTime', { configurable: true, get: () => position, set: (v: number) => (position = v) })
  Object.defineProperty(audio, 'paused', { configurable: true, get: () => false })

  /** Plays on to `beat` and lets a few frames run. */
  return (beat: number) => {
    position = secondsAtBeat(beat)
    act(() => {
      vi.advanceTimersByTime(100)
    })
  }
}

describe('the lyric cursor follows the playing clock', () => {
  beforeAll(() => {
    vi.useFakeTimers()
  })
  afterAll(() => {
    vi.useRealTimers()
  })
  afterEach(() => {
    act(() => useStageStore.getState().reset())
  })

  it.each([
    ['a bare stage', false, false],
    ['the gameplay overlay with no mic hardware', true, false],
    ['the gameplay overlay with a solo singer on a configured mic', true, true],
  ])('solo song, %s: syllables go active, then sung, while the song plays', (_label, withOverlay, withMic) => {
    setRig(withMic)
    const playTo = mountStage(soloChart, withOverlay)

    playTo(-4) // the lead-in: the first line is up, nothing sung yet
    expect(syllableStates()).toEqual(['unsung', 'unsung', 'unsung', 'unsung'])

    playTo(2)
    expect(syllableStates()).toEqual(['active', 'unsung', 'unsung', 'unsung'])
    expect(screen.getByTestId('lyric-active-syllable')).toHaveTextContent('Gründ')

    playTo(10)
    expect(syllableStates()).toEqual(['sung', 'active', 'unsung', 'unsung'])

    playTo(26)
    expect(syllableStates()).toEqual(['sung', 'sung', 'sung', 'active'])
    const sweep = document.querySelector<HTMLElement>('[data-active]')!
    expect(Number(sweep.style.getPropertyValue('--progress'))).toBeGreaterThan(0)

    // Past the `-` break the next line is shown *before* it is sung (USDX
    // paging): all unsung until its first note, then it sweeps like the first.
    playTo(40)
    expect(syllableStates()).toEqual(['unsung'])
    playTo(50)
    expect(syllableStates()).toEqual(['active'])
  })

  it('duet: each part box sweeps on its own cursor while the song plays', () => {
    setRig(false)
    const playTo = mountStage(duetChart, false)
    const p1Box = () => screen.getAllByTestId('lyric-box').find((box) => box.dataset.part === 'p1')!

    playTo(2)
    expect(syllableStates(p1Box())).toEqual(['active', 'unsung', 'unsung', 'unsung'])

    playTo(18)
    expect(syllableStates(p1Box())).toEqual(['sung', 'sung', 'active', 'unsung'])
  })
})
