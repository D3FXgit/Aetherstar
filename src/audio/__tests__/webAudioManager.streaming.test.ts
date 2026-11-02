import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWebAudioManager,
  LOOP_DECLICK_SECONDS,
  STREAM_RELEASE_MARGIN_MS,
  type MixerBinding,
  type StreamingBinding,
  type TrackGainResolver,
} from '../webAudioManager'
import type {
  AudioContextLike,
  BiquadFilterNodeLike,
  BufferSourceNodeLike,
  ConvolverNodeLike,
  GainNodeLike,
  MediaElementLike,
  MediaElementSourceNodeLike,
} from '../webAudioApi'
import { resultsBedPlayOptions } from '../resultsBed'

// Songs are streamed through an <audio> element into a
// MediaElementAudioSourceNode, so a new selection is heard as soon as the
// audio at its start point arrives rather than once the whole file is fetched
// and decoded. jsdom has no media playback, so the element here is a double
// whose loading, play() and end are driven by hand.

interface FakeElement extends MediaElementLike {
  paused: boolean
  /** Fires the listeners registered for `type`. */
  fire(type: string): void
  /** Completes a deferred metadata load. */
  loadMetadata(): void
  /** Settles a deferred play(). */
  resolvePlay(): void
  rejectPlay(error: unknown): void
  listenerCount(type: string): number
}

interface ElementOptions {
  duration?: number
  /** Metadata arrives only on loadMetadata() (default: already there when src is set). */
  deferMetadata?: boolean
  /** play() settles only on resolvePlay()/rejectPlay() (default: at once). */
  deferPlay?: boolean
}

function makeFakeElement({ duration = 246, deferMetadata = false, deferPlay = false }: ElementOptions = {}): FakeElement {
  const listeners = new Map<string, Set<() => void>>()
  let settlePlay: { resolve: () => void; reject: (error: unknown) => void } | null = null
  let src = ''
  const element: FakeElement = {
    get src() {
      return src
    },
    set src(value: string) {
      src = value
      if (!deferMetadata && value) (element as { readyState: number }).readyState = 1
    },
    crossOrigin: null,
    preload: '',
    currentTime: 0,
    duration,
    readyState: 0,
    paused: true,
    play: vi.fn(() => {
      if (!deferPlay) {
        element.paused = false
        return Promise.resolve()
      }
      return new Promise<void>((resolve, reject) => {
        settlePlay = {
          resolve: () => {
            element.paused = false
            resolve()
          },
          reject,
        }
      })
    }),
    pause: vi.fn(() => {
      element.paused = true
    }),
    load: vi.fn(),
    removeAttribute: vi.fn((name: string) => {
      if (name === 'src') src = ''
    }),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener)
    }),
    fire(type) {
      ;[...(listeners.get(type) ?? [])].forEach((listener) => listener())
    },
    loadMetadata() {
      ;(element as { readyState: number }).readyState = 1
      element.fire('loadedmetadata')
    },
    resolvePlay() {
      settlePlay?.resolve()
    },
    rejectPlay(error) {
      settlePlay?.reject(error)
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0
    },
  }
  return element
}

function makeFakeGainNode(): GainNodeLike {
  return {
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn<() => void>(),
  }
}

type FakeMediaNode = MediaElementSourceNodeLike & { element: MediaElementLike }

function makeContext(elementOptions: ElementOptions[] = []) {
  const gainNodes: ReturnType<typeof makeFakeGainNode>[] = []
  const bufferSources: BufferSourceNodeLike[] = []
  const elements: FakeElement[] = []
  const mediaNodes: FakeMediaNode[] = []
  const context: AudioContextLike = {
    currentTime: 10,
    state: 'running',
    destination: {},
    createGain: vi.fn(() => {
      const node = makeFakeGainNode()
      gainNodes.push(node)
      return node
    }),
    createBufferSource: vi.fn(() => {
      const source: BufferSourceNodeLike = { buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
      bufferSources.push(source)
      return source
    }),
    decodeAudioData: vi.fn().mockResolvedValue({ duration: 30 } as AudioBuffer),
    resume: vi.fn().mockResolvedValue(undefined),
    createMediaElementSource: vi.fn((element: MediaElementLike) => {
      const node: FakeMediaNode = { element, connect: vi.fn(), disconnect: vi.fn() }
      mediaNodes.push(node)
      return node
    }),
  }
  const streaming: StreamingBinding = {
    // Library songs stream; the bundled menu loop is decoded.
    shouldStream: (track) => track.startsWith('aetherstar-media://'),
    createElement: () => {
      const element = makeFakeElement(elementOptions[elements.length])
      elements.push(element)
      return element
    },
  }
  /** The track gain node the voice of `mediaNode` feeds (through its edge fade). */
  function trackGainOf(mediaNode: FakeMediaNode): GainNodeLike {
    const edge = vi.mocked(mediaNode.connect).mock.calls[0][0] as GainNodeLike
    return vi.mocked(edge.connect).mock.calls[0][0] as GainNodeLike
  }
  return { context, gainNodes, bufferSources, elements, mediaNodes, streaming, trackGainOf }
}

function setTime(context: AudioContextLike, seconds: number) {
  ;(context as { currentTime: number }).currentTime = seconds
}

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const SONG_A = 'aetherstar-media://roots/D:/Songs/A/song.mp3'
const SONG_B = 'aetherstar-media://roots/D:/Songs/B/song.mp3'
const SONG_C = 'aetherstar-media://roots/D:/Songs/C/song.mp3'
const MENU_LOOP = '/assets/menu_loop.wav'
const BROWSE = { loop: false, fadeCurve: 'equal-power' as const }

describe('createWebAudioManager -- streamed tracks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('plays a song through a media element: no fetch, no decode, CORS-mode request, seeked to the preview start before play()', async () => {
    const { context, elements, mediaNodes, streaming, trackGainOf } = makeContext()
    const onStarted = vi.fn()
    const manager = createWebAudioManager(() => context, undefined, undefined, streaming)

    await manager.play(SONG_A, 'preview', { onStarted })

    expect(fetch).not.toHaveBeenCalled()
    expect(context.decodeAudioData).not.toHaveBeenCalled()
    expect(context.createBufferSource).not.toHaveBeenCalled()
    const [element] = elements
    expect(element.src).toBe(SONG_A)
    expect(element.crossOrigin).toBe('anonymous')
    expect(element.preload).toBe('auto')
    expect(context.createMediaElementSource).toHaveBeenCalledWith(element)
    // A 246 s song with no #PREVIEWSTART: a minute in.
    expect(element.currentTime).toBe(60)
    expect(element.play).toHaveBeenCalledOnce()
    expect(onStarted).toHaveBeenCalledWith({ durationSec: 246, offsetSec: 60 })
    // element -> edge fade -> track gain (at full volume for play()) -> destination
    const trackGain = trackGainOf(mediaNodes[0])
    expect(trackGain.gain.value).toBe(1)
    expect(trackGain.connect).toHaveBeenCalledWith(context.destination)
  })

  it('fades the edge in from silence once playback has begun, so the mid-song start does not click', async () => {
    const { context, mediaNodes, streaming } = makeContext()
    const manager = createWebAudioManager(() => context, undefined, undefined, streaming)

    await manager.play(SONG_A, 'preview')

    const edge = vi.mocked(mediaNodes[0].connect).mock.calls[0][0] as GainNodeLike
    expect(edge.gain.setValueAtTime).toHaveBeenCalledWith(0, 10)
    expect(edge.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10 + LOOP_DECLICK_SECONDS)
  })

  it('uses #PREVIEWSTART, else the library row value, exactly as a decoded track does', async () => {
    const { context, elements, streaming } = makeContext()
    const resolver: TrackGainResolver = async () => ({ gain: 0.5, previewStartSec: 33 })
    const manager = createWebAudioManager(() => context, resolver, undefined, streaming)

    await manager.play(SONG_A, 'preview', { previewStartSec: 90 })
    await manager.play(SONG_B, 'preview')

    expect(elements[0].currentTime).toBe(90)
    expect(elements[1].currentTime).toBe(33)
  })

  it('opens the menu bus at 0 unless asked to start at the preview', async () => {
    const { context, elements, streaming } = makeContext()
    const manager = createWebAudioManager(() => context, undefined, undefined, streaming)

    await manager.play(SONG_A, 'music', { loop: false })
    await manager.crossfadeTo(SONG_B, 1200, 'music', { previewStartSec: 75, startAtPreview: true, loop: false })

    expect(elements[0].currentTime).toBe(0)
    expect(elements[1].currentTime).toBe(75)
  })

  it('still decodes what it is not told to stream -- the bundled menu loop', async () => {
    const { context, bufferSources, elements, streaming } = makeContext()
    const manager = createWebAudioManager(() => context, undefined, undefined, streaming)

    await manager.play(MENU_LOOP, 'music')

    expect(context.decodeAudioData).toHaveBeenCalledOnce()
    expect(bufferSources).toHaveLength(1)
    expect(elements).toHaveLength(0)
  })

  it('decodes everything on a context that cannot stream', async () => {
    const { context, bufferSources, elements, streaming } = makeContext()
    delete (context as { createMediaElementSource?: unknown }).createMediaElementSource
    const manager = createWebAudioManager(() => context, undefined, undefined, streaming)

    await manager.play(SONG_A, 'preview')

    expect(bufferSources).toHaveLength(1)
    expect(elements).toHaveLength(0)
  })

  it('hands the resolver no buffer for a streamed track', async () => {
    const { context, streaming } = makeContext()
    const resolver = vi.fn<TrackGainResolver>().mockResolvedValue(1)
    const manager = createWebAudioManager(() => context, resolver, undefined, streaming)

    await manager.play(SONG_A, 'preview')

    expect(resolver).toHaveBeenCalledWith(SONG_A, {})
  })

  describe('switching songs', () => {
    it('keeps the outgoing song playing until the incoming one has actually started, then crossfades', async () => {
      const { context, elements, mediaNodes, streaming, trackGainOf } = makeContext([{}, { deferPlay: true }])
      const manager = createWebAudioManager(() => context, undefined, undefined, streaming)
      await manager.play(SONG_A, 'preview', BROWSE)
      const outgoingGain = trackGainOf(mediaNodes[0])

      const switching = manager.crossfadeTo(SONG_B, 220, 'preview', BROWSE)
      await flush()
      // The new song is loading: the old one is untouched.
      expect(elements[1].play).toHaveBeenCalledOnce()
      expect(outgoingGain.gain.linearRampToValueAtTime).not.toHaveBeenCalled()
      expect(elements[0].pause).not.toHaveBeenCalled()

      elements[1].resolvePlay()
      await switching

      const incomingGain = trackGainOf(mediaNodes[1])
      expect(incomingGain.gain.value).toBe(0)
      expect(incomingGain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 10 + 0.22)
      expect(outgoingGain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 10 + 0.22)
    })

    it('releases the outgoing element only once its fade is over: paused, unhooked and emptied', async () => {
      vi.useFakeTimers()
      const { context, elements, mediaNodes, streaming } = makeContext()
      const manager = createWebAudioManager(() => context, undefined, undefined, streaming)
      await manager.play(SONG_A, 'preview', BROWSE)
      await manager.crossfadeTo(SONG_B, 220, 'preview', BROWSE)

      vi.advanceTimersByTime(220)
      expect(elements[0].pause).not.toHaveBeenCalled()

      vi.advanceTimersByTime(STREAM_RELEASE_MARGIN_MS)
      expect(elements[0].pause).toHaveBeenCalledOnce()
      expect(mediaNodes[0].disconnect).toHaveBeenCalled()
      expect(elements[0].removeAttribute).toHaveBeenCalledWith('src')
      expect(elements[0].load).toHaveBeenCalled()
      expect(elements[0].listenerCount('ended')).toBe(0)
      // The incoming song plays on.
      expect(elements[1].pause).not.toHaveBeenCalled()
    })

    it('drops a song skipped past while it was still loading: released, never played, never reported', async () => {
      const { context, elements, streaming } = makeContext([{}, { deferMetadata: true }, {}])
      const onStartedB = vi.fn()
      const onErrorB = vi.fn()
      const manager = createWebAudioManager(() => context, undefined, undefined, streaming)
      await manager.play(SONG_A, 'preview', BROWSE)

      const toB = manager.crossfadeTo(SONG_B, 220, 'preview', { ...BROWSE, onStarted: onStartedB, onError: onErrorB })
      await manager.crossfadeTo(SONG_C, 220, 'preview', BROWSE)
      elements[1].loadMetadata()
      await toB

      expect(elements[1].play).not.toHaveBeenCalled()
      expect(elements[1].removeAttribute).toHaveBeenCalledWith('src')
      expect(onStartedB).not.toHaveBeenCalled()
      expect(onErrorB).not.toHaveBeenCalled()
      expect(elements[2].paused).toBe(false)
    })

    it('reports a song that cannot load, releases its element, and leaves the playing one alone', async () => {
      const { context, elements, streaming } = makeContext([{}, { deferMetadata: true }])
      const onError = vi.fn()
      const manager = createWebAudioManager(() => context, undefined, undefined, streaming)
      await manager.play(SONG_A, 'preview', BROWSE)

      const toB = manager.crossfadeTo(SONG_B, 220, 'preview', { ...BROWSE, onError })
      await flush()
      elements[1].fire('error')
      await toB

      expect(onError).toHaveBeenCalledOnce()
      expect(elements[1].play).not.toHaveBeenCalled()
      expect(elements[1].removeAttribute).toHaveBeenCalledWith('src')
      expect(elements[0].pause).not.toHaveBeenCalled()
      // Still the channel's track: a transfer finds it.
      expect(manager.transfer!('preview', 'music', 400, { track: SONG_A })).not.toBeNull()
    })

    it('reports a play() the element refuses as an error, and releases it', async () => {
      const { context, elements, streaming } = makeContext([{ deferPlay: true }])
      const onError = vi.fn()
      const manager = createWebAudioManager(() => context, undefined, undefined, streaming)

      const starting = manager.play(SONG_A, 'preview', { onError })
      await flush()
      elements[0].rejectPlay(new Error('NotAllowedError'))
      await starting

      expect(onError).toHaveBeenCalledOnce()
      expect(elements[0].removeAttribute).toHaveBeenCalledWith('src')
    })
  })

  describe('stop', () => {
    it('fades to silence, then releases the element -- and a second stop changes nothing', async () => {
      vi.useFakeTimers()
      const { context, elements, mediaNodes, streaming, trackGainOf } = makeContext()
      const manager = createWebAudioManager(() => context, undefined, undefined, streaming)
      await manager.play(SONG_A, 'preview')
      const gain = trackGainOf(mediaNodes[0])

      manager.stop(250, 'preview')
      manager.stop(250, 'preview')

      expect(gain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 10.25)
      vi.advanceTimersByTime(249)
      expect(elements[0].pause).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1 + STREAM_RELEASE_MARGIN_MS)
      expect(elements[0].pause).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    })

    it('a stop() that lands while the song is still loading means it never plays', async () => {
      const { context, elements, streaming } = makeContext([{ deferMetadata: true }])
      const onStarted = vi.fn()
      const manager = createWebAudioManager(() => context, undefined, undefined, streaming)

      const starting = manager.play(SONG_A, 'preview', { onStarted })
      manager.stop(250, 'preview')
      elements[0].loadMetadata()
      await starting

      expect(elements[0].play).not.toHaveBeenCalled()
      expect(onStarted).not.toHaveBeenCalled()
      expect(elements[0].removeAttribute).toHaveBeenCalledWith('src')
    })
  })

  describe('the end of a streamed song', () => {
    it('tells the owner of a song that does not loop, empties the channel and releases the element', async () => {
      const { context, elements, streaming } = makeContext()
      const onEnded = vi.fn()
      const manager = createWebAudioManager(() => context, undefined, undefined, streaming)
      await manager.play(SONG_A, 'preview', { loop: false, onEnded })

      elements[0].fire('ended')

      expect(onEnded).toHaveBeenCalledOnce()
      expect(elements[0].removeAttribute).toHaveBeenCalledWith('src')
      expect(manager.transfer!('preview', 'music', 400)).toBeNull()
    })

    it('loops a looping song back to its start point -- not to 0 -- and reports no end', async () => {
      const { context, elements, mediaNodes, streaming } = makeContext()
      const onEnded = vi.fn()
      const manager = createWebAudioManager(() => context, undefined, undefined, streaming)
      await manager.play(SONG_A, 'preview', { previewStartSec: 42, onEnded })
      const edge = vi.mocked(mediaNodes[0].connect).mock.calls[0][0] as GainNodeLike

      elements[0].currentTime = 246
      elements[0].fire('ended')
      await flush()

      expect(elements[0].currentTime).toBe(42)
      expect(elements[0].play).toHaveBeenCalledTimes(2)
      // Faded in again at the seam.
      expect(edge.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(2)
      expect(onEnded).not.toHaveBeenCalled()
      expect(elements[0].removeAttribute).not.toHaveBeenCalled()
    })

    it('says nothing for a song that was crossfaded away before its end', async () => {
      const { context, elements, streaming } = makeContext()
      const onEnded = vi.fn()
      const manager = createWebAudioManager(() => context, undefined, undefined, streaming)
      await manager.play(SONG_A, 'preview', { loop: false, onEnded })
      await manager.crossfadeTo(SONG_B, 220, 'preview', BROWSE)

      elements[0].fire('ended')

      expect(onEnded).not.toHaveBeenCalled()
    })
  })

  describe('transfer (Home <-> Song Select)', () => {
    it('hands the very same element over: nothing new is created, paused, seeked or restarted', async () => {
      const { context, elements, streaming } = makeContext()
      const manager = createWebAudioManager(() => context, undefined, undefined, streaming)
      await manager.crossfadeTo(SONG_A, 1200, 'music', { previewStartSec: 60, startAtPreview: true, loop: false })
      elements[0].currentTime = 97.5

      const moved = manager.transfer!('music', 'preview', 400, { track: SONG_A, loop: false })

      expect(moved).toEqual({ track: SONG_A, durationSec: 246, positionSec: 97.5 })
      expect(elements).toHaveLength(1)
      expect(elements[0].play).toHaveBeenCalledOnce()
      expect(elements[0].pause).not.toHaveBeenCalled()
      expect(elements[0].currentTime).toBe(97.5)
    })

    it('swaps the buses under the element and glides each to its new level', async () => {
      const { context, gainNodes, mediaNodes, streaming, trackGainOf } = makeContext()
      const gains: Record<string, number> = { music: 0.3, preview: 0.8, results: 0.8 }
      const mixer: MixerBinding = { gainFor: (channel) => gains[channel], subscribe: () => () => {} }
      const manager = createWebAudioManager(() => context, undefined, mixer, streaming)
      await manager.crossfadeTo(SONG_A, 1200, 'music', { startAtPreview: true, loop: false })
      const trackGain = trackGainOf(mediaNodes[0])
      const menuBus = vi.mocked(trackGain.connect).mock.calls[0][0] as GainNodeLike
      expect(gainNodes).toContain(menuBus)

      manager.transfer!('music', 'preview', 400, { track: SONG_A })

      // Not re-wired: the track still feeds the same bus, which now plays the preview role.
      expect(trackGain.connect).toHaveBeenCalledOnce()
      expect(menuBus.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.8, 10.4)
    })

    it('reports the end to the new owner, with looping as the handover set it', async () => {
      const { context, elements, streaming } = makeContext()
      const firstOwner = vi.fn()
      const newOwner = vi.fn()
      const manager = createWebAudioManager(() => context, undefined, undefined, streaming)
      // Party Draw: a looping preview...
      await manager.play(SONG_A, 'preview', { onEnded: firstOwner })
      // ...taken over by the menu, which plays it out.
      manager.transfer!('preview', 'music', 400, { loop: false, onEnded: newOwner })

      elements[0].fire('ended')

      expect(newOwner).toHaveBeenCalledOnce()
      expect(firstOwner).not.toHaveBeenCalled()
    })

    it('reads the position from the element, so a stall or seek is never mistaken for elapsed time', async () => {
      const { context, elements, streaming } = makeContext()
      const manager = createWebAudioManager(() => context, undefined, undefined, streaming)
      await manager.play(SONG_A, 'preview')

      setTime(context, 200)
      elements[0].currentTime = 61.25

      expect(manager.transfer!('preview', 'music', 400)?.positionSec).toBe(61.25)
    })
  })

  describe('ducking a streamed song (the song-start countdown)', () => {
    it('ducks and restores the track gain, element untouched', async () => {
      const { context, elements, mediaNodes, streaming, trackGainOf } = makeContext()
      const resolver: TrackGainResolver = async () => 0.5
      const manager = createWebAudioManager(() => context, resolver, undefined, streaming)
      await manager.play(SONG_A, 'preview')
      const gain = trackGainOf(mediaNodes[0])

      manager.duckTo(0.2, 300, 'preview')
      expect(gain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.1, 10.3)
      manager.restore(300, 'preview')
      expect(gain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.5, 10.3)
      expect(elements[0].pause).not.toHaveBeenCalled()
    })
  })

  it('plays the results bed through its effect chain, looping from its start point', async () => {
    const { context, elements, mediaNodes, streaming, trackGainOf } = makeContext()
    const filters: BiquadFilterNodeLike[] = []
    Object.assign(context, {
      sampleRate: 8000,
      createBiquadFilter: vi.fn(() => {
        const node: BiquadFilterNodeLike = { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, connect: vi.fn() }
        filters.push(node)
        return node
      }),
      createConvolver: vi.fn((): ConvolverNodeLike => ({ buffer: null, normalize: false, connect: vi.fn() })),
      createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
        const data = Array.from({ length: channels }, () => new Float32Array(length))
        return { numberOfChannels: channels, length, sampleRate, getChannelData: (c: number) => data[c] } as unknown as AudioBuffer
      }),
    })
    const manager = createWebAudioManager(() => context, undefined, undefined, streaming)

    await manager.crossfadeTo(SONG_A, 1500, 'results', resultsBedPlayOptions(42))

    const trackGain = trackGainOf(mediaNodes[0])
    expect(filters[0].type).toBe('lowpass')
    expect(trackGain.connect).toHaveBeenCalledWith(filters[0])
    expect(elements[0].currentTime).toBe(42)

    elements[0].fire('ended')
    await flush()
    expect(elements[0].currentTime).toBe(42)
    expect(elements[0].play).toHaveBeenCalledTimes(2)
  })
})
