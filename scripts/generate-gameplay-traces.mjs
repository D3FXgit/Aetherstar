// Authoring script for fixtures/gameplay-traces/ (the committed output). Not
// part of `npm test`; re-run by hand if the fixture chart or the sampling
// constants below change.
//
//   node scripts/generate-gameplay-traces.mjs
//
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CHART_PATH = path.join(ROOT, 'fixtures/sample-song/notes.txt')
const OUT_DIR = path.join(ROOT, 'fixtures/gameplay-traces')

// Sample step within each note's own span, in ms. The spec's Architecture
// Decisions named 10ms; widened here to 25ms to keep the committed fixture
// size reasonable -- still dense enough for a deterministic, exact-pitch
// "perfect" trace.
const SAMPLE_STEP_MS = 25
const DEVICE_ID = 'fixture'

// ':' normal, '*' golden, 'F' freestyle, 'R' rap, 'G' golden rap. Rap notes
// are judged on voiced activity at any pitch, so sampling them at the chart
// pitch is just as "perfect" as it is for sung notes.
const NOTE_LINE_PATTERN = /^([:*FRG])\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)(?:\s(.*))?$/

function parseChart(raw) {
  const lines = raw.split(/\r?\n/)
  const tags = new Map()
  for (const line of lines) {
    if (!line.startsWith('#')) continue
    const sep = line.indexOf(':')
    if (sep === -1) continue
    tags.set(line.slice(1, sep).trim().toUpperCase(), line.slice(sep + 1).trim())
  }
  const bpm = Number(tags.get('BPM') ?? 0)
  const gap = Number(tags.get('GAP') ?? 0)

  const notes = []
  for (const line of lines) {
    if (line === 'E') break
    const m = line.match(NOTE_LINE_PATTERN)
    if (!m) continue
    const [, marker, startBeat, length, pitch] = m
    if (marker === 'F') continue // freestyle notes are always credited -- no sample needed
    notes.push({ startBeat: Number(startBeat), length: Number(length), pitch: Number(pitch) })
  }

  return { bpm, gap, notes }
}

// Must stay identical to src/stage/timing/beatMs.ts: an UltraStar #BPM counts
// quarter beats, so one file beat is 60000/(bpm*4) ms. This script used to
// carry the same missing `* 4` the playback clock did, which put every
// committed trace sample four times too far into the song.
function beatToMs(beat, bpm, gap) {
  return gap + beat * (60000 / (bpm * 4))
}

// Octave-agnostic matching means any consistent reference octave works --
// treats the raw pitch integer directly as a semitone offset from A4.
function pitchToHz(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}

function generatePerfectTrace(chart) {
  const samples = []
  for (const note of chart.notes) {
    const startMs = beatToMs(note.startBeat, chart.bpm, chart.gap)
    const endMs = beatToMs(note.startBeat + note.length, chart.bpm, chart.gap)
    const hz = pitchToHz(note.pitch)
    for (let t = startMs; t < endMs; t += SAMPLE_STEP_MS) {
      samples.push({ t: Math.round(t), hz, confidence: 1, deviceId: DEVICE_ID })
    }
  }
  return samples
}

function generateSilenceTrace(chart) {
  const samples = []
  for (const note of chart.notes) {
    const startMs = beatToMs(note.startBeat, chart.bpm, chart.gap)
    const endMs = beatToMs(note.startBeat + note.length, chart.bpm, chart.gap)
    for (let t = startMs; t < endMs; t += SAMPLE_STEP_MS) {
      samples.push({ t: Math.round(t), hz: 0, confidence: 0, deviceId: DEVICE_ID })
    }
  }
  return samples
}

const raw = readFileSync(CHART_PATH, 'utf-8')
const chart = parseChart(raw)

writeFileSync(path.join(OUT_DIR, 'perfect.json'), JSON.stringify(generatePerfectTrace(chart)))
writeFileSync(path.join(OUT_DIR, 'silence.json'), JSON.stringify(generateSilenceTrace(chart)))

console.log(`Generated fixtures/gameplay-traces/{perfect,silence}.json for ${chart.notes.length} notes.`)
