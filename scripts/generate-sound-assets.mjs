// Synthesizes every audio file AetherStar ships: the one-shot sound effects in
// assets/sfx/ and the looping menu track in menu_music/. Nothing here is
// sampled, recorded or downloaded -- every sound is built from oscillators,
// seeded noise, envelopes and filters below, so the output is original work
// covered by the repository's MIT licence.
//
//   node scripts/generate-sound-assets.mjs            (re)write every file
//   node scripts/generate-sound-assets.mjs --check    verify the committed files
//                                                     are byte-identical to what
//                                                     this script produces
//   node scripts/generate-sound-assets.mjs ui_click countdown_go
//                                                     only the named files
//
// Pure Node (no dependencies, no ffmpeg). The output is deterministic: all
// randomness comes from a seeded PRNG, so re-running produces the same bytes.
//
// Format: 16-bit PCM WAV. Sound effects at 44.1 kHz, mono except the stereo
// song-start trio (song_selected, countdown_beep, countdown_go); the menu loop
// mono at 22.05 kHz to keep the repository small (Chromium/Electron decode all).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SFX_DIR = path.join(ROOT, 'assets/sfx')
const MUSIC_DIR = path.join(ROOT, 'menu_music')

const SFX_RATE = 44100
const MUSIC_RATE = 22050
const TAU = Math.PI * 2

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Seeded PRNG (mulberry32), uniform in [0, 1). */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dbToGain = (db) => 10 ** (db / 20)
const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-9))

const NOTE_INDEX = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 }
/** 'A4' -> 440. Sharps only. */
function hz(name) {
  const m = /^([A-G]#?)(-?\d)$/.exec(name)
  if (!m) throw new Error(`bad note ${name}`)
  const midi = NOTE_INDEX[m[1]] + (Number(m[2]) + 1) * 12
  return 440 * 2 ** ((midi - 69) / 12)
}
const cents = (c) => 2 ** (c / 1200)

/** PolyBLEP residual for band-limited saw/square. */
function polyBlep(t, dt) {
  if (t < dt) {
    t /= dt
    return t + t - t * t - 1
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt
    return t * t + t + t + 1
  }
  return 0
}

/** A phase-accumulating oscillator; call it once per sample with the current frequency. */
function osc(rate, wave = 'sine', phase = 0) {
  let p = phase
  return (f) => {
    const dt = f / rate
    let v
    switch (wave) {
      case 'saw':
        v = 2 * p - 1 - polyBlep(p, dt)
        break
      case 'square':
        v = (p < 0.5 ? 1 : -1) + polyBlep(p, dt) - polyBlep((p + 0.5) % 1, dt)
        break
      case 'tri':
        v = 1 - 4 * Math.abs(p - 0.5)
        break
      default:
        v = Math.sin(TAU * p)
    }
    p += dt
    p -= Math.floor(p)
    return v
  }
}

/** Two-operator FM (sine modulating sine). `index` is in radians. */
function fm(rate, phase = 0) {
  let pc = phase
  let pm = 0
  return (f, ratio, index) => {
    const v = Math.sin(TAU * pc + index * Math.sin(TAU * pm))
    pc += f / rate
    pm += (f * ratio) / rate
    pc -= Math.floor(pc)
    pm -= Math.floor(pm)
    return v
  }
}

/** Topology-preserving state-variable filter (stable under fast cutoff modulation). */
function svf(rate) {
  let ic1 = 0
  let ic2 = 0
  const out = { lp: 0, bp: 0, hp: 0 }
  return (x, fc, q = 0.707) => {
    const g = Math.tan((Math.PI * Math.min(Math.max(fc, 10), rate * 0.45)) / rate)
    const k = 1 / q
    const a1 = 1 / (1 + g * (g + k))
    const a2 = g * a1
    const a3 = g * a2
    const v3 = x - ic2
    const v1 = a1 * ic1 + a2 * v3
    const v2 = ic2 + a2 * ic1 + a3 * v3
    ic1 = 2 * v1 - ic1
    ic2 = 2 * v2 - ic2
    out.lp = v2
    out.bp = v1
    out.hp = x - k * v1 - v2
    return out
  }
}

/** White noise in [-1, 1) and Paul Kellet's economy pink noise, both seeded. */
function white(seed) {
  const r = rng(seed)
  return () => r() * 2 - 1
}
function pink(seed) {
  const w = white(seed)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  return () => {
    const x = w()
    b0 = 0.99765 * b0 + x * 0.099046
    b1 = 0.963 * b1 + x * 0.2965164
    b2 = 0.57 * b2 + x * 1.0526913
    return (b0 + b1 + b2 + x * 0.1848) * 0.2
  }
}

/** Percussive envelope: smooth (sin^2) attack of `a` seconds, then exponential decay with time constant `tau`. */
function perc(t, a, tau) {
  if (t < 0) return 0
  if (t < a) return Math.sin((0.5 * Math.PI * t) / a) ** 2
  return Math.exp(-(t - a) / tau)
}

/** Gate envelope: sin^2 attack, flat hold until `len`, then sin^2 release over `r`. */
function gate(t, a, len, r) {
  if (t < 0) return 0
  let v = t < a ? Math.sin((0.5 * Math.PI * t) / a) ** 2 : 1
  if (t > len) v *= t - len >= r ? 0 : Math.cos((0.5 * Math.PI * (t - len)) / r) ** 2
  return v
}

/** Smoothstep from 0 at `t0` to 1 at `t1`. */
function ramp(t, t0, t1) {
  const x = Math.min(Math.max((t - t0) / (t1 - t0), 0), 1)
  return x * x * (3 - 2 * x)
}

function buffer(rate, seconds) {
  return new Float32Array(Math.max(1, Math.round(seconds * rate)))
}

/** Mixes `fn(t)` (called once per sample, in order) into `buf` from `start` for `dur` seconds. */
function add(buf, rate, start, dur, fn) {
  const s0 = Math.round(start * rate)
  const n = Math.round(dur * rate)
  for (let i = 0; i < n; i++) {
    const v = fn(i / rate)
    const j = s0 + i
    if (j >= 0 && j < buf.length) buf[j] += v
  }
}

/** Mono Freeverb (Jezar's public-domain design). Returns a new buffer `tail` seconds longer than `x`. */
function reverb(x, rate, { room = 0.7, damp = 0.4, wet = 0.25, dry = 1, tail = 0 } = {}) {
  const scale = rate / 44100
  const line = (len) => ({ buf: new Float32Array(Math.max(1, Math.round(len * scale))), i: 0, store: 0 })
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(line)
  const allpasses = [556, 441, 341, 225].map(line)
  const feedback = room * 0.28 + 0.7
  const d1 = damp * 0.4
  const d2 = 1 - d1
  const out = new Float32Array(x.length + Math.round(tail * rate))
  for (let n = 0; n < out.length; n++) {
    const input = n < x.length ? x[n] : 0
    const scaled = input * 0.015
    let acc = 0
    for (const c of combs) {
      const y = c.buf[c.i]
      c.store = y * d2 + c.store * d1
      c.buf[c.i] = scaled + c.store * feedback
      if (++c.i >= c.buf.length) c.i = 0
      acc += y
    }
    for (const a of allpasses) {
      const b = a.buf[a.i]
      const y = b - acc
      a.buf[a.i] = acc + b * 0.5
      if (++a.i >= a.buf.length) a.i = 0
      acc = y
    }
    out[n] = input * dry + acc * wet * 3
  }
  return out
}

/** Feedback echo with a gentle low-pass in the loop. Returns a new buffer `tail` seconds longer. */
function echo(x, rate, { time, feedback = 0.35, wet = 0.3, tone = 3500, tail = 0 }) {
  const d = Math.round(time * rate)
  const out = new Float32Array(x.length + Math.round(tail * rate))
  const line = new Float32Array(d)
  const f = svf(rate)
  let i = 0
  for (let n = 0; n < out.length; n++) {
    const input = n < x.length ? x[n] : 0
    const delayed = line[i]
    line[i] = input + f(delayed, tone).lp * feedback
    if (++i >= d) i = 0
    out[n] = input + delayed * wet
  }
  return out
}

/** Peak and the loudest 25 ms window (RMS), plus when that loudness is first reached. */
function measure(x, rate) {
  let peak = 0
  for (const v of x) peak = Math.max(peak, Math.abs(v))
  const w = Math.round(rate * 0.025)
  const windows = []
  for (let i = 0; i + w <= x.length; i += w) {
    let s = 0
    for (let j = i; j < i + w; j++) s += x[j] * x[j]
    windows.push(Math.sqrt(s / w))
  }
  const maxRms = Math.max(...windows, 0)
  let firstNonSilent = x.findIndex((v) => Math.abs(v) > 1 / 32768)
  if (firstNonSilent < 0) firstNonSilent = x.length
  return {
    peak,
    maxRms,
    windows,
    firstSoundMs: (firstNonSilent / rate) * 1000,
    // first 25 ms window at >= 97% of the loudest one (window start time)
    fullLevelMs: windows.findIndex((r) => r >= 0.97 * maxRms) * 25,
  }
}

/**
 * Final SFX mastering: DC/rumble removal, level, and click-free edges.
 * `rms` sets the loudest-25ms-window level, `peak` caps the true peak; when
 * both are given the quieter result wins.
 */
function master(x, rate, { rms, peak = -1, fadeIn = 0, fadeOut = 0.008 }) {
  // one-pole high-pass at ~20 Hz
  const a = Math.exp((-TAU * 20) / rate)
  let px = 0
  let py = 0
  for (let i = 0; i < x.length; i++) {
    const y = a * (py + x[i] - px)
    px = x[i]
    py = y
    x[i] = y
  }
  const nIn = Math.round(fadeIn * rate)
  for (let i = 0; i < nIn; i++) x[i] *= Math.sin((0.5 * Math.PI * i) / nIn) ** 2
  const nOut = Math.min(Math.round(fadeOut * rate), x.length)
  for (let i = 0; i < nOut; i++) x[x.length - 1 - i] *= Math.sin((0.5 * Math.PI * i) / nOut) ** 2
  const m = measure(x, rate)
  let g = dbToGain(peak) / m.peak
  if (rms !== undefined) g = Math.min(g, dbToGain(rms) / m.maxRms)
  for (let i = 0; i < x.length; i++) x[i] *= g
  return x
}

/** 16-bit PCM WAV: mono from one Float32Array, stereo (interleaved) from an [L, R] pair. */
function encodeWav(x, rate) {
  const chans = Array.isArray(x) ? x : [x]
  const nch = chans.length
  const frames = chans[0].length
  const bytes = frames * nch * 2
  const b = Buffer.alloc(44 + bytes)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + bytes, 4)
  b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii')
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20) // PCM
  b.writeUInt16LE(nch, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * 2 * nch, 28)
  b.writeUInt16LE(2 * nch, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(bytes, 40)
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]))
      b.writeInt16LE(Math.round(v * 32767), 44 + (i * nch + c) * 2)
    }
  }
  return b
}

// ---------------------------------------------------------------------------
// Stereo primitives (used by the song-start trio: song_selected,
// countdown_beep, countdown_go). A stereo signal is an [L, R] pair of
// Float32Arrays of equal length.
// ---------------------------------------------------------------------------

function stereoBuffer(rate, seconds) {
  return [buffer(rate, seconds), buffer(rate, seconds)]
}

/** Equal-power pan gains for `pan` in [-1, 1], normalised so the centre is unity on both sides. */
function panGains(pan) {
  const a = ((pan + 1) * Math.PI) / 4
  return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]
}

/** Mixes a mono `fn(t)` into the stereo pair `st` at `pan`. */
function addPan(st, rate, start, dur, pan, fn) {
  const [gl, gr] = panGains(pan)
  const s0 = Math.round(start * rate)
  const n = Math.round(dur * rate)
  for (let i = 0; i < n; i++) {
    const v = fn(i / rate)
    const j = s0 + i
    if (j >= 0 && j < st[0].length) {
      st[0][j] += v * gl
      st[1][j] += v * gr
    }
  }
}

/** Mixes a stereo `fn(t, out)` (which writes out[0] and out[1]) into `st`. */
function addStereo(st, rate, start, dur, fn) {
  const o = [0, 0]
  const s0 = Math.round(start * rate)
  const n = Math.round(dur * rate)
  for (let i = 0; i < n; i++) {
    o[0] = 0
    o[1] = 0
    fn(i / rate, o)
    const j = s0 + i
    if (j >= 0 && j < st[0].length) {
      st[0][j] += o[0]
      st[1][j] += o[1]
    }
  }
}

/** Mid/side builder: L = mid + side, R = mid - side, each a mono `fn(t)`. */
function addMidSide(st, rate, start, dur, midFn, sideFn) {
  addStereo(st, rate, start, dur, (t, o) => {
    const m = midFn(t)
    const s = sideFn(t)
    o[0] = m + s
    o[1] = m - s
  })
}

/**
 * Stereo Freeverb: two banks of the same design, the right one with Jezar's
 * 23-sample spread so the tails decorrelate. Returns a new pair `tail` seconds
 * longer than the input. `width` 1 = fully separate tails, 0 = mono tail.
 */
function reverbStereo([xl, xr], rate, { room = 0.7, damp = 0.4, wet = 0.25, dry = 1, width = 1, predelay = 0, tail = 0 } = {}) {
  const scale = rate / 44100
  const bank = (spread) => {
    const line = (len) => ({ buf: new Float32Array(Math.max(1, Math.round((len + spread) * scale))), i: 0, store: 0 })
    return {
      combs: [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(line),
      allpasses: [556, 441, 341, 225].map(line),
    }
  }
  const feedback = room * 0.28 + 0.7
  const d1 = damp * 0.4
  const d2 = 1 - d1
  const run = (b, input) => {
    let acc = 0
    for (const c of b.combs) {
      const y = c.buf[c.i]
      c.store = y * d2 + c.store * d1
      c.buf[c.i] = input + c.store * feedback
      if (++c.i >= c.buf.length) c.i = 0
      acc += y
    }
    for (const a of b.allpasses) {
      const v = a.buf[a.i]
      const y = v - acc
      a.buf[a.i] = acc + v * 0.5
      if (++a.i >= a.buf.length) a.i = 0
      acc = y
    }
    return acc
  }
  const bl = bank(0)
  const br = bank(23)
  const wet1 = wet * (width / 2 + 0.5) * 3
  const wet2 = wet * ((1 - width) / 2) * 3
  const pd = Math.round(predelay * rate)
  const pre = new Float32Array(Math.max(1, pd))
  let pi = 0
  const n = xl.length + Math.round(tail * rate)
  const outL = new Float32Array(n)
  const outR = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const il = i < xl.length ? xl[i] : 0
    const ir = i < xr.length ? xr[i] : 0
    let input = (il + ir) * 0.015
    if (pd > 0) {
      const d = pre[pi]
      pre[pi] = input
      if (++pi >= pd) pi = 0
      input = d
    }
    const yl = run(bl, input)
    const yr = run(br, input)
    outL[i] = il * dry + yl * wet1 + yr * wet2
    outR[i] = ir * dry + yr * wet1 + yl * wet2
  }
  return [outL, outR]
}

/** Ping-pong echo: the (mono-summed) input enters on the left, each repeat crosses sides. Same length as the input. */
function pingPong([xl, xr], rate, { time, feedback = 0.4, wet = 0.3, tone = 4000 }) {
  const d = Math.round(time * rate)
  const lineL = new Float32Array(d)
  const lineR = new Float32Array(d)
  const fl = svf(rate)
  const fr = svf(rate)
  let i = 0
  const outL = Float32Array.from(xl)
  const outR = Float32Array.from(xr)
  for (let n = 0; n < xl.length; n++) {
    const dl = lineL[i]
    const dr = lineR[i]
    lineL[i] = 0.5 * (xl[n] + xr[n]) + fl(dr, tone).lp * feedback
    lineR[i] = fr(dl, tone).lp * feedback
    if (++i >= d) i = 0
    outL[n] += dl * wet
    outR[n] += dr * wet
  }
  return [outL, outR]
}

const monoOf = ([l, r]) => Float32Array.from(l, (v, i) => 0.5 * (v + r[i]))

/** Stereo-linked look-ahead peak limiter (instant attack over `look` s, exponential release). */
function limit([l, r], rate, ceilingDb, { look = 0.003, release = 0.08 } = {}) {
  const ceil = dbToGain(ceilingDb)
  const n = l.length
  const need = new Float32Array(n)
  for (let i = 0; i < n; i++) need[i] = Math.min(1, ceil / Math.max(Math.abs(l[i]), Math.abs(r[i]), 1e-9))
  const la = Math.max(1, Math.round(look * rate))
  const rel = Math.exp(-1 / (release * rate))
  let g = 1
  // running minimum over the look-ahead window (small window: direct scan is fine)
  for (let i = 0; i < n; i++) {
    let target = 1
    for (let j = i; j < Math.min(n, i + la); j++) target = Math.min(target, need[j])
    g = target < g ? target : target + (g - target) * rel
    l[i] *= g
    r[i] *= g
  }
}

/**
 * Keeps the 25 ms window (mono mix, on the same 25 ms grid the tests use) that
 * starts at `peakSec` the loudest one in the file: everything before it is
 * held `introDb` under it by a flat gain, everything from `afterSec` on is
 * held `afterDb` under it by a slow, smoothed gain ride that only ever turns
 * down. song_selected relies on this (SONG_SELECTED_PEAK_OFFSET_MS).
 */
function keepPeakAt(st, rate, peakSec, { introDb = -2, afterSec, afterDb = -1 }) {
  const mono = monoOf(st)
  const w = Math.round(rate * 0.025)
  const winRms = (i) => {
    let s = 0
    for (let j = i; j < Math.min(i + w, mono.length); j++) s += mono[j] * mono[j]
    return Math.sqrt(s / w)
  }
  const peakWin = Math.round(peakSec / 0.025) * w
  const ref = winRms(peakWin)

  // before the peak: one flat gain, released over the 15 ms before the peak window's predecessor ends
  let introMax = 0
  for (let i = 0; i + w <= peakWin - w; i += w) introMax = Math.max(introMax, winRms(i))
  const gIntro = Math.min(1, (ref * dbToGain(introDb)) / Math.max(introMax, 1e-9))
  const relEnd = peakWin - w
  const relStart = relEnd - Math.round(0.015 * rate)
  for (let i = 0; i < relEnd; i++) {
    const g = i < relStart ? gIntro : gIntro + (1 - gIntro) * ((i - relStart) / (relEnd - relStart))
    st[0][i] *= g
    st[1][i] *= g
  }

  // after: smoothed ride towards ref * afterDb
  const from = Math.round(afterSec * rate)
  const target = ref * dbToGain(afterDb)
  const hop = Math.round(rate * 0.005)
  const gains = []
  const half = Math.round(w / 2)
  for (let c = 0; c < mono.length; c += hop) {
    let s = 0
    let n = 0
    for (let j = Math.max(0, c - half); j < Math.min(mono.length, c + half); j++, n++) s += mono[j] * mono[j]
    gains.push(Math.min(1, target / Math.max(Math.sqrt(s / Math.max(n, 1)), 1e-9)))
  }
  // spread each reduction to its neighbours (min over +-40 ms), then smooth (+-30 ms)
  const k1 = 8
  const minned = gains.map((_, i) => {
    let m = 1
    for (let j = Math.max(0, i - k1); j <= Math.min(gains.length - 1, i + k1); j++) m = Math.min(m, gains[j])
    return m
  })
  const k2 = 6
  const smooth = minned.map((_, i) => {
    let s = 0
    let n = 0
    for (let j = Math.max(0, i - k2); j <= Math.min(minned.length - 1, i + k2); j++, n++) s += minned[j]
    return s / n
  })
  for (let i = from; i < mono.length; i++) {
    const p = i / hop
    const i0 = Math.min(Math.floor(p), smooth.length - 1)
    const i1 = Math.min(i0 + 1, smooth.length - 1)
    const g = smooth[i0] + (smooth[i1] - smooth[i0]) * (p - i0)
    st[0][i] *= g
    st[1][i] *= g
  }
}

/**
 * Stereo SFX mastering: rumble removal, click-free edges, level. `rms` sets the
 * loudest 25 ms window of the mono mix; then a look-ahead limiter holds `peak`.
 * With `passes` > 1 the level is re-measured after limiting and topped up, so
 * the loudest window ends up at `rms` even when the limiter had to work.
 * `atSec` levels the 25 ms window starting there instead of the loudest one.
 */
function masterStereo(st, rate, { rms, peak = -1, fadeIn = 0, fadeOut = 0.008, passes = 1, atSec }) {
  const a = Math.exp((-TAU * 20) / rate)
  for (const x of st) {
    let px = 0
    let py = 0
    for (let i = 0; i < x.length; i++) {
      const y = a * (py + x[i] - px)
      px = x[i]
      py = y
      x[i] = y
    }
    const nIn = Math.round(fadeIn * rate)
    for (let i = 0; i < nIn; i++) x[i] *= Math.sin((0.5 * Math.PI * i) / nIn) ** 2
    const nOut = Math.min(Math.round(fadeOut * rate), x.length)
    for (let i = 0; i < nOut; i++) x[x.length - 1 - i] *= Math.sin((0.5 * Math.PI * i) / nOut) ** 2
  }
  for (let pass = 0; pass < passes; pass++) {
    const m = measure(monoOf(st), rate)
    const level = atSec === undefined ? m.maxRms : m.windows[Math.round(atSec / 0.025)]
    const g = dbToGain(rms) / level
    for (const x of st) for (let i = 0; i < x.length; i++) x[i] *= g
    limit(st, rate, peak)
  }
  return st
}

// ---------------------------------------------------------------------------
// Instrument voices (return a per-sample function of time)
// ---------------------------------------------------------------------------

/** FM bell / e-piano tone: brightness decays faster than the amplitude. */
function bell(rate, f, { ratio = 2, index = 1.4, indexTau = 0.12, a = 0.002, tau = 0.25, phase = 0 } = {}) {
  const o = fm(rate, phase)
  return (t) => o(f, ratio, index * Math.exp(-t / indexTau)) * perc(t, a, tau)
}

/** Filtered noise burst. */
function noiseBurst(rate, seed, { mode = 'bp', fc = 3000, q = 0.8, a = 0.0005, tau = 0.01, colour = 'white' }) {
  const n = colour === 'pink' ? pink(seed) : white(seed)
  const f = svf(rate)
  return (t) => f(n(), typeof fc === 'function' ? fc(t) : fc, q)[mode] * perc(t, a, tau)
}

/** Detuned two-saw pad voice through a low-pass whose cutoff is `cutoff(t)`. */
function padVoice(rate, f, cutoff, seed, { detune = 7, q = 0.8 } = {}) {
  const r = rng(seed)
  const o1 = osc(rate, 'saw', r())
  const o2 = osc(rate, 'saw', r())
  const fl = svf(rate)
  const up = cents(detune)
  const down = cents(-detune)
  return (t) => fl((o1(f * up) + o2(f * down)) * 0.5, cutoff(t), q).lp
}

// ---------------------------------------------------------------------------
// Sound effects
// ---------------------------------------------------------------------------

function uiHover(rate) {
  const x = buffer(rate, 0.06)
  const o = osc(rate)
  add(x, rate, 0, 0.06, (t) => o(1900 - 220 * (1 - Math.exp(-t / 0.01))) * perc(t, 0.0015, 0.011))
  add(x, rate, 0, 0.012, (t) => 0.25 * noiseBurst(rate, 11, { fc: 6000, q: 1.2, tau: 0.002 })(t))
  return master(x, rate, { rms: -27, peak: -19 })
}

function uiClick(rate) {
  const x = buffer(rate, 0.09)
  const top = osc(rate)
  const body = osc(rate)
  const n = noiseBurst(rate, 12, { mode: 'hp', fc: 2500, tau: 0.0025 })
  add(x, rate, 0, 0.09, (t) => top(700 + 450 * Math.exp(-t / 0.006)) * perc(t, 0.001, 0.016))
  add(x, rate, 0, 0.09, (t) => 0.6 * body(260) * perc(t, 0.001, 0.012))
  add(x, rate, 0, 0.02, (t) => 0.35 * n(t))
  return master(x, rate, { rms: -25, peak: -16 })
}

function uiConfirm(rate) {
  const dry = buffer(rate, 0.42)
  // A5 -> E6: a rising fifth, soft e-piano bell with an octave glint on each note
  for (const [start, note, tau] of [
    [0, 'A5', 0.16],
    [0.075, 'E6', 0.24],
  ]) {
    const b = bell(rate, hz(note), { ratio: 2, index: 1.2, indexTau: 0.08, tau })
    const glint = osc(rate)
    add(dry, rate, start, 0.42, (t) => b(t) + 0.18 * glint(hz(note) * 2) * perc(t, 0.001, 0.05))
  }
  const x = reverb(dry, rate, { room: 0.55, damp: 0.5, wet: 0.22 })
  return master(x, rate, { rms: -13, peak: -3, fadeOut: 0.06 })
}

function uiBack(rate) {
  const x = buffer(rate, 0.2)
  // soft downward whoosh: pink noise through a band-pass sweeping down
  const n = pink(21)
  const f = svf(rate)
  add(x, rate, 0, 0.2, (t) => {
    const fc = 2800 * Math.exp(-t / 0.07) + 450
    return f(n(), fc, 1.3).bp * Math.sin(Math.PI * Math.min(t / 0.19, 1)) ** 1.5
  })
  const o = osc(rate)
  add(x, rate, 0, 0.2, (t) => 0.12 * o(880 + 440 * Math.exp(-t / 0.04)) * perc(t, 0.004, 0.05))
  return master(x, rate, { rms: -24, peak: -14, fadeOut: 0.02 })
}

function uiError(rate) {
  const x = buffer(rate, 0.28)
  // two low, slightly dissonant buzzes ("uh-uh"), the second a touch lower
  for (const [start, f0] of [
    [0, 155],
    [0.135, 146],
  ]) {
    const sq = osc(rate, 'square')
    const sw = osc(rate, 'saw')
    const fl = svf(rate)
    add(x, rate, start, 0.13, (t) => {
      const v = 0.6 * sq(f0) + 0.5 * sw(f0 * 1.06)
      return fl(v, 1500 - 600 * ramp(t, 0, 0.11), 0.9).lp * gate(t, 0.004, 0.085, 0.03)
    })
  }
  return master(x, rate, { rms: -14, peak: -4, fadeOut: 0.01 })
}

// --- the song-start trio (stereo) ------------------------------------------
//
// song_selected, countdown_beep and countdown_go are one piece of music: the
// sting is in F major, the countdown ticks sit on its dominant (C), and "go"
// is a bright C that the sting's final C7 chord points at.

/** Supersaw: `voices` detuned band-limited saws spread across the stereo field, through a low-pass (and optional high-pass at `hp` Hz) per side. */
function supersaw(rate, f, seed, { voices = 7, detune = 22, width = 0.85, hp = 0 } = {}) {
  const r = rng(seed)
  const vs = []
  for (let k = 0; k < voices; k++) {
    const x = voices === 1 ? 0 : (k / (voices - 1)) * 2 - 1
    const [gl, gr] = panGains((k % 2 ? -1 : 1) * Math.abs(x) * width)
    vs.push({ o: osc(rate, 'saw', r()), ratio: cents(detune * x + (r() - 0.5) * 3), gl, gr })
  }
  const norm = 1 / Math.sqrt(voices)
  const fl = svf(rate)
  const fr = svf(rate)
  const hl = svf(rate)
  const hr = svf(rate)
  return (cutoff, q, out) => {
    let l = 0
    let rr = 0
    for (const v of vs) {
      const s = v.o(f * v.ratio)
      l += s * v.gl
      rr += s * v.gr
    }
    l = fl(l * norm, cutoff, q).lp
    rr = fr(rr * norm, cutoff, q).lp
    out[0] += hp > 0 ? hl(l, hp, 0.6).hp : l
    out[1] += hp > 0 ? hr(rr, hp, 0.6).hp : rr
  }
}

/** Kick drum: a sine sweeping from `f0` down to `f1`, softly saturated, with a short click. */
function kickVoice(rate, seed, { f0 = 150, f1 = 45, pitchTau = 0.035, tau = 0.25, drive = 1.6, click = 0.25 } = {}) {
  const o = osc(rate)
  const n = noiseBurst(rate, seed, { mode: 'bp', fc: 3500, q: 0.7, tau: 0.004 })
  return (t) => Math.tanh(drive * o(f1 + (f0 - f1) * Math.exp(-t / pitchTau)) * perc(t, 0.0015, tau)) / Math.tanh(drive) + click * n(t)
}

/** Snare/clap: band-passed noise with a little tonal body. */
function snareVoice(rate, seed, { fc = 2600, tau = 0.07, body = 0.3 } = {}) {
  const n = white(seed)
  const f1 = svf(rate)
  const f2 = svf(rate)
  const b = osc(rate)
  return (t) => {
    const x = n()
    const v = 0.8 * f1(x, fc, 0.6).bp + 0.6 * f2(x, 5500, 0.8).bp
    return v * perc(t, 0.001, tau) + body * b(185 + 40 * Math.exp(-t / 0.02)) * perc(t, 0.001, 0.035)
  }
}

/** Crash cymbal: independent noise per side, high-passed with a metallic band, long decay. */
function crashVoice(rate, seed, { tau = 0.9, fc = 5500 } = {}) {
  const sides = [0, 1].map((k) => ({ n: white(seed + k), hp: svf(rate), bp: svf(rate) }))
  return (t, o) => {
    const env = perc(t, 0.002, tau) * (0.65 + 0.35 * Math.exp(-t / 0.05))
    for (let k = 0; k < 2; k++) {
      const s = sides[k]
      const x = s.n()
      o[k] += env * (s.hp(x, fc, 0.6).hp + 0.6 * s.bp(x, 9000, 1.2).bp)
    }
  }
}

/** Plucked synth note: saw + detuned square through a closing low-pass, with a sine body. */
function pluckVoice(rate, f, seed, { tau = 0.28, bright = 4500, brightTau = 0.07 } = {}) {
  const r = rng(seed)
  const s = osc(rate, 'saw', r())
  const sq = osc(rate, 'square', r())
  const sn = osc(rate, 'sine', r())
  const fl = svf(rate)
  return (t) => {
    const v = fl(0.6 * s(f) + 0.25 * sq(f * cents(6)), f + bright * Math.exp(-t / brightTau), 0.9).lp
    return (v + 0.55 * sn(f)) * perc(t, 0.002, tau)
  }
}

/**
 * Countdown tick (each of 3-2-1). A clean C5 "beep" whose bright 3rd partial
 * (G6) rings on after the note is released, very wide (a detuned side signal
 * plus a wide room and ping-pong echoes), with a breath of air on top.
 */
function countdownBeep(rate) {
  const DUR = 0.9167
  const ON = 0.02
  const dry = stereoBuffer(rate, DUR)
  const body = (seed, detune) => {
    const r = rng(seed)
    const c5 = osc(rate, 'sine', r())
    const c6 = osc(rate, 'sine', r())
    const g6 = osc(rate, 'sine', r())
    const g7 = osc(rate, 'sine', r())
    const d8 = osc(rate, 'sine', r())
    const hi = osc(rate, 'sine', r())
    const d = cents(detune)
    return (t) => {
      const note = gate(t, 0.015, 0.115, 0.03)
      // G6 rings on: dips a little as the note releases, holds, then fades fast
      const ring = t < 0.13 ? gate(t, 0.015, 1, 0) : t < 0.3 ? 0.75 * Math.exp(-(t - 0.13) / 0.4) : 0.491 * Math.exp(-(t - 0.3) / 0.1)
      const top = note * (0.12 * d8(hz('D8') * d) + 0.12 * hi(8234 * d))
      return note * (c5(hz('C5') * d) + 0.7 * c6(hz('C6') * d)) + ring * (0.8 * g6(hz('G6') * d) + 0.2 * g7(hz('G7') * d)) + top
    }
  }
  const mid = body(201, 0)
  const side = body(202, 9)
  const air = noiseBurst(rate, 203, { mode: 'hp', fc: 7000, a: 0.012, tau: 0.09 })
  const airR = noiseBurst(rate, 204, { mode: 'hp', fc: 7000, a: 0.012, tau: 0.09 })
  addMidSide(dry, rate, ON, DUR - ON, mid, (t) => 0.9 * side(t))
  addStereo(dry, rate, ON, 0.4, (t, o) => {
    o[0] += 1.1 * air(t)
    o[1] += 1.1 * airR(t)
  })
  const echoed = pingPong(dry, rate, { time: 0.083, feedback: 0.35, wet: 0.3, tone: 5000 })
  const x = reverbStereo(echoed, rate, { room: 0.3, damp: 0.45, wet: 0.1, width: 1 })
  return masterStereo(x, rate, { rms: -16.2, peak: -3, fadeOut: 0.06 })
}

/**
 * "Go": a bright C6 with its two-octaves-up partial (C8) almost as loud, a
 * glassy inharmonic sparkle on the attack, extremely wide (the side signal is
 * louder than the mid) with a ~1.3 s room.
 */
function countdownGo(rate) {
  const DUR = 1.25
  const dry = stereoBuffer(rate, DUR)
  const tone = (seed, detune) => {
    const r = rng(seed)
    const d = cents(detune)
    // [frequency, gain, hold (s), decay time constant (s)]
    const parts = [
      [hz('C6'), 1, 0, 0.22],
      [hz('C7'), 0.15, 0, 0.18],
      [hz('G7'), 0.12, 0, 0.15],
      [hz('C8'), 0.75, 0.16, 0.09],
    ].map(([f, g, hold, tau]) => ({ o: osc(rate, 'sine', r()), f: f * d, g, hold, tau }))
    // glassy inharmonic partials, gone within ~150 ms
    const glass = [6612, 7025, 8541, 9957, 11004].map((f, k) => ({ o: osc(rate, 'sine', r()), f: f * d, g: [0.3, 0.27, 0.9, 0.45, 0.57][k], tau: 0.07 + 0.015 * k }))
    return (t) => {
      let v = 0
      for (const p of parts) v += p.g * p.o(p.f) * (t < p.hold ? gate(t, 0.003, 1, 0) : perc(t - p.hold, 0.003, p.tau))
      for (const p of glass) v += p.g * p.o(p.f) * perc(t, 0.001, p.tau)
      return v
    }
  }
  const mid = tone(301, 0)
  const side = tone(302, 7)
  const sparkle = [303, 304].map((s) => noiseBurst(rate, s, { mode: 'hp', fc: 8000, a: 0.001, tau: 0.06 }))
  addMidSide(dry, rate, 0, DUR, mid, (t) => 1.6 * side(t))
  addStereo(dry, rate, 0, 0.3, (t, o) => {
    o[0] += 0.5 * sparkle[0](t)
    o[1] += 0.5 * sparkle[1](t)
  })
  const echoed = pingPong(dry, rate, { time: 0.19, feedback: 0.35, wet: 0.18, tone: 6000 })
  const x = reverbStereo(echoed, rate, { room: 0.65, damp: 0.4, wet: 0.18, width: 1 })
  return masterStereo(x, rate, { rms: -18.7, peak: -2.3, fadeOut: 0.06 })
}

/**
 * The song-start sting, 4.75 s exactly (SONG_SELECTED_DURATION_MS), in F major.
 * The start transition's 3-2-1 countdown (ticks at 1.75 / 2.75 / 3.75 s, "go"
 * at 4.75 s) rides on top of it:
 *
 *    45-260 ms  a gated stutter fill: five 30 ms hits of snare + an Ebmaj7 stab, kicks under the first two
 *    297 ms     THE HIT (loudest moment, SONG_SELECTED_PEAK_OFFSET_MS): kick, crash, wide supersaw
 *               F(add9) over an F1 sub, and a pluck cascade A6-G6-F6-C6-Bb5-F5-C5
 *    0.92 s     crash, the chord moves to Eb(add9), cascade again
 *    1.36-1.6 s snare fill back into F (just before tick "3")
 *    2.78 s     build over a C pedal (tick "2"): snares, then Ab - Bb - C stabs
 *    3.74 s     C7 chord and an 808 sub drop sweeping 130 Hz -> ~17 Hz (tick "1")
 *    4.45 s     near silence, so "go" lands in a hole
 */
function songSelected(rate) {
  const DUR = 4.75
  const ON = 0.045
  const HIT = 0.297
  const dry = stereoBuffer(rate, DUR) // straight to the output and into the room
  const low = stereoBuffer(rate, DUR) // bass, kicks and the drop: kept out of the room
  const plucks = stereoBuffer(rate, DUR) // through ping-pong echoes, then the room
  const stutter = stereoBuffer(rate, DUR) // the gated intro: no room, so the gaps stay silent

  // 1) stutter fill
  const STUTTER = [0.045, 0.102, 0.158, 0.21, 0.258]
  STUTTER.forEach((at, k) => {
    const vel = 0.4 + 0.08 * k
    const g = (t) => gate(t, 0.002, 0.022, 0.007)
    const sn = snareVoice(rate, 400 + k, { fc: 2200, tau: 0.05, body: 0.35 })
    addPan(stutter, rate, at, 0.035, 0, (t) => 1.1 * vel * sn(t) * g(t))
    for (const [v, note] of ['A#5', 'D#6', 'G6', 'D7'].entries()) {
      const s = supersaw(rate, hz(note), 410 + k * 8 + v, { voices: 5, detune: 18, width: 0.6 })
      addStereo(stutter, rate, at, 0.035, (t, o) => {
        const tmp = [0, 0]
        s(4500, 0.7, tmp)
        o[0] += 0.2 * vel * tmp[0] * g(t)
        o[1] += 0.2 * vel * tmp[1] * g(t)
      })
    }
    if (k < 2 || k === 3) {
      const kk = kickVoice(rate, 420 + k, { f0: 135, f1: 55, pitchTau: 0.02, tau: 0.035, click: 0.1 })
      addPan(stutter, rate, at + 0.008, 0.12, 0, (t) => (k === 3 ? 0.22 : 0.42) * kk(t))
    }
  })

  // 2) harmony: sections of pad + bass
  const F_ADD9 = ['F3', 'A3', 'C4', 'F4', 'G4', 'C5']
  const sections = [
    { at: HIT, end: 0.92, bass: 'F1', bassLevel: 0.71, pad: F_ADD9, level: 0.85, attack: 0.012, accent: 0.4 },
    { at: 0.92, end: 1.6, bass: 'D#1', bassLevel: 0.55, pad: ['D#3', 'G3', 'A#3', 'D#4', 'F4', 'A#4'], level: 0.65, attack: 0.02 },
    { at: 1.6, end: 2.78, bass: 'F1', bassLevel: 0.48, pad: F_ADD9, level: 0.45, attack: 0.02 },
    { at: 2.78, end: 3.74, bass: 'F1', bassLevel: 0.34, pad: ['C3', 'F3', 'A#3', 'C4', 'F4'], level: 0.2, attack: 0.03 },
    { at: 3.74, end: 3.95, bass: null, pad: ['C3', 'E3', 'G3', 'A#3', 'C4', 'E4'], level: 0.25, attack: 0.01, release: 0.2 },
  ]
  sections.forEach((sec, k) => {
    const XF = 0.03
    const len = sec.end - sec.at
    const release = sec.release ?? XF
    sec.pad.forEach((note, v) => {
      const s = supersaw(rate, hz(note), 500 + k * 16 + v, { voices: 7, detune: 24, width: 1, hp: 450 })
      addStereo(dry, rate, sec.at, len + release + 0.01, (t, o) => {
        const env = gate(t, sec.attack, len, release) * sec.level * (1 + (sec.accent ?? 0) * Math.exp(-t / 0.15))
        const cutoff = 7000 + 5000 * Math.exp(-t / 0.25)
        const tmp = [0, 0]
        s(cutoff, 0.8, tmp)
        o[0] += 0.3 * env * tmp[0]
        o[1] += 0.3 * env * tmp[1]
      })
    })
    if (sec.bass) {
      const f = hz(sec.bass)
      const sub = osc(rate)
      const oct = osc(rate)
      const saws = [osc(rate, 'saw', 0.3), osc(rate, 'saw', 0.8)]
      const fls = [svf(rate), svf(rate)]
      addStereo(low, rate, sec.at, len + XF + 0.01, (t, o) => {
        const env = gate(t, 0.01, len, XF) * sec.bassLevel
        const body = Math.tanh(1.3 * (0.25 * sub(f) + 0.75 * oct(2 * f)))
        // the saw layer is a detuned pair, one per side, so the bass is not dead centre
        for (let c = 0; c < 2; c++) o[c] += 0.5 * env * (body + 0.6 * fls[c](saws[c](2 * f * cents(c ? -8 : 8)), 520, 0.8).lp)
      })
    }
  })

  // a bed of air over the whole hit-to-drop span: stereo noise, high-passed
  {
    const n = [white(560), white(561)]
    const hp = [svf(rate), svf(rate)]
    const bp = [svf(rate), svf(rate)]
    addStereo(dry, rate, HIT, 3.74 - HIT + 0.2, (t, o) => {
      const env = gate(t, 0.005, 3.74 - HIT, 0.15) * (0.7 + 0.3 * Math.exp(-t / 0.6)) * (1 - 0.15 * ramp(t, 0.6, 3.4))
      for (let c = 0; c < 2; c++) {
        const x = n[c]()
        o[c] += env * (0.05 * hp[c](x, 4000, 0.6).hp + 0.35 * bp[c](x, 6000, 1).bp)
      }
    })
  }

  // 3) pluck cascades
  const CASCADES = [
    { at: HIT, notes: ['A6', 'G6', 'F6', 'C6', 'A#5', 'F5', 'C5'], gain: 1 },
    { at: 0.93, notes: ['G6', 'F6', 'C6', 'A#5', 'F5', 'C5', 'G5'], gain: 0.8 },
    { at: 1.59, notes: ['A6', 'G6', 'F6', 'C6', 'A#5', 'F5', 'C5'], gain: 0.85 },
    { at: 2.24, notes: ['G6', 'F6', 'C6', 'A#5', 'F5', 'C5'], gain: 0.75 },
    { at: 2.9, notes: ['F6', 'C6', 'A#5', 'F5', 'C5'], gain: 0.5 },
    { at: 3.56, notes: ['F6', 'C6', 'A#5', 'F5'], gain: 0.35 },
  ]
  CASCADES.forEach((c, k) => {
    c.notes.forEach((note, i) => {
      const p = pluckVoice(rate, hz(note), 600 + k * 10 + i)
      addPan(plucks, rate, c.at + i * 0.055, 0.9, (i % 2 ? -0.6 : 0.6), (t) => 0.45 * c.gain * p(t))
    })
  })

  // 4) drums
  for (const [at, vel, f1] of [
    [HIT, 1.3, 44],
    [0.935, 0.8, 52],
    [1.6, 0.7, 52],
  ]) {
    const kk = kickVoice(rate, 700 + Math.round(at * 100), { f0: 130, f1, pitchTau: 0.05, tau: 0.3, drive: 2.2 })
    addPan(low, rate, at, 0.8, 0, (t) => 0.5 * vel * kk(t))
  }
  for (const [at, vel, tau] of [
    [HIT, 1, 1.0],
    [0.93, 0.85, 0.6],
    [1.59, 0.5, 0.5],
    [2.81, 0.4, 0.45],
  ]) {
    const c = crashVoice(rate, 720 + Math.round(at * 100), { tau })
    addStereo(dry, rate, at, Math.min(DUR - at, tau * 5), (t, o) => {
      const tmp = [0, 0]
      c(t, tmp)
      o[0] += 0.35 * vel * tmp[0]
      o[1] += 0.35 * vel * tmp[1]
    })
  }
  for (const [at, vel] of [
    [1.36, 0.75],
    [1.48, 0.8],
    [1.535, 0.85],
    [1.59, 0.95],
    [2.81, 0.5],
    [2.92, 0.5],
    [3.14, 0.55],
    [3.36, 0.6],
    [3.58, 0.65],
  ]) {
    const sn = snareVoice(rate, 740 + Math.round(at * 100))
    addPan(dry, rate, at, 0.4, 0, (t) => 0.7 * vel * sn(t))
  }
  // build stabs climbing Ab - Bb - C into the dominant
  for (const [at, notes] of [
    [3.14, ['G#3', 'C4', 'D#4', 'G#4']],
    [3.36, ['A#3', 'D4', 'F4', 'A#4']],
    [3.58, ['C4', 'E4', 'G4', 'C5']],
  ]) {
    notes.forEach((note, v) => {
      const s = supersaw(rate, hz(note), 800 + Math.round(at * 100) + v, { voices: 5, detune: 20, width: 0.8 })
      addStereo(dry, rate, at + 0.01, 0.35, (t, o) => {
        const env = gate(t, 0.004, 0.12, 0.12)
        const tmp = [0, 0]
        s(1200 + 3000 * Math.exp(-t / 0.06), 0.9, tmp)
        o[0] += 0.15 * env * tmp[0]
        o[1] += 0.15 * env * tmp[1]
      })
    })
  }

  // 5) the drop: 808 sub sweeping down from ~130 Hz
  {
    const o = osc(rate)
    const kk = kickVoice(rate, 790, { f0: 160, f1: 60, pitchTau: 0.02, tau: 0.05, click: 0.3 })
    addPan(low, rate, 3.74, 0.8, 0, (t) => {
      const f = 18 + 112 * Math.exp(-t / 0.22)
      return 0.3 * Math.tanh(1.8 * o(f)) * gate(t, 0.004, 0.62, 0.1) + 0.25 * kk(t)
    })
  }

  // 6) a faint F chord glint in the hole before "go"
  ;['F5', 'C6', 'A6'].forEach((note, i) => {
    const p = pluckVoice(rate, hz(note), 900 + i, { tau: 0.3, bright: 2500 })
    addPan(plucks, rate, 4.42 + i * 0.03, 0.33, i - 1, (t) => 0.01 * p(t))
  })

  // a short breath before the big downbeats, so they land with a snap
  for (const at of [0.93, 1.59]) {
    for (const bus of [dry, low]) {
      for (const x of bus) {
        const a = Math.round((at - 0.03) * rate)
        const b = Math.round(at * rate)
        // only what is already sounding is ducked: the downbeat's own hits start at `at`
        for (let i = a; i < b; i++) x[i] *= 1 - 0.65 * Math.sin((Math.PI * (i - a)) / (b - a)) ** 2
      }
    }
  }

  const echoed = pingPong(plucks, rate, { time: 0.165, feedback: 0.38, wet: 0.35, tone: 4500 })
  const bus = [Float32Array.from(dry[0], (v, i) => v + echoed[0][i]), Float32Array.from(dry[1], (v, i) => v + echoed[1][i])]
  const roomed = reverbStereo(bus, rate, { room: 0.7, damp: 0.45, wet: 0.16, width: 1, predelay: 0.012 })
  const out = [0, 1].map((c) => Float32Array.from(roomed[c].subarray(0, dry[c].length), (v, i) => v + low[c][i] + stutter[c][i]))
  // digital silence before the first transient
  for (const x of out) for (let i = 0; i < Math.round(ON * rate); i++) x[i] = 0
  // keep the window at 300 ms the loudest moment (the app relies on that), before and after limiting
  keepPeakAt(out, rate, 0.3, { introDb: -2.5, afterSec: 0.325, afterDb: -1.5 })
  masterStereo(out, rate, { rms: -14.3, peak: -3.6, fadeOut: 0.05, passes: 3, atSec: 0.3 })
  keepPeakAt(out, rate, 0.3, { introDb: -1.5, afterSec: 0.325, afterDb: -1 })
  return out
}

function hitExcellent(rate) {
  const x = buffer(rate, 0.28)
  for (const [note, g] of [
    ['E6', 0.6],
    ['B6', 0.45],
  ]) {
    const b = bell(rate, hz(note), { ratio: 2, index: 1.1, indexTau: 0.04, tau: 0.08 })
    add(x, rate, 0, 0.28, (t) => g * b(t))
  }
  const sp = osc(rate)
  add(x, rate, 0, 0.28, (t) => 0.12 * sp(hz('B7')) * perc(t, 0.001, 0.025))
  return master(x, rate, { peak: -21, fadeOut: 0.03 })
}

function hitGood(rate) {
  const x = buffer(rate, 0.16)
  const b = bell(rate, hz('G5'), { ratio: 2, index: 0.8, indexTau: 0.03, tau: 0.05 })
  add(x, rate, 0, 0.16, (t) => b(t))
  return master(x, rate, { peak: -25.6, fadeOut: 0.02 })
}

function hitBad(rate) {
  const x = buffer(rate, 0.2)
  for (const f0 of [196, 185]) {
    const o = osc(rate, 'tri')
    const fl = svf(rate)
    add(x, rate, 0, 0.2, (t) => fl(o(f0 * (1 - 0.18 * ramp(t, 0, 0.15))), 900, 0.7).lp * perc(t, 0.003, 0.06))
  }
  return master(x, rate, { peak: -26.5, fadeOut: 0.03 })
}

function hitGolden(rate) {
  const dry = buffer(rate, 0.74)
  // sparkle transient
  add(dry, rate, 0, 0.08, (t) => 0.3 * noiseBurst(rate, 51, { mode: 'hp', fc: 7000, tau: 0.02 })(t))
  const top = bell(rate, hz('C8'), { ratio: 3.5, index: 1.5, indexTau: 0.02, tau: 0.05 })
  add(dry, rate, 0, 0.3, (t) => 0.25 * top(t))
  // C5 floor + ascending C6-E6-G6-C7
  const base = bell(rate, hz('C5'), { ratio: 2, index: 1, indexTau: 0.08, tau: 0.25 })
  add(dry, rate, 0, 0.74, (t) => 0.35 * base(t))
  ;['C6', 'E6', 'G6', 'C7'].forEach((note, k) => {
    const b = bell(rate, hz(note), { ratio: 2, index: 1.3, indexTau: 0.06, tau: 0.2 })
    add(dry, rate, k * 0.045, 0.74, (t) => 0.45 * b(t))
  })
  const x = reverb(dry, rate, { room: 0.6, damp: 0.4, wet: 0.25 }).subarray(0, dry.length)
  return master(Float32Array.from(x), rate, { peak: -18, fadeOut: 0.12 })
}

function cheer(rate) {
  const DUR = 2.6
  const dry = buffer(rate, DUR)
  const r = rng(61)
  const swell = (t) => ramp(t, 0, 0.35) * (1 - ramp(t, 1.5, DUR))
  // crowd "aaah/yeah": voiced saws + breath through two formant band-passes
  for (let v = 0; v < 28; v++) {
    const f0 = 170 + r() * 260
    const f1 = 450 + r() * 450
    const f2 = 1100 + r() * 1400
    const onset = r() * 0.25
    const rise = 0.1 + r() * 0.35
    const lfoRate = 2.5 + r() * 4.5
    const lfoPhase = r()
    const vibRate = 4 + r() * 3
    const o = osc(rate, 'saw', r())
    const n = white(1000 + v)
    const fa = svf(rate)
    const fb = svf(rate)
    add(dry, rate, onset, DUR - onset, (t) => {
      const f = f0 * (1 + rise * (1 - Math.exp(-t / 0.25))) * (1 + 0.012 * Math.sin(TAU * vibRate * t))
      const src = 0.6 * o(f) + 0.5 * n()
      const y = fa(src, f1, 4).bp + 0.6 * fb(src, f2, 5).bp
      const am = 0.55 + 0.45 * Math.sin(TAU * (lfoRate * t + lfoPhase))
      return 0.09 * y * am * swell(onset + t)
    })
  }
  // claps: three quick noise bursts + a short tail each
  for (let c = 0; c < 60; c++) {
    const at = 0.08 + (r() ** 1.4) * 2.1
    const g = (0.35 + 0.65 * r()) * (1 - ramp(at, 1.4, 2.4))
    const fc = 1000 + r() * 800
    const n = white(2000 + c)
    const f = svf(rate)
    add(dry, rate, at, 0.12, (t) => {
      const env = perc(t, 0.0005, 0.004) + perc(t - 0.008, 0.0005, 0.004) + 0.8 * perc(t - 0.016, 0.0005, 0.03)
      return 0.5 * g * f(n(), fc, 1.2).bp * env
    })
  }
  // a couple of whistles
  for (const [at, f0, len] of [
    [0.3, 1700, 0.7],
    [0.9, 2100, 0.5],
  ]) {
    const o = osc(rate)
    add(dry, rate, at, len, (t) => {
      const f = f0 * (1 + 0.35 * ramp(t, 0, len * 0.6)) * (1 + 0.01 * Math.sin(TAU * 6 * t))
      return 0.05 * o(f) * gate(t, 0.04, len - 0.15, 0.15)
    })
  }
  const x = reverb(dry, rate, { room: 0.7, damp: 0.5, wet: 0.3 }).subarray(0, dry.length)
  return master(Float32Array.from(x), rate, { rms: -12, peak: -1, fadeOut: 0.3 })
}

function crownLand(rate) {
  const dry = buffer(rate, 0.9)
  // impact
  const thump = osc(rate)
  add(dry, rate, 0, 0.6, (t) => thump(42 + 80 * Math.exp(-t / 0.04)) * perc(t, 0.001, 0.16))
  add(dry, rate, 0, 0.15, (t) => 0.6 * noiseBurst(rate, 71, { mode: 'lp', fc: 900, tau: 0.03 })(t))
  // shimmering C major chord: detuned bell pairs with a fast tremolo
  ;['C6', 'E6', 'G6', 'C7', 'E7'].forEach((note, k) => {
    for (const dt of [-6, 6]) {
      const b = bell(rate, hz(note) * cents(dt), { ratio: 3.5, index: 1.2, indexTau: 0.06, tau: 0.35, phase: k * 0.21 })
      add(dry, rate, 0.008 + k * 0.012, 0.9, (t) => 0.13 * b(t) * (1 - 0.25 * (0.5 + 0.5 * Math.sin(TAU * 11 * t + k))))
    }
  })
  const x = reverb(dry, rate, { room: 0.7, damp: 0.35, wet: 0.32 }).subarray(0, dry.length)
  return master(Float32Array.from(x), rate, { rms: -12.7, peak: -1, fadeOut: 0.15 })
}

function scoreTick(rate) {
  const x = buffer(rate, 0.035)
  const o = osc(rate)
  const o2 = osc(rate)
  add(x, rate, 0, 0.035, (t) => (o(hz('C7')) + 0.2 * o2(hz('C8'))) * perc(t, 0.0008, 0.007))
  return master(x, rate, { peak: -24, fadeOut: 0.005 })
}

function uiBing(rate) {
  const dry = buffer(rate, 0.5)
  const b = bell(rate, hz('E6'), { ratio: 2, index: 1.4, indexTau: 0.06, tau: 0.16 })
  const p = osc(rate)
  add(dry, rate, 0, 0.5, (t) => b(t) + 0.12 * p(hz('E6') * 2.76) * perc(t, 0.001, 0.05))
  const x = reverb(dry, rate, { room: 0.5, damp: 0.5, wet: 0.2 }).subarray(0, dry.length)
  return master(Float32Array.from(x), rate, { peak: -18, fadeOut: 0.08 })
}

function uiBong(rate) {
  const dry = buffer(rate, 0.6)
  const b = bell(rate, hz('A5'), { ratio: 2, index: 1.1, indexTau: 0.07, tau: 0.2 })
  const body = osc(rate)
  add(dry, rate, 0, 0.6, (t) => b(t) + 0.4 * body(hz('A4')) * perc(t, 0.002, 0.15))
  const x = reverb(dry, rate, { room: 0.5, damp: 0.5, wet: 0.2 }).subarray(0, dry.length)
  return master(Float32Array.from(x), rate, { peak: -22, fadeOut: 0.1 })
}

// ---------------------------------------------------------------------------
// Menu music: "Aether Lounge" -- 32 bars at 100 BPM in D major, seamless loop
// ---------------------------------------------------------------------------

const CHORDS = {
  Dmaj9: { bass: 'D2', pad: ['A3', 'C#4', 'E4', 'F#4'] },
  Bm9: { bass: 'B1', pad: ['A3', 'C#4', 'D4', 'F#4'] },
  Gmaj9: { bass: 'G2', pad: ['B3', 'D4', 'F#4', 'A4'] },
  A9sus4: { bass: 'A2', pad: ['G3', 'B3', 'D4', 'E4'] },
  Em9: { bass: 'E2', pad: ['G3', 'B3', 'D4', 'F#4'] },
  A13: { bass: 'A2', pad: ['G3', 'C#4', 'F#4', 'B4'] },
  'F#m7': { bass: 'F#2', pad: ['A3', 'C#4', 'E4', 'F#4'] },
  Gmaj7: { bass: 'G2', pad: ['B3', 'D4', 'F#4', 'G4'] },
}

// prettier-ignore
const PROGRESSION = [
  // A
  'Dmaj9', 'Bm9', 'Gmaj9', 'A9sus4', 'Dmaj9', 'Bm9', 'Gmaj9', 'A9sus4',
  // B (melody)
  'Em9', 'A13', 'F#m7', 'Bm9', 'Em9', 'A13', 'Gmaj7', 'A9sus4',
  // A' (melody)
  'Dmaj9', 'Bm9', 'Gmaj9', 'A9sus4', 'Dmaj9', 'Bm9', 'Gmaj9', 'A9sus4',
  // C (half-time breakdown, then back up into bar 1)
  'Gmaj9', 'F#m7', 'Em9', 'A9sus4', 'Gmaj9', 'A9sus4', 'Bm9', 'A9sus4',
]

// [beat within the 8-bar phrase, note, length in beats]
// prettier-ignore
const MELODY_B = [
  [0, 'B4', 1], [1, 'D5', 1], [2, 'F#5', 2],
  [4, 'E5', 1.5], [5.5, 'C#5', 0.5], [6, 'A4', 2],
  [8, 'C#5', 1], [9, 'E5', 1], [10, 'A5', 2],
  [12, 'F#5', 3],
  [16, 'G5', 1], [17, 'F#5', 1], [18, 'E5', 1], [19, 'D5', 1],
  [20, 'C#5', 2], [22, 'E5', 2],
  [24, 'D5', 1], [25, 'B4', 1], [26, 'D5', 1], [27, 'F#5', 1],
  [28, 'E5', 3.5],
]
// prettier-ignore
const MELODY_A = [
  [0, 'F#5', 1.5], [1.5, 'E5', 0.5], [2, 'D5', 1], [3, 'A4', 1],
  [4, 'B4', 1.5], [5.5, 'C#5', 0.5], [6, 'D5', 1], [7, 'F#5', 1],
  [8, 'E5', 2], [10, 'D5', 1], [11, 'B4', 1],
  [12, 'A4', 3],
  [16, 'F#5', 1.5], [17.5, 'A5', 0.5], [18, 'F#5', 1], [19, 'E5', 1],
  [20, 'D5', 1.5], [21.5, 'E5', 0.5], [22, 'F#5', 2],
  [24, 'G5', 1], [25, 'F#5', 1], [26, 'E5', 1], [27, 'D5', 1],
  [28, 'E5', 3.5],
]

function menuLoop(rate) {
  const BPM = 100
  const beat = 60 / BPM
  const bar = beat * 4
  const bars = PROGRESSION.length
  const loopLen = Math.round(bars * bar * rate)
  const TAIL = 4
  const total = loopLen + Math.round(TAIL * rate)
  const loopSec = loopLen / rate
  const pad = new Float32Array(total)
  const keys = new Float32Array(total)
  const lead = new Float32Array(total)
  const bass = new Float32Array(total)
  const drums = new Float32Array(total)
  const send = new Float32Array(total)
  const r = rng(90)
  const at = (barIdx, beatInBar = 0) => barIdx * bar + beatInBar * beat

  PROGRESSION.forEach((name, b) => {
    const chord = CHORDS[name]
    const t0 = at(b)
    const breakdown = b >= 24 && b < 28

    // pad: slow attack, release overlapping the next chord; the filter LFO
    // completes a whole number of cycles per loop so the seam is invisible
    chord.pad.forEach((note, v) => {
      const f = hz(note)
      const cutoff = (t) => {
        const abs = t0 + t
        return 950 + 450 * Math.sin((TAU * 2 * abs) / loopSec) + 200 * Math.sin((TAU * 7 * abs) / loopSec + v)
      }
      const voice = padVoice(rate, f, cutoff, 300 + b * 8 + v, { detune: 8, q: 0.7 })
      add(pad, rate, t0, bar + 1.2, (t) => 0.14 * voice(t) * gate(t, 0.45, bar, 1.1))
    })

    // e-piano arpeggio on 8ths over the pad tones + an octave
    const tones = [...chord.pad, ...chord.pad.map((n) => n.replace(/\d$/, (o) => String(Number(o) + 1)))]
    const pattern = b % 2 === 0 ? [0, 2, 4, 5, 6, 5, 4, 2] : [1, 3, 4, 6, 7, 6, 4, 3]
    for (let s = 0; s < 8; s++) {
      if (breakdown && s % 2 === 1) continue
      const f = hz(tones[pattern[s]])
      const vel = (s % 2 === 0 ? 0.11 : 0.075) * (0.9 + 0.2 * r())
      const e = bell(rate, f, { ratio: 1, index: 1.3, indexTau: 0.12, a: 0.003, tau: 0.32, phase: r() })
      add(keys, rate, t0 + s * beat * 0.5, 1.2, (t) => vel * e(t))
    }

    // bass: syncopated root/octave line, sine + soft saw through a low-pass
    const root = hz(chord.bass)
    const bassLine = breakdown
      ? [[0, 2.5, 1], [3, 0.75, 1]]
      : [[0, 1.25, 1], [1.5, 0.4, 1], [2.5, 0.9, 1], [3.5, 0.4, 2]]
    for (const [pos, len, mult] of bassLine) {
      const o = osc(rate)
      const s = osc(rate, 'saw', 0.25)
      const fl = svf(rate)
      add(bass, rate, t0 + pos * beat, len * beat + 0.08, (t) => {
        const f = root * mult
        const env = gate(t, 0.006, len * beat, 0.07)
        return env * (0.8 * o(f) + fl(s(f), 420 + 900 * Math.exp(-t / 0.06), 0.9).lp * 0.35)
      })
    }

    // drums
    const kicks = breakdown ? [[0, 1]] : [[0, 1], [2, 0.85], [2.5, 0.45]]
    for (const [pos, vel] of kicks) {
      const o = osc(rate)
      const click = noiseBurst(rate, 400 + b * 4 + pos * 2, { mode: 'lp', fc: 2500, tau: 0.003 })
      add(drums, rate, t0 + pos * beat, 0.45, (t) => vel * (o(46 + 70 * Math.exp(-t / 0.03)) * perc(t, 0.001, 0.2) + 0.25 * click(t)))
    }
    if (!breakdown) {
      for (const pos of [1, 3]) {
        const n = noiseBurst(rate, 500 + b * 4 + pos, { mode: 'bp', fc: 1900, q: 0.9, a: 0.001, tau: 0.08 })
        const tone = osc(rate)
        add(drums, rate, t0 + pos * beat, 0.4, (t) => {
          const v = 0.32 * n(t) + 0.18 * tone(190) * perc(t, 0.001, 0.05)
          send[Math.round((t0 + pos * beat + t) * rate)] += 0.9 * v
          return v
        })
      }
    } else {
      // breakdown: a soft rim on beat 3 only
      const n = noiseBurst(rate, 600 + b, { mode: 'bp', fc: 2600, q: 2, tau: 0.03 })
      add(drums, rate, t0 + 2 * beat, 0.2, (t) => {
        const v = 0.25 * n(t)
        send[Math.round((t0 + 2 * beat + t) * rate)] += v
        return v
      })
    }
    // closed hats on 16ths with an accent pattern; open hat every other bar
    const accents = [0.55, 0.18, 0.32, 0.18]
    for (let s = 0; s < 16; s++) {
      const n = noiseBurst(rate, 700 + b * 16 + s, { mode: 'hp', fc: 6500, a: 0.0005, tau: 0.022 })
      const vel = accents[s % 4] * (0.85 + 0.3 * r())
      add(drums, rate, t0 + s * beat * 0.25, 0.12, (t) => 0.22 * vel * n(t))
    }
    if (b % 2 === 1) {
      const n = noiseBurst(rate, 800 + b, { mode: 'hp', fc: 5500, a: 0.002, tau: 0.13 })
      add(drums, rate, t0 + 3.5 * beat, 0.5, (t) => 0.06 * n(t))
    }
  })

  // lead melody (soft sine/triangle flute with delayed vibrato) in B and A'
  for (const [phraseBar, melody] of [
    [8, MELODY_B],
    [16, MELODY_A],
  ]) {
    for (const [pos, note, len] of melody) {
      const f = hz(note)
      const o = osc(rate)
      const o3 = osc(rate, 'tri')
      const dur = len * beat
      add(lead, rate, at(phraseBar) + pos * beat, dur + 0.3, (t) => {
        const vib = 1 + 0.004 * ramp(t, 0.15, 0.4) * Math.sin(TAU * 5.2 * t)
        return 0.16 * gate(t, 0.035, dur * 0.92, 0.25) * (o(f * vib) + 0.18 * o3(f * vib))
      })
    }
  }

  // buses -> echo/reverb -> mix
  const keysWet = echo(keys, rate, { time: beat * 0.75, feedback: 0.38, wet: 0.35, tone: 2800 })
  const leadWet = echo(lead, rate, { time: beat * 1.5, feedback: 0.3, wet: 0.25, tone: 2500 })
  for (let i = 0; i < total; i++) send[i] += 0.35 * pad[i] + 0.4 * keysWet[i] + 0.5 * leadWet[i]
  const verb = reverb(send, rate, { room: 0.82, damp: 0.5, wet: 1, dry: 0 })
  const mix = new Float32Array(total)
  for (let i = 0; i < total; i++) {
    mix[i] = 1 * pad[i] + 1.4 * keysWet[i] + 0.75 * leadWet[i] + 0.3 * bass[i] + 0.6 * drums[i] + 0.5 * verb[i]
  }

  // seamless loop: wrap everything that rings past the loop end back onto the
  // start (every process above is linear, so this is exactly what the next
  // pass of the loop would hear), then rotate so the file opens one 16th
  // before the downbeat -- the seam sits between two notes, not on a kick.
  for (let i = loopLen; i < total; i++) mix[i - loopLen] += mix[i]
  const pickup = Math.round(beat * 0.25 * rate)
  const out = new Float32Array(loopLen)
  for (let i = 0; i < loopLen; i++) out[i] = mix[(i - pickup + loopLen) % loopLen]

  // remove DC circularly (mean), level to a calm background RMS, soft-knee limit
  let mean = 0
  for (const v of out) mean += v
  mean /= loopLen
  let ss = 0
  for (let i = 0; i < loopLen; i++) {
    out[i] -= mean
    ss += out[i] * out[i]
  }
  const g = dbToGain(-17) / Math.sqrt(ss / loopLen)
  const knee = dbToGain(-4)
  const ceil = dbToGain(-1)
  for (let i = 0; i < loopLen; i++) {
    const v = out[i] * g
    const a = Math.abs(v)
    out[i] = a <= knee ? v : Math.sign(v) * (knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee)))
  }
  return out
}

// ---------------------------------------------------------------------------
// Registry + CLI
// ---------------------------------------------------------------------------

const ASSETS = [
  { file: 'assets/sfx/ui_hover.wav', rate: SFX_RATE, build: uiHover },
  { file: 'assets/sfx/ui_click.wav', rate: SFX_RATE, build: uiClick },
  { file: 'assets/sfx/ui_confirm.wav', rate: SFX_RATE, build: uiConfirm },
  { file: 'assets/sfx/ui_back.wav', rate: SFX_RATE, build: uiBack },
  { file: 'assets/sfx/ui_error.wav', rate: SFX_RATE, build: uiError },
  { file: 'assets/sfx/ui_bing.wav', rate: SFX_RATE, build: uiBing },
  { file: 'assets/sfx/ui_bong.wav', rate: SFX_RATE, build: uiBong },
  { file: 'assets/sfx/countdown_beep.wav', rate: SFX_RATE, build: countdownBeep },
  { file: 'assets/sfx/countdown_go.wav', rate: SFX_RATE, build: countdownGo },
  { file: 'assets/sfx/song_selected.wav', rate: SFX_RATE, build: songSelected },
  { file: 'assets/sfx/placeholder_hit_excellent.wav', rate: SFX_RATE, build: hitExcellent },
  { file: 'assets/sfx/placeholder_hit_good.wav', rate: SFX_RATE, build: hitGood },
  { file: 'assets/sfx/placeholder_hit_bad.wav', rate: SFX_RATE, build: hitBad },
  { file: 'assets/sfx/placeholder_hit_golden.wav', rate: SFX_RATE, build: hitGolden },
  { file: 'assets/sfx/placeholder_cheer.wav', rate: SFX_RATE, build: cheer },
  { file: 'assets/sfx/placeholder_crown_land.wav', rate: SFX_RATE, build: crownLand },
  { file: 'assets/sfx/placeholder_score_tick.wav', rate: SFX_RATE, build: scoreTick },
  { file: 'menu_music/menu_loop.wav', rate: MUSIC_RATE, build: menuLoop },
]

function main(argv) {
  const check = argv.includes('--check')
  const only = argv.filter((a) => !a.startsWith('--'))
  const selected = only.length ? ASSETS.filter((a) => only.some((o) => a.file.includes(o))) : ASSETS
  if (only.length && selected.length === 0) throw new Error(`no asset matches ${only.join(', ')}`)
  mkdirSync(SFX_DIR, { recursive: true })
  mkdirSync(MUSIC_DIR, { recursive: true })
  let mismatches = 0
  for (const asset of selected) {
    const out = asset.build(asset.rate)
    const wav = encodeWav(out, asset.rate)
    const target = path.join(ROOT, asset.file)
    // stereo files are measured on their mono mix (what the tests check)
    const x = Array.isArray(out) ? monoOf(out) : out
    const m = measure(x, asset.rate)
    const info = [
      asset.file.padEnd(42),
      `${Array.isArray(out) ? 'stereo' : 'mono  '}`,
      `${((x.length / asset.rate) * 1000).toFixed(0).padStart(6)} ms`,
      `peak ${gainToDb(m.peak).toFixed(1).padStart(6)} dBFS`,
      `rms25 ${gainToDb(m.maxRms).toFixed(1).padStart(6)} dBFS`,
      `${(wav.length / 1024).toFixed(0).padStart(5)} KiB`,
    ]
    if (asset.build === songSelected) info.push(`first sound ${m.firstSoundMs.toFixed(0)} ms, full level ${m.fullLevelMs} ms`)
    if (check) {
      let same = false
      try {
        same = readFileSync(target).equals(wav)
      } catch {
        same = false
      }
      if (!same) mismatches++
      console.log(same ? 'ok      ' : 'DIFFERS ', info.join('  '))
    } else {
      writeFileSync(target, wav)
      console.log(info.join('  '))
    }
  }
  if (check && mismatches) {
    console.error(`${mismatches} file(s) differ from the generator output`)
    process.exitCode = 1
  }
}

main(process.argv.slice(2))
