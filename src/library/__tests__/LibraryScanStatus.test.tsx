import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LibraryScanStatus } from '../LibraryScanStatus'
import type { ScanProgress } from '../types'

function progress(overrides: Partial<ScanProgress> = {}): ScanProgress {
  return { rootPath: '/library', songsFound: 1284, songsParsed: 412, currentPath: null, done: false, errorCount: 0, ...overrides }
}

describe('LibraryScanStatus', () => {
  it('reads out the indexed song count when nothing is scanning', () => {
    render(<LibraryScanStatus isReindexing={false} scanProgress={{}} indexedCount={1284} />)

    expect(screen.getByTestId('library-scan-status')).toHaveTextContent('1,284 songs indexed')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  // scanProgress carries real songsParsed/songsFound counts from the scanner, so
  // there is no excuse for an indeterminate spinner here: "use a determinate
  // progress indicator when you know how long loading will take".
  it('shows determinate progress -- real parsed/found counts, not a spinner -- while a scan is running', () => {
    render(<LibraryScanStatus isReindexing scanProgress={{ '/library': progress() }} indexedCount={1284} />)

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '412')
    expect(bar).toHaveAttribute('aria-valuemax', '1284')
    expect(screen.getByTestId('library-scan-status')).toHaveTextContent('412 / 1,284')
  })

  it('sums the counts across every root still being walked', () => {
    render(
      <LibraryScanStatus
        isReindexing
        scanProgress={{
          '/a': progress({ rootPath: '/a', songsParsed: 10, songsFound: 40 }),
          '/b': progress({ rootPath: '/b', songsParsed: 5, songsFound: 60 }),
        }}
        indexedCount={0}
      />,
    )

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '15')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '100')
  })

  it('ignores roots that have already finished, so a completed scan does not pad the bar', () => {
    render(
      <LibraryScanStatus
        isReindexing
        scanProgress={{
          '/a': progress({ rootPath: '/a', songsParsed: 40, songsFound: 40, done: true }),
          '/b': progress({ rootPath: '/b', songsParsed: 5, songsFound: 60 }),
        }}
        indexedCount={40}
      />,
    )

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '60')
  })

  // The scanner has to walk before it can count, so there is a beat between
  // "refresh started" and the first progress event. Saying so beats a bar that
  // sits at zero.
  it('says the refresh has started before the first progress event arrives, with no bar to sit at zero', () => {
    render(<LibraryScanStatus isReindexing scanProgress={{}} indexedCount={1284} />)

    expect(screen.getByTestId('library-scan-status')).toHaveTextContent(/refreshing library/i)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  // Status, not an alert: it must reach a screen reader without interrupting
  // whatever the user is doing in the grid.
  it('announces politely rather than interrupting', () => {
    render(<LibraryScanStatus isReindexing scanProgress={{}} indexedCount={0} />)

    const status = screen.getByTestId('library-scan-status')
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })
})
