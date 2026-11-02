import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SongPreviewMedia } from '../SongPreviewMedia'

const mocks = vi.hoisted(() => ({ reducedMotion: false }))

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>()
  return { ...actual, useReducedMotion: () => mocks.reducedMotion }
})

const VIDEO_URL = 'aetherstar-media://roots/library/song/video.mp4'
const COVER_URL = 'aetherstar-media://roots/library/song/cover.jpg'

describe('SongPreviewMedia', () => {
  beforeEach(() => {
    mocks.reducedMotion = false
  })

  it('paints the cover art underneath the video, so a video that has not decoded a frame yet is never a black box', () => {
    render(<SongPreviewMedia videoUrl={VIDEO_URL} coverUrl={COVER_URL} />)

    expect(screen.getByTestId('song-preview-video')).toHaveAttribute('src', VIDEO_URL)
    expect(screen.getByTestId('song-preview-cover')).toHaveAttribute('src', COVER_URL)
  })

  // The bug this component exists for: an UltraStar library is full of MPEG-1/2
  // .mpg and DivX .avi that Chromium genuinely cannot decode
  // (DEMUXER_ERROR_COULD_NOT_OPEN). Without an onError the <video> fails
  // silently and the panel is a black rectangle -- with perfectly good cover art
  // sitting unused behind the ternary that chose the video.
  it('drops the video and leaves the cover showing when the video cannot be decoded', () => {
    render(<SongPreviewMedia videoUrl={VIDEO_URL} coverUrl={COVER_URL} />)

    fireEvent.error(screen.getByTestId('song-preview-video'))

    expect(screen.queryByTestId('song-preview-video')).not.toBeInTheDocument()
    expect(screen.getByTestId('song-preview-cover')).toBeInTheDocument()
  })

  it('attempts an .mpg anyway, because the media protocol substitutes a transcoded sibling when one exists', () => {
    render(<SongPreviewMedia videoUrl="aetherstar-media://roots/library/song/video.mpg" coverUrl={COVER_URL} />)

    expect(screen.getByTestId('song-preview-video')).toBeInTheDocument()
  })

  it('shows a labelled placeholder, not an empty black well, when there is neither a playable video nor a cover', () => {
    render(<SongPreviewMedia videoUrl={VIDEO_URL} coverUrl={null} />)

    fireEvent.error(screen.getByTestId('song-preview-video'))

    expect(screen.getByTestId('song-preview-empty')).toBeInTheDocument()
  })

  it('gives the next song a fresh attempt at its video after the previous one failed', () => {
    const { rerender } = render(<SongPreviewMedia videoUrl={VIDEO_URL} coverUrl={COVER_URL} />)
    fireEvent.error(screen.getByTestId('song-preview-video'))
    expect(screen.queryByTestId('song-preview-video')).not.toBeInTheDocument()

    rerender(<SongPreviewMedia videoUrl="aetherstar-media://roots/library/other/video.mp4" coverUrl={COVER_URL} />)

    expect(screen.getByTestId('song-preview-video')).toBeInTheDocument()
  })

  // Muted is load-bearing twice over: Chromium only lets a video autoplay
  // without a user gesture while it is muted, and the audio for this preview is
  // a separate ducked channel (useWebAudioManager's 'preview') that the video
  // must never double.
  it('autoplays muted, looping and inline -- the only combination Chromium will start without a gesture', () => {
    render(<SongPreviewMedia videoUrl={VIDEO_URL} coverUrl={COVER_URL} />)

    const video = screen.getByTestId('song-preview-video') as HTMLVideoElement
    expect(video.muted).toBe(true)
    expect(video).toHaveAttribute('autoplay')
    expect(video).toHaveAttribute('loop')
    expect(video).toHaveAttribute('playsinline')
  })

  // A looping video that starts on its own in the corner of a browse screen is
  // exactly the "automatic and repetitive ... peripheral motion" Reduce Motion
  // asks apps to drop. The cover is the same picture, held still.
  it('holds on the cover instead of autoplaying the loop under Reduce Motion', () => {
    mocks.reducedMotion = true

    render(<SongPreviewMedia videoUrl={VIDEO_URL} coverUrl={COVER_URL} />)

    expect(screen.queryByTestId('song-preview-video')).not.toBeInTheDocument()
    expect(screen.getByTestId('song-preview-cover')).toBeInTheDocument()
  })

  it('shows the cover alone for a song with no video at all', () => {
    render(<SongPreviewMedia videoUrl={null} coverUrl={COVER_URL} />)

    expect(screen.queryByTestId('song-preview-video')).not.toBeInTheDocument()
    expect(screen.getByTestId('song-preview-cover')).toBeInTheDocument()
  })
})
