import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { SFX_URLS, SONG_SELECTED_DURATION_MS, SONG_SELECTED_PEAK_OFFSET_MS } from '../sfxAssets'
import { menuSongUrl } from '../menuTrack'

// Every audio file the app ships is synthesized by
// scripts/generate-sound-assets.mjs (see assets/sfx/README.md). These checks
// pin the properties the code depends on, and that nothing in the audio
// folders came from anywhere else.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const GENERATOR = readFileSync(path.join(ROOT, 'scripts/generate-sound-assets.mjs'), 'utf-8')

interface Wav {
  format: number
  channels: number
  sampleRate: number
  bits: number
  /** Mono mix of all channels (a stereo file is averaged L/R), one value per frame. */
  samples: Float32Array
  /** Each channel's own frames. */
  channelData: Float32Array[]
}

function readWav(relPath: string): Wav {
  const b = readFileSync(path.join(ROOT, relPath))
  expect(b.toString('ascii', 0, 4)).toBe('RIFF')
  expect(b.toString('ascii', 8, 12)).toBe('WAVE')
  let offset = 12
  let fmt: Omit<Wav, 'samples' | 'channelData'> | undefined
  let channelData: Float32Array[] | undefined
  while (offset + 8 <= b.length) {
    const id = b.toString('ascii', offset, offset + 4)
    const size = b.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      fmt = {
        format: b.readUInt16LE(offset + 8),
        channels: b.readUInt16LE(offset + 10),
        sampleRate: b.readUInt32LE(offset + 12),
        bits: b.readUInt16LE(offset + 22),
      }
    } else if (id === 'data' && fmt) {
      const nch = fmt.channels
      const frames = size / 2 / nch
      channelData = Array.from({ length: nch }, () => new Float32Array(frames))
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < nch; c++) channelData[c][i] = b.readInt16LE(offset + 8 + (i * nch + c) * 2) / 32768
      }
    }
    offset += 8 + size + (size & 1)
  }
  if (!fmt || !channelData) throw new Error(`${relPath}: missing fmt or data chunk`)
  const chans = channelData
  const samples = Float32Array.from(chans[0], (_, i) => chans.reduce((sum, ch) => sum + ch[i], 0) / chans.length)
  return { ...fmt, samples, channelData }
}

function windowRms(x: Float32Array, from: number, to: number): number {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(to - from, 1))
}

const sfxFiles = readdirSync(path.join(ROOT, 'assets/sfx')).filter((f) => !f.startsWith('._') && f !== 'README.md')
const musicFiles = readdirSync(path.join(ROOT, 'menu_music')).filter((f) => !f.startsWith('._') && f !== 'README.md')

describe('shipped audio assets', () => {
  it('every audio file is produced by scripts/generate-sound-assets.mjs, and every file it produces exists', () => {
    const generated = [...GENERATOR.matchAll(/file: '([^']+\.wav)'/g)].map((m) => m[1]).sort()
    const onDisk = [...sfxFiles.map((f) => `assets/sfx/${f}`), ...musicFiles.map((f) => `menu_music/${f}`)].sort()
    expect(onDisk).toEqual(generated)
  })

  it('every registered sound effect points at a generated file', () => {
    for (const url of Object.values(SFX_URLS)) {
      expect(sfxFiles).toContain(path.basename(url.split('?')[0]))
    }
    expect(Object.keys(SFX_URLS)).toHaveLength(sfxFiles.length)
  })

  // The song-start trio is one stereo piece of music; everything else is mono.
  const STEREO = ['song_selected.wav', 'countdown_beep.wav', 'countdown_go.wav']

  it.each(sfxFiles)('%s is 16-bit PCM at 44.1 kHz (stereo for the song-start trio, else mono), starts and ends at silence', (file) => {
    const wav = readWav(`assets/sfx/${file}`)
    expect(wav).toMatchObject({ format: 1, channels: STEREO.includes(file) ? 2 : 1, sampleRate: 44100, bits: 16 })
    for (const ch of wav.channelData) {
      expect(Math.abs(ch[0])).toBeLessThan(0.01)
      expect(Math.abs(ch[ch.length - 1])).toBeLessThan(0.01)
    }
  })

  it('the stereo song-start trio stays small', () => {
    const total = STEREO.reduce((sum, f) => sum + statSync(path.join(ROOT, 'assets/sfx', f)).size, 0)
    expect(total).toBeLessThan(1.5 * 1024 * 1024)
  })

  it('song_selected.wav matches SONG_SELECTED_DURATION_MS and peaks at SONG_SELECTED_PEAK_OFFSET_MS', () => {
    // measured on the mono mix
    const { samples, sampleRate } = readWav('assets/sfx/song_selected.wav')
    expect(Math.round((samples.length / sampleRate) * 1000)).toBe(SONG_SELECTED_DURATION_MS)

    const w = Math.round(sampleRate * 0.025)
    const windows: number[] = []
    for (let i = 0; i + w <= samples.length; i += w) windows.push(windowRms(samples, i, i + w))
    const loudest = Math.max(...windows)
    // silent at 0 ms, full level (>= 97% of the loudest 25 ms window) first reached at the documented offset
    expect(windows[0]).toBeLessThan(loudest * 0.3)
    expect(windows.findIndex((r) => r >= 0.97 * loudest) * 25).toBe(SONG_SELECTED_PEAK_OFFSET_MS)
  })

  it('the menu track is the generated loop: 60-90 s, small, no silence at either end, and a seamless seam', () => {
    expect(musicFiles).toEqual(['menu_loop.wav'])
    expect(menuSongUrl).toContain('menu_loop')
    expect(statSync(path.join(ROOT, 'menu_music/menu_loop.wav')).size).toBeLessThan(4 * 1024 * 1024)

    const { samples, sampleRate, channels, bits, format } = readWav('menu_music/menu_loop.wav')
    expect({ format, channels, bits }).toEqual({ format: 1, channels: 1, bits: 16 })
    const seconds = samples.length / sampleRate
    expect(seconds).toBeGreaterThanOrEqual(60)
    expect(seconds).toBeLessThanOrEqual(90)

    const edge = Math.round(sampleRate * 0.05)
    const silence = 10 ** (-40 / 20)
    expect(windowRms(samples, 0, edge)).toBeGreaterThan(silence)
    expect(windowRms(samples, samples.length - edge, samples.length)).toBeGreaterThan(silence)

    // the jump from the last sample back to the first is no bigger than an ordinary sample step
    let maxStep = 0
    for (let i = 1; i < samples.length; i++) maxStep = Math.max(maxStep, Math.abs(samples[i] - samples[i - 1]))
    expect(Math.abs(samples[0] - samples[samples.length - 1])).toBeLessThan(maxStep)
  })
})
