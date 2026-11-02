import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { parseChartText } from '../../../stage/chart/parseChartText'
import { flattenNotes } from '../flattenNotes'

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures/sample-song/notes.txt',
)

const raw = readFileSync(FIXTURE_PATH, 'utf-8')

describe('flattenNotes', () => {
  it('flattens every line\'s notes in chart order with deterministic ids', () => {
    const chart = parseChartText(raw)

    const flat = flattenNotes(chart.lines)

    expect(flat[0]).toEqual({ ...chart.lines[0].notes[0], noteId: 'note-0' })
    expect(flat[1]).toEqual({ ...chart.lines[0].notes[1], noteId: 'note-1' })

    const secondLineFirstNoteFlatIndex = chart.lines[0].notes.length
    expect(flat[secondLineFirstNoteFlatIndex]).toEqual({
      ...chart.lines[1].notes[0],
      noteId: `note-${secondLineFirstNoteFlatIndex}`,
    })

    const totalNotes = chart.lines.reduce((sum, line) => sum + line.notes.length, 0)
    expect(flat).toHaveLength(totalNotes)
  })
})
