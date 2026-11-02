import { SFX_ASSETS } from '../assets/manifest'
import { pickVariation } from './pickVariation'
import { computeDuckedVolume } from './duckVolume'

export interface AudioBufferSourceLike {
  buffer: unknown
  connect: (node: unknown) => void
  start: (when?: number) => void
}

export interface GainNodeLike {
  gain: { value: number }
  connect: (node: unknown) => void
}

export interface AudioContextLike {
  createBufferSource(): AudioBufferSourceLike
  createGain(): GainNodeLike
  decodeAudioData(data: ArrayBuffer): Promise<unknown>
  destination: unknown
  /** For precise click-track scheduling in calibration; the SFX engine itself never reads this. */
  currentTime: number
}

export interface SfxEngineDeps {
  audioContext: AudioContextLike
  fetchArrayBuffer: (url: string) => Promise<ArrayBuffer>
  getSongAudioElement: () => { volume: number } | null
}

export interface SfxEngine {
  loadAll(): Promise<void>
  play(name: string): void
  setVolume(volume: number): void
}

const DUCK_AMOUNT = 0.6
const DUCK_DURATION_MS = 400

/** Strips the manifest's 'sfx/' prefix and extension: 'sfx/hit_perfect.wav' -> 'hit_perfect'. */
function nameFromPath(path: string): string {
  return path.replace(/^sfx\//, '').replace(/\.\w+$/, '')
}

/** Raw Web Audio API SFX playback: preloaded buffers, per-name variation, and a brief duck of the song's own volume per trigger. */
export function createSfxEngine({ audioContext, fetchArrayBuffer, getSongAudioElement }: SfxEngineDeps): SfxEngine {
  const buffers = new Map<string, unknown[]>()
  const lastVariation = new Map<string, number>()
  const masterGain = audioContext.createGain()
  masterGain.connect(audioContext.destination)

  return {
    async loadAll() {
      await Promise.all(
        SFX_ASSETS.map(async (spec) => {
          const name = nameFromPath(spec.path)
          const arrayBuffer = await fetchArrayBuffer(spec.path)
          const decoded = await audioContext.decodeAudioData(arrayBuffer)
          buffers.set(name, [...(buffers.get(name) ?? []), decoded])
        }),
      )
    },

    play(name) {
      const variants = buffers.get(name)
      if (!variants || variants.length === 0) return

      const index = pickVariation(variants.length, lastVariation.get(name) ?? null)
      lastVariation.set(name, index)

      const source = audioContext.createBufferSource()
      source.buffer = variants[index]
      source.connect(masterGain)
      source.start()

      const songElement = getSongAudioElement()
      if (songElement) {
        const baseVolume = songElement.volume
        songElement.volume = computeDuckedVolume(baseVolume, DUCK_AMOUNT)
        setTimeout(() => {
          songElement.volume = baseVolume
        }, DUCK_DURATION_MS)
      }
    },

    setVolume(volume) {
      masterGain.gain.value = volume
    },
  }
}
