// Authoring script for the built-in demo song, fixtures/sample-song/ (the
// committed output). Not part of `npm test`; re-run by hand after editing the
// chart, the arrangement or the cover below.
//
//   node scripts/generate-demo-audio.mjs
//
// Everything it writes is synthesized from scratch -- no samples, no
// third-party recordings -- so the demo song ships under the repo's own MIT
// license:
//
//   instrumental.wav  backing track (pad, bass, drums, arpeggio), mono 22.05 kHz 16-bit.
//                     Tagged as #AUDIO/#MP3 *and* #INSTRUMENTAL: the karaoke mix is the
//                     backing track, so the song still plays if the vocal stem is missing.
//   vocals.wav        guide melody that follows every note of notes.txt, mono 8 kHz 16-bit
//                     (a few soft harmonics need nothing more), tagged #VOCALS.
//   cover.png         gradient + star, tagged #COVER.
//
// The melody is read from notes.txt itself, so the guide voice always matches
// the chart. The harmony (CHORDS) is hand-written to fit it; change both
// together.
//
// Fully deterministic: noise comes from a seeded PRNG, so re-running without
// changes reproduces byte-identical files.
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SONG_DIR = path.join(ROOT, 'fixtures/sample-song')
const CHART_PATH = path.join(SONG_DIR, 'notes.txt')

const INSTRUMENTAL_RATE = 22050
const VOCALS_RATE = 8000

// --- Chart -----------------------------------------------------------------

const NOTE_LINE_PATTERN = /^([:*FRG])\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)(?:\s(.*))?$/

function parseChart(raw) {
  const lines = raw.split(/\r?\n/)
  const tags = new Map()
  const notes = []
  for (const line of lines) {
    if (/^\s*E\s*$/.test(line)) break
    if (line.startsWith('#')) {
      const sep = line.indexOf(':')
      if (sep !== -1) tags.set(line.slice(1, sep).trim().toUpperCase(), line.slice(sep + 1).trim())
      continue
    }
    const m = line.match(NOTE_LINE_PATTERN)
    if (!m) continue
    const [, marker, startBeat, length, pitch] = m
    notes.push({ marker, startBeat: Number(startBeat), length: Number(length), pitch: Number(pitch) })
  }
  return { bpm: Number(tags.get('BPM')), gap: Number(tags.get('GAP') ?? 0), notes }
}

const chart = parseChart(readFileSync(CHART_PATH, 'utf-8'))

// Same conversion as src/stage/timing/beatMs.ts: #BPM counts quarter beats.
const msPerBeat = 60000 / (chart.bpm * 4)
const beatToSec = (beat) => (chart.gap + beat * msPerBeat) / 1000

// One bar of 4/4 = 16 chart beats (a chart beat is a sixteenth note at #BPM:120).
const BEATS_PER_BAR = 16
const barToSec = (bar) => beatToSec(bar * BEATS_PER_BAR)
const QUARTER_SEC = (4 * msPerBeat) / 1000
const BAR_SEC = BEATS_PER_BAR * (msPerBeat / 1000)

// --- Arrangement -----------------------------------------------------------

// Bar index -> chord (bar 0 starts at #GAP). Intro bars are negative.
const CHORD_TONES = {
  C: [60, 64, 67],
  F: [53, 57, 60],
  G: [55, 59, 62],
  Am: [57, 60, 64],
}
const CHORDS = {
  [-3]: 'C', [-2]: 'F', [-1]: 'G',
  0: 'C', 1: 'G', 2: 'Am', 3: 'F', // Wake up / A spark of gold
  4: 'C', 5: 'G', 6: 'F', 7: 'C', // Hold the note / Every voice
  8: 'Am', 9: 'G', //                 instrumental break
  10: 'Am', 11: 'F', //               rap
  12: 'C', 13: 'G', //                freestyle
  14: 'F', 15: 'G', 16: 'Am', 17: 'F', // First light / Sing it out
  18: 'G', 19: 'C', //                Here comes the first light
  20: 'C', //                         outro
}
const FIRST_BAR = -3
const LAST_BAR = 20
const RAP_BARS = new Set([10, 11])
const ARP_BARS = new Set([8, 9])
const TAIL_SEC = 0.5
const TOTAL_SEC = barToSec(LAST_BAR + 1) + TAIL_SEC

const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12)

// --- DSP helpers -----------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = mulberry32(0xae7e5)
const noise = () => random() * 2 - 1

/** Linear attack, sustain, linear release; 0 outside [0, dur + release]. */
function envelope(t, dur, attack, release) {
  if (t < 0) return 0
  if (t < attack) return t / attack
  if (t < dur) return 1
  if (t < dur + release) return 1 - (t - dur) / release
  return 0
}

/**
 * Adds an additive-synthesis tone. `freqAt(t)` may vary (vibrato, glides), so
 * the phase is integrated sample by sample rather than computed from t.
 */
function addTone(buf, rate, { start, dur, freqAt, amp, harmonics, attack = 0.01, release = 0.05, decay = 0 }) {
  const first = Math.max(0, Math.floor(start * rate))
  const last = Math.min(buf.length, Math.ceil((start + dur + release) * rate))
  const nyquist = rate / 2
  let phase = 0
  for (let i = first; i < last; i++) {
    const t = i / rate - start
    const env = envelope(t, dur, attack, release) * (decay > 0 ? Math.exp(-t * decay) : 1)
    const f = freqAt(t)
    phase += (2 * Math.PI * f) / rate
    let sample = 0
    for (let h = 0; h < harmonics.length; h++) {
      if (f * (h + 1) >= nyquist) break
      sample += harmonics[h] * Math.sin(phase * (h + 1))
    }
    buf[i] += sample * env * amp
  }
}

function addKick(buf, rate, start, amp = 0.55) {
  const n = Math.floor(0.35 * rate)
  let phase = 0
  for (let j = 0; j < n; j++) {
    const i = Math.floor(start * rate) + j
    if (i >= buf.length) break
    const t = j / rate
    phase += (2 * Math.PI * (45 + 85 * Math.exp(-t * 30))) / rate
    buf[i] += Math.sin(phase) * Math.exp(-t * 9) * amp
  }
}

function addSnare(buf, rate, start, amp = 0.22) {
  const n = Math.floor(0.25 * rate)
  for (let j = 0; j < n; j++) {
    const i = Math.floor(start * rate) + j
    if (i >= buf.length) break
    const t = j / rate
    buf[i] += (noise() * Math.exp(-t * 20) + 0.6 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30)) * amp
  }
}

/** Crude high-passed noise: white noise minus a one-pole low-pass of itself. */
function addHat(buf, rate, start, amp = 0.07, decay = 70) {
  const n = Math.floor(0.08 * rate)
  let low = 0
  for (let j = 0; j < n; j++) {
    const i = Math.floor(start * rate) + j
    if (i >= buf.length) break
    const t = j / rate
    const white = noise()
    low += 0.35 * (white - low)
    buf[i] += (white - low) * Math.exp(-t * decay) * amp
  }
}

/** Count-in click: a short, bright sine blip. */
function addClick(buf, rate, start, accent) {
  addTone(buf, rate, {
    start, dur: 0.02, freqAt: () => (accent ? 1760 : 1320), amp: 0.18, harmonics: [1], attack: 0.001, release: 0.04, decay: 40,
  })
}

/** Gentle tanh limiter, then scale to a -1 dBFS peak. */
function master(buf) {
  let peak = 0
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Math.tanh(buf[i] * 1.2)
    peak = Math.max(peak, Math.abs(buf[i]))
  }
  const gain = peak > 0 ? 0.89 / peak : 1
  for (let i = 0; i < buf.length; i++) buf[i] *= gain
  return buf
}

/** Short fade at both ends so playback never starts or stops on a click. */
function fadeEdges(buf, rate, fadeInSec, fadeOutSec) {
  const inN = Math.floor(fadeInSec * rate)
  const outN = Math.floor(fadeOutSec * rate)
  for (let i = 0; i < inN && i < buf.length; i++) buf[i] *= i / inN
  for (let i = 0; i < outN && i < buf.length; i++) buf[buf.length - 1 - i] *= i / outN
}

// --- Instrumental ----------------------------------------------------------

function renderInstrumental() {
  const rate = INSTRUMENTAL_RATE
  const buf = new Float32Array(Math.ceil(TOTAL_SEC * rate))
  // Soft saw-ish pad: 1/n harmonics, rolled off further for warmth.
  const padHarmonics = [1, 0.4, 0.22, 0.12, 0.07, 0.04]
  const bassHarmonics = [1, 0.35, 0.12]
  const pluckHarmonics = [1, 0.3, 0.15, 0.08]

  for (let bar = FIRST_BAR; bar <= LAST_BAR; bar++) {
    const chordName = CHORDS[bar]
    const tones = CHORD_TONES[chordName]
    const barStart = barToSec(bar)
    const isOutro = bar === LAST_BAR
    const padLevel = RAP_BARS.has(bar) ? 0.35 : 1

    // Pad: each chord tone as a slightly detuned pair (a touch of chorus).
    for (const midi of tones) {
      for (const detune of [-0.0015, 0.0015]) {
        const hz = midiToHz(midi) * (1 + detune)
        addTone(buf, rate, {
          start: barStart, dur: isOutro ? BAR_SEC * 0.6 : BAR_SEC, freqAt: () => hz,
          amp: 0.028 * padLevel, harmonics: padHarmonics, attack: 0.35, release: isOutro ? 1.2 : 0.45,
        })
      }
    }

    // Bass: root in the E2..D#3 register.
    const pitchClass = tones[0] % 12
    const bassMidi = 28 + ((pitchClass - 4 + 12) % 12) + 12
    const bassHits = isOutro ? [[0, 1.6]] : [[0, 0.42], [1.5, 0.2], [2, 0.42], [3, 0.2]]
    if (bar >= -2) {
      for (const [quarter, dur] of bassHits) {
        const hz = midiToHz(quarter === 3 ? bassMidi + 7 : bassMidi)
        addTone(buf, rate, {
          start: barStart + quarter * QUARTER_SEC, dur, freqAt: () => hz,
          amp: 0.3, harmonics: bassHarmonics, attack: 0.006, release: 0.08, decay: 2.2,
        })
      }
    }

    // Drums. Bar -3 is a four-click count-in; the outro is one kick.
    if (bar === FIRST_BAR) {
      for (let q = 0; q < 4; q++) addClick(buf, rate, barStart + q * QUARTER_SEC, q === 0)
    } else if (isOutro) {
      addKick(buf, rate, barStart)
    } else {
      for (let q = 0; q < 4; q++) {
        const t = barStart + q * QUARTER_SEC
        if (q === 0 || q === 2) addKick(buf, rate, t)
        else addSnare(buf, rate, t)
        addHat(buf, rate, t, 0.06)
        addHat(buf, rate, t + QUARTER_SEC / 2, 0.045)
      }
      if (RAP_BARS.has(bar)) {
        // Busier groove under the rap: an extra kick and sixteenth hats.
        addKick(buf, rate, barStart + 2.5 * QUARTER_SEC, 0.4)
        for (let s = 0; s < 16; s += 2) addHat(buf, rate, barStart + (s + 1) * (QUARTER_SEC / 4), 0.03, 90)
      }
    }

    // Arpeggio over the instrumental break: sixteenths through the chord.
    if (ARP_BARS.has(bar)) {
      const pattern = [0, 1, 2, 1]
      for (let s = 0; s < 16; s++) {
        const midi = tones[pattern[s % 4]] + 12 + (s >= 8 && pattern[s % 4] === 0 ? 12 : 0)
        const hz = midiToHz(midi)
        addTone(buf, rate, {
          start: barStart + s * (QUARTER_SEC / 4), dur: 0.08, freqAt: () => hz,
          amp: 0.09, harmonics: pluckHarmonics, attack: 0.004, release: 0.12, decay: 6,
        })
      }
    }
  }

  master(buf)
  fadeEdges(buf, rate, 0.01, 0.4)
  return buf
}

// --- Guide vocal -----------------------------------------------------------

function renderVocals() {
  const rate = VOCALS_RATE
  const buf = new Float32Array(Math.ceil(TOTAL_SEC * rate))

  for (const note of chart.notes) {
    const start = beatToSec(note.startBeat)
    const dur = (note.length * msPerBeat) / 1000
    const hz = midiToHz(note.pitch)

    if (note.marker === 'R' || note.marker === 'G') {
      // Rap: a spoken-style syllable -- falling pitch, fast decay, a breath of
      // consonant noise at the onset. Golden rap gets a slightly longer ring.
      addTone(buf, rate, {
        start, dur: Math.min(dur, 0.18), freqAt: (t) => hz * Math.pow(2, (3 - 30 * t) / 12),
        amp: 0.32, harmonics: [1, 0.5, 0.35, 0.2], attack: 0.008, release: note.marker === 'G' ? 0.25 : 0.06, decay: 7,
      })
      const n = Math.floor(0.025 * rate)
      for (let j = 0; j < n; j++) {
        const i = Math.floor(start * rate) + j
        if (i < buf.length) buf[i] += noise() * 0.12 * (1 - j / n)
      }
      continue
    }

    if (note.marker === 'F') {
      // Freestyle "ooh": a soft, nearly pure tone that slides up into the note.
      addTone(buf, rate, {
        start, dur, freqAt: (t) => hz * Math.pow(2, (-2 * Math.exp(-t * 6)) / 12),
        amp: 0.22, harmonics: [1, 0.08], attack: 0.15, release: 0.3,
      })
      continue
    }

    // Sung note: a few soft harmonics with delayed vibrato. Golden notes get an
    // octave shimmer on top.
    const vibrato = (t) => 1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, Math.max(0, (t - 0.2) / 0.2))
    addTone(buf, rate, {
      start, dur, freqAt: (t) => hz * vibrato(t),
      amp: note.marker === '*' ? 0.3 : 0.32,
      harmonics: note.marker === '*' ? [1, 0.35, 0.18, 0.3, 0.05] : [1, 0.35, 0.15, 0.06],
      attack: 0.03, release: 0.08,
    })
  }

  master(buf)
  fadeEdges(buf, rate, 0.01, 0.1)
  return buf
}

// --- WAV writer ------------------------------------------------------------

function encodeWav(samples, rate) {
  const dataBytes = samples.length * 2
  const out = Buffer.alloc(44 + dataBytes)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(36 + dataBytes, 4)
  out.write('WAVE', 8, 'ascii')
  out.write('fmt ', 12, 'ascii')
  out.writeUInt32LE(16, 16) // fmt chunk size
  out.writeUInt16LE(1, 20) // PCM
  out.writeUInt16LE(1, 22) // mono
  out.writeUInt32LE(rate, 24)
  out.writeUInt32LE(rate * 2, 28) // byte rate
  out.writeUInt16LE(2, 32) // block align
  out.writeUInt16LE(16, 34) // bits per sample
  out.write('data', 36, 'ascii')
  out.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    out.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2)
  }
  return out
}

// --- PNG cover -------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** Is (x, y) inside a five-pointed star centred on (cx, cy)? */
function insideStar(x, y, cx, cy, outer, inner) {
  const dx = x - cx
  const dy = y - cy
  const r = Math.hypot(dx, dy)
  if (r > outer) return false
  // Angle measured from straight up, folded into one of ten 36-degree wedges.
  let angle = Math.atan2(dx, -dy)
  if (angle < 0) angle += 2 * Math.PI
  const wedge = Math.PI / 5
  let local = angle % (2 * wedge)
  if (local > wedge) local = 2 * wedge - local
  // Edge from the tip (angle 0, radius outer) to the notch (angle wedge, radius inner).
  const tipX = 0, tipY = outer
  const notchX = inner * Math.sin(wedge), notchY = inner * Math.cos(wedge)
  const px = r * Math.sin(local), py = r * Math.cos(local)
  const cross = (notchX - tipX) * (py - tipY) - (notchY - tipY) * (px - tipX)
  return cross <= 0
}

function renderCover(size) {
  const pixels = Buffer.alloc(size * size * 3)
  const cx = size / 2
  const cy = size * 0.46
  const outer = size * 0.3
  const inner = outer * 0.42
  const SUPER = 3 // 3x3 supersampling for the star edge
  // Deterministic "stars" in the background.
  const sparkleRandom = mulberry32(42)
  const sparkles = Array.from({ length: 40 }, () => ({
    x: sparkleRandom() * size, y: sparkleRandom() * size * 0.9, r: 0.6 + sparkleRandom() * 1.6, a: 0.35 + sparkleRandom() * 0.6,
  }))

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Night-to-dawn vertical gradient: deep indigo -> violet -> warm amber.
      const v = y / (size - 1)
      const top = [16, 14, 52], mid = [92, 42, 128], bottom = [246, 158, 82]
      const [a, b, t] = v < 0.6 ? [top, mid, v / 0.6] : [mid, bottom, (v - 0.6) / 0.4]
      let rgb = a.map((c, i) => c + (b[i] - c) * t)

      // Soft golden glow around the star.
      const glow = Math.exp(-((Math.hypot(x - cx, y - cy) / (size * 0.32)) ** 2))
      rgb = rgb.map((c, i) => c + ([255, 214, 120][i] - c) * glow * 0.55)

      for (const s of sparkles) {
        const d = Math.hypot(x - s.x, y - s.y)
        if (d < s.r + 1) {
          const k = Math.max(0, Math.min(1, s.r + 0.5 - d)) * s.a
          rgb = rgb.map((c) => c + (255 - c) * k)
        }
      }

      let cover = 0
      for (let sy = 0; sy < SUPER; sy++) {
        for (let sx = 0; sx < SUPER; sx++) {
          if (insideStar(x + (sx + 0.5) / SUPER, y + (sy + 0.5) / SUPER, cx, cy, outer, inner)) cover++
        }
      }
      if (cover > 0) {
        const k = cover / (SUPER * SUPER)
        // Star body: bright gold, lighter towards its centre.
        const centre = 1 - Math.min(1, Math.hypot(x - cx, y - cy) / outer)
        const star = [255, 206 + 40 * centre, 92 + 120 * centre]
        rgb = rgb.map((c, i) => c + (star[i] - c) * k)
      }

      const o = (y * size + x) * 3
      pixels[o] = Math.round(Math.max(0, Math.min(255, rgb[0])))
      pixels[o + 1] = Math.round(Math.max(0, Math.min(255, rgb[1])))
      pixels[o + 2] = Math.round(Math.max(0, Math.min(255, rgb[2])))
    }
  }

  // Filter every scanline with whichever of None/Sub/Up/Average/Paeth gives the
  // smallest absolute sum -- the usual heuristic, and plenty for a gradient.
  const stride = size * 3
  const raw = Buffer.alloc((stride + 1) * size)
  const zero = Buffer.alloc(stride)
  for (let y = 0; y < size; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : zero
    let best = null
    for (let type = 0; type <= 4; type++) {
      const filtered = Buffer.alloc(stride)
      let sum = 0
      for (let i = 0; i < stride; i++) {
        const left = i >= 3 ? row[i - 3] : 0
        const up = prev[i]
        const upLeft = i >= 3 ? prev[i - 3] : 0
        let predictor = 0
        if (type === 1) predictor = left
        else if (type === 2) predictor = up
        else if (type === 3) predictor = (left + up) >> 1
        else if (type === 4) {
          const p = left + up - upLeft
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft)
          predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
        }
        const value = (row[i] - predictor) & 0xff
        filtered[i] = value
        sum += value < 128 ? value : 256 - value
      }
      if (!best || sum < best.sum) best = { type, filtered, sum }
    }
    raw[y * (stride + 1)] = best.type
    best.filtered.copy(raw, y * (stride + 1) + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// --- Main ------------------------------------------------------------------

const outputs = [
  ['instrumental.wav', encodeWav(renderInstrumental(), INSTRUMENTAL_RATE)],
  ['vocals.wav', encodeWav(renderVocals(), VOCALS_RATE)],
  ['cover.png', renderCover(400)],
]
let total = 0
for (const [name, bytes] of outputs) {
  writeFileSync(path.join(SONG_DIR, name), bytes)
  total += bytes.length
  console.log(`${name.padEnd(17)} ${(bytes.length / 1024).toFixed(1).padStart(8)} KiB`)
}
console.log(`total             ${(total / 1024).toFixed(1).padStart(8)} KiB  (${TOTAL_SEC.toFixed(2)} s, ${chart.notes.length} notes)`)
