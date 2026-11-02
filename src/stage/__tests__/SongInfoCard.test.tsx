import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { createRef } from 'react'
import { SongInfoCard } from '../SongInfoCard'
import type { SongMeta } from '../../contracts/types'

const META: SongMeta = {
  artist: 'Nova Lane',
  title: 'Paper Satellites',
  mp3Path: 'song.mp3',
  coverPath: 'cover.jpg',
  bpm: 250,
  gap: 0,
  videoGap: 0,
}

/** A stand-in for the stage's real <audio> element (jsdom never actually plays one). */
function audioRefWith(currentTime: number, duration: number) {
  const ref = createRef<HTMLAudioElement>()
  Object.defineProperty(ref, 'current', { value: { currentTime, duration } as HTMLAudioElement, writable: true })
  return ref
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SongInfoCard', () => {
  it('renders the title, cover art, and the artist · BPM · time metadata line', () => {
    render(<SongInfoCard meta={META} coverUrl="app-media://media/songs/cover.jpg" audioRef={audioRefWith(72, 262)} />)

    expect(screen.getByTestId('song-info-title')).toHaveTextContent('Paper Satellites')
    expect(screen.getByTestId('song-info-cover')).toHaveAttribute('src', 'app-media://media/songs/cover.jpg')
    // Layout: "Nova Lane · 250 BPM · 1:12 / 4:22".
    expect(screen.getByTestId('song-info-meta')).toHaveTextContent('Nova Lane · 250 BPM · 1:12 / 4:22')
  })

  it('tracks the real audio clock as it advances', () => {
    vi.useFakeTimers()
    const ref = audioRefWith(0, 262)
    render(<SongInfoCard meta={META} coverUrl={null} audioRef={ref} />)
    expect(screen.getByTestId('song-info-meta')).toHaveTextContent('0:00 / 4:22')

    ref.current!.currentTime = 95
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.getByTestId('song-info-meta')).toHaveTextContent('1:35 / 4:22')
  })

  it('shows elapsed time alone rather than a made-up total when the duration is not known yet', () => {
    render(<SongInfoCard meta={META} coverUrl={null} audioRef={audioRefWith(5, Number.NaN)} />)
    expect(screen.getByTestId('song-info-meta')).toHaveTextContent('Nova Lane · 250 BPM · 0:05')
    expect(screen.getByTestId('song-info-meta').textContent).not.toContain('/')
  })

  // Regression: the cover thumb used to be `h-full aspect-square shrink-0`
  // around an `h-full w-full` <img>. Inside a `self-start` grid cell the card
  // has no definite height, so `h-full` resolved to auto and the <img> fell
  // back to its *intrinsic* size -- a 3000x3000 cover.jpg then dragged the
  // thumb (and the whole card) to 3000px, and `shrink-0` forbade flex from
  // pulling it back. It only looked fine on charts whose cover happened to be
  // small. The thumb now carries its own viewport-relative clamp, so the
  // source image's pixel dimensions cannot influence layout at all.
  it('bounds the cover thumb to a clamped size instead of letting the image drive layout', () => {
    render(<SongInfoCard meta={META} coverUrl="app-media://media/songs/cover.jpg" audioRef={audioRefWith(0, 0)} />)

    const thumb = screen.getByTestId('song-info-cover-thumb')
    expect(thumb.className).toMatch(/size-\[clamp\(/)
    expect(thumb.className).not.toContain('h-full')
    expect(thumb.className).not.toContain('aspect-square')
  })

  it('caps the whole card so it can never spread across a high-resolution display', () => {
    render(<SongInfoCard meta={META} coverUrl={null} audioRef={audioRefWith(0, 0)} />)

    const card = screen.getByTestId('song-info-card')
    expect(card.className).toMatch(/max-w-\[/)
    // `h-full` on a card in an auto-height grid cell is what invited the
    // circular sizing in the first place.
    expect(card.className).not.toContain('h-full')
  })

  // The card composites over playing video every frame it is on screen, and a
  // backdrop blur re-samples that video every frame. A solid scrim and a text
  // shadow do the legibility work for none of the GPU time.
  it('carries no backdrop blur, because it composites over playing video', () => {
    render(<SongInfoCard meta={META} coverUrl={null} audioRef={audioRefWith(0, 0)} />)

    const card = screen.getByTestId('song-info-card')
    expect(card.className).not.toMatch(/backdrop-blur/)
    expect(card.className).toMatch(/bg-black\/6\d/)
  })

  it('renders without cover art when the chart has no #COVER', () => {
    render(<SongInfoCard meta={{ ...META, coverPath: undefined }} coverUrl={null} audioRef={audioRefWith(0, 0)} />)
    expect(screen.queryByTestId('song-info-cover')).not.toBeInTheDocument()
    expect(screen.getByTestId('song-info-card')).toBeInTheDocument()
  })
})

describe('SongInfoCard: a cover that will not load', () => {
  it('drops the thumb instead of leaving an empty square', () => {
    render(<SongInfoCard meta={META} coverUrl="app-media://media/songs/missing.jpg" audioRef={audioRefWith(0, 0)} />)
    fireEvent.error(screen.getByTestId('song-info-cover'))
    expect(screen.queryByTestId('song-info-cover-thumb')).not.toBeInTheDocument()
    expect(screen.getByTestId('song-info-title')).toHaveTextContent('Paper Satellites')
  })
})
