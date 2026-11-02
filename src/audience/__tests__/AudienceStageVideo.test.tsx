import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { AudienceStageVideo } from '../AudienceStageVideo'
import type { AudiencePlayback } from '../types'
import type { SongMeta } from '../../contracts/types'

/**
 * The television's backdrop through a host pause: it freezes on its frame and,
 * on resume, plays on from there -- never back to the start.
 */

const meta: SongMeta = {
  artist: 'Nova Lane',
  title: 'Paper Satellites',
  mp3Path: 'song.mp3',
  videoPath: 'clip.mp4',
  bpm: 250,
  gap: 2000,
  videoGap: 1.5,
}

interface MediaState {
  currentTime: number
  paused: boolean
  seeks: number[]
}

const states = new WeakMap<HTMLMediaElement, MediaState>()

function stateOf(element: HTMLMediaElement): MediaState {
  let state = states.get(element)
  if (!state) {
    state = { currentTime: 0, paused: true, seeks: [] }
    states.set(element, state)
  }
  return state
}

const NOW = 1_700_000_000_000

function anchor(positionMs: number, paused: boolean, pausedByHost = paused): AudiencePlayback {
  return { positionMs, atEpochMs: Date.now(), paused, pausedByHost, epoch: 0 }
}

describe('AudienceStageVideo: a host pause never restarts the backdrop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const proto = HTMLMediaElement.prototype
    vi.spyOn(proto, 'play').mockImplementation(function (this: HTMLMediaElement) {
      stateOf(this).paused = false
      return Promise.resolve()
    })
    vi.spyOn(proto, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      stateOf(this).paused = true
    })
    vi.spyOn(proto, 'paused', 'get').mockImplementation(function (this: HTMLMediaElement) {
      return stateOf(this).paused
    })
    vi.spyOn(proto, 'currentTime', 'get').mockImplementation(function (this: HTMLMediaElement) {
      return stateOf(this).currentTime
    })
    vi.spyOn(proto, 'currentTime', 'set').mockImplementation(function (this: HTMLMediaElement, value: number) {
      stateOf(this).currentTime = value
      stateOf(this).seeks.push(value)
    })
    vi.spyOn(proto, 'readyState', 'get').mockReturnValue(HTMLMediaElement.HAVE_ENOUGH_DATA)
    vi.spyOn(proto, 'duration', 'get').mockReturnValue(240)
    vi.spyOn(proto, 'seeking', 'get').mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('freezes on its frame while the host is paused and plays on from it after', () => {
    const view = render(<AudienceStageVideo meta={meta} sourceDir="/songs/test" playback={anchor(30_000, false)} />)
    const video = screen.getByTestId('audience-stage-video') as HTMLVideoElement
    // The first anchor puts it on audio + #VIDEOGAP.
    expect(stateOf(video).paused).toBe(false)
    expect(video.currentTime).toBeCloseTo(31.5, 3)

    // Playing on for a second, then the host pauses at 31 s.
    act(() => {
      stateOf(video).currentTime = 32.49
      vi.advanceTimersByTime(1000)
    })
    stateOf(video).seeks.length = 0
    view.rerender(<AudienceStageVideo meta={meta} sourceDir="/songs/test" playback={anchor(31_000, true)} />)
    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.getByTestId('audience-stage-video')).toBe(video)
    expect(stateOf(video).paused).toBe(true)
    expect(stateOf(video).seeks).toEqual([])
    expect(video.currentTime).toBeCloseTo(32.49, 3)

    // Resume: the host's clock is moving again from where it stopped.
    view.rerender(<AudienceStageVideo meta={meta} sourceDir="/songs/test" playback={anchor(31_000, false)} />)
    act(() => {
      vi.advanceTimersByTime(250)
    })

    expect(screen.getByTestId('audience-stage-video')).toBe(video)
    expect(stateOf(video).paused).toBe(false)
    expect(stateOf(video).seeks).toEqual([])
    expect(video.currentTime).toBeCloseTo(32.49, 3)
  })
})
