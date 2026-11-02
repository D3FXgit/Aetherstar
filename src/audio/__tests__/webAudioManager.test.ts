import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOOP_DECLICK_SECONDS,
  channelNeedsDeclick,
  EQUAL_POWER_STEPS,
  createWebAudioManager,
  previewStartOffset,
  type MixerBinding,
} from '../webAudioManager'
import type { AudioContextLike, BiquadFilterNodeLike, BufferSourceNodeLike, ConvolverNodeLike, GainNodeLike } from '../webAudioApi'
import { RESULTS_BED_EFFECT, dbToGain, resultsBedPlayOptions } from '../resultsBed'

function makeFakeGainNode(): GainNodeLike {
  return {
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  }
}

function makeFakeBufferSource(): BufferSourceNodeLike {
  return {
    buffer: null,
    loop: false,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }
}

function makeFakeAudioContext(overrides: Partial<AudioContextLike> = {}) {
  const fakeBuffer = {} as AudioBuffer
  const gainNodes: GainNodeLike[] = []
  const bufferSources: BufferSourceNodeLike[] = []
  // Lets a test hold a decode open so two play() calls on the same channel can
  // genuinely interleave (see the "rapid play()" cases below).
  const pendingDecodes: Array<(buffer: AudioBuffer) => void> = []

  const context: AudioContextLike = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createGain: vi.fn(() => {
      const node = makeFakeGainNode()
      gainNodes.push(node)
      return node
    }),
    createBufferSource: vi.fn(() => {
      const source = makeFakeBufferSource()
      bufferSources.push(source)
      return source
    }),
    decodeAudioData: vi.fn().mockResolvedValue(fakeBuffer),
    resume: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }

  function deferDecodes() {
    context.decodeAudioData = vi.fn(
      () => new Promise<AudioBuffer>((resolve) => pendingDecodes.push(() => resolve(fakeBuffer))),
    )
  }

  /**
   * Drains every decode opened so far (including ones opened only once an
   * earlier `await fetch(...)` settled) and lets the awaiting continuations run.
   */
  async function flushDecodes() {
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 8; i++) await Promise.resolve()
      pendingDecodes.splice(0).forEach((resolve) => resolve(fakeBuffer))
    }
  }

  return { context, gainNodes, bufferSources, fakeBuffer, deferDecodes, flushDecodes }
}

describe('createWebAudioManager', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('play() decodes, loops, connects through a gain node at full volume, and starts exactly once', async () => {
    const { context, gainNodes, bufferSources } = makeFakeAudioContext()
    const manager = createWebAudioManager(() => context)

    await manager.play('menu.mp3')

    expect(context.decodeAudioData).toHaveBeenCalledOnce()
    expect(bufferSources).toHaveLength(1)
    expect(bufferSources[0].loop).toBe(true)
    expect(bufferSources[0].connect).toHaveBeenCalledWith(gainNodes[0])
    expect(gainNodes[0].connect).toHaveBeenCalledWith(context.destination)
    expect(bufferSources[0].start).toHaveBeenCalledOnce()
    expect(gainNodes[0].gain.value).toBe(1)
  })

  it('duckTo() anchors then schedules a ramp to the target volume; restore() ramps back to full', async () => {
    const { context, gainNodes } = makeFakeAudioContext({ currentTime: 10 })
    const manager = createWebAudioManager(() => context)
    await manager.play('menu.mp3')
    const gain = gainNodes[0]

    manager.duckTo(0.1, 500)

    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(gain.gain.value, context.currentTime)
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.1, 10.5)

    manager.restore(500)

    expect(gain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 10.5)
  })

  it('crossfadeTo() starts the new track at gain 0 ramping up, ramps the old track down, and schedules the old source to stop at the end of the ramp (never before, never not at all)', async () => {
    const { context, gainNodes, bufferSources } = makeFakeAudioContext({ currentTime: 10 })
    const manager = createWebAudioManager(() => context)
    await manager.play('a.mp3')
    const oldGain = gainNodes[0]
    const oldSource = bufferSources[0]

    await manager.crossfadeTo('b.mp3', 500)

    expect(bufferSources).toHaveLength(2)
    const newGain = gainNodes[1]
    expect(newGain.gain.value).toBe(0)
    expect(newGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10.5)
    expect(oldGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10.5)
    // Regression: crossfadeTo() used to drop the outgoing source reference
    // while the node was still running, leaking a live (silent, looping)
    // AudioBufferSourceNode on every crossfade. It must be stopped -- but only
    // once the fade has actually reached zero, never immediately.
    expect(oldSource.stop).toHaveBeenCalledWith(10.5)
  })

  it('caches a decoded buffer per track -- decodeAudioData is called only once across repeated play() calls with the same track', async () => {
    const { context, bufferSources, fakeBuffer } = makeFakeAudioContext()
    const manager = createWebAudioManager(() => context)

    await manager.play('menu.mp3')
    manager.restore(600)
    await manager.play('menu.mp3')

    expect(context.decodeAudioData).toHaveBeenCalledOnce()
    expect(bufferSources).toHaveLength(2)
    expect(bufferSources[0].buffer).toBe(fakeBuffer)
    expect(bufferSources[1].buffer).toBe(fakeBuffer)
  })

  // --- Named channels (Phase 1b). The whole point of these is that menu music
  // and a song preview are two *concurrent* sources with independent gain, so
  // "duck the music under the preview" is expressible at all. Before channels
  // the engine modelled one current source and a preview simply destroyed the
  // music.
  describe('named channels', () => {
    it('a preview on its own channel plays alongside the music: the music source keeps running and only its gain ramps down', async () => {
      const { context, gainNodes, bufferSources } = makeFakeAudioContext({ currentTime: 10 })
      const manager = createWebAudioManager(() => context)

      await manager.play('menu.mp3', 'music')
      const musicGain = gainNodes[0]
      const musicSource = bufferSources[0]

      manager.duckTo(0.1, 300, 'music')
      await manager.play('preview.mp3', 'preview')

      // The regression this pins: play()ing a preview used to call
      // currentSource.stop() on the menu music.
      expect(musicSource.stop).not.toHaveBeenCalled()
      expect(musicGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.1, 10.3)
      expect(bufferSources).toHaveLength(2)
      expect(bufferSources[1].start).toHaveBeenCalledOnce()
      expect(gainNodes[1].gain.value).toBe(1)
      expect(gainNodes[1]).not.toBe(musicGain)
    })

    it('defaults to the music channel when no channel is named', async () => {
      const { context, gainNodes, bufferSources } = makeFakeAudioContext({ currentTime: 10 })
      const manager = createWebAudioManager(() => context)

      await manager.play('menu.mp3')
      manager.duckTo(0, 600)

      expect(gainNodes[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10.6)

      // ...and it is the *music* channel, not some nameless fourth thing: the
      // named-music accessors reach the very same gain node.
      manager.restore(600, 'music')
      expect(gainNodes[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(1, 10.6)
      expect(bufferSources).toHaveLength(1)
    })

    it('duckTo()/restore() on one channel never touch the other', async () => {
      const { context, gainNodes } = makeFakeAudioContext({ currentTime: 10 })
      const manager = createWebAudioManager(() => context)
      await manager.play('menu.mp3', 'music')
      await manager.play('preview.mp3', 'preview')
      const [musicGain, previewGain] = gainNodes

      manager.duckTo(0.1, 300, 'music')

      expect(musicGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.1, 10.3)
      expect(previewGain.gain.linearRampToValueAtTime).not.toHaveBeenCalled()
    })

    it('stop() fades the channel to silence and stops its source at the end of the fade -- not immediately, and not never', async () => {
      const { context, gainNodes, bufferSources } = makeFakeAudioContext({ currentTime: 10 })
      const manager = createWebAudioManager(() => context)
      await manager.play('preview.mp3', 'preview')
      const previewGain = gainNodes[0]
      const previewSource = bufferSources[0]

      manager.stop(250, 'preview')

      expect(previewGain.gain.setValueAtTime).toHaveBeenCalledWith(previewGain.gain.value, 10)
      expect(previewGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10.25)
      // The defect this pins: the old code called restore() here, which ramped
      // the *preview* to full and left `source.loop = true` running forever.
      expect(previewSource.stop).toHaveBeenCalledWith(10.25)
    })

    it('stop() clears the channel, so a later restore() cannot resurrect the stopped preview', async () => {
      const { context, gainNodes } = makeFakeAudioContext({ currentTime: 10 })
      const manager = createWebAudioManager(() => context)
      await manager.play('preview.mp3', 'preview')
      const previewGain = gainNodes[0]

      manager.stop(250, 'preview')
      const rampsAfterStop = vi.mocked(previewGain.gain.linearRampToValueAtTime).mock.calls.length

      manager.restore(300, 'preview')
      manager.duckTo(0.5, 300, 'preview')

      expect(vi.mocked(previewGain.gain.linearRampToValueAtTime).mock.calls).toHaveLength(rampsAfterStop)
    })

    it('stop() is idempotent -- a second stop() schedules no second ramp and no second source stop', async () => {
      const { context, gainNodes, bufferSources } = makeFakeAudioContext({ currentTime: 10 })
      const manager = createWebAudioManager(() => context)
      await manager.play('preview.mp3', 'preview')

      manager.stop(250, 'preview')
      manager.stop(300, 'preview')

      expect(vi.mocked(gainNodes[0].gain.linearRampToValueAtTime).mock.calls).toEqual([[0, 10.25]])
      expect(bufferSources[0].stop).toHaveBeenCalledOnce()
    })

    it('stopping the preview leaves the music source running and untouched', async () => {
      const { context, gainNodes, bufferSources } = makeFakeAudioContext({ currentTime: 10 })
      const manager = createWebAudioManager(() => context)
      await manager.play('menu.mp3', 'music')
      await manager.play('preview.mp3', 'preview')

      manager.stop(250, 'preview')

      expect(bufferSources[0].stop).not.toHaveBeenCalled()
      expect(gainNodes[0].gain.linearRampToValueAtTime).not.toHaveBeenCalled()
      expect(bufferSources[1].stop).toHaveBeenCalledWith(10.25)
    })

    it('two rapid play() calls on one channel: the superseded source is torn down and the channel ends up controlling the last one', async () => {
      const { context, gainNodes, bufferSources, deferDecodes, flushDecodes } = makeFakeAudioContext({ currentTime: 10 })
      const manager = createWebAudioManager(() => context)
      deferDecodes()

      const first = manager.play('a.mp3', 'preview')
      const second = manager.play('b.mp3', 'preview')
      await flushDecodes()
      await Promise.all([first, second])

      expect(bufferSources).toHaveLength(2)
      // Whichever source lost the race must be stopped rather than left
      // looping, and the channel's gain must control the surviving one -- the
      // old code stopped `currentSource` *before* awaiting the decode, so a
      // superseded play() stopped a source that had not been assigned yet and
      // left `currentGain` pointing at a dead node.
      const stopped = bufferSources.filter((s) => vi.mocked(s.stop).mock.calls.length > 0)
      expect(stopped).toHaveLength(1)
      const survivorIndex = bufferSources.findIndex((s) => vi.mocked(s.stop).mock.calls.length === 0)

      manager.duckTo(0.25, 300, 'preview')
      expect(gainNodes[survivorIndex].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.25, 10.3)
    })

    it('a play() still decoding when stop() lands does not resurrect the channel', async () => {
      const { context, gainNodes, bufferSources, deferDecodes, flushDecodes } = makeFakeAudioContext({ currentTime: 10 })
      const manager = createWebAudioManager(() => context)
      deferDecodes()

      const pending = manager.play('preview.mp3', 'preview')
      manager.stop(250, 'preview')
      await flushDecodes()
      await pending

      // The late-arriving source must not be left running just because its
      // decode finished after the caller asked for silence.
      expect(bufferSources).toHaveLength(1)
      expect(bufferSources[0].stop).toHaveBeenCalled()
      manager.restore(300, 'preview')
      expect(gainNodes[0].gain.linearRampToValueAtTime).not.toHaveBeenCalledWith(1, 10.3)
    })
  })

  it('resumes on construction, and falls back to a one-time user-gesture listener when still suspended afterward', async () => {
    const { context } = makeFakeAudioContext({ state: 'suspended' })

    createWebAudioManager(() => context)

    expect(context.resume).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    await Promise.resolve()

    window.dispatchEvent(new Event('pointerdown'))
    expect(context.resume).toHaveBeenCalledTimes(2)

    window.dispatchEvent(new Event('pointerdown'))
    expect(context.resume).toHaveBeenCalledTimes(2)
  })

  describe('a context that is suspended after construction', () => {
    /** Reaches past the readonly `state` to simulate the host suspending the context. */
    function suspend(context: AudioContextLike, state: AudioContextLike['state']) {
      ;(context as { state: AudioContextLike['state'] }).state = state
    }

    it('resumes on the next action instead of playing into a dead context', async () => {
      // Construction-time resume is a one-shot, so nothing used to recover a
      // context suspended *later* -- the case this codebase has already hit
      // once, when the audience window stealing focus suspended the main
      // window's AudioContext. Every action is now a chance to come back.
      const { context } = makeFakeAudioContext()
      const manager = createWebAudioManager(() => context)
      expect(context.resume).toHaveBeenCalledTimes(0)

      suspend(context, 'suspended')
      await manager.play('track.mp3')

      expect(context.resume).toHaveBeenCalledTimes(1)
    })

    it('re-arms the user-gesture fallback for a suspension the first one never saw', async () => {
      const { context } = makeFakeAudioContext()
      const manager = createWebAudioManager(() => context)

      suspend(context, 'suspended')
      await manager.play('track.mp3')
      await Promise.resolve()
      await Promise.resolve()

      window.dispatchEvent(new Event('pointerdown'))
      expect(context.resume).toHaveBeenCalledTimes(2)
    })

    it('does not stack a gesture listener per action while it stays suspended', async () => {
      // duckTo/restore run on every scene transition. Without a guard, each
      // one would leave another pointerdown listener behind, and one click
      // would then fire a resume for every action since the suspension.
      const { context } = makeFakeAudioContext()
      const manager = createWebAudioManager(() => context)

      suspend(context, 'suspended')
      await manager.play('track.mp3')
      manager.duckTo(0, 100)
      manager.restore(100)
      await Promise.resolve()
      await Promise.resolve()

      const resumesBeforeGesture = vi.mocked(context.resume).mock.calls.length
      window.dispatchEvent(new Event('pointerdown'))
      expect(context.resume).toHaveBeenCalledTimes(resumesBeforeGesture + 1)
    })

    it('leaves a closed context alone -- resume() on it rejects and nothing can revive it', async () => {
      const { context } = makeFakeAudioContext()
      const manager = createWebAudioManager(() => context)

      suspend(context, 'closed')
      await manager.play('track.mp3')

      expect(context.resume).not.toHaveBeenCalled()
    })

    it('does not resume a healthy context on every single action', async () => {
      const { context } = makeFakeAudioContext()
      const manager = createWebAudioManager(() => context)

      await manager.play('track.mp3')
      manager.duckTo(0, 100)

      expect(context.resume).not.toHaveBeenCalled()
    })
  })
  // Per-song loudness normalisation on the preview bus (src/audio/loudness.ts).
  // The engine itself knows nothing about songs -- it is handed a resolver, so
  // that a preview comes out of the Song Selector at the same level the song
  // will play at on stage.
  describe('per-track gain', () => {
    it('starts a track at its own normalisation gain rather than at 1', async () => {
      const { context, gainNodes } = makeFakeAudioContext()
      const manager = createWebAudioManager(() => context, () => Promise.resolve(0.25))

      await manager.play('loud-song.mp3', 'preview')

      expect(gainNodes[0].gain.value).toBe(0.25)
    })

    it('leaves anything the resolver does not recognise at full volume', async () => {
      const { context, gainNodes } = makeFakeAudioContext()
      const manager = createWebAudioManager(() => context, () => Promise.resolve(1))

      await manager.play('menu_song.mp3', 'music')

      expect(gainNodes[0].gain.value).toBe(1)
    })

    it('defaults to unity when no resolver is supplied at all', async () => {
      const { context, gainNodes } = makeFakeAudioContext()
      const manager = createWebAudioManager(() => context)

      await manager.play('track.mp3')

      expect(gainNodes[0].gain.value).toBe(1)
    })

    it('restores to the track gain, not to 1 -- restoring to 1 would undo the normalisation', async () => {
      const { context, gainNodes } = makeFakeAudioContext()
      const manager = createWebAudioManager(() => context, () => Promise.resolve(0.25))

      await manager.play('loud-song.mp3')
      manager.duckTo(0, 100)
      manager.restore(100)

      const ramps = gainNodes[0].gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>
      expect(ramps.mock.calls.at(-1)?.[0]).toBe(0.25)
    })

    it('states duckTo as a fraction of the track gain, so ducking a quiet song does not make it louder', async () => {
      const { context, gainNodes } = makeFakeAudioContext()
      const manager = createWebAudioManager(() => context, () => Promise.resolve(0.25))

      await manager.play('loud-song.mp3')
      manager.duckTo(0.5, 100)

      const ramps = gainNodes[0].gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>
      expect(ramps.mock.calls.at(-1)?.[0]).toBe(0.125)
    })

    it('crossfades in to the incoming track own gain', async () => {
      const { context, gainNodes } = makeFakeAudioContext()
      const gains: Record<string, number> = { 'a.mp3': 1, 'b.mp3': 0.4 }
      const manager = createWebAudioManager(() => context, (track) => Promise.resolve(gains[track] ?? 1))

      await manager.play('a.mp3')
      await manager.crossfadeTo('b.mp3', 100)

      const incoming = gainNodes[1].gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>
      expect(incoming.mock.calls.at(-1)?.[0]).toBe(0.4)
      expect(gainNodes[1].gain.value).toBe(0)
    })

    it('lets a stop() that lands while the gain is still resolving supersede the play', async () => {
      // The gain lookup is an IPC round trip, so it is another await inside
      // play() -- and every await inside play() is a window in which the caller
      // may have asked for silence. Resolving the gain *before* calling play()
      // would have re-opened exactly the race the generation counter closes.
      const { context, bufferSources } = makeFakeAudioContext()
      let releaseGain: (gain: number) => void = () => {}
      const manager = createWebAudioManager(
        () => context,
        () => new Promise<number>((resolve) => { releaseGain = resolve }),
      )

      const playing = manager.play('song.mp3', 'preview')
      manager.stop(0, 'preview')
      releaseGain(0.25)
      await playing

      expect(bufferSources[0].stop).toHaveBeenCalled()
    })

    it('starts preview channel ~1 minute in (60s) and sets loopStart for songs longer than 75s', async () => {
      const { context, bufferSources } = makeFakeAudioContext()
      const fakeLongBuffer = { duration: 180 } as AudioBuffer
      context.decodeAudioData = vi.fn().mockResolvedValue(fakeLongBuffer)
      const manager = createWebAudioManager(() => context)

      await manager.play('long-song.mp3', 'preview')

      expect(bufferSources[0].start).toHaveBeenCalledWith(0, 60)
      expect(bufferSources[0].loopStart).toBe(60)
      expect(bufferSources[0].loopEnd).toBe(180)
    })

    it('starts preview channel at 33% for shorter songs (>20s)', async () => {
      const { context, bufferSources } = makeFakeAudioContext()
      const fakeShortBuffer = { duration: 60 } as AudioBuffer
      context.decodeAudioData = vi.fn().mockResolvedValue(fakeShortBuffer)
      const manager = createWebAudioManager(() => context)

      await manager.play('short-song.mp3', 'preview')

      expect(bufferSources[0].start).toHaveBeenCalledWith(0, 19)
      expect(bufferSources[0].loopStart).toBe(19)
      expect(bufferSources[0].loopEnd).toBe(60)
    })

    it('starts music channel at offset 0', async () => {
      const { context, bufferSources } = makeFakeAudioContext()
      const fakeBufferWithDuration = { duration: 120 } as AudioBuffer
      context.decodeAudioData = vi.fn().mockResolvedValue(fakeBufferWithDuration)
      const manager = createWebAudioManager(() => context)

      await manager.play('menu-theme.mp3', 'music')

      expect(bufferSources[0].start).toHaveBeenCalledWith(0, 0)
      expect(bufferSources[0].loopStart).toBeUndefined()
    })
  })
  describe('preview start', () => {
    it('uses #PREVIEWSTART when the caller passes it', async () => {
      const { context, bufferSources } = makeFakeAudioContext()
      context.decodeAudioData = vi.fn().mockResolvedValue({ duration: 180 } as AudioBuffer)
      const manager = createWebAudioManager(() => context)

      await manager.play('song.mp3', 'preview', { previewStartSec: 42.5 })

      expect(bufferSources[0].start).toHaveBeenCalledWith(0, 42.5)
      expect(bufferSources[0].loopStart).toBe(42.5)
    })

    it('falls back to the library row value, then to the guess', async () => {
      const { context, bufferSources } = makeFakeAudioContext()
      context.decodeAudioData = vi.fn().mockResolvedValue({ duration: 180 } as AudioBuffer)
      const manager = createWebAudioManager(() => context, () => Promise.resolve({ gain: 1, previewStartSec: 30 }))

      await manager.play('song.mp3', 'preview')

      expect(bufferSources[0].start).toHaveBeenCalledWith(0, 30)
    })

    it('ignores the option on the menu bus', async () => {
      const { context, bufferSources } = makeFakeAudioContext()
      context.decodeAudioData = vi.fn().mockResolvedValue({ duration: 180 } as AudioBuffer)
      const manager = createWebAudioManager(() => context)

      await manager.play('menu.mp3', 'music', { previewStartSec: 42 })

      expect(bufferSources[0].start).toHaveBeenCalledWith(0, 0)
    })

    it('previewStartOffset rejects a start past the end, and keeps the old guess otherwise', () => {
      expect(previewStartOffset(180, 179.5)).toBe(60)
      expect(previewStartOffset(180, -1)).toBe(60)
      expect(previewStartOffset(180, null)).toBe(60)
      expect(previewStartOffset(60)).toBe(19)
      expect(previewStartOffset(10)).toBe(0)
      expect(previewStartOffset(undefined, 12)).toBe(12)
    })
  })

  describe('late loudness measurement', () => {
    it('fades a playing track to its refined gain instead of jumping', async () => {
      const { context, gainNodes } = makeFakeAudioContext()
      let refine: (gain: number | null) => void = () => {}
      const refinedGain = new Promise<number | null>((resolve) => {
        refine = resolve
      })
      const manager = createWebAudioManager(() => context, () => Promise.resolve({ gain: 0.5, refinedGain }))

      await manager.play('song.mp3', 'preview')
      const node = gainNodes[0]
      expect(node.gain.value).toBe(0.5)

      refine(0.25)
      await Promise.resolve()
      await Promise.resolve()
      expect(node.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.25, expect.any(Number))
    })

    it('respects a duck that happened before the measurement landed', async () => {
      const { context, gainNodes } = makeFakeAudioContext()
      let refine: (gain: number | null) => void = () => {}
      const refinedGain = new Promise<number | null>((resolve) => {
        refine = resolve
      })
      const manager = createWebAudioManager(() => context, () => Promise.resolve({ gain: 0.5, refinedGain }))

      await manager.play('song.mp3', 'preview')
      manager.duckTo(0.5, 100, 'preview')
      refine(0.25)
      await Promise.resolve()
      await Promise.resolve()
      expect(gainNodes[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.125, expect.any(Number))
    })

    it('drops a measurement for a track that has since been stopped', async () => {
      const { context, gainNodes } = makeFakeAudioContext()
      let refine: (gain: number | null) => void = () => {}
      const refinedGain = new Promise<number | null>((resolve) => {
        refine = resolve
      })
      const manager = createWebAudioManager(() => context, () => Promise.resolve({ gain: 0.5, refinedGain }))

      await manager.play('song.mp3', 'preview')
      manager.stop(100, 'preview')
      const calls = vi.mocked(gainNodes[0].gain.linearRampToValueAtTime).mock.calls.length
      refine(0.25)
      await Promise.resolve()
      await Promise.resolve()
      expect(vi.mocked(gainNodes[0].gain.linearRampToValueAtTime).mock.calls.length).toBe(calls)
    })
  })

  describe('mixer buses', () => {
    function fakeMixer(gains: Record<string, number>) {
      const listeners = new Set<() => void>()
      const binding: MixerBinding = {
        gainFor: (channel) => gains[channel],
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
      return { binding, gains, notify: () => listeners.forEach((listener) => listener()) }
    }

    it('routes each channel through its own bus at the mixer gain', async () => {
      const { context, gainNodes } = makeFakeAudioContext()
      const mixer = fakeMixer({ music: 0.3, preview: 0.6 })
      const manager = createWebAudioManager(() => context, undefined, mixer.binding)

      await manager.play('menu.mp3', 'music')

      // The track node is made first; its bus is made when it connects.
      const [trackNode, bus] = gainNodes
      expect(bus.gain.value).toBe(0.3)
      expect(bus.connect).toHaveBeenCalledWith(context.destination)
      expect(trackNode.connect).toHaveBeenCalledWith(bus)
    })

    it('applies a slider move live, to the bus only', async () => {
      const { context, gainNodes } = makeFakeAudioContext()
      const mixer = fakeMixer({ music: 0.3, preview: 0.6 })
      const manager = createWebAudioManager(() => context, undefined, mixer.binding)
      await manager.play('menu.mp3', 'music')

      mixer.gains.music = 0.1
      mixer.notify()

      expect(gainNodes[1].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.1, expect.any(Number))
      expect(gainNodes[0].gain.linearRampToValueAtTime).not.toHaveBeenCalled()
    })

    it('reuses the bus across tracks', async () => {
      const { context, gainNodes } = makeFakeAudioContext()
      const mixer = fakeMixer({ music: 1, preview: 1 })
      const manager = createWebAudioManager(() => context, undefined, mixer.binding)
      await manager.play('a.mp3', 'preview')
      await manager.play('b.mp3', 'preview')

      // One bus plus two track nodes.
      expect(gainNodes).toHaveLength(3)
      expect(gainNodes[2].connect).toHaveBeenCalledWith(gainNodes[1])
    })
  })
  // The anti-click edge fade mutates the decoded samples. The menu track is an
  // authored seamless loop, so fading its edges would put a dip at the seam;
  // previews loop arbitrary song audio and still need it.
  describe('loop edge fade', () => {
    const SAMPLE_RATE = 48000
    function makeConstantBuffer(): AudioBuffer {
      const data = new Float32Array(SAMPLE_RATE).fill(0.5)
      return {
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 1,
        length: data.length,
        duration: 1,
        getChannelData: () => data,
      } as unknown as AudioBuffer
    }

    it('only the preview channel gets the fade', () => {
      expect(channelNeedsDeclick('music')).toBe(false)
      expect(channelNeedsDeclick('preview')).toBe(true)
    })

    it('leaves the menu music buffer untouched at both edges', async () => {
      const { context, bufferSources } = makeFakeAudioContext()
      context.decodeAudioData = vi.fn(() => Promise.resolve(makeConstantBuffer()))
      const manager = createWebAudioManager(() => context)

      await manager.play('menu_loop.wav', 'music')

      const data = (bufferSources[0].buffer as AudioBuffer).getChannelData(0)
      expect(data[0]).toBe(0.5)
      expect(data[data.length - 1]).toBe(0.5)
    })

    it('fades the first and last samples of a preview buffer', async () => {
      const { context, bufferSources } = makeFakeAudioContext()
      context.decodeAudioData = vi.fn(() => Promise.resolve(makeConstantBuffer()))
      const manager = createWebAudioManager(() => context)

      await manager.play('song.mp3', 'preview', { previewStartSec: 0 })

      const data = (bufferSources[0].buffer as AudioBuffer).getChannelData(0)
      const fadeSamples = Math.round(LOOP_DECLICK_SECONDS * SAMPLE_RATE)
      expect(data[0]).toBe(0)
      expect(data[data.length - 1]).toBe(0)
      expect(data[fadeSamples]).toBe(0.5)
    })

    it('never hands a faded buffer to the music channel when the same track was previewed first', async () => {
      const { context, bufferSources } = makeFakeAudioContext()
      context.decodeAudioData = vi.fn(() => Promise.resolve(makeConstantBuffer()))
      const manager = createWebAudioManager(() => context)

      await manager.play('same.wav', 'preview', { previewStartSec: 0 })
      await manager.play('same.wav', 'music')

      expect(context.decodeAudioData).toHaveBeenCalledTimes(2)
      const musicData = (bufferSources[1].buffer as AudioBuffer).getChannelData(0)
      expect(musicData[0]).toBe(0.5)
    })
  })

  // A library song played as menu music (src/audio/menuMusic.ts): opened at its
  // preview start, played once, not cached, and reported back when it starts.
  describe('a library song on the menu bus', () => {
    const SONG = { previewStartSec: 42, startAtPreview: true, loop: false, cache: false }

    it('opens at the preview start, plays once, and reports its timing', async () => {
      const { context, bufferSources } = makeFakeAudioContext()
      context.decodeAudioData = vi.fn().mockResolvedValue({ duration: 200 } as AudioBuffer)
      const manager = createWebAudioManager(() => context)
      const onStarted = vi.fn()

      await manager.crossfadeTo('song.mp3', 1200, 'music', { ...SONG, onStarted })

      expect(bufferSources[0].loop).toBe(false)
      expect(bufferSources[0].loopStart).toBeUndefined()
      expect(bufferSources[0].start).toHaveBeenCalledWith(0, 42)
      expect(onStarted).toHaveBeenCalledWith({ durationSec: 200, offsetSec: 42 })
    })

    it('falls back to the preview heuristic without a #PREVIEWSTART', async () => {
      const { context, bufferSources } = makeFakeAudioContext()
      context.decodeAudioData = vi.fn().mockResolvedValue({ duration: 200 } as AudioBuffer)
      const manager = createWebAudioManager(() => context)

      await manager.play('song.mp3', 'music', { ...SONG, previewStartSec: null })

      expect(bufferSources[0].start).toHaveBeenCalledWith(0, previewStartOffset(200))
    })

    it('decodes it afresh every time rather than keeping a whole song in memory', async () => {
      const { context } = makeFakeAudioContext()
      const manager = createWebAudioManager(() => context)

      await manager.play('song.mp3', 'music', SONG)
      await manager.play('song.mp3', 'music', SONG)

      expect(context.decodeAudioData).toHaveBeenCalledTimes(2)
    })

    it('reports a track that fails to load, leaving whatever was playing alone', async () => {
      const { context, bufferSources } = makeFakeAudioContext()
      const manager = createWebAudioManager(() => context)
      await manager.play('menu.wav', 'music')
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      const onError = vi.fn()
      const onStarted = vi.fn()

      await manager.crossfadeTo('missing.mp3', 3000, 'music', { ...SONG, onError, onStarted })

      expect(onError).toHaveBeenCalledOnce()
      expect(onStarted).not.toHaveBeenCalled()
      expect(bufferSources[0].stop).not.toHaveBeenCalled()
    })

    it('reports nothing for a track superseded while it was loading', async () => {
      const { context, deferDecodes, flushDecodes } = makeFakeAudioContext()
      deferDecodes()
      const manager = createWebAudioManager(() => context)
      const onStarted = vi.fn()

      const pending = manager.crossfadeTo('song.mp3', 1200, 'music', { ...SONG, onStarted })
      manager.stop(100, 'music')
      await flushDecodes()
      await pending

      expect(onStarted).not.toHaveBeenCalled()
    })
  })

  // The results bed (src/audio/resultsBed.ts): the sung song, through the
  // `muffled` chain, on its own `results` bus.
  describe('the results bed', () => {
    const BED = resultsBedPlayOptions(42)

    /** A context that can build the whole chain; its nodes are recorded in creation order. */
    function fullContext() {
      const fake = makeFakeAudioContext()
      const filters: BiquadFilterNodeLike[] = []
      const convolvers: ConvolverNodeLike[] = []
      Object.assign(fake.context, {
        sampleRate: 8000,
        createBiquadFilter: vi.fn(() => {
          const node: BiquadFilterNodeLike = { type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0 }, connect: vi.fn() }
          filters.push(node)
          return node
        }),
        createConvolver: vi.fn(() => {
          const node: ConvolverNodeLike = { buffer: null, normalize: false, connect: vi.fn() }
          convolvers.push(node)
          return node
        }),
        createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
          const data = Array.from({ length: channels }, () => new Float32Array(length))
          return { numberOfChannels: channels, length, sampleRate, getChannelData: (c: number) => data[c] } as unknown as AudioBuffer
        }),
      })
      fake.context.decodeAudioData = vi.fn().mockResolvedValue({ duration: 200 } as AudioBuffer)
      return { ...fake, filters, convolvers }
    }

    it('routes the track through lowpass -> high-shelf -> dry/convolver -> level, then the results bus', async () => {
      const { context, gainNodes, filters, convolvers, bufferSources } = fullContext()
      const mixer: MixerBinding = { gainFor: () => 0.5, subscribe: () => () => {} }
      const manager = createWebAudioManager(() => context, undefined, mixer)

      await manager.crossfadeTo('song.mp3', 1500, 'results', BED)

      const [lowpass, highShelf] = filters
      expect(lowpass).toMatchObject({ type: 'lowpass', frequency: { value: RESULTS_BED_EFFECT.lowpassHz }, Q: { value: RESULTS_BED_EFFECT.lowpassQ } })
      expect(highShelf).toMatchObject({ type: 'highshelf', gain: { value: RESULTS_BED_EFFECT.highShelfDb } })
      expect(convolvers).toHaveLength(1)
      expect(convolvers[0].buffer).not.toBeNull()

      // Track node first, then the bus, then the chain's own gains.
      const trackNode = gainNodes[0]
      const bus = gainNodes[1]
      expect(bufferSources[0].connect).toHaveBeenCalledWith(trackNode)
      expect(trackNode.connect).toHaveBeenCalledWith(lowpass)
      expect(bus.gain.value).toBe(0.5)
      const level = gainNodes.find((node) => node !== bus && vi.mocked(node.connect).mock.calls.some(([to]) => to === bus))!
      expect(level.gain.value).toBeCloseTo(dbToGain(RESULTS_BED_EFFECT.levelDb), 9)
      // The track never bypasses the chain onto the bus.
      expect(trackNode.connect).not.toHaveBeenCalledWith(bus)
    })

    it('fades in from silence, opens at the preview start, and loops from there to the end', async () => {
      const { context, gainNodes, bufferSources } = fullContext()
      const manager = createWebAudioManager(() => context)

      await manager.crossfadeTo('song.mp3', 1500, 'results', BED)

      expect(bufferSources[0].start).toHaveBeenCalledWith(0, 42)
      expect(bufferSources[0].loop).toBe(true)
      expect(bufferSources[0].loopStart).toBe(42)
      expect(bufferSources[0].loopEnd).toBe(200)
      expect(gainNodes[0].gain.value).toBe(0)
      expect(gainNodes[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 1.5)
    })

    it('fades out and stops on stop(), leaving the other buses alone', async () => {
      const { context, gainNodes, bufferSources } = fullContext()
      const manager = createWebAudioManager(() => context)
      await manager.play('menu.wav', 'music')
      await manager.crossfadeTo('song.mp3', 1500, 'results', BED)
      const bedGain = vi.mocked(bufferSources[1].connect).mock.calls[0][0]
      expect(gainNodes).toContain(bedGain)

      manager.stop(800, 'results')

      expect(bedGain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.8)
      expect(bufferSources[1].stop).toHaveBeenCalledWith(0.8)
      expect(bufferSources[0].stop).not.toHaveBeenCalled()
    })

    it('plays dry-but-quieter on a minimal context, and never errors', async () => {
      const { context, gainNodes, bufferSources } = makeFakeAudioContext()
      const manager = createWebAudioManager(() => context)
      const onError = vi.fn()

      await manager.crossfadeTo('song.mp3', 1500, 'results', { ...BED, onError })

      expect(onError).not.toHaveBeenCalled()
      expect(bufferSources[0].start).toHaveBeenCalledOnce()
      expect(gainNodes.some((node) => Math.abs(node.gain.value - dbToGain(RESULTS_BED_EFFECT.levelDb)) < 1e-9)).toBe(true)
    })

    it('reports a song that cannot load and starts nothing', async () => {
      const { context, bufferSources } = fullContext()
      const manager = createWebAudioManager(() => context)
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      const onError = vi.fn()

      await manager.crossfadeTo('missing.mp3', 1500, 'results', { ...BED, onError })

      expect(onError).toHaveBeenCalledOnce()
      expect(bufferSources).toHaveLength(0)
      // A stop() afterwards is a harmless no-op.
      expect(() => manager.stop(800, 'results')).not.toThrow()
    })

    it('gets the anti-click loop fade, like a preview', () => {
      expect(channelNeedsDeclick('results')).toBe(true)
    })

    it('never caches the whole song, but reuses the buffer its preview already decoded', async () => {
      const { context } = fullContext()
      const manager = createWebAudioManager(() => context)

      await manager.crossfadeTo('fresh.mp3', 1500, 'results', BED)
      await manager.crossfadeTo('fresh.mp3', 1500, 'results', BED)
      expect(context.decodeAudioData).toHaveBeenCalledTimes(2)

      await manager.play('previewed.mp3', 'preview')
      await manager.crossfadeTo('previewed.mp3', 1500, 'results', BED)
      expect(context.decodeAudioData).toHaveBeenCalledTimes(3)
    })
  })
})

// --- Handing a playing source between channels (Home <-> Song Select) --------

describe('createWebAudioManager -- transfer, natural end and equal-power crossfades', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const MENU_SONG = { previewStartSec: 60, startAtPreview: true, loop: false, cache: false }

  function setTime(context: AudioContextLike, seconds: number) {
    ;(context as { currentTime: number }).currentTime = seconds
  }

  function songContext() {
    const fake = makeFakeAudioContext({ currentTime: 10 })
    fake.context.decodeAudioData = vi.fn().mockResolvedValue({ duration: 200 } as AudioBuffer)
    return fake
  }

  it('hands the very same source over: no new decode, source or start, and no stop', async () => {
    const { context, bufferSources } = songContext()
    const manager = createWebAudioManager(() => context)
    await manager.crossfadeTo('song.mp3', 1200, 'music', MENU_SONG)
    const source = bufferSources[0]

    const moved = manager.transfer!('music', 'preview', 400, { track: 'song.mp3' })

    expect(moved).toMatchObject({ track: 'song.mp3', durationSec: 200 })
    expect(context.decodeAudioData).toHaveBeenCalledOnce()
    expect(context.createBufferSource).toHaveBeenCalledOnce()
    expect(source.start).toHaveBeenCalledOnce()
    expect(source.stop).not.toHaveBeenCalled()
  })

  it('reports a continuous position: where the source has got to, not where it started', async () => {
    const { context } = songContext()
    const manager = createWebAudioManager(() => context)
    await manager.crossfadeTo('song.mp3', 1200, 'music', MENU_SONG)

    setTime(context, 25)
    expect(manager.transfer!('music', 'preview', 400)?.positionSec).toBeCloseTo(75, 6)

    // And it keeps counting on the new channel, through a second handover.
    setTime(context, 40)
    expect(manager.transfer!('preview', 'music', 400)?.positionSec).toBeCloseTo(90, 6)
  })

  it('folds the position of a looping preview back into its loop', async () => {
    const { context } = songContext()
    const manager = createWebAudioManager(() => context)
    // Opens 60 s into a 200 s song and loops 60..200.
    await manager.play('song.mp3', 'preview')

    setTime(context, 10 + 150)
    expect(manager.transfer!('preview', 'music', 400)?.positionSec).toBeCloseTo(70, 6)
  })

  it('the receiving channel now owns the source; the giving channel is empty', async () => {
    const { context, gainNodes, bufferSources } = songContext()
    const manager = createWebAudioManager(() => context)
    await manager.crossfadeTo('song.mp3', 1200, 'music', MENU_SONG)
    const [source] = bufferSources
    const [gain] = gainNodes
    manager.transfer!('music', 'preview', 400)
    vi.mocked(gain.gain.linearRampToValueAtTime).mockClear()

    // Nothing left on the menu bus to stop or duck.
    manager.stop(300, 'music')
    manager.duckTo(0.2, 300, 'music')
    expect(source.stop).not.toHaveBeenCalled()
    expect(gain.gain.linearRampToValueAtTime).not.toHaveBeenCalled()

    manager.stop(300, 'preview')
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10.3)
    expect(source.stop).toHaveBeenCalledWith(10.3)
  })

  it('hands nothing over -- and changes nothing -- when the channel is playing another track, or nothing', async () => {
    const { context, bufferSources } = songContext()
    const manager = createWebAudioManager(() => context)
    expect(manager.transfer!('music', 'preview', 400)).toBeNull()

    await manager.crossfadeTo('song.mp3', 1200, 'music', MENU_SONG)
    expect(manager.transfer!('music', 'preview', 400, { track: 'other.mp3' })).toBeNull()
    expect(manager.transfer!('music', 'music', 400)).toBeNull()

    manager.stop(300, 'music')
    expect(bufferSources[0].stop).toHaveBeenCalled()
  })

  it('stops whatever the receiving channel was still playing, on the fade', async () => {
    const { context, bufferSources } = songContext()
    const manager = createWebAudioManager(() => context)
    await manager.play('old-preview.mp3', 'preview')
    await manager.crossfadeTo('song.mp3', 1200, 'music', MENU_SONG)

    manager.transfer!('music', 'preview', 400)

    expect(bufferSources[0].stop).toHaveBeenCalledWith(10.4)
    expect(bufferSources[1].stop).not.toHaveBeenCalled()
  })

  it('can switch looping off as the source changes hands', async () => {
    const { context, bufferSources } = songContext()
    const manager = createWebAudioManager(() => context)
    await manager.play('preview.mp3', 'preview')
    expect(bufferSources[0].loop).toBe(true)

    manager.transfer!('preview', 'music', 400, { loop: false })

    expect(bufferSources[0].loop).toBe(false)
  })

  it('supersedes a menu song still decoding on the giving channel', async () => {
    const { context, bufferSources, deferDecodes, flushDecodes } = songContext()
    const manager = createWebAudioManager(() => context)
    await manager.crossfadeTo('a.mp3', 1200, 'music', MENU_SONG)
    deferDecodes()
    const onStarted = vi.fn()
    const pending = manager.crossfadeTo('b.mp3', 3000, 'music', { ...MENU_SONG, onStarted })

    manager.transfer!('music', 'preview', 400)
    await flushDecodes()
    await pending

    expect(onStarted).not.toHaveBeenCalled()
    expect(bufferSources[1].stop).toHaveBeenCalled()
    expect(bufferSources[0].stop).not.toHaveBeenCalled()
  })

  describe('with mixer buses', () => {
    function fakeMixer(gains: Record<string, number>): MixerBinding {
      return { gainFor: (channel) => gains[channel], subscribe: () => () => {} }
    }

    it('swaps the buses rather than re-wiring the source, and glides each to its new level', async () => {
      const { context, gainNodes } = songContext()
      const manager = createWebAudioManager(() => context, undefined, fakeMixer({ music: 0.25, preview: 0.64, results: 1 }))
      await manager.crossfadeTo('song.mp3', 1200, 'music', MENU_SONG)
      const [trackNode, menuBus] = gainNodes
      expect(trackNode.connect).toHaveBeenCalledWith(menuBus)
      expect(menuBus.gain.value).toBe(0.25)

      manager.transfer!('music', 'preview', 400)

      // Still wired to the same bus -- which is now the preview bus, gliding
      // from the Menu music level to the Music level over 400 ms, not jumping.
      expect(trackNode.connect).toHaveBeenCalledOnce()
      expect(menuBus.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.64, 10.4)
      const otherBus = gainNodes[2]
      expect(otherBus.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0.25, 10.4)

      // The next preview of another song lands on the bus the song is on now.
      await manager.crossfadeTo('next.mp3', 700, 'preview')
      expect(gainNodes[3].connect).toHaveBeenCalledWith(menuBus)
    })
  })

  describe('a track that plays out', () => {
    it('tells its owner and leaves the channel empty', async () => {
      const { context, bufferSources } = songContext()
      const manager = createWebAudioManager(() => context)
      const onEnded = vi.fn()
      await manager.play('song.mp3', 'preview', { loop: false, onEnded })

      bufferSources[0].onended?.()

      expect(onEnded).toHaveBeenCalledOnce()
      manager.stop(300, 'preview')
      expect(bufferSources[0].stop).not.toHaveBeenCalled()
    })

    it('says nothing for a source that was stopped, or crossfaded away', async () => {
      const { context, bufferSources } = songContext()
      const manager = createWebAudioManager(() => context)
      const first = vi.fn()
      const second = vi.fn()
      await manager.play('a.mp3', 'preview', { loop: false, onEnded: first })
      await manager.crossfadeTo('b.mp3', 700, 'preview', { loop: false, onEnded: second })
      bufferSources[0].onended?.()
      expect(first).not.toHaveBeenCalled()

      manager.stop(300, 'preview')
      bufferSources[1].onended?.()
      expect(second).not.toHaveBeenCalled()
    })

    it('reports the end to the channel the source was handed to, with the new owner callback', async () => {
      const { context, bufferSources } = songContext()
      const manager = createWebAudioManager(() => context)
      const menuEnded = vi.fn()
      const previewEnded = vi.fn()
      await manager.crossfadeTo('song.mp3', 1200, 'music', { ...MENU_SONG, onEnded: menuEnded })
      manager.transfer!('music', 'preview', 400, { onEnded: previewEnded })

      bufferSources[0].onended?.()

      expect(previewEnded).toHaveBeenCalledOnce()
      expect(menuEnded).not.toHaveBeenCalled()
    })
  })

  describe('equal-power crossfade', () => {
    it('fades in on a sine and out on a cosine, each finishing exactly on its target', async () => {
      const { context, gainNodes } = songContext()
      const manager = createWebAudioManager(() => context)
      await manager.play('a.mp3', 'preview')
      const outgoing = gainNodes[0]

      await manager.crossfadeTo('b.mp3', 800, 'preview', { fadeCurve: 'equal-power' })
      const incoming = gainNodes[1]

      const inCalls = vi.mocked(incoming.gain.linearRampToValueAtTime).mock.calls
      const outCalls = vi.mocked(outgoing.gain.linearRampToValueAtTime).mock.calls
      expect(inCalls).toHaveLength(EQUAL_POWER_STEPS)
      expect(outCalls).toHaveLength(EQUAL_POWER_STEPS)
      expect(inCalls.at(-1)).toEqual([1, 10.8])
      expect(outCalls.at(-1)).toEqual([0, 10.8])

      // Halfway: both at -3 dB, so the summed power of two songs stays put.
      const half = EQUAL_POWER_STEPS / 2 - 1
      expect(inCalls[half][0]).toBeCloseTo(Math.SQRT1_2, 6)
      expect(outCalls[half][0]).toBeCloseTo(Math.SQRT1_2, 6)
      expect(inCalls[half][0] ** 2 + outCalls[half][0] ** 2).toBeCloseTo(1, 6)
    })

    it('leaves the default crossfade linear', async () => {
      const { context, gainNodes } = songContext()
      const manager = createWebAudioManager(() => context)
      await manager.play('a.mp3', 'preview')
      await manager.crossfadeTo('b.mp3', 800, 'preview')

      expect(gainNodes[1].gain.linearRampToValueAtTime).toHaveBeenCalledOnce()
    })

    it('a new ramp replaces a fade still in flight instead of queueing behind it', async () => {
      const { context, gainNodes } = songContext()
      const manager = createWebAudioManager(() => context)
      await manager.play('a.mp3', 'preview')
      await manager.crossfadeTo('b.mp3', 800, 'preview', { fadeCurve: 'equal-power' })
      const cancelAndHoldAtTime = vi.fn()
      gainNodes[1].gain.cancelAndHoldAtTime = cancelAndHoldAtTime

      setTime(context, 10.2)
      manager.stop(250, 'preview')

      expect(cancelAndHoldAtTime).toHaveBeenCalledWith(10.2)
    })
  })
})
