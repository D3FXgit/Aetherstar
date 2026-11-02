import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AudienceResultsView } from '../AudienceResultsView'
import type { SongChart, SongLine } from '../../contracts/types'
import type { AudienceResultRow } from '../types'

const NOTE = { kind: 'normal' as const, startBeat: 0, length: 4, pitch: 60, syllable: 'la' }
/** A duet with no shared lines: lanes alternate P1, P2, P1 (see laneParts.ts). */
const DUET: SongLine[] = [
  { part: 'p1', notes: [NOTE] },
  { part: 'p2', notes: [{ ...NOTE, startBeat: 8 }] },
]
const CHART: SongChart = { meta: {} as never, lines: DUET }

vi.mock('../../stage/chart/useChartLoader', () => ({
  useChartLoader: () => ({ status: 'ready', chart: CHART, sourceDir: '/library/duet', error: null }),
}))

function row(name: string, micNumber: number, score: number): AudienceResultRow {
  return { playerId: name, name, micNumber, avatarUrl: '', score, epicCount: 0, goodCount: 0, awfulCount: 0, bestLine: null }
}

describe('AudienceResultsView', () => {
  // Review finding: the television ranked a third duet singer against the
  // shared lines only (0 here), where the host's lane gave them P1.
  it('ranks each singer against the lines their lane sang, as the host does', () => {
    render(
      <AudienceResultsView
        song={{ path: '/library/duet', title: 'Duet', artist: 'Test', coverUrl: null }}
        results={[row('A', 1, 9_600), row('B', 2, 9_500), row('C', 3, 9_400)]}
      />,
    )

    const ratings = screen.getAllByTestId('audience-results-row-rating').map((node) => node.textContent)
    expect(ratings).toEqual(['Superstar', 'Superstar'])
  })
})
