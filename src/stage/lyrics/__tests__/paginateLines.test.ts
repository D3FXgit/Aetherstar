import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { paginateLines } from '../paginateLines'
import { parseChartText } from '../../chart/parseChartText'

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures/sample-song/notes.txt',
)
const chart = parseChartText(readFileSync(FIXTURE_PATH, 'utf-8'))

describe('paginateLines', () => {
  it('returns the first two lines as current/next at index 0', () => {
    const { currentLine, nextLine } = paginateLines(chart.lines, 0)
    expect(currentLine).toBe(chart.lines[0])
    expect(nextLine).toBe(chart.lines[1])
  })

  it('returns a null next line on the chart\'s last line', () => {
    const lastIndex = chart.lines.length - 1
    const { currentLine, nextLine } = paginateLines(chart.lines, lastIndex)
    expect(currentLine).toBe(chart.lines[lastIndex])
    expect(nextLine).toBeNull()
  })
})
