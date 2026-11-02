import { describe, expect, it, beforeEach } from 'vitest'
import { useMockAudioManager } from './mockAudioManager'

describe('useMockAudioManager', () => {
  beforeEach(() => {
    useMockAudioManager.setState({
      channels: {
        music: { currentTrack: null, currentVolume: 1, isDucked: false },
        preview: { currentTrack: null, currentVolume: 1, isDucked: false },
        results: { currentTrack: null, currentVolume: 1, isDucked: false },
      },
      currentTrack: null,
      currentVolume: 1,
      isDucked: false,
    })
  })

  it('play() sets the current track and resets volume/duck state', () => {
    useMockAudioManager.getState().play('a.mp3')
    expect(useMockAudioManager.getState()).toMatchObject({
      currentTrack: 'a.mp3',
      currentVolume: 1,
      isDucked: false,
    })
  })

  it('duckTo() lowers the volume and marks the track ducked', () => {
    useMockAudioManager.getState().duckTo(0.1, 300)
    expect(useMockAudioManager.getState()).toMatchObject({ currentVolume: 0.1, isDucked: true })
  })

  it('restore() resets volume to 1 and clears the duck flag', () => {
    useMockAudioManager.getState().duckTo(0.1, 300)
    useMockAudioManager.getState().restore(300)
    expect(useMockAudioManager.getState()).toMatchObject({ currentVolume: 1, isDucked: false })
  })

  it('crossfadeTo() sets the new track and resets volume/duck state', () => {
    useMockAudioManager.getState().play('a.mp3')
    useMockAudioManager.getState().duckTo(0.1, 300)
    useMockAudioManager.getState().crossfadeTo('b.mp3', 500)
    expect(useMockAudioManager.getState()).toMatchObject({
      currentTrack: 'b.mp3',
      currentVolume: 1,
      isDucked: false,
    })
  })

  // Contract, engine and mock must not drift: the mock has to model the same
  // "two concurrent buses with independent gain" semantics the real engine now
  // implements, or a component tested against it proves nothing.
  it('keeps the preview channel independent of the music channel', () => {
    useMockAudioManager.getState().play('menu.mp3', 'music')
    useMockAudioManager.getState().duckTo(0.1, 300, 'music')
    useMockAudioManager.getState().play('preview.mp3', 'preview')

    const state = useMockAudioManager.getState()
    expect(state.channels.music).toEqual({ currentTrack: 'menu.mp3', currentVolume: 0.1, isDucked: true })
    expect(state.channels.preview).toEqual({ currentTrack: 'preview.mp3', currentVolume: 1, isDucked: false })
    // The flattened legacy view mirrors the music channel, which is what the
    // default-channel callers have always been asserting on.
    expect(state).toMatchObject({ currentTrack: 'menu.mp3', currentVolume: 0.1, isDucked: true })
  })

  it('stop() clears the channel to silence rather than restoring it, and leaves the other channel alone', () => {
    useMockAudioManager.getState().play('menu.mp3', 'music')
    useMockAudioManager.getState().play('preview.mp3', 'preview')

    useMockAudioManager.getState().stop(250, 'preview')

    const state = useMockAudioManager.getState()
    expect(state.channels.preview).toEqual({ currentTrack: null, currentVolume: 0, isDucked: false })
    expect(state.channels.music.currentTrack).toBe('menu.mp3')
  })

  it('transfer() moves the track to the other channel and empties the first -- only for the named track', () => {
    useMockAudioManager.getState().play('song.mp3', 'music')

    expect(useMockAudioManager.getState().transfer!('music', 'preview', 400, { track: 'other.mp3' })).toBeNull()
    expect(useMockAudioManager.getState().transfer!('music', 'preview', 400, { track: 'song.mp3' })).toMatchObject({
      track: 'song.mp3',
    })

    const state = useMockAudioManager.getState()
    expect(state.channels.preview.currentTrack).toBe('song.mp3')
    expect(state.channels.music.currentTrack).toBeNull()
    expect(useMockAudioManager.getState().transfer!('music', 'preview', 400)).toBeNull()
  })
})
