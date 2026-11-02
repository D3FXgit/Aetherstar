import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { Stage, type StageControl } from '../Stage'
import { useStageStore } from '../stageStore'
import type { SongChart } from '../../contracts/types'

const chart: SongChart = {
  meta: {
    artist: 'Nova Lane',
    title: 'Paper Satellites',
    mp3Path: 'song.mp3',
    videoPath: 'Nova Lane - Paper Satellites [VD#1].mpg',
    bpm: 250,
    gap: 24065,
    videoGap: 1,
  },
  lines: [
    { part: 'solo', notes: [{ kind: 'normal', startBeat: 0, length: 3, pitch: 65, syllable: 'Wake' }] },
    { part: 'solo', notes: [{ kind: 'normal', startBeat: 16, length: 2, pitch: 65, syllable: 'Spark' }] },
  ],
}

describe('Stage', () => {
  it('mounts the lyric box and media layer, and shows the first line before anyone sings', () => {
    render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" />)

    expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0)
    expect(screen.getByText('Wake')).toBeInTheDocument()
    expect(screen.getByTestId('stage-ambient-fallback')).toBeInTheDocument()
  })

  // The lead-in is the last three seconds before the *first note*, not a
  // 24-second count from the top of the file.
  it('counts down only in the last three seconds before the first note', () => {
    vi.useFakeTimers()
    try {
      render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" />)
      expect(screen.queryByTestId('stage-countdown')).not.toBeInTheDocument()

      const audio = screen.getByTestId('stage-clock-audio') as HTMLAudioElement
      Object.defineProperty(audio, 'currentTime', { value: 22, configurable: true })
      act(() => {
        vi.advanceTimersByTime(250)
      })
      // First note at beat 0 = #GAP 24.065 s: 2.065 s to go.
      expect(screen.getByTestId('stage-countdown')).toHaveTextContent('3')
      expect(screen.getByTestId('stage-countdown').className).not.toMatch(/backdrop-blur/)
    } finally {
      vi.useRealTimers()
      act(() => useStageStore.getState().reset())
    }
  })

  // The jukebox: nobody is waiting to sing, so there is no 3-2-1 at all.
  it('skips the lead-in entirely when asked to', () => {
    vi.useFakeTimers()
    try {
      render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" skipLeadIn />)
      expect(useStageStore.getState().status).toBe('playing')

      const audio = screen.getByTestId('stage-clock-audio') as HTMLAudioElement
      Object.defineProperty(audio, 'currentTime', { value: 22, configurable: true })
      act(() => {
        vi.advanceTimersByTime(250)
      })
      expect(screen.queryByTestId('stage-countdown')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
      act(() => useStageStore.getState().reset())
    }
  })

  it('ends the song at #END, once', () => {
    const onEnded = vi.fn()
    render(
      <Stage chart={{ ...chart, meta: { ...chart.meta, endMs: 30_000 } }} sourceDir="/abs/fixtures/sample-song" onEnded={onEnded} />,
    )
    const audio = screen.getByTestId('stage-clock-audio') as HTMLAudioElement

    Object.defineProperty(audio, 'currentTime', { value: 29.5, configurable: true })
    fireEvent.timeUpdate(audio)
    expect(onEnded).not.toHaveBeenCalled()

    Object.defineProperty(audio, 'currentTime', { value: 30.1, configurable: true })
    fireEvent.timeUpdate(audio)
    fireEvent(audio, new Event('ended'))
    expect(onEnded).toHaveBeenCalledOnce()
  })

  it('starts the audio at #START, skipping the intro', async () => {
    render(<Stage chart={{ ...chart, meta: { ...chart.meta, startMs: 12_500 } }} sourceDir="/abs/fixtures/sample-song" />)
    const audio = screen.getByTestId('stage-clock-audio') as HTMLAudioElement
    let position = 0
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get: () => position,
      set: (value: number) => {
        position = value
      },
    })
    await act(async () => {
      fireEvent.canPlay(audio)
    })
    expect(position).toBe(12.5)
  })

  it('draws a duet as two compact lyric boxes, P2 above P1, in their mic colours', () => {
    const duet: SongChart = {
      ...chart,
      lines: [
        { part: 'p1', notes: [{ kind: 'normal', startBeat: 0, length: 3, pitch: 65, syllable: 'One' }] },
        { part: 'p2', notes: [{ kind: 'normal', startBeat: 4, length: 2, pitch: 65, syllable: 'Two' }] },
      ],
    }
    render(<Stage chart={duet} sourceDir="/abs/fixtures/sample-song" />)

    const boxes = screen.getAllByTestId('lyric-box')
    expect(boxes.map((box) => box.dataset.part)).toEqual(['p2', 'p1'])
    expect(boxes.every((box) => box.dataset.compact === 'true')).toBe(true)
    expect(boxes[0]).toHaveTextContent('Two')
    expect(boxes[1]).toHaveTextContent('One')
  })

  it('renders the song info card from the chart meta (title + artist · BPM · time, top-left)', () => {
    render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" />)

    expect(screen.getByTestId('song-info-title')).toHaveTextContent('Paper Satellites')
    expect(screen.getByTestId('song-info-meta')).toHaveTextContent('Nova Lane · 250 BPM')
  })

  it('renders exactly as before when no overlay prop is given (no regression to existing rendering)', () => {
    render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" />)
    expect(screen.queryByTestId('stage-overlay-probe')).not.toBeInTheDocument()
  })

  it('renders the overlay render-prop as an additional layer, given the clock', () => {
    render(
      <Stage
        chart={chart}
        sourceDir="/abs/fixtures/sample-song"
        overlay={(clock) => (
          <div data-testid="stage-overlay-probe">{typeof clock.beatPosition.get() === 'number' ? 'has-clock' : 'no-clock'}</div>
        )}
      />,
    )
    expect(screen.getByTestId('stage-overlay-probe')).toHaveTextContent('has-clock')
    // The existing lyric box/media layer are still present alongside the overlay.
    expect(screen.getAllByTestId('lyric-line').length).toBeGreaterThan(0)
    expect(screen.getByTestId('stage-ambient-fallback')).toBeInTheDocument()
  })

  it('hands the overlay the stage clock, including a synchronous getBeat', () => {
    let getBeat: (() => number) | null = null
    render(
      <Stage
        chart={chart}
        sourceDir="/abs/fixtures/sample-song"
        overlay={(clock) => {
          getBeat = clock.getBeat
          return null
        }}
      />,
    )
    const audio = screen.getByTestId('stage-clock-audio') as HTMLAudioElement
    Object.defineProperty(audio, 'currentTime', { value: 24.065 + 1.2, configurable: true })
    // Read straight off the element, not off the last frame: 1.2 s past #GAP
    // at 250 BPM is 1200 / 60 = 20 beats, before any frame has run.
    expect(getBeat).not.toBeNull()
    expect(getBeat!()).toBeCloseTo(20, 6)
  })

  // Regression guard: nothing used to call play(). Since useStageClock reads
  // beat position from audio.currentTime, a paused element meant the
  // countdown never advanced and the song never started.
  it('starts audio playback once the element can play, so the timing clock has a source', async () => {
    const play = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)

    render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" />)
    const audio = document.querySelector('audio')
    expect(audio).not.toBeNull()
    fireEvent(audio!, new Event('canplay'))

    expect(play).toHaveBeenCalled()
  })

  it('surfaces a rejected play() instead of leaving a silently frozen stage', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('NotAllowedError'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" />)
    fireEvent(document.querySelector('audio')!, new Event('canplay'))
    await Promise.resolve()
    await Promise.resolve()

    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('calls onEnded when the audio element fires its native ended event -- how the session knows a song finished', () => {
    const onEnded = vi.fn()
    render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" onEnded={onEnded} />)

    const audio = document.querySelector('audio')
    expect(audio).not.toBeNull()
    fireEvent(audio!, new Event('ended'))

    expect(onEnded).toHaveBeenCalledOnce()
  })

  it('does not throw when no onEnded prop is given (regression guard)', () => {
    render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" />)
    const audio = document.querySelector('audio')
    expect(() => fireEvent(audio!, new Event('ended'))).not.toThrow()
  })
})

/**
 * The stage used to re-render its whole tree -- the media elements, the song
 * card, the lyric box and the entire gameplay overlay -- five times a second
 * for the length of the song, plus once per syllable. Two causes, both fixed
 * by moving the state that changes into the layer that needs it:
 *
 *  - `countdownMs` was React state on Stage itself, polled every 200ms; and
 *    because nothing ever moved the stage out of 'countdown' status, that poll
 *    (and the countdown panel it drives) ran for the entire song rather than
 *    just the pre-GAP lead-in.
 *  - `currentLineIndex`/`activeSyllableIndex` were subscribed on Stage, so a
 *    syllable boundary -- several a second while anyone is singing -- re-ran
 *    `overlay(clock)` and re-rendered the note lane with it.
 */
describe('Stage — render isolation', () => {
  const clockChart: SongChart = { ...chart, meta: { ...chart.meta, gap: 2000 } }

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    act(() => useStageStore.getState().reset())
  })

  it('leaves the countdown once playback reaches the GAP, instead of showing it for the whole song', () => {
    vi.useFakeTimers()
    render(<Stage chart={clockChart} sourceDir="/abs/fixtures/sample-song" />)
    expect(screen.getByTestId('stage-countdown')).toBeInTheDocument()

    const audio = screen.getByTestId('stage-clock-audio') as HTMLAudioElement
    Object.defineProperty(audio, 'currentTime', { value: 2.5, configurable: true })
    act(() => {
      vi.advanceTimersByTime(400)
    })

    expect(screen.queryByTestId('stage-countdown')).not.toBeInTheDocument()
    expect(useStageStore.getState().status).toBe('playing')
  })

  it('does not re-render the gameplay overlay while the countdown ticks', () => {
    vi.useFakeTimers()
    const overlay = vi.fn(() => <div data-testid="stage-overlay-probe" />)
    render(<Stage chart={clockChart} sourceDir="/abs/fixtures/sample-song" overlay={overlay} />)

    const before = overlay.mock.calls.length
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(overlay.mock.calls.length).toBe(before)
  })

  it('re-renders the lyric box on a syllable boundary without re-rendering the overlay', () => {
    const overlay = vi.fn(() => <div data-testid="stage-overlay-probe" />)
    render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" overlay={overlay} />)

    const before = overlay.mock.calls.length
    act(() => {
      useStageStore.getState().setActiveSyllableIndex(0)
    })

    expect(document.querySelector('[data-active]')).not.toBeNull()
    expect(overlay.mock.calls.length).toBe(before)
  })
})

describe('Stage — stem start-up', () => {
  const stemChart: SongChart = {
    ...chart,
    meta: { ...chart.meta, mp3Path: 'mix.mp3', vocalsPath: 'voc.mp3', instrumentalPath: 'inst.mp3' },
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('holds the clock until BOTH elements can play, so the guide vocal never joins a bar late', () => {
    const play = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)

    render(<Stage chart={stemChart} sourceDir="/abs/fixtures/sample-song" />)

    fireEvent(screen.getByTestId('stage-clock-audio'), new Event('canplay'))
    expect(play).not.toHaveBeenCalled()

    fireEvent(screen.getByTestId('stage-vocal-stem-audio'), new Event('canplay'))
    // Everything starts in the same task: the clock, the stem seeded to the
    // clock's own position, and the decorative video.
    expect(play).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('stage-vocal-stem-audio')).toHaveProperty(
      'currentTime',
      (screen.getByTestId('stage-clock-audio') as HTMLAudioElement).currentTime,
    )
  })

  // Review finding: `usingStems` is a dependency of the start effect, so a
  // guide vocal failing mid-song re-ran the start gate -- and with the clock
  // already playable, `playFromClock` again, re-seeking the playing video.
  it('does not start the song a second time when the stem plan changes after the start', () => {
    const play = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)

    render(<Stage chart={stemChart} sourceDir="/abs/fixtures/sample-song" />)
    const clockAudio = screen.getByTestId('stage-clock-audio') as HTMLAudioElement
    fireEvent(clockAudio, new Event('canplay'))
    fireEvent(screen.getByTestId('stage-vocal-stem-audio'), new Event('canplay'))
    expect(play).toHaveBeenCalledTimes(3)

    // Mid-song: the clock is playable and the guide vocal fails, so the plan
    // drops the stems -- on the same, still-playing clock element.
    Object.defineProperty(clockAudio, 'readyState', { value: HTMLMediaElement.HAVE_ENOUGH_DATA, configurable: true })
    act(() => {
      fireEvent.error(screen.getByTestId('stage-vocal-stem-audio'))
    })

    expect(screen.queryByTestId('stage-vocal-stem-audio')).not.toBeInTheDocument()
    expect(screen.getByTestId('stage-clock-audio')).toBe(clockAudio)
    expect(play).toHaveBeenCalledTimes(3)
  })

  it('starts the clock anyway when a stem stalls without ever loading or erroring', () => {
    // Losing the clock is losing gameplay, so a half-written or unreadable
    // stem must never be able to hold the whole song hostage.
    vi.useFakeTimers()
    const play = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)

    render(<Stage chart={stemChart} sourceDir="/abs/fixtures/sample-song" />)
    fireEvent(screen.getByTestId('stage-clock-audio'), new Event('canplay'))
    expect(play).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(2500)
    })

    expect(play).toHaveBeenCalled()
  })

  it('starts as soon as the stem errors, without waiting out the timeout', () => {
    const play = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)

    render(<Stage chart={stemChart} sourceDir="/abs/fixtures/sample-song" />)
    fireEvent(screen.getByTestId('stage-clock-audio'), new Event('canplay'))
    fireEvent.error(screen.getByTestId('stage-vocal-stem-audio'))

    expect(play).toHaveBeenCalled()
  })
})

/**
 * Stage draws the song card and the lyric box; the gameplay overlay draws the
 * lane, the score cards and the status pill. Neither layer can see the other,
 * so both declare the *same* grid (see stage/layout.ts) and place into named
 * cells. These are the assertions that keep Stage's half in its own cells.
 */
describe('Stage: its half of the shared singer-view grid', () => {
  it('places the song card and the lyric box into the shared grid\'s named cells', () => {
    const { container } = render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" />)

    const grid = container.querySelector<HTMLElement>('.grid')!
    // Row 1 left: the song card. Row 3, both columns: the lyric box.
    expect(grid.querySelector('[class*="row-start-1"] [data-testid="song-info-title"]')).not.toBeNull()

    const lyricCell = grid.querySelector<HTMLElement>('[class*="row-start-3"]')!
    expect(lyricCell.className).toContain('col-span-2')
    expect(lyricCell.querySelector('[data-testid="lyric-box"]')).not.toBeNull()
  })

  // Purely decorative: everything a singer can actually point at lives in the
  // overlay underneath, so this layer must never swallow a click.
  it('never intercepts pointer events aimed at the overlay beneath it', () => {
    const { container } = render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" />)
    expect(container.querySelector<HTMLElement>('.grid')!.className).toContain('pointer-events-none')
  })

  it('draws exactly one lyric box, whatever the party size', () => {
    render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" />)
    expect(screen.getAllByTestId('lyric-box')).toHaveLength(1)
  })
})

// The jukebox's transport bar drives the stage through this handle.
describe('Stage: transport control', () => {
  function audioAt(seconds: number, duration: number) {
    const audio = screen.getByTestId('stage-clock-audio') as HTMLAudioElement
    let currentTime = seconds
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value
      },
    })
    Object.defineProperty(audio, 'duration', { configurable: true, value: duration })
    return audio
  }

  it('reports the song span and seeks the clock audio, clamped to #START..#END', () => {
    const controlRef = createRef<StageControl>()
    render(
      <Stage
        chart={{ ...chart, meta: { ...chart.meta, startMs: 5000, endMs: 120_000 } }}
        sourceDir="/abs/fixtures/sample-song"
        controlRef={controlRef}
        skipLeadIn
      />,
    )
    const audio = audioAt(30, 200)
    const control = controlRef.current!

    expect(control.getTime()).toBe(30)
    expect(control.getStartTime()).toBe(5)
    expect(control.getEndTime()).toBe(120)

    control.seek(60)
    expect(audio.currentTime).toBe(60)
    control.seek(1)
    expect(audio.currentTime).toBe(5)
    control.seek(500)
    expect(audio.currentTime).toBe(120)
    act(() => useStageStore.getState().reset())
  })

  it('falls back to the audio duration without #END, and can hide the song card', () => {
    const controlRef = createRef<StageControl>()
    render(<Stage chart={chart} sourceDir="/abs/fixtures/sample-song" controlRef={controlRef} showSongCard={false} skipLeadIn />)
    audioAt(0, 200)
    expect(controlRef.current!.getStartTime()).toBe(0)
    expect(controlRef.current!.getEndTime()).toBe(200)
    expect(screen.queryByTestId('song-info-card')).not.toBeInTheDocument()
    act(() => useStageStore.getState().reset())
  })

  // The demo song: #MP3 and #INSTRUMENTAL name the same WAV, #VOCALS the guide.
  // The instrumental is the clock, and its length is the song's.
  describe('on a song with vocal + instrumental stems', () => {
    const stemChart: SongChart = {
      ...chart,
      meta: { ...chart.meta, mp3Path: 'instrumental.wav', vocalsPath: 'vocals.wav', instrumentalPath: 'instrumental.wav' },
    }

    function renderStems() {
      const controlRef = createRef<StageControl>()
      render(<Stage chart={stemChart} sourceDir="/abs/fixtures/sample-song" controlRef={controlRef} skipLeadIn />)
      const clockAudio = screen.getByTestId('stage-clock-audio') as HTMLAudioElement
      const stemAudio = screen.getByTestId('stage-vocal-stem-audio') as HTMLAudioElement
      return { control: controlRef.current!, clockAudio, stemAudio }
    }

    function setMedia(element: HTMLMediaElement, props: Record<string, unknown>) {
      for (const [name, value] of Object.entries(props)) {
        Object.defineProperty(element, name, { configurable: true, value })
      }
    }

    function ranges(start: number, end: number): TimeRanges {
      return { length: 1, start: () => start, end: () => end } as unknown as TimeRanges
    }

    afterEach(() => act(() => useStageStore.getState().reset()))

    it('reports the clock (instrumental) length once its metadata arrives', () => {
      const { control, clockAudio } = renderStems()
      expect(clockAudio.getAttribute('src')).toContain('instrumental.wav')
      // Before `loadedmetadata`: NaN, which is no length at all.
      expect(control.getEndTime()).toBeNull()

      setMedia(clockAudio, { duration: 48.5 })
      fireEvent(clockAudio, new Event('loadedmetadata'))
      expect(control.getEndTime()).toBe(48.5)
    })

    it('keeps the length the clock last reported through durationchange', () => {
      const { control, clockAudio } = renderStems()
      setMedia(clockAudio, { duration: 48.5 })
      fireEvent(clockAudio, new Event('durationchange'))
      setMedia(clockAudio, { duration: NaN })
      expect(control.getEndTime()).toBe(48.5)
    })

    it('reads a WAV clock that reports Infinity by its seekable range, and seeks within it', () => {
      const { control, clockAudio } = renderStems()
      let currentTime = 9
      Object.defineProperty(clockAudio, 'currentTime', {
        configurable: true,
        get: () => currentTime,
        set: (value: number) => {
          currentTime = value
        },
      })
      setMedia(clockAudio, { duration: Infinity, seekable: ranges(0, 48.5) })

      expect(control.getTime()).toBe(9)
      expect(control.getEndTime()).toBe(48.5)
      control.seek(500)
      expect(clockAudio.currentTime).toBe(48.5)
    })

    it('falls back to the guide-vocal stem only when the clock cannot tell', () => {
      const { control, clockAudio, stemAudio } = renderStems()
      setMedia(clockAudio, { duration: Infinity })
      setMedia(stemAudio, { duration: 48.4 })
      expect(control.getEndTime()).toBe(48.4)

      setMedia(clockAudio, { duration: 48.5 })
      expect(control.getEndTime()).toBe(48.5)
    })

    it('stays unknown, never Infinity, while nothing knows the length', () => {
      const { control, clockAudio, stemAudio } = renderStems()
      setMedia(clockAudio, { duration: Infinity })
      setMedia(stemAudio, { duration: NaN })
      expect(control.getEndTime()).toBeNull()
    })
  })
})
