import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePauseStore } from '../pauseStore'
import { useStagePauseControl } from '../useStagePauseControl'
import { useStageStore } from '../../stageStore'

interface FakeMedia {
  currentTime: number
  duration: number
  paused: boolean
  ended: boolean
  play: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
}

function fakeMedia(currentTime = 0, duration = 300): FakeMedia {
  const media: FakeMedia = {
    currentTime,
    duration,
    paused: false,
    ended: false,
    play: vi.fn(() => {
      media.paused = false
      return Promise.resolve()
    }),
    pause: vi.fn(() => {
      media.paused = true
    }),
  }
  return media
}

function setup(options: { started?: boolean; videoGapMs?: number } = {}) {
  const audio = fakeMedia(42)
  const stem = fakeMedia(41.9)
  const video = fakeMedia(40)
  const refs = {
    audioRef: { current: audio as unknown as HTMLMediaElement },
    vocalStemRef: { current: stem as unknown as HTMLMediaElement },
    videoRef: { current: video as unknown as HTMLMediaElement },
    startedRef: { current: options.started ?? true },
  }
  const hook = renderHook(() => useStagePauseControl({ ...refs, videoGapMs: options.videoGapMs ?? 1500 }))
  return { audio, stem, video, refs, hook }
}

describe('useStagePauseControl', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    usePauseStore.getState().reset()
    useStageStore.getState().reset()
    useStageStore.getState().setStatus('playing')
  })

  afterEach(() => {
    usePauseStore.getState().reset()
    vi.useRealTimers()
  })

  it('freezes audio, stem and video, and marks the stage paused', () => {
    const { audio, stem, video } = setup()

    act(() => usePauseStore.getState().pause())

    expect(audio.pause).toHaveBeenCalled()
    expect(stem.pause).toHaveBeenCalled()
    expect(video.pause).toHaveBeenCalled()
    expect(useStageStore.getState().status).toBe('paused')
  })

  it('stays frozen through the lead-in, then resumes in sync with #VIDEOGAP', () => {
    const { audio, stem, video } = setup({ videoGapMs: 1500 })
    act(() => usePauseStore.getState().pause())
    act(() => usePauseStore.getState().resume())

    act(() => vi.advanceTimersByTime(2000))
    expect(audio.play).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1000))
    expect(audio.play).toHaveBeenCalledOnce()
    // Exactly where it was: the clock is not moved, the others are put on it.
    expect(audio.currentTime).toBe(42)
    expect(stem.currentTime).toBe(42)
    expect(stem.play).toHaveBeenCalled()
    expect(video.currentTime).toBeCloseTo(43.5)
    expect(video.play).toHaveBeenCalled()
    expect(useStageStore.getState().status).toBe('playing')
  })

  // Owner report: the video restarted around a pause. Pause freezes audio and
  // video on the same instant, so a resume finds the video already on the
  // clock: it plays on from its own frame instead of being seeked.
  it('plays an in-step video on from its own frame on resume, without seeking it', () => {
    const { video } = setup({ videoGapMs: 1500 })
    video.currentTime = 43.49
    const setCurrentTime = vi.fn()
    let position = video.currentTime
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => position,
      set: (value: number) => {
        setCurrentTime(value)
        position = value
      },
    })

    act(() => usePauseStore.getState().pause())
    act(() => usePauseStore.getState().resume())
    act(() => vi.advanceTimersByTime(3000))

    expect(video.play).toHaveBeenCalled()
    expect(setCurrentTime).not.toHaveBeenCalled()
    expect(video.currentTime).toBe(43.49)
  })

  it('resumes a pause taken during the lead-in back into the lead-in', () => {
    useStageStore.getState().setStatus('countdown')
    setup()
    act(() => usePauseStore.getState().pause())
    act(() => usePauseStore.getState().resume())
    act(() => vi.advanceTimersByTime(3000))
    expect(useStageStore.getState().status).toBe('countdown')
  })

  it('leaves starting to the stage when the song had not begun yet', () => {
    const { audio } = setup({ started: false })
    act(() => usePauseStore.getState().pause())
    act(() => usePauseStore.getState().resume())
    act(() => vi.advanceTimersByTime(3000))
    expect(audio.play).not.toHaveBeenCalled()
  })

  it('makes no sound on a restart or when the song is left', () => {
    const { audio } = setup()
    act(() => usePauseStore.getState().pause())
    act(() => usePauseStore.getState().restart())
    expect(audio.play).not.toHaveBeenCalled()

    act(() => usePauseStore.getState().pause())
    act(() => usePauseStore.getState().reset())
    expect(audio.play).not.toHaveBeenCalled()
  })

  it('leaves no stale paused status behind when the stage goes away', () => {
    const { hook } = setup()
    act(() => usePauseStore.getState().pause())
    hook.unmount()
    expect(useStageStore.getState().status).toBe('idle')
  })
})
