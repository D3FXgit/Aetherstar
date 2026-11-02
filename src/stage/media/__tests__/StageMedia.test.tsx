import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { getSong } from '../../../library/api'
import { clearSongGainCache } from '../../../audio/songGain'
import { StageMedia } from '../StageMedia'
import type { SongChart } from '../../../contracts/types'

vi.mock('../../../library/api', () => ({ getSong: vi.fn().mockResolvedValue(null) }))

const SOURCE_DIR = '/abs/fixtures/sample-song'

function chartWith(overrides: Partial<SongChart['meta']>): SongChart {
  return {
    meta: {
      artist: 'Nova Lane',
      title: 'Paper Satellites',
      mp3Path: 'song.mp3',
      bpm: 250,
      gap: 24065,
      videoGap: 1,
      ...overrides,
    },
    lines: [],
  }
}

describe('StageMedia', () => {
  // Behaviour change: an undecodable tag is still *attempted*, because the
  // app-media handler substitutes a transcoded .mp4/.webm sibling when one
  // exists (so converting a song needs no #VIDEO tag edit). Ambient cover
  // art sits underneath as the base layer, so if it genuinely can't decode
  // there is no flash of empty black.
  it("still shows ambient cover art beneath an unsupported .mpg video, and attempts it in case a transcoded sibling exists", () => {
    const chart = chartWith({ videoPath: 'Nova Lane - Paper Satellites [VD#1].mpg' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    expect(screen.getByTestId('stage-ambient-fallback')).toBeInTheDocument()
    expect(document.querySelector('video')).toBeInTheDocument()
  })

  it('removes the video and keeps the ambient cover when the video cannot decode', () => {
    const chart = chartWith({ videoPath: 'Nova Lane - Paper Satellites [VD#1].mpg' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    fireEvent.error(document.querySelector('video')!)

    expect(document.querySelector('video')).not.toBeInTheDocument()
    expect(screen.getByTestId('stage-ambient-fallback')).toBeInTheDocument()
  })

  it('renders a <video> for a natively playable video path', () => {
    const chart = chartWith({ videoPath: 'clip.mp4' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    const video = document.querySelector('video')
    expect(video).toBeInTheDocument()
    expect(video?.getAttribute('src')).toBe('app-media://media/abs/fixtures/sample-song/clip.mp4')
  })

  it('always renders an <audio> element with the resolved app-media URL', () => {
    const chart = chartWith({ videoPath: 'clip.mp4', mp3Path: 'song.mp3' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    const audio = document.querySelector('audio')
    expect(audio?.getAttribute('src')).toBe('app-media://media/abs/fixtures/sample-song/song.mp3')
  })

  it('renders a GlassErrorState when the audio element fails to load', () => {
    const chart = chartWith({ mp3Path: 'missing.mp3' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    fireEvent.error(document.querySelector('audio')!)

    expect(screen.getByTestId('glass-error-state')).toBeInTheDocument()
    expect(document.querySelector('audio')).not.toBeInTheDocument()
  })

  // Behaviour change: a broken *video* is no longer fatal. Audio is the
  // timing clock's only source, so audio failure still shows the error
  // state; video is decoration and degrades to the cover art instead of
  // blanking the whole stage mid-song.
  it('does NOT show the error state when only the video fails -- video is decoration, not the clock', () => {
    const chart = chartWith({ videoPath: 'missing.mp4' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    fireEvent.error(document.querySelector('video')!)

    expect(screen.queryByTestId('glass-error-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('stage-ambient-fallback')).toBeInTheDocument()
  })

  it('still shows the error state when the audio fails, since that leaves no clock source', () => {
    const chart = chartWith({ videoPath: 'clip.mp4' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    fireEvent.error(document.querySelector('audio')!)

    expect(screen.getByTestId('glass-error-state')).toBeInTheDocument()
  })
})

describe('StageMedia — stems', () => {
  it('renders exactly one <audio> for a song without stems (the overwhelming majority)', () => {
    render(<StageMedia chart={chartWith({})} sourceDir={SOURCE_DIR} />)

    expect(document.querySelectorAll('audio')).toHaveLength(1)
    expect(screen.queryByTestId('stage-vocal-stem-audio')).not.toBeInTheDocument()
  })

  it('makes the instrumental the clock and adds the vocals as a second, followed element', () => {
    const chart = chartWith({ mp3Path: 'mix.mp3', vocalsPath: 'voc.mp3', instrumentalPath: 'inst.mp3' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    expect(screen.getByTestId('stage-clock-audio').getAttribute('src')).toBe(
      `app-media://exact${SOURCE_DIR}/inst.mp3`,
    )
    expect(screen.getByTestId('stage-vocal-stem-audio').getAttribute('src')).toBe(
      `app-media://exact${SOURCE_DIR}/voc.mp3`,
    )
  })

  it('requests stems from the exact-path host so a missing one can never resolve to the full mix', () => {
    // The default host lets electron/protocols.cjs substitute "any audio file
    // in this folder" -- which for a stem is the mix, and would play the whole
    // song a second time on top of the instrumental.
    const chart = chartWith({ mp3Path: 'mix.mp3', vocalsPath: 'voc.mp3', instrumentalPath: 'inst.mp3' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    expect(screen.getByTestId('stage-vocal-stem-audio').getAttribute('src')).toContain('app-media://exact')
  })

  it('plays a stems-only chart (no #AUDIO/#MP3 at all) off the instrumental', () => {
    const chart = chartWith({ mp3Path: '', vocalsPath: 'voc.mp3', instrumentalPath: 'inst.mp3' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    expect(screen.getByTestId('stage-clock-audio').getAttribute('src')).toContain('inst.mp3')
    expect(screen.queryByTestId('glass-error-state')).not.toBeInTheDocument()
  })

  it('falls back to the full mix — never to silence or an error — when the vocal stem cannot load', () => {
    const chart = chartWith({ mp3Path: 'mix.mp3', vocalsPath: 'missing.mp3', instrumentalPath: 'inst.mp3' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    fireEvent.error(screen.getByTestId('stage-vocal-stem-audio'))

    expect(screen.queryByTestId('stage-vocal-stem-audio')).not.toBeInTheDocument()
    expect(screen.getByTestId('stage-clock-audio').getAttribute('src')).toContain('mix.mp3')
    expect(screen.queryByTestId('glass-error-state')).not.toBeInTheDocument()
  })

  it('keeps the already-running instrumental as the clock when the vocal stem fails mid-song', () => {
    const chart = chartWith({ mp3Path: 'mix.mp3', vocalsPath: 'missing.mp3', instrumentalPath: 'inst.mp3' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} playbackStarted />)

    fireEvent.error(screen.getByTestId('stage-vocal-stem-audio'))

    // Swapping the clock here would reload a fresh element at position 0 and
    // break the song outright -- much worse than a missing guide vocal.
    expect(screen.getByTestId('stage-clock-audio').getAttribute('src')).toContain('inst.mp3')
    expect(screen.queryByTestId('glass-error-state')).not.toBeInTheDocument()
  })

  it('skips every clock source that has failed, and shows the error once none is left', () => {
    const chart = chartWith({ mp3Path: 'mix.mp3', vocalsPath: 'voc.mp3', instrumentalPath: 'inst.mp3' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    fireEvent.error(screen.getByTestId('stage-clock-audio')) // the instrumental
    expect(screen.getByTestId('stage-clock-audio').getAttribute('src')).toContain('mix.mp3')

    fireEvent.error(screen.getByTestId('stage-clock-audio')) // the mix -- never back to the instrumental
    expect(screen.getByTestId('stage-clock-audio').getAttribute('src')).toContain('voc.mp3')

    fireEvent.error(screen.getByTestId('stage-clock-audio')) // the last candidate
    expect(screen.getByTestId('glass-error-state')).toBeInTheDocument()
  })

  it('promotes the full mix when the instrumental clock itself fails, instead of showing the error state', () => {
    const chart = chartWith({ mp3Path: 'mix.mp3', vocalsPath: 'voc.mp3', instrumentalPath: 'inst.mp3' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    fireEvent.error(screen.getByTestId('stage-clock-audio'))

    expect(screen.getByTestId('stage-clock-audio').getAttribute('src')).toContain('mix.mp3')
    expect(screen.queryByTestId('glass-error-state')).not.toBeInTheDocument()
  })

  // Media separation: the <audio> element is the only sound source on the
  // stage. A karaoke video very often carries the studio recording on its own
  // audio track, which played over the parsed mix as a second, drifting copy
  // of the song. The element must therefore be muted three ways -- attribute,
  // property, and volume -- because the attribute alone is only consulted at
  // element creation, and a video element that gets re-created (a src swap, a
  // codec fallback) can otherwise come back audible.
  it('hard-mutes the decorative video so the parsed audio file is the only sound source', () => {
    const chart = chartWith({ videoPath: 'clip.mp4', mp3Path: 'song.mp3' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    const video = document.querySelector('video')!
    expect(video.muted).toBe(true)
    expect(video.defaultMuted).toBe(true)
    expect(video.volume).toBe(0)
    expect(video.hasAttribute('muted')).toBe(true)
  })

  it('leaves the clock audio audible -- muting the video must never silence the song', () => {
    const chart = chartWith({ videoPath: 'clip.mp4', mp3Path: 'song.mp3' })
    render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)

    const audio = screen.getByTestId('stage-clock-audio') as HTMLAudioElement
    expect(audio.muted).toBe(false)
  })

  it('tells its parent whether ducking is possible', () => {
    const onStemPlan = vi.fn()
    const chart = chartWith({ mp3Path: 'mix.mp3', vocalsPath: 'voc.mp3', instrumentalPath: 'inst.mp3' })
    const { rerender } = render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} onStemPlan={onStemPlan} />)
    expect(onStemPlan).toHaveBeenLastCalledWith(true)

    rerender(<StageMedia chart={chartWith({})} sourceDir={SOURCE_DIR} onStemPlan={onStemPlan} />)
    expect(onStemPlan).toHaveBeenLastCalledWith(false)
  })
})

// Loudness normalisation (src/audio/loudness.ts). `sourceDir` is the song's
// primary key in the library index, so StageMedia looks the measurement up
// itself rather than having a number threaded down to it from four screens
// away, and applies it as a plain `volume` write -- no Web Audio graph on the
// element that is also the timing clock.
describe('StageMedia — loudness normalisation', () => {
  const LOUD_SONG_FOLDER = SOURCE_DIR

  beforeEach(() => {
    clearSongGainCache()
    vi.mocked(getSong).mockReset()
    vi.mocked(getSong).mockResolvedValue(null)
  })

  async function renderAndSettle(chart: SongChart) {
    const result = render(<StageMedia chart={chart} sourceDir={LOUD_SONG_FOLDER} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    return result
  }

  function clockAudio(): HTMLAudioElement {
    return screen.getByTestId('stage-clock-audio') as HTMLAudioElement
  }

  it('pulls a song measured 12 dB hot down to the target level', async () => {
    // One very loud master: -5.9 LUFS against a -18 LUFS target.
    vi.mocked(getSong).mockResolvedValue({ loudnessLufs: -5.9, truePeakDbtp: 3 } as never)

    await renderAndSettle(chartWith({ mp3Path: 'song.mp3' }))

    expect(clockAudio().volume).toBeCloseTo(10 ** (-12.1 / 20), 6)
  })

  it('plays a song that has never been analysed at the conservative unmeasured level (-6 dB)', async () => {
    // The un-rescanned library: not silence, not full blast.
    vi.mocked(getSong).mockResolvedValue({ loudnessLufs: null, truePeakDbtp: null } as never)

    await renderAndSettle(chartWith({ mp3Path: 'song.mp3' }))

    expect(clockAudio().volume).toBeCloseTo(10 ** (-6 / 20), 6)
  })

  it('opens at the unmeasured level rather than silence while the measurement is still in flight', () => {
    let resolveLookup: (song: unknown) => void = () => {}
    vi.mocked(getSong).mockReturnValue(new Promise((resolve) => { resolveLookup = resolve }) as never)

    render(<StageMedia chart={chartWith({ mp3Path: 'song.mp3' })} sourceDir={LOUD_SONG_FOLDER} />)

    expect(clockAudio().volume).toBeCloseTo(10 ** (-6 / 20), 6)
    resolveLookup(null)
  })

  it('honours the chart author s #VOLUME on top of the measurement', async () => {
    vi.mocked(getSong).mockResolvedValue({ loudnessLufs: -18, truePeakDbtp: -6 } as never)

    await renderAndSettle(chartWith({ mp3Path: 'song.mp3', volume: 0.5 }))

    expect(clockAudio().volume).toBeCloseTo(0.5, 10)
  })

  it('applies #VOLUME on its own when the song has no stored measurement', async () => {
    vi.mocked(getSong).mockResolvedValue(null)

    await renderAndSettle(chartWith({ mp3Path: 'song.mp3', volume: 0.4 }))

    expect(clockAudio().volume).toBeCloseTo(0.4 * 10 ** (-6 / 20), 6)
  })

  it('never asks the element for a volume it would throw on', async () => {
    // -60 LUFS wants a +42 dB boost, which an HTMLMediaElement cannot express;
    // asking for it would throw IndexSizeError and take the whole stage down.
    vi.mocked(getSong).mockResolvedValue({ loudnessLufs: -60, truePeakDbtp: -40 } as never)

    await renderAndSettle(chartWith({ mp3Path: 'song.mp3' }))

    expect(clockAudio().volume).toBe(1)
  })
})

describe('StageMedia: no playable video', () => {
  it('shows the #BACKGROUND image when the video is missing, and logs a warning rather than a crash', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const chart = chartWith({ videoPath: 'video.mp4', backgroundPath: 'Moonlight Duet [BG].jpg', coverPath: 'cover.jpg' })
      render(<StageMedia chart={chart} sourceDir={SOURCE_DIR} />)
      fireEvent.error(document.querySelector('video')!)

      expect(document.querySelector('video')).not.toBeInTheDocument()
      expect(screen.getByTestId('stage-ambient-background')).toHaveAttribute(
        'src',
        `app-media://media/abs/fixtures/sample-song/${encodeURI('Moonlight Duet [BG].jpg')}`,
      )
      expect(error.mock.calls.some((call) => String(call[0]).includes('[AetherStar crash]'))).toBe(false)
      expect(warn.mock.calls.some((call) => String(call[0]).includes('video-unavailable'))).toBe(true)
    } finally {
      error.mockRestore()
      warn.mockRestore()
    }
  })

  it('without #BACKGROUND or #COVER, still asks for the folder cover under the conventional name', () => {
    render(<StageMedia chart={chartWith({})} sourceDir={SOURCE_DIR} />)
    expect(screen.getByTestId('stage-ambient-cover').getAttribute('src')).toBe(
      `app-media://media/abs/fixtures/sample-song/${encodeURI('Nova Lane - Paper Satellites [CO].jpg')}`,
    )
  })
})
