import { readFileSync } from 'node:fs'
import type { NoteKind, SongChart, SongLine, SongMeta, SongNote } from './types'

const NOTE_KIND_BY_MARKER: Record<string, NoteKind> = {
  ':': 'normal',
  '*': 'golden',
  F: 'freestyle',
  R: 'rap',
  G: 'goldenRap',
}

const NOTE_LINE_PATTERN = /^([:*FRG])\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s(.*)$/
const LINE_BREAK_PATTERN = /^-\s+(-?\d+)\s*$/

/**
 * Minimal UltraStar .txt -> SongChart loader for fixtures and tests.
 * Not the tolerant library parser (electron/library/parser.cjs) — assumes a well-formed file.
 */
export function loadFixtureChart(filePath: string): SongChart {
  const raw = readFileSync(filePath, 'utf-8')
  const lines = raw.split(/\r?\n/)

  const meta = parseMeta(lines)
  const chartLines = parseLines(lines)

  return { meta, lines: chartLines }
}

function parseMeta(lines: string[]): SongMeta {
  const tags = new Map<string, string>()
  for (const line of lines) {
    if (!line.startsWith('#')) continue
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) continue
    const tag = line.slice(1, separatorIndex).trim().toUpperCase()
    const value = line.slice(separatorIndex + 1).trim()
    tags.set(tag, value)
  }

  return {
    artist: tags.get('ARTIST') ?? '',
    title: tags.get('TITLE') ?? '',
    mp3Path: tags.get('MP3') ?? '',
    videoPath: tags.get('VIDEO'),
    coverPath: tags.get('COVER'),
    bpm: Number(tags.get('BPM') ?? 0),
    gap: Number(tags.get('GAP') ?? 0),
    videoGap: Number(tags.get('VIDEOGAP') ?? 0),
    language: tags.get('LANGUAGE'),
    edition: tags.get('EDITION'),
  }
}

function parseLines(lines: string[]): SongLine[] {
  const result: SongLine[] = []
  let current: SongLine = { part: 'solo', notes: [] }

  const flushCurrentLine = () => {
    if (current.notes.length > 0) result.push(current)
  }

  for (const line of lines) {
    if (line === 'E') break

    const noteMatch = line.match(NOTE_LINE_PATTERN)
    if (noteMatch) {
      const [, marker, startBeat, length, pitch, syllable] = noteMatch
      const note: SongNote = {
        kind: NOTE_KIND_BY_MARKER[marker],
        startBeat: Number(startBeat),
        length: Number(length),
        pitch: Number(pitch),
        syllable: syllable.replace(/\s+$/, ''),
      }
      current.notes.push(note)
      continue
    }

    const lineBreakMatch = line.match(LINE_BREAK_PATTERN)
    if (lineBreakMatch) {
      current.lineBreakBeat = Number(lineBreakMatch[1])
      flushCurrentLine()
      current = { part: 'solo', notes: [] }
    }
  }

  flushCurrentLine()
  return result
}
