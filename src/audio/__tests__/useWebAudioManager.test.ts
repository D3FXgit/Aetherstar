import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mixerBinding, mixerChannelFor, resolvePreviewTrack, streamingBinding, useWebAudioManager } from '../useWebAudioManager'
import { createWebAudioManager } from '../webAudioManager'

vi.mock('../webAudioManager')

// One stub for the whole file, because the store caches its engine in a module
// variable: only the first test in the file actually constructs one.
const engine = {
  play: vi.fn(),
  duckTo: vi.fn(),
  restore: vi.fn(),
  crossfadeTo: vi.fn(),
  stop: vi.fn(),
}

describe('useWebAudioManager', () => {
  beforeEach(() => {
    vi.mocked(createWebAudioManager).mockClear()
    Object.values(engine).forEach((fn) => fn.mockClear())
    vi.mocked(createWebAudioManager).mockReturnValue(engine)
  })

  it('lazily constructs exactly one engine on first action, delegating to it', () => {
    useWebAudioManager.getState().play('menu.mp3')

    expect(createWebAudioManager).toHaveBeenCalledOnce()
    expect(createWebAudioManager).toHaveBeenCalledWith(expect.any(Function), resolvePreviewTrack, mixerBinding, streamingBinding)
    expect(engine.play).toHaveBeenCalledWith('menu.mp3', undefined)

    useWebAudioManager.getState().duckTo(0.1, 500)
    useWebAudioManager.getState().restore(500)
    useWebAudioManager.getState().crossfadeTo('b.mp3', 500)

    expect(createWebAudioManager).toHaveBeenCalledOnce()
    expect(engine.duckTo).toHaveBeenCalledWith(0.1, 500, undefined)
    expect(engine.restore).toHaveBeenCalledWith(500, undefined)
    expect(engine.crossfadeTo).toHaveBeenCalledWith('b.mp3', 500, undefined)
  })

  // The store is the seam every component goes through, so a channel argument
  // it silently swallowed would make the whole channel API a no-op in the app
  // while the engine's own tests still passed.
  it('forwards the channel argument (and stop()) through to the engine', () => {
    useWebAudioManager.getState().play('preview.mp3', 'preview')
    useWebAudioManager.getState().duckTo(0.1, 300, 'music')
    useWebAudioManager.getState().restore(300, 'music')
    useWebAudioManager.getState().crossfadeTo('c.mp3', 300, 'preview')
    useWebAudioManager.getState().stop(250, 'preview')

    expect(engine.play).toHaveBeenCalledWith('preview.mp3', 'preview')
    expect(engine.duckTo).toHaveBeenCalledWith(0.1, 300, 'music')
    expect(engine.restore).toHaveBeenCalledWith(300, 'music')
    expect(engine.crossfadeTo).toHaveBeenCalledWith('c.mp3', 300, 'preview')
    expect(engine.stop).toHaveBeenCalledWith(250, 'preview')
  })

  it('forwards a preview start through to the engine', () => {
    useWebAudioManager.getState().play('preview.mp3', 'preview', { previewStartSec: 42 })
    useWebAudioManager.getState().crossfadeTo('c.mp3', 300, 'preview', { previewStartSec: 7 })

    expect(engine.play).toHaveBeenCalledWith('preview.mp3', 'preview', { previewStartSec: 42 })
    expect(engine.crossfadeTo).toHaveBeenCalledWith('c.mp3', 300, 'preview', { previewStartSec: 7 })
  })

  it('maps the menu bus to Menu music and the preview bus to Music', () => {
    expect(mixerChannelFor('music')).toBe('menuMusic')
    expect(mixerChannelFor('preview')).toBe('music')
  })

  it('maps the results bus (the sung song, muffled) to Music as well', () => {
    expect(mixerChannelFor('results')).toBe('music')
  })

  it('forwards an effect option untouched', () => {
    const options = { effect: 'muffled' as const, startAtPreview: true, loop: true, cache: false }
    useWebAudioManager.getState().crossfadeTo('r.mp3', 1500, 'results', options)

    expect(engine.crossfadeTo).toHaveBeenCalledWith('r.mp3', 1500, 'results', options)
  })

  // Songs stream (a new preview is heard as soon as its start point has
  // arrived); the bundled menu loop is decoded, because its seamless loop needs
  // a sample-exact buffer.
  it('streams library media, on every bus, and decodes the bundled menu loop', () => {
    const song = 'aetherstar-media://roots/D:/Songs/A%20-%20B/song.mp3'
    expect(streamingBinding.shouldStream(song, 'preview')).toBe(true)
    expect(streamingBinding.shouldStream(song, 'music')).toBe(true)
    expect(streamingBinding.shouldStream(song, 'results')).toBe(true)
    expect(streamingBinding.shouldStream('app-media://media/D:/Songs/A/song.ogg', 'preview')).toBe(true)
    expect(streamingBinding.shouldStream('/assets/menu_loop-abc123.wav', 'music')).toBe(false)
  })
})
