import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Stage } from '../Stage'
import { useStageStore } from '../stageStore'
import { usePauseStore, RESUME_LEAD_IN_SECONDS } from '../pause/pauseStore'
import type { SongChart } from '../../contracts/types'

/**
 * Owner report: "In singing mode, when the song gets paused, the video on the
 * main screen restarts." The stage's video must be the same element, at the
 * same position, through a pause, and continue from there on resume.
 */

const chart: SongChart = {
  meta: {
    artist: 'Nova Lane',
    title: 'Paper Satellites',
    mp3Path: 'song.mp3',
    videoPath: 'clip.mp4',
    bpm: 250,
    gap: 2000,
    videoGap: 1.5,
  },
  lines: [
    { part: 'solo', notes: [{ kind: 'normal', startBeat: 0, length: 3, pitch: 65, syllable: 'Wake' }] },
    { part: 'solo', notes: [{ kind: 'normal', startBeat: 16, length: 2, pitch: 65, syllable: 'Spark' }] },
  ],
}

interface MediaState {
  currentTime: number
  paused: boolean
  seeks: number[]
  loads: number
}

/** How far either side of its position a seek of the fake video lands; further, and it restarts. */
const VIDEO_CACHED_SEC = 5

const states = new WeakMap<HTMLMediaElement, MediaState>()

function stateOf(element: HTMLMediaElement): MediaState {
  let state = states.get(element)
  if (!state) {
    state = { currentTime: 0, paused: true, seeks: [], loads: 0 }
    states.set(element, state)
  }
  return state
}

/** A media element that behaves like Chromium's for everything the stage touches. */
function installFakeMedia() {
  const proto = HTMLMediaElement.prototype
  vi.spyOn(proto, 'play').mockImplementation(function (this: HTMLMediaElement) {
    stateOf(this).paused = false
    return Promise.resolve()
  })
  vi.spyOn(proto, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    stateOf(this).paused = true
  })
  vi.spyOn(proto, 'load').mockImplementation(function (this: HTMLMediaElement) {
    const state = stateOf(this)
    state.loads += 1
    state.currentTime = 0
    state.paused = true
  })
  vi.spyOn(proto, 'paused', 'get').mockImplementation(function (this: HTMLMediaElement) {
    return stateOf(this).paused
  })
  vi.spyOn(proto, 'currentTime', 'get').mockImplementation(function (this: HTMLMediaElement) {
    return stateOf(this).currentTime
  })
  vi.spyOn(proto, 'currentTime', 'set').mockImplementation(function (this: HTMLMediaElement, value: number) {
    const state = stateOf(this)
    state.seeks.push(value)
    // A long video is only partly in the media cache. A seek outside what is
    // cached needs a ranged read, and when the source cannot answer one the
    // element lands on its first frame: the restart the owner saw.
    const cached = this instanceof HTMLVideoElement ? VIDEO_CACHED_SEC : Infinity
    state.currentTime = Math.abs(value - state.currentTime) <= cached ? value : 0
  })
  vi.spyOn(proto, 'readyState', 'get').mockReturnValue(HTMLMediaElement.HAVE_ENOUGH_DATA)
  vi.spyOn(proto, 'duration', 'get').mockReturnValue(240)
  vi.spyOn(proto, 'ended', 'get').mockReturnValue(false)
  vi.spyOn(proto, 'seeking', 'get').mockReturnValue(false)
}

function frames(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

/** Plays both elements forward by `seconds`, as Chromium would while the song runs. */
function playFor(audio: HTMLMediaElement, video: HTMLMediaElement, seconds: number) {
  const steps = Math.round(seconds * 10)
  for (let i = 0; i < steps; i++) {
    if (!stateOf(audio).paused) stateOf(audio).currentTime += 0.1
    if (!stateOf(video).paused) stateOf(video).currentTime += 0.1
    frames(100)
  }
}

describe('Stage: pausing the song never restarts its video', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installFakeMedia()
    act(() => {
      usePauseStore.getState().reset()
      useStageStore.getState().reset()
    })
  })

  afterEach(() => {
    act(() => {
      usePauseStore.getState().reset()
      useStageStore.getState().reset()
    })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function startSong() {
    const view = render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" />)
    const audio = screen.getByTestId('stage-clock-audio') as HTMLAudioElement
    const video = document.querySelector('video') as HTMLVideoElement
    expect(video).not.toBeNull()
    act(() => {
      fireEvent.canPlay(audio)
    })
    frames(50)
    expect(stateOf(audio).paused).toBe(false)
    expect(stateOf(video).paused).toBe(false)
    // Mid-song: 30 s in, the video on audio + #VIDEOGAP (a few ms behind, as a real one is).
    stateOf(audio).currentTime = 30
    stateOf(video).currentTime = 31.48
    frames(50)
    return { view, audio, video }
  }

  it('keeps the same <video>, paused where it was, through the pause menu', () => {
    const { audio, video } = startSong()
    stateOf(video).seeks.length = 0

    act(() => usePauseStore.getState().pause())
    frames(2000)

    const pausedVideo = document.querySelector('video')
    expect(pausedVideo).toBe(video)
    expect(stateOf(video).paused).toBe(true)
    expect(stateOf(audio).paused).toBe(true)
    expect(stateOf(video).loads).toBe(0)
    expect(stateOf(video).seeks).toEqual([])
    expect(video.currentTime).toBeCloseTo(31.48, 3)
    expect(screen.getByTestId('stage-clock-audio')).toBe(audio)
    expect(audio.currentTime).toBeCloseTo(30, 3)
  })

  it('continues from where it stopped on resume, re-synced to audio + #VIDEOGAP', () => {
    const { audio, video } = startSong()
    playFor(audio, video, 1)
    expect(audio.currentTime).toBeCloseTo(31, 3)

    act(() => usePauseStore.getState().pause())
    frames(1500)
    act(() => usePauseStore.getState().resume())
    // The lead-in: still frozen, still in place.
    frames((RESUME_LEAD_IN_SECONDS - 1) * 1000)
    expect(document.querySelector('video')).toBe(video)
    expect(stateOf(video).paused).toBe(true)
    expect(video.currentTime).toBeCloseTo(32.48, 3)

    stateOf(video).seeks.length = 0
    frames(1000)
    expect(usePauseStore.getState().phase).toBe('running')
    expect(stateOf(audio).paused).toBe(false)
    expect(stateOf(video).paused).toBe(false)
    expect(document.querySelector('video')).toBe(video)
    // Already on the clock: played on from its own frame, not seeked (and so
    // never sent back to the start).
    expect(stateOf(video).seeks).toEqual([])
    expect(stateOf(video).loads).toBe(0)
    expect(video.currentTime).toBeCloseTo(32.48, 3)

    playFor(audio, video, 1)
    expect(video.currentTime).toBeGreaterThan(33)
    expect(video.currentTime).toBeLessThan(34)
    expect(audio.currentTime).toBeCloseTo(32, 3)
  })

  it('still seeks a video that is genuinely out of step back onto audio + #VIDEOGAP on resume', () => {
    const { audio, video } = startSong()
    act(() => usePauseStore.getState().pause())
    // The video stalled behind the clock before the pause took hold.
    stateOf(video).currentTime = 30.9
    stateOf(video).seeks.length = 0
    act(() => usePauseStore.getState().resume())
    frames(RESUME_LEAD_IN_SECONDS * 1000)

    expect(usePauseStore.getState().phase).toBe('running')
    expect(stateOf(video).seeks).toEqual([31.5])
    expect(video.currentTime).toBeCloseTo(31.5, 3)
    expect(stateOf(video).paused).toBe(false)
    expect(document.querySelector('video')).toBe(video)
    expect(audio.currentTime).toBeCloseTo(30, 3)
  })
})
