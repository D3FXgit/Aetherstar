import { describe, expect, it, vi } from 'vitest'
import {
  createSfxPlayer,
  DEFAULT_SFX_VOLUME,
  SFX_CUT_INSTEAD_OF_FADE_MS,
  SFX_STOP_FADE_MS,
  SFX_VOICES_PER_SOUND,
} from '../sfxPlayer'
import type { AudioContextLike, BufferSourceNodeLike, GainNodeLike } from '../webAudioApi'
import type { SfxName } from '../sfxContract'
import { SFX_URLS } from '../sfxAssets'

// Derived from the real registry rather than hand-listed: this fixture only
// ever needs to be *complete*, and a hand-written copy meant every new sound
// broke six unrelated tests with a type error that says nothing about them.
const URLS = Object.fromEntries(
  Object.keys(SFX_URLS).map((name) => [name, `/${name}.wav`]),
) as Record<SfxName, string>

function makeFakeGainNode(): GainNodeLike {
  return {
    gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(),
  }
}

function makeFakeBufferSource(): BufferSourceNodeLike {
  return { buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
}

function makeFakeAudioContext(overrides: Partial<AudioContextLike> = {}) {
  const fakeBuffer = {} as AudioBuffer
  const gainNodes: GainNodeLike[] = []
  const bufferSources: BufferSourceNodeLike[] = []

  const context = {
    currentTime: 0,
    state: 'running' as const,
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
  } as unknown as AudioContextLike & { currentTime: number }

  return { context, gainNodes, bufferSources, fakeBuffer }
}

/** Bytes without a network. Every play in here goes through this. */
const fetchAudio = () => Promise.resolve(new ArrayBuffer(8))

/** Lets microtasks (fetch -> decode -> start) settle. */
async function flush() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
}

async function makePlayer(overrides: Partial<AudioContextLike> = {}) {
  const fake = makeFakeAudioContext(overrides)
  const player = createSfxPlayer(() => fake.context, URLS, DEFAULT_SFX_VOLUME, fetchAudio)
  return { ...fake, player }
}

describe('createSfxPlayer', () => {
  it('fetches the named sound and plays it through the shared context', async () => {
    const fetchSpy = vi.fn(fetchAudio)
    const { context, bufferSources } = makeFakeAudioContext()
    const player = createSfxPlayer(() => context, URLS, DEFAULT_SFX_VOLUME, fetchSpy)

    player.play('click')
    await flush()

    expect(fetchSpy).toHaveBeenCalledWith('/click.wav')
    expect(bufferSources).toHaveLength(1)
    expect(bufferSources[0].start).toHaveBeenCalledOnce()
  })

  it('applies the SFX volume so effects sit under the menu music', async () => {
    const { player, gainNodes } = await makePlayer()

    player.play('confirm')
    await flush()

    expect(gainNodes[0].gain.value).toBe(DEFAULT_SFX_VOLUME)
  })

  it('reads a volume function at the start of every sound, so the Effects slider applies to the next one', async () => {
    const fake = makeFakeAudioContext()
    let level = 0.5
    const player = createSfxPlayer(() => fake.context, URLS, () => level, fetchAudio)

    player.play('confirm')
    await flush()
    level = 0.1
    player.play('confirm')
    await flush()

    expect(fake.gainNodes[0].gain.value).toBe(0.5)
    expect(fake.gainNodes[1].gain.value).toBe(0.1)
  })

  it('routes every voice into the context destination, so SFX mix with the music instead of competing with it', async () => {
    const { player, gainNodes, bufferSources, context } = await makePlayer()

    player.play('hover')
    await flush()

    expect(bufferSources[0].connect).toHaveBeenCalledWith(gainNodes[0])
    expect(gainNodes[0].connect).toHaveBeenCalledWith(context.destination)
  })

  it('gives overlapping plays their own voice, so rapid sounds do not cut each other off', async () => {
    const { player, bufferSources } = await makePlayer()

    player.play('hover')
    await flush()
    player.play('hover')
    await flush()

    expect(bufferSources).toHaveLength(2)
    expect(bufferSources[0].stop).not.toHaveBeenCalled()
  })

  it('resumes a context the autoplay policy left suspended rather than playing into silence', async () => {
    const { player, context } = await makePlayer({ state: 'suspended' })

    player.play('click')
    await flush()

    expect(context.resume).toHaveBeenCalled()
  })

  it('swallows a failed fetch (a missing sound) instead of throwing into the caller', async () => {
    const { context } = makeFakeAudioContext()
    const player = createSfxPlayer(() => context, URLS, DEFAULT_SFX_VOLUME, () =>
      Promise.reject(new Error('404')),
    )

    expect(() => player.play('click')).not.toThrow()
    await flush()
  })

  it('swallows a throwing context factory instead of breaking the interaction that triggered it', () => {
    const player = createSfxPlayer(
      () => {
        throw new Error('no Web Audio in this environment')
      },
      URLS,
      DEFAULT_SFX_VOLUME,
      fetchAudio,
    )

    expect(() => player.play('error')).not.toThrow()
  })

  it('decodes each sound once however often it is played', async () => {
    const fetchSpy = vi.fn(fetchAudio)
    const { context } = makeFakeAudioContext()
    const player = createSfxPlayer(() => context, URLS, DEFAULT_SFX_VOLUME, fetchSpy)

    player.play('hitGood')
    await flush()
    for (let i = 0; i < 50; i += 1) player.play('hitGood')
    await flush()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1)
  })

  it('starts an already-decoded sound synchronously, so a click and its click sound land together', async () => {
    const { player, bufferSources } = await makePlayer()

    player.play('click')
    await flush()
    player.play('click')

    // No await between the second play and this assertion: the sound is
    // already sounding.
    expect(bufferSources).toHaveLength(2)
  })

  it('preload() decodes the whole set up front, so the first hit of a song is as prompt as the thousandth', async () => {
    const fetchSpy = vi.fn(fetchAudio)
    const { context } = makeFakeAudioContext()
    const player = createSfxPlayer(() => context, URLS, DEFAULT_SFX_VOLUME, fetchSpy)

    await player.preload()

    expect(fetchSpy).toHaveBeenCalledTimes(Object.keys(URLS).length)
    // And nothing was played by warming the cache.
    expect(context.createBufferSource).not.toHaveBeenCalled()
  })
})

/**
 * The bug this pins, reported from a real session: "sfx kill the song and make
 * the software stutter and freeze", and later "SFX in combination with music
 * are glitchy and make weird buffer noises".
 *
 * Nothing may be allocated per play beyond the buffer source itself, and one
 * sound may never stack up an unbounded number of simultaneous voices -- eight
 * lanes of hit feedback fire up to ~11-22 times a second (see hitSfxGate).
 */
describe('createSfxPlayer voice budget', () => {
  it('caps how many copies of one sound overlap, stealing the oldest', async () => {
    const { player, bufferSources } = await makePlayer()

    player.play('hitGood')
    await flush()
    for (let i = 0; i < 2000; i += 1) player.play('hitGood')

    const stopped = bufferSources.filter((source) => (source.stop as ReturnType<typeof vi.fn>).mock.calls.length > 0)
    const sounding = bufferSources.length - stopped.length
    expect(sounding).toBeLessThanOrEqual(SFX_VOICES_PER_SOUND)
  })

  it('budgets per sound, so one busy sound cannot silence another', async () => {
    const { player, bufferSources } = await makePlayer()
    const names = Object.keys(URLS) as SfxName[]

    await player.preload()
    for (const name of names) player.play(name)

    // Every distinct sound got its own voice and none was stolen.
    expect(bufferSources).toHaveLength(names.length)
    expect(bufferSources.every((source) => (source.stop as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true)
  })
})

// The handle exists so that whatever a React effect starts, its cleanup can
// release. See sfxContract.ts's SfxHandle for the two bugs that came of not
// having one.
describe('the returned handle', () => {
  it('cuts a sound that has barely started, so a cancelled play cannot overlap its own replacement', async () => {
    const { player, bufferSources, gainNodes } = await makePlayer()

    await player.preload()
    // The StrictMode shape exactly: play, then cleanup in the same tick.
    player.play('songSelected').stop()

    expect(bufferSources[0].stop).toHaveBeenCalledWith()
    expect(gainNodes[0].gain.value).toBe(0)
  })

  it('fades a sound that is already at level instead of cutting it to a click', async () => {
    const { player, bufferSources, gainNodes, context } = await makePlayer()

    await player.preload()
    const handle = player.play('songSelected')
    // 2 s into song_selected.wav: full level.
    ;(context as { currentTime: number }).currentTime = 2
    handle.stop()

    expect(gainNodes[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 2 + SFX_STOP_FADE_MS / 1000)
    // Torn down at silence rather than mid-fade -- which would be the click all
    // over again.
    expect(bufferSources[0].stop).toHaveBeenCalledWith(2 + SFX_STOP_FADE_MS / 1000)
  })

  it('is idempotent, so two teardown paths cannot restart the ramp from a half-faded value', async () => {
    const { player, bufferSources, gainNodes, context } = await makePlayer()

    await player.preload()
    const handle = player.play('songSelected')
    ;(context as { currentTime: number }).currentTime = 2
    handle.stop()
    handle.stop()

    expect(gainNodes[0].gain.linearRampToValueAtTime).toHaveBeenCalledOnce()
    expect(bufferSources[0].stop).toHaveBeenCalledOnce()
  })

  it('cuts immediately on a zero fade', async () => {
    const { player, bufferSources, gainNodes, context } = await makePlayer()

    await player.preload()
    const handle = player.play('songSelected')
    ;(context as { currentTime: number }).currentTime = 2
    handle.stop(0)

    expect(gainNodes[0].gain.value).toBe(0)
    expect(bufferSources[0].stop).toHaveBeenCalledWith()
  })

  it('cancels a sound stopped before its buffer finished decoding, rather than letting it start late', async () => {
    const { player, bufferSources } = await makePlayer()

    // First play of this sound: nothing is decoded yet, so the handle exists
    // before the voice does.
    player.play('songSelected').stop()
    await flush()

    expect(bufferSources).toHaveLength(0)
  })

  it('uses the cut threshold measured from the sound envelope, not a magic number', async () => {
    const justBefore = await makePlayer()
    const justAfter = await makePlayer()

    await justBefore.player.preload()
    const early = justBefore.player.play('songSelected')
    ;(justBefore.context as { currentTime: number }).currentTime = (SFX_CUT_INSTEAD_OF_FADE_MS - 1) / 1000
    early.stop()

    await justAfter.player.preload()
    const late = justAfter.player.play('songSelected')
    ;(justAfter.context as { currentTime: number }).currentTime = (SFX_CUT_INSTEAD_OF_FADE_MS + 1) / 1000
    late.stop()

    expect(justBefore.gainNodes[0].gain.linearRampToValueAtTime).not.toHaveBeenCalled()
    expect(justAfter.gainNodes[0].gain.linearRampToValueAtTime).toHaveBeenCalled()
  })

  it('is a safe no-op when there was never a sound to play', async () => {
    const { context } = makeFakeAudioContext()
    const missingUrls = { ...URLS, click: '' }
    const player = createSfxPlayer(() => context, missingUrls, DEFAULT_SFX_VOLUME, fetchAudio)

    expect(() => player.play('click').stop()).not.toThrow()
  })
})
