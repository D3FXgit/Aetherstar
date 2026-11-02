import { render, screen, act, fireEvent } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SongStartTransition } from '../SongStartTransition'
import { useSfx } from '../../audio/useSfx'
import { SONG_SELECTED_DURATION_MS } from '../../audio/sfxAssets'
import type { ImagePixelSampler } from '../../design/palette/imagePixelSampler'

const COVER_URL = 'aetherstar-media://roots/library/major-tom/cover.jpg'

/** A uniform RGBA buffer -- enough for the extractor, which only cares about bucket counts. */
function solidPixels(r: number, g: number, b: number, count = 64): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4)
  for (let i = 0; i < count; i++) {
    data.set([r, g, b, 255], i * 4)
  }
  return data
}

function samplerReturning(pixels: Uint8ClampedArray): ImagePixelSampler {
  return vi.fn().mockResolvedValue(pixels) as unknown as ImagePixelSampler
}

/** Drains the palette promise chain under fake timers, where waitFor cannot tick. */
async function flushPalette() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

const mocks = vi.hoisted(() => ({ reducedMotion: false }))

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => mocks.reducedMotion }
})

// Each play returns its own handle, exactly as the real player does, and each
// handle's `stop` is a spy -- which is what lets the tests below assert that a
// sound the transition started was actually released again.
vi.mock('../../audio/useSfx', () => {
  const play = vi.fn(() => ({ stop: vi.fn() }))
  return { useSfx: Object.assign((selector: (s: { play: typeof play }) => unknown) => selector({ play }), { getState: () => ({ play }) }) }
})

function playSpy() {
  return (useSfx as unknown as { getState: () => { play: ReturnType<typeof vi.fn> } }).getState().play
}

/** Every handle returned for `name`, in play order. */
function handlesFor(name: string): { stop: ReturnType<typeof vi.fn> }[] {
  const spy = playSpy()
  return spy.mock.results
    .map((result, index) => ({ result, name: spy.mock.calls[index]?.[0] }))
    .filter((entry) => entry.name === name)
    .map((entry) => entry.result.value as { stop: ReturnType<typeof vi.fn> })
}

/** Sounds this transition started and has not stopped -- i.e. what is actually audible. */
function livePlaysOf(name: string): number {
  return handlesFor(name).filter((handle) => handle.stop.mock.calls.length === 0).length
}

describe('SongStartTransition', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.reducedMotion = false
    playSpy().mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('plays the song-selected sound as soon as the transition starts', () => {
    render(<SongStartTransition onComplete={vi.fn()} durationMs={4000} />)
    expect(playSpy()).toHaveBeenCalledWith('songSelected')
  })

  it('counts 3, 2, 1 over the final three seconds, beeping on each', () => {
    render(<SongStartTransition onComplete={vi.fn()} durationMs={4000} />)

    expect(screen.queryByTestId('transition-countdown')).not.toBeInTheDocument()

    act(() => void vi.advanceTimersByTime(1000)) // T-3000
    expect(screen.getByTestId('transition-countdown')).toHaveTextContent('3')

    act(() => void vi.advanceTimersByTime(1000)) // T-2000
    expect(screen.getByTestId('transition-countdown')).toHaveTextContent('2')

    act(() => void vi.advanceTimersByTime(1000)) // T-1000
    expect(screen.getByTestId('transition-countdown')).toHaveTextContent('1')

    expect(playSpy().mock.calls.filter(([name]) => name === 'countdownBeep')).toHaveLength(3)
  })

  it('plays the go sound and completes exactly once, at the end of the sound', () => {
    const onComplete = vi.fn()
    render(<SongStartTransition onComplete={onComplete} durationMs={4000} />)

    act(() => void vi.advanceTimersByTime(3999))
    expect(onComplete).not.toHaveBeenCalled()

    act(() => void vi.advanceTimersByTime(1))
    expect(playSpy()).toHaveBeenCalledWith('countdownGo')
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('renders the song title and artist while the transition runs', () => {
    render(<SongStartTransition songTitle="Orbit Seven" artist="Mira Castell" onComplete={vi.fn()} durationMs={4000} />)
    expect(screen.getByTestId('transition-song-title')).toHaveTextContent('Orbit Seven')
    expect(screen.getByText('Mira Castell')).toBeInTheDocument()
  })

  it('cancels its timers on unmount so a cancelled transition never fires onComplete', () => {
    const onComplete = vi.fn()
    const { unmount } = render(<SongStartTransition onComplete={onComplete} durationMs={4000} />)

    unmount()
    act(() => void vi.advanceTimersByTime(10000))

    expect(onComplete).not.toHaveBeenCalled()
  })

  // The "audio gets played layered on the transition to start" report. The
  // effect started sounds it had no way to stop, so a cancelled run of the
  // sequence left its audio playing -- over the next screen in every build, and
  // over its own immediate replacement under StrictMode in development.
  describe('a cancelled run takes its audio with it', () => {
    it('stops the transition sound when the user backs out mid-transition', () => {
      const { unmount } = render(<SongStartTransition onComplete={vi.fn()} durationMs={4000} />)

      // Half a second in: song_selected.wav still has 3.5 s left to run.
      act(() => void vi.advanceTimersByTime(500))
      unmount()

      expect(livePlaysOf('songSelected')).toBe(0)
    })

    it('stops a countdown beep that a cancelled run had already started', () => {
      const { unmount } = render(<SongStartTransition onComplete={vi.fn()} durationMs={4000} />)

      act(() => void vi.advanceTimersByTime(1000)) // T-3000: "3"
      expect(handlesFor('countdownBeep')).toHaveLength(1)
      unmount()

      expect(livePlaysOf('countdownBeep')).toBe(0)
    })

    it('leaves exactly one transition sound audible through a StrictMode mount/cleanup/mount', () => {
      // React StrictMode deliberately mounts, cleans up and mounts again in
      // development. The sequence therefore runs twice, and before the cleanup
      // released what it started, both copies of a 4.75 s sound played on top
      // of each other -- roughly 6 dB louder and slightly phased.
      render(
        <StrictMode>
          <SongStartTransition onComplete={vi.fn()} durationMs={4000} />
        </StrictMode>,
      )

      // Both runs really did start the sound -- that is StrictMode's whole
      // point, and nothing here suppresses it...
      expect(handlesFor('songSelected').length).toBeGreaterThanOrEqual(2)
      // ...but only the surviving run's copy is still playing.
      expect(livePlaysOf('songSelected')).toBe(1)
    })

    it('lets the go sound through, since the screen it ends on is the one being handed over to', () => {
      const onComplete = vi.fn()
      const { unmount } = render(<SongStartTransition onComplete={onComplete} durationMs={4000} />)

      act(() => void vi.advanceTimersByTime(4000))
      // The real app unmounts this screen the instant onComplete advances the
      // session; the "go" must survive that.
      unmount()

      expect(onComplete).toHaveBeenCalledOnce()
      expect(livePlaysOf('countdownGo')).toBe(1)
    })
  })

  describe('album cover', () => {
    it('shows the selected song s cover art', () => {
      render(<SongStartTransition songTitle="Orbit Seven" coverUrl={COVER_URL} onComplete={vi.fn()} durationMs={4000} />)
      expect(screen.getByTestId('transition-cover')).toHaveAttribute('src', COVER_URL)
    })

    it('leaves the cover out entirely when the song has none, keeping the title-only look', () => {
      render(<SongStartTransition songTitle="Orbit Seven" onComplete={vi.fn()} durationMs={4000} />)
      expect(screen.queryByTestId('transition-cover')).not.toBeInTheDocument()
      expect(screen.getByTestId('transition-song-title')).toHaveTextContent('Orbit Seven')
    })

    it('drops the cover rather than showing a broken image when it fails to load', () => {
      render(<SongStartTransition songTitle="Orbit Seven" coverUrl={COVER_URL} onComplete={vi.fn()} durationMs={4000} />)

      act(() => void fireEvent.error(screen.getByTestId('transition-cover')))

      expect(screen.queryByTestId('transition-cover')).not.toBeInTheDocument()
      expect(screen.getByTestId('transition-song-title')).toHaveTextContent('Orbit Seven')
    })

    it('is decorative to assistive tech -- the title beside it already carries the name', () => {
      render(<SongStartTransition songTitle="Orbit Seven" coverUrl={COVER_URL} onComplete={vi.fn()} durationMs={4000} />)
      expect(screen.getByTestId('transition-cover')).toHaveAttribute('alt', '')
    })
  })

  describe('ambient palette', () => {
    it('starts on the default magenta/cyan gradient with no cover-derived layer', () => {
      render(<SongStartTransition onComplete={vi.fn()} durationMs={4000} />)

      expect(screen.getByTestId('ambient-default-near').getAttribute('style')).toContain('oklch(0.42 0.15 320)')
      expect(screen.queryByTestId('ambient-cover-near')).not.toBeInTheDocument()
    })

    it('morphs the gradient to a colour taken from the cover once extraction resolves', async () => {
      render(
        <SongStartTransition
          coverUrl={COVER_URL}
          paletteSampler={samplerReturning(solidPixels(200, 30, 30))}
          onComplete={vi.fn()}
          durationMs={4000}
        />,
      )

      await flushPalette()

      // sRGB(200,30,30) -> OKLCh L .535 / C .203 / h 27.61, with chroma clamped
      // into the ambient band. The point of the assertion is the hue: it is the
      // cover's, not the default 320.
      const style = screen.getByTestId('ambient-cover-near').getAttribute('style')
      expect(style).toContain('oklch(0.535 0.18 27.61)')
      expect(style).not.toContain('320')
    })

    it('keeps the default gradient when the cover has no usable colour (an all-black sleeve)', async () => {
      render(
        <SongStartTransition
          coverUrl={COVER_URL}
          paletteSampler={samplerReturning(solidPixels(8, 8, 10))}
          onComplete={vi.fn()}
          durationMs={4000}
        />,
      )

      await flushPalette()

      expect(screen.queryByTestId('ambient-cover-near')).not.toBeInTheDocument()
      expect(screen.getByTestId('ambient-default-near').getAttribute('style')).toContain('320')
    })

    it('keeps the default gradient when the cover cannot be sampled at all', async () => {
      render(
        <SongStartTransition
          coverUrl={COVER_URL}
          paletteSampler={vi.fn().mockResolvedValue(null)}
          onComplete={vi.fn()}
          durationMs={4000}
        />,
      )

      await flushPalette()

      expect(screen.queryByTestId('ambient-cover-near')).not.toBeInTheDocument()
    })

    it('never lets a failing sampler take the transition down: the countdown still completes', async () => {
      const onComplete = vi.fn()
      render(
        <SongStartTransition
          coverUrl={COVER_URL}
          paletteSampler={vi.fn().mockRejectedValue(new Error('SecurityError'))}
          onComplete={onComplete}
          durationMs={4000}
        />,
      )

      await flushPalette()
      act(() => void vi.advanceTimersByTime(4000))

      expect(onComplete).toHaveBeenCalledOnce()
      expect(playSpy()).toHaveBeenCalledWith('countdownGo')
    })

    it('holds the timing contract with a cover present -- the palette work is off the critical path', async () => {
      const onComplete = vi.fn()
      render(
        <SongStartTransition
          coverUrl={COVER_URL}
          paletteSampler={samplerReturning(solidPixels(200, 30, 30))}
          onComplete={onComplete}
          durationMs={4000}
        />,
      )

      await flushPalette()

      act(() => void vi.advanceTimersByTime(1000))
      expect(screen.getByTestId('transition-countdown')).toHaveTextContent('3')
      act(() => void vi.advanceTimersByTime(2999))
      expect(onComplete).not.toHaveBeenCalled()
      act(() => void vi.advanceTimersByTime(1))
      expect(onComplete).toHaveBeenCalledOnce()
    })
  })

  describe('countdown hierarchy and announcements', () => {
    it('lets the artwork recede once the countdown owns the frame', () => {
      render(<SongStartTransition songTitle="Orbit Seven" coverUrl={COVER_URL} onComplete={vi.fn()} durationMs={4000} />)

      expect(screen.getByTestId('transition-artwork')).toHaveAttribute('data-stage', 'front')

      act(() => void vi.advanceTimersByTime(1000)) // T-3000, "3"
      expect(screen.getByTestId('transition-artwork')).toHaveAttribute('data-stage', 'receded')
    })

    it('announces the song, then each count, through one stable live region', () => {
      render(<SongStartTransition songTitle="Orbit Seven" artist="Mira Castell" onComplete={vi.fn()} durationMs={4000} />)

      const announcer = screen.getByTestId('transition-announcer')
      expect(announcer).toHaveAttribute('aria-live', 'assertive')
      expect(announcer).toHaveTextContent('Starting Orbit Seven by Mira Castell')

      act(() => void vi.advanceTimersByTime(1000))
      expect(announcer).toHaveTextContent('Starting in 3')
    })

    it('hides the decorative numeral from screen readers so the count is announced once, not twice', () => {
      render(<SongStartTransition onComplete={vi.fn()} durationMs={4000} />)
      act(() => void vi.advanceTimersByTime(1000))
      expect(screen.getByTestId('transition-countdown')).toHaveAttribute('aria-hidden', 'true')
    })

    it('replaces the zoom with a fade when the viewer has asked for reduced motion', () => {
      mocks.reducedMotion = true
      render(<SongStartTransition onComplete={vi.fn()} durationMs={4000} />)

      // A sustained scale of the whole frame is exactly the peripheral zooming
      // the setting exists to suppress, so the carrier gets no transform at all.
      expect(screen.getByTestId('ambient-zoom-near').getAttribute('style')).not.toContain('scale')
      expect(screen.getByTestId('ambient-zoom-far').getAttribute('style')).not.toContain('scale')
    })

    it('still zooms by default', () => {
      render(<SongStartTransition onComplete={vi.fn()} durationMs={4000} />)
      expect(screen.getByTestId('ambient-zoom-near').getAttribute('style')).toContain('scale')
    })

    it('keeps the countdown timing identical under reduced motion', () => {
      mocks.reducedMotion = true
      const onComplete = vi.fn()
      render(<SongStartTransition onComplete={onComplete} durationMs={4000} />)

      act(() => void vi.advanceTimersByTime(1000))
      expect(screen.getByTestId('transition-countdown')).toHaveTextContent('3')
      act(() => void vi.advanceTimersByTime(3000))
      expect(onComplete).toHaveBeenCalledOnce()
    })

    it('identifies itself as the modal moment it is, and says how to back out', () => {
      render(<SongStartTransition songTitle="Orbit Seven" onComplete={vi.fn()} durationMs={4000} />)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(screen.getByTestId('transition-cancel-hint')).toBeInTheDocument()
    })
  })

  // Every assertion here pins one half of a measured regression. Profiled
  // against the real Electron app on an M3 Max at 1728x1080 CSS / 3456x2160
  // device px (DPR 2), reading the compositor's own trace rather than rAF
  // alone: without these promotions the screen spent ~1.9s of every 4s inside
  // 140-216ms `RasterDecoderImpl::DoRasterCHROMIUM` tasks in the GPU process
  // (median 72.9 rAF fps, ~260 dropped frames, 2316 raster tasks/s); with them
  // it holds 120fps with zero dropped frames and 74 raster tasks/s.
  describe('compositor promotion (frame-rate regression)', () => {
    it('promotes the zooming ambient carriers, so the full-screen gradients rasterise once instead of every frame', () => {
      render(<SongStartTransition onComplete={vi.fn()} durationMs={4000} />)

      expect(screen.getByTestId('ambient-zoom-near')).toHaveStyle({ willChange: 'transform' })
      expect(screen.getByTestId('ambient-zoom-far')).toHaveStyle({ willChange: 'transform' })
    })

    it('promotes the artwork, so scale-springing the shadowed cover cannot re-raster the whole frame', () => {
      render(<SongStartTransition songTitle="Orbit Seven" coverUrl={COVER_URL} onComplete={vi.fn()} durationMs={4000} />)

      expect(screen.getByTestId('transition-artwork')).toHaveStyle({ willChange: 'transform' })
    })

    it('promotes nothing under reduced motion, where no transform animates and a layer would be pure cost', () => {
      mocks.reducedMotion = true
      render(<SongStartTransition songTitle="Orbit Seven" coverUrl={COVER_URL} onComplete={vi.fn()} durationMs={4000} />)

      for (const id of ['ambient-zoom-near', 'ambient-zoom-far', 'transition-artwork']) {
        expect(screen.getByTestId(id).style.willChange).toBe('')
      }
    })
  })

  describe('timing contract', () => {
    // The 4750ms/3-2-1 shape is measured against assets/sfx/song_selected.wav's
    // envelope, not chosen. Nothing done for frame rate may move it.
    it('defaults to the measured length of song_selected.wav', () => {
      const onComplete = vi.fn()
      render(<SongStartTransition onComplete={onComplete} />)

      expect(SONG_SELECTED_DURATION_MS).toBe(4750)

      act(() => void vi.advanceTimersByTime(SONG_SELECTED_DURATION_MS - 3000))
      expect(screen.getByTestId('transition-countdown')).toHaveTextContent('3')
      act(() => void vi.advanceTimersByTime(1000))
      expect(screen.getByTestId('transition-countdown')).toHaveTextContent('2')
      act(() => void vi.advanceTimersByTime(1000))
      expect(screen.getByTestId('transition-countdown')).toHaveTextContent('1')

      act(() => void vi.advanceTimersByTime(999))
      expect(onComplete).not.toHaveBeenCalled()
      act(() => void vi.advanceTimersByTime(1))
      expect(onComplete).toHaveBeenCalledOnce()
    })
  })
})
